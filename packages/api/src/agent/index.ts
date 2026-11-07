/**
 * `runAgent`: the read-only WhatsApp agent turn (WA-02) on the Ask engine.
 *
 * Order of a turn (each step can end it with a fixed Hebrew reply and NO
 * model call):
 *   app-role connection check → role enabled → feature on → closed-intent
 *   gate → one in-flight task per conversation → person budget → restaurant
 *   budget (Ask's `reserveQuestion`, reserve-before-spend) → model loop over
 *   the ROLE's tools (redacted before the model) → grounding (Ask's
 *   `groundAnswer`; ₪ or links in prose = ungrounded) → server ₪ facts +
 *   go-links appended after grounding → ≤ 1,024 chars.
 *
 * Model-off mode (no key, budget spent, model error): the same role tools run
 * deterministically for the classified intent and their server facts are sent.
 *
 * Reuse, not a second engine: the client type, pinned model constant, usage
 * rows (`assistant_usage`), cost caps, grounding and sanitiser are Ask's. The
 * loop below is an INTERIM until W3-04b exposes `runAskLoop` / a `channel`
 * option on `runAsk` (an addendum asked of its owner); it mirrors runClaude's
 * request shape and limits (≤ 4 tool turns).
 */
import type { Database, UserRole } from '@restomatch/db';
import { z } from 'zod';
import { addClaudeSpend, recordUsage, reserveQuestion } from '../ask/budget';
import { anthropicAskClient, ASK_MODEL, type AskClientLike } from '../ask/claude';
import { groundAnswer } from '../ask/grounding';
import type { Figures, ScreenLink } from '../ask/tools';
import { isFeatureOn } from '../lib/featureGate';
import { beginTask, personHasTurn, takePersonTurn } from './budget';
import { assertAgentConnection, callTool, runInAgentTx, ToolNotAllowedError, type AgentBinding, type ToolCallResult } from './caller';
import { HE } from './copy/he';
import { goLinks } from './links';
import { systemBlocks } from './prompt';
import { toolDefinitionsFor, toolsFor } from './registry';
import { composeMessage, factsText } from './render';

export type { AgentBinding } from './caller';
export { routeMessage, commandOf, type InboundMessage, type RouteResult, type RouterDeps } from './router';

const MAX_TURNS = 4;
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 30_000;
const HISTORY_TURNS = 6;
const HISTORY_TTL_MS = 24 * 3600_000;

/** Roles live in v1 of WA-02. Chef (WA-09) and receiver (WA-10) are refused until their flows ship. */
export const AGENT_LIVE_ROLES: readonly UserRole[] = ['owner', 'manager', 'bookkeeper'];

export type AgentRefusal = 'off' | 'role' | 'off_list' | 'busy' | 'budget_person' | 'budget_restaurant' | 'tool_not_allowed';
export type AgentIntent = 'decisions' | 'supplierLeak' | 'leak' | 'claims' | 'orders' | 'deliveries' | 'vat' | 'payRun' | 'invoices';

export interface AgentReply {
  text: string;
  mode: 'model' | 'modelOff' | 'fixed';
  grounded: boolean;
  intent: AgentIntent | null;
  refusal: AgentRefusal | null;
  tools: string[];
  links: string[];
  modelCalls: number;
}

/** The KPI hook (`wa.turn`): no message text, ever. */
export interface AgentTurnEvent {
  automationId: 'WA';
  channel: 'whatsapp';
  restaurantId: string;
  userId: string;
  role: UserRole;
  intent: AgentIntent | null;
  tools: string[];
  grounded: boolean;
  refusal: AgentRefusal | null;
  mode: AgentReply['mode'];
  costMicroUsd: number;
}
let turnSink: (e: AgentTurnEvent) => void = (e) => console.info('[wa.turn]', JSON.stringify(e));
/** Interim sink until `activity_event_type` has a WhatsApp value (WA-03ʰ / AU-07). */
export function setAgentTurnSink(fn: ((e: AgentTurnEvent) => void) | null): void {
  turnSink = fn ?? ((e) => console.info('[wa.turn]', JSON.stringify(e)));
}

let clientOverride: AskClientLike | null | undefined;
/** Test seam: a recorded/fake model client (null = force model-off). */
export function __setAgentClient(c: AskClientLike | null | undefined): void {
  clientOverride = c;
}
function agentClient(env: NodeJS.ProcessEnv): AskClientLike | null {
  if (clientOverride !== undefined) return clientOverride;
  const key = env.ANTHROPIC_API_KEY;
  if (!key || env.ASK_WITH_CLAUDE === '0') return null;
  return anthropicAskClient(key);
}

