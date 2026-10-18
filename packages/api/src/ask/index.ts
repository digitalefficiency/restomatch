/**
 * "Ask RestoMatch" orchestration: Claude when keyed and within budget, else
 * (or on any Claude failure) the deterministic offline engine. Always records
 * one question in assistant_usage (no text stored).
 */
import type { Database } from '@restomatch/db';
import { claudeAllowed, recordUsage, takeBurst, usageToday } from './budget';
import { anthropicAskClient, runClaude, type AskClientLike } from './claude';
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
  let reason: OfflineReason | null = null;

  if (!client) reason = 'noKey';
  else if (!takeBurst(restaurantId, now.getTime()) || !claudeAllowed(await usageToday(db, restaurantId, now))) {
    reason = 'budget';
  }

  if (client && reason === null) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
    try {
      const r = await runClaude(client, question, locale, { db, restaurantId, now }, today);
      await recordUsage(db, restaurantId, { claudeCalls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens }, now);
      const g = groundAnswer(r.answer, r.links, r.numbers);
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
      // Message only — never the request/response (they hold restaurant data).
      console.warn('[ask] Claude leg failed — offline answer:', err instanceof Error ? err.message : 'error');
      reason = 'error';
    }
  }

  const off = await offlineAnswer(db, restaurantId, question, now);
  await recordUsage(db, restaurantId, { claudeCalls: 0, inputTokens: 0, outputTokens: 0 }, now);
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

export { CANNED_INTENTS, classifyQuestion, type CannedIntent } from './offline';
export { ASK_COST_MICRO_USD_PER_DAY, ASK_QUESTIONS_PER_DAY, usageToday, __resetAskBurst } from './budget';
export { askSystemPrompt, ASK_MODEL, type AskClientLike } from './claude';
export { groundAnswer, figuresIn } from './grounding';
export { clip, monthKey, runTool, TOOL_DEFINITIONS } from './tools';
