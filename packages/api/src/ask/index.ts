/**
 * "Ask RestoMatch" orchestration: Claude when keyed and within budget, else
 * (or on any Claude failure) the deterministic offline engine. Always records
 * one question in assistant_usage (no text stored).
 */
import type { Database, UserRole } from '@restomatch/db';
import { recordAudit, type AuditAction } from '../audit';
import { TRPCError } from '@trpc/server';
import { addClaudeSpend, allowAskBurst, recordUsage, reserveQuestion } from './budget';
import { anthropicAskClient, AskRunError, runClaude, type AskClientLike } from './claude';
import { groundAnswer, type Citation } from './grounding';
import { offlineAnswer, type CannedIntent } from './offline';
import { isOpsIntent, OPS_INTENT_TOOL } from './opsOffline';
import type { ScreenLink } from './tools';

export type AskMode = 'claude' | 'offline';
export type AskChannel = 'web' | 'whatsapp';
export type OfflineReason = 'noKey' | 'budget' | 'error';

export interface AskResult {
  mode: AskMode;
  /** claude: the model's grounded text. offline: null (the web renders `facts`). */
  answer: string | null;
  citations: Citation[];
  grounded: boolean;
  intent: CannedIntent | null;
  facts: Record<string, unknown>;
  links: ScreenLink[];
  reason: OfflineReason | null;
}

let clientOverride: AskClientLike | null | undefined;
/** Test seam: a fake Claude client (null = force offline). */
export function __setAskClient(c: AskClientLike | null | undefined): void {
  clientOverride = c;
}

function askClient(env: NodeJS.ProcessEnv): AskClientLike | null {
  if (clientOverride !== undefined) return clientOverride;
  const key = env.ANTHROPIC_API_KEY;
  if (!key || env.ASK_WITH_CLAUDE === '0') return null;
  return anthropicAskClient(key);
}

export async function runAsk(
  db: Database,
  restaurantId: string,
  question: string,
  locale: 'he' | 'en',
  opts: {
    now?: Date;
    env?: NodeJS.ProcessEnv;
    role?: UserRole;
    userId?: string | null;
    /** Where the question came from (WA-02 passes 'whatsapp'). No behaviour change yet. */
    channel?: AskChannel;
  } = {},
): Promise<AskResult> {
  const role = opts.role;
  const now = opts.now ?? new Date();
  const client = askClient(opts.env ?? process.env);
  // Burst limit on every path (offline answers run DB aggregates too).
  if (!(await allowAskBurst(restaurantId, now.getTime()))) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'יותר מדי שאלות בדקה. נסו שוב בעוד רגע.' });
  }
  let reason: OfflineReason | null = null;
  // Reserve the question atomically BEFORE any spend (counts it when allowed).
  let counted = false;
  if (!client) reason = 'noKey';
  else if (!(await reserveQuestion(db, restaurantId, now))) reason = 'budget';
  else counted = true;

  let online: { result: AskResult; tools: string[] } | null = null;
  if (client && reason === null) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
    try {
      const r = await runClaude(client, question, locale, { db, restaurantId, now, locale, role }, today);
      await addClaudeSpend(db, restaurantId, { claudeCalls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, now);
      const g = groundAnswer(r.answer, r.links, r.figures);
      const linkSet = new Set(g.citations.map((c) => c.href));
      online = {
        result: {
          mode: 'claude',
          answer: g.answer,
          citations: g.citations,
          grounded: g.grounded,
          intent: null,
          facts: {},
          links: r.links.filter((l) => linkSet.has(l.href)),
          reason: null,
        },
        tools: r.toolsUsed,
      };
    } catch (err) {
      // A failed leg was still billed: count what it spent.
      if (err instanceof AskRunError) await addClaudeSpend(db, restaurantId, { claudeCalls: err.usage.calls, inputTokens: err.usage.inputTokens, outputTokens: err.usage.outputTokens }, now);
      // Message only — never the request/response (they hold restaurant data).
      console.warn('[ask] Claude leg failed — offline answer:', err instanceof Error ? err.message : 'error');
      reason = 'error';
    }
  }
  if (online) {
    // Outside the try: a failed audit insert must surface, not fall back offline inside an aborted tx.
    await recordAnswered(db, restaurantId, opts.userId, {
      intent: null,
      tools: online.tools,
      mode: 'online',
      grounded: online.result.grounded,
    });
    return online.result;
  }

  const off = await offlineAnswer(db, restaurantId, question, now, locale, role);
  if (!counted) await recordUsage(db, restaurantId, { claudeCalls: 0, inputTokens: 0, outputTokens: 0 }, now);
  await recordAnswered(db, restaurantId, opts.userId, {
    intent: off.intent,
    tools: off.intent && isOpsIntent(off.intent) ? [OPS_INTENT_TOOL[off.intent]] : [],
    mode: 'offline',
    grounded: true,
  });
  return {
    mode: 'offline',
    answer: null,
    citations: [],
    grounded: true,
    intent: off.intent,
    facts: off.facts,
    links: off.links,
    reason,
  };
}

/** INTERIM(G-05): G-05 adds 'ask.answered' to AuditAction in its sweep; then drop the cast. */
const ASK_ANSWERED = 'ask.answered' as unknown as AuditAction;

/**
 * KPI hook (AU-06 → AU-07): one audit_log row per answered question. Never the
 * question text, never a ₪ figure — only which intent/tools answered and how.
 */
async function recordAnswered(
  db: Database,
  restaurantId: string,
  userId: string | null | undefined,
  after: { intent: CannedIntent | null; tools: string[]; mode: 'online' | 'offline'; grounded: boolean },
): Promise<void> {
  await recordAudit(db, {
    restaurantId,
    userId: userId ?? null,
    action: ASK_ANSWERED,
    entityType: 'ask',
    after: { automationId: 'A11', ...after, tools: [...new Set(after.tools)] },
  });
}

export { AskRunError } from './claude';
export { CANNED_INTENTS, classifyQuestion, type CannedIntent } from './offline';
export {
  ASK_BURST_LIMIT,
  ASK_COST_MICRO_USD_PER_DAY,
  ASK_QUESTIONS_PER_DAY,
  setAskBurstLimiter,
  usageToday,
  __resetAskBurst,
  type AskBurstLimiter,
} from './budget';
export {
  askSystemPrompt,
  ASK_MODEL,
  AnswerSchema as ASK_ANSWER_SCHEMA,
  ANSWER_JSON_SCHEMA as ASK_ANSWER_JSON_SCHEMA,
  runAskLoop,
  type AskClientLike,
  type AskLoopOptions,
  type ClaudeAnswer,
  type ClaudeRunResult,
} from './claude';
export { groundAnswer, figuresIn } from './grounding';
export { clip, monthKey, runTool, TOOL_DEFINITIONS } from './tools';
export { OPS_TOOL_NAMES, type OpsToolName } from './opsTools';
export { OPS_INTENTS, type OpsIntent } from './opsOffline';
export { TOOL_ROLES, canUseTool, redactForRole } from './roles';