// ---------------------------------------------------------------- intents

const INTENT_RULES: Array<[AgentIntent, RegExp]> = [
  ['supplierLeak', /(דלף|דליפ|דולף|leak).*(אצל|מול|של|from|at)\s+\S/i],
  ['decisions', /(החלט|לאשר|אישור|אשר|ממתי|מחכ|approve|decision|queue|פער)/i],
  ['claims', /(זיכוי|זיכויים|החזר|לתבוע|credit|claim)/i],
  ['leak', /(דלף|דליפ|דולף|הפסד|leak)/i],
  ['payRun', /(ריצת תשלומ|לשלם|תשלומ|pay ?run|payment)/i],
  ['vat', /(מע"מ|מע״מ|מעמ|\bvat\b|מספר הקצאה)/i],
  ['deliveries', /(משלוח|אספק|יגיע|הגיע|מגיע|קבלת סחורה|סחורה|משאית|deliver|truck|receiv)/i],
  ['orders', /(הזמנ|order)/i],
  ['invoices', /(חשבוני|invoice|ספק|supplier|מחיר|התייקר|price)/i],
];

/** The closed intent of a message, or null (off-list: fixed refusal, no tool, no model). */
export function classifyAgentIntent(text: string): AgentIntent | null {
  for (const [intent, re] of INTENT_RULES) if (re.test(text)) return intent;
  return null;
}

/** Deterministic tool order per intent (model-off mode); the first the role has wins. */
const INTENT_TOOLS: Record<AgentIntent, string[]> = {
  decisions: ['approvals_summary', 'approvals_queue'],
  supplierLeak: ['supplier_leak'],
  leak: ['leak_hero'],
  claims: ['claimable_lines', 'recovery_claims'],
  orders: ['orders_list', 'today_deliveries'],
  deliveries: ['today_deliveries'],
  vat: ['vat_at_risk'],
  payRun: ['pay_run_month'],
  invoices: ['approvals_queue', 'leak_hero', 'today_deliveries', 'orders_list'],
};

export function supplierNameIn(text: string): string | null {
  const m = text.match(/(?:אצל|מול|של|from|at)\s+(.+?)[\s?!.״"']*$/i);
  const raw = m?.[1]?.replace(/\b(החודש|this month)\b/gi, '').trim();
  return raw ? raw.slice(0, 80) : null;
}

// ---------------------------------------------------------------- memory (interim)

type Turn = { role: 'user' | 'assistant'; text: string };
const memory = new Map<string, { at: number; turns: Turn[] }>();
function historyOf(key: string, now: number): Turn[] {
  const m = memory.get(key);
  if (!m || now - m.at > HISTORY_TTL_MS) return [];
  return m.turns;
}
function remember(key: string, now: number, ...turns: Turn[]): void {
  const prev = historyOf(key, now);
  if (memory.size >= 20_000) memory.clear();
  memory.set(key, { at: now, turns: [...prev, ...turns].slice(-HISTORY_TURNS) });
}
/** Test seam. */
export function __resetAgentMemory(): void {
  memory.clear();
}

// ---------------------------------------------------------------- the turn

const AnswerSchema = z.object({
  answer: z.string().min(1).max(1500),
  citations: z
    .array(
      z.object({
        label: z.string().max(120),
        value: z.number().nullable(),
        unit: z.enum(['ils', 'pct', 'count']).nullable(),
        href: z.string().max(200),
      }),
    )
    .max(8),
});
const ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], enum: ['ils', 'pct', 'count', null] },
          href: { type: 'string' },
        },
        required: ['label', 'value', 'unit', 'href'],
        additionalProperties: false,
      },
    },
  },
  required: ['answer', 'citations'],
  additionalProperties: false,
} as const;

export interface RunAgentOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Test/future seam: roles beyond AGENT_LIVE_ROLES (WA-09 chef, WA-10 receiver). */
  enableRoles?: readonly UserRole[];
  /** Test seam: see what the model was sent (tool results are already redacted). */
  onModelRequest?: (body: Record<string, unknown>) => void;
}

/**
 * One agent turn for a bound person. `db` MUST be the app-role connection
 * (`DATABASE_URL_APP`); identity comes from `binding` only.
 */
