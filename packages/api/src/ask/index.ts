/**
 * "Ask RestoMatch" orchestration: Claude when keyed and within budget, else
 * (or on any Claude failure) the deterministic offline engine. Always records
 * one question in assistant_usage (no text stored).
 */
import type { Database } from '@restomatch/db';
import { TRPCError } from '@trpc/server';
import { addClaudeSpend, allowAskBurst, recordUsage, reserveQuestion } from './budget';
import { anthropicAskClient, AskRunError, runClaude, type AskClientLike } from './claude';
import { groundAnswer, type Citation } from './grounding';
import { offlineAnswer, type CannedIntent } from './offline';
import type { ScreenLink } from './tools';

export type AskMode = 'claude' | 'offline';
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
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<AskResult> {
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

  if (client && reason === null) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
    try {
      const r = await runClaude(client, question, locale, { db, restaurantId, now, locale }, today);
      await addClaudeSpend(db, restaurantId, { claudeCalls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, now);
      const g = groundAnswer(r.answer, r.links, r.figures);
      const linkSet = new Set(g.citations.map((c) => c.href));
      return {
        mode: 'claude',
        answer: g.answer,
        citations: g.citations,
        grounded: g.grounded,
        intent: null,
        facts: {},
        links: r.links.filter((l) => linkSet.has(l.href)),
        reason: null,
      };
    } catch (err) {
      // A failed leg was still billed: count what it spent.
      if (err instanceof AskRunError) await addClaudeSpend(db, restaurantId, { claudeCalls: err.usage.calls, inputTokens: err.usage.inputTokens, outputTokens: err.usage.outputTokens }, now);
      // Message only — never the request/response (they hold restaurant data).
      console.warn('[ask] Claude leg failed — offline answer:', err instanceof Error ? err.message : 'error');
      reason = 'error';
    }
  }

  const off = await offlineAnswer(db, restaurantId, question, now, locale);
  if (!counted) await recordUsage(db, restaurantId, { claudeCalls: 0, inputTokens: 0, outputTokens: 0 }, now);
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
export { askSystemPrompt, ASK_MODEL, type AskClientLike } from './claude';
export { groundAnswer, figuresIn } from './grounding';
export { clip, monthKey, runTool, TOOL_DEFINITIONS } from './tools';
