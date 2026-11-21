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
 * Reuse, not a second engine: the tool loop is Ask's `runAskLoop` (AU-06):
 * same model, effort, answer schema, turn cap and failure accounting as the
 * web. The usage rows (`assistant_usage`), cost caps, grounding and sanitiser
 * are Ask's too. WA-02 owns only the system prompt, the role tool set and the
 * tool runner (allow-list + redaction before the model).
 */
import type { Database, UserRole } from '@restomatch/db';
import { addClaudeSpend, estimateCostMicroUsd, recordUsage, reserveQuestion } from '../ask/budget';
import { anthropicAskClient, AskRunError, runAskLoop, type AskClientLike } from '../ask/claude';
import { groundAnswer } from '../ask/grounding';
import type { ScreenLink, ToolOutput } from '../ask/tools';
import { isFeatureOn } from '../lib/featureGate';
import { beginTask, personHasTurn, takePersonTurn } from './budget';
import { assertAgentConnection, callTool, runInAgentTx, ToolNotAllowedError, type AgentBinding, type ToolCallResult } from './caller';
import { HE } from './copy/he';
import { goLinks } from './links';
import { systemPrompt } from './prompt';
import { toolDefinitionsFor, toolsFor } from './registry';
import { composeMessage, factsText } from './render';

export type { AgentBinding } from './caller';
export { routeMessage, commandOf, type InboundMessage, type RouteResult, type RouterDeps } from './router';

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

export interface RunAgentOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Test/future seam: roles beyond AGENT_LIVE_ROLES (WA-09 chef, WA-10 receiver). */
  enableRoles?: readonly UserRole[];
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
  const results: ToolCallResult[] = [];
  let refusal: AgentRefusal | null = null;
  const spend = async (u: { calls: number; inputTokens: number; outputTokens: number }) => {
    await runInAgentTx(db, binding, (tx) =>
      addClaudeSpend(tx, binding.restaurantId, { claudeCalls: u.calls, inputTokens: u.inputTokens, outputTokens: u.outputTokens }, now),
    );
    return estimateCostMicroUsd(u.inputTokens, u.outputTokens);
  };
  // The tool runner: role allow-list → input parse → run → REDACT → figures/links.
  // Its errors carry fixed text only (Ask's loop forwards a thrown message to the model).
  const runTool = async (name: string, input: unknown): Promise<ToolOutput> => {
    try {
      const r = await callTool(db, binding, name, input, { now });
      used.push(r.name);
      results.push(r);
      return { data: r.data, links: r.links.map((href) => ({ href, screen: 'overview' as const })), figures: r.figures };
    } catch (err) {
      if (err instanceof ToolNotAllowedError) {
        refusal = 'tool_not_allowed';
        console.warn('[wa.agent] refusal: tool_not_allowed', JSON.stringify({ role: binding.role, tool: name.slice(0, 60) }));
        throw new Error('tool not allowed');
      }
      throw new Error('tool failed');
    }
  };

  let run: Awaited<ReturnType<typeof runAskLoop>>;
  try {
    run = await runAskLoop(client, {
      system: systemPrompt(binding.role, binding.restaurantName, today),
      tools: toolDefinitionsFor(binding.role),
      runTool,
      messages: [...history.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: question }],
    });
  } catch (err) {
    const usage = err instanceof AskRunError ? err.usage : { calls: 0, inputTokens: 0, outputTokens: 0 };
    const cost = await spend(usage);
    throw new ModelTurnError(err instanceof Error ? err.message : 'model failed', usage.calls, cost);
  }
  const calls = run.calls;
  const costMicroUsd = await spend(run);
  const answer = run.answer;

  if (answer.answer.trim() === 'OFF_LIST' && results.length === 0) {
    return { text: '', grounded: true, refusal: 'off_list' as AgentRefusal, links: [], calls, costMicroUsd, offList: true };
  }

  const paths = results.flatMap((r) => r.links);
  const screenLinks: ScreenLink[] = paths.map((href) => ({ href, screen: 'overview' }));
  // Figures from the REDACTED results only (the same values the model saw).
  const g = groundAnswer(answer, screenLinks, run.figures);
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