export async function runAgent(db: Database, binding: AgentBinding, text: string, opts: RunAgentOptions = {}): Promise<AgentReply> {
  await assertAgentConnection(db);
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  // Role in the key: a role switch never carries an earlier answer (₪) into a narrower role's context.
  const convKey = `${binding.restaurantId}:${binding.userId}:${binding.role}`;
  const tools: string[] = [];
  let modelCalls = 0;
  let costMicroUsd = 0;
  let intent: AgentIntent | null = null;

  const finish = (r: Omit<AgentReply, 'tools' | 'modelCalls' | 'intent'>): AgentReply => {
    const reply: AgentReply = { ...r, intent, tools: [...new Set(tools)], modelCalls };
    turnSink({
      automationId: 'WA',
      channel: 'whatsapp',
      restaurantId: binding.restaurantId,
      userId: binding.userId,
      role: binding.role,
      intent,
      tools: reply.tools,
      grounded: reply.grounded,
      refusal: reply.refusal,
      mode: reply.mode,
      costMicroUsd,
    });
    return reply;
  };
  const fixed = (t: string, refusal: AgentRefusal | null): AgentReply =>
    finish({ text: t, mode: 'fixed', grounded: true, refusal, links: [] });

  const live = [...AGENT_LIVE_ROLES, ...(opts.enableRoles ?? [])];
  if (!live.includes(binding.role)) return fixed(HE.roleNotYet, 'role');
  // Interim off switch: `aiAssistant` (WA-11 adds `whatsappAgent`); FEATURES_OFF is honoured inside.
  if (!(await runInAgentTx(db, binding, (tx) => isFeatureOn(tx, binding.restaurantId, 'aiAssistant')))) {
    return fixed(HE.off, 'off');
  }
  intent = classifyAgentIntent(text);
  if (!intent) return fixed(HE.offList(binding.restaurantName), 'off_list');

  const release = beginTask(convKey);
  if (!release) return fixed(HE.busy, 'busy');
  try {
    const client = agentClient(env);
    let notice: string | null = null;
    let refusal: AgentRefusal | null = null;
    let counted = false;
    if (!(await personHasTurn(binding.restaurantId, binding.userId, now))) {
      notice = HE.budgetPerson;
      refusal = 'budget_person';
    } else if (client) {
      if (await runInAgentTx(db, binding, (tx) => reserveQuestion(tx, binding.restaurantId, now))) {
        counted = true;
        await takePersonTurn(binding.restaurantId, binding.userId, now);
      } else {
        notice = HE.budgetRestaurant;
        refusal = 'budget_restaurant';
      }
    }

    if (client && counted) {
      try {
        const r = await modelTurn(db, binding, client, text, historyOf(convKey, now.getTime()), now, opts, tools);
        modelCalls = r.calls;
        costMicroUsd = r.costMicroUsd;
        if (r.offList) return fixed(HE.offList(binding.restaurantName), 'off_list');
        remember(convKey, now.getTime(), { role: 'user', text }, { role: 'assistant', text: r.text });
        return finish({ text: r.text, mode: 'model', grounded: r.grounded, refusal: r.refusal, links: r.links });
      } catch (err) {
        if (err instanceof ModelTurnError) {
          modelCalls = err.calls;
          costMicroUsd = err.costMicroUsd;
        }
        console.warn('[wa.agent] model leg failed, model-off answer:', err instanceof Error ? err.message.slice(0, 120) : 'error');
      }
    }

    // Model-off mode: the role's tools for the intent, server facts only.
    if (!counted) await runInAgentTx(db, binding, (tx) => recordUsage(tx, binding.restaurantId, { claudeCalls: 0, inputTokens: 0, outputTokens: 0 }, now));
    const off = await modelOffAnswer(db, binding, intent, text, now, tools, env);
    const body = notice ? `${notice}\n\n${off.text}` : off.text;
    return finish({ text: composeMessage(body, off.links), mode: 'modelOff', grounded: true, refusal, links: off.links });
  } finally {
    release();
  }
}

class ModelTurnError extends Error {
  constructor(message: string, readonly calls: number, readonly costMicroUsd: number) {
    super(message);
  }
}

async function modelOffAnswer(
  db: Database,
  binding: AgentBinding,
  intent: AgentIntent,
  text: string,
  now: Date,
  used: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ text: string; links: string[] }> {
  const mine = new Set(toolsFor(binding.role).map((t) => t.name));
  const name = INTENT_TOOLS[intent].find((n) => mine.has(n));
  if (!name) return { text: HE.offList(binding.restaurantName), links: [] };
  let input: unknown = {};
  if (name === 'supplier_leak') {
    const supplier = supplierNameIn(text);
    if (!supplier) return { text: HE.supplierNotFound, links: [] };
    input = { supplier };
  }
  used.push(name);
  const r = await callTool(db, binding, name, input, { now });
  return { text: r.verdict ?? factsText(r.facts), links: goLinks(binding.restaurantId, r.links, 1, env) };
}

const INPUT_MICRO_USD_PER_TOKEN = 4;
const OUTPUT_MICRO_USD_PER_TOKEN = 20;
const SHEKEL_IN_PROSE = /₪|ש"ח|ש״ח|\bשקל/;

async function modelTurn(
  db: Database,
  binding: AgentBinding,
  client: AskClientLike,
  question: string,
  history: Turn[],
  now: Date,
  opts: RunAgentOptions,
  used: string[],
): Promise<{ text: string; grounded: boolean; refusal: AgentRefusal | null; links: string[]; calls: number; costMicroUsd: number; offList: boolean }> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: question },
  ];
  const results: ToolCallResult[] = [];
  let refusal: AgentRefusal | null = null;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const spend = async () => {
    await runInAgentTx(db, binding, (tx) =>
      addClaudeSpend(tx, binding.restaurantId, { claudeCalls: calls, inputTokens, outputTokens }, now),
    );
    return inputTokens * INPUT_MICRO_USD_PER_TOKEN + outputTokens * OUTPUT_MICRO_USD_PER_TOKEN;
  };

  let answer: z.infer<typeof AnswerSchema> | null = null;
  try {
    for (let turn = 0; turn < MAX_TURNS && !answer; turn += 1) {
      calls += 1;
      const body: Record<string, unknown> = {
        model: ASK_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_JSON_SCHEMA } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: systemBlocks(binding.role, binding.restaurantName, today),
        tools: toolDefinitionsFor(binding.role),
        tool_choice: { type: 'auto' },
        messages,
      };
      opts.onModelRequest?.(body);
      const res = await client.create(body, { timeout: TIMEOUT_MS });
      inputTokens += res.usage?.input_tokens ?? 0;
      outputTokens += res.usage?.output_tokens ?? 0;
      if (res.stop_reason === 'refusal') throw new Error('model refused');
      if (res.stop_reason === 'max_tokens') throw new Error('model hit max_tokens');
      const toolUses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && toolUses.length > 0) {
        messages.push({ role: 'assistant', content: res.content });
        const out = await Promise.all(
          toolUses.map(async (b) => {
            const name = String(b.name);
            try {
              const r = await callTool(db, binding, name, b.input, { now });
              used.push(r.name);
              results.push(r);
              return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ data: r.data, links: r.links }) };
            } catch (err) {
              if (err instanceof ToolNotAllowedError) {
                refusal = 'tool_not_allowed';
                console.warn('[wa.agent] refusal: tool_not_allowed', JSON.stringify({ role: binding.role, tool: name.slice(0, 60) }));
                return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'tool not allowed' };
              }
              return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'tool failed' };
            }
          }),
        );
        messages.push({ role: 'user', content: out });
        continue;
      }
      const raw = res.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      answer = AnswerSchema.parse(JSON.parse(raw));
    }
    if (!answer) throw new Error('model used too many tool turns');
  } catch (err) {
    const cost = await spend();
    throw new ModelTurnError(err instanceof Error ? err.message : 'model failed', calls, cost);
  }
  const costMicroUsd = await spend();

  if (answer.answer.trim() === 'OFF_LIST' && results.length === 0) {
    return { text: '', grounded: true, refusal: 'off_list' as AgentRefusal, links: [], calls, costMicroUsd, offList: true };
  }

  const paths = results.flatMap((r) => r.links);
  const screenLinks: ScreenLink[] = paths.map((href) => ({ href, screen: 'overview' }));
  const figures: Figures = { ils: [], pct: [], count: [] };
  for (const r of results) {
    figures.ils.push(...r.figures.ils);
    figures.pct.push(...r.figures.pct);
    figures.count.push(...r.figures.count);
  }
  const g = groundAnswer(answer, screenLinks, figures);
  // The model never formats ₪: a ₪ (or "שקל") in prose is ungrounded by rule.
  const grounded = g.grounded && results.length > 0 && !SHEKEL_IN_PROSE.test(g.answer);
  const verdicts = results.map((r) => r.verdict).filter((v): v is string => Boolean(v));
  const facts = results.flatMap((r) => r.facts).slice(0, 6);

  let body: string;
  if (verdicts.length) body = [...new Set(verdicts)].join('\n');
  else if (grounded) body = facts.length ? `${g.answer}\n${facts.slice(0, 4).map((f) => `• ${f}`).join('\n')}` : g.answer;
  else body = factsText(facts);

  const cited = g.citations.map((c) => c.href);
  const links = goLinks(binding.restaurantId, [...cited, ...paths], 1, opts.env ?? process.env);
  return { text: composeMessage(body, links), grounded, refusal, links, calls, costMicroUsd, offList: false };
}
