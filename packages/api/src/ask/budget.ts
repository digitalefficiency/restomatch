/**
 * Per-restaurant cost guard for the assistant (the pattern of
 * receiving/english.ts, made durable): a process-local burst limit plus a daily
 * budget in `assistant_usage` (migration 0053, RLS) — questions per day and an
 * estimated Claude cost per day. Past either cap the question is answered by
 * the deterministic offline engine; nothing is ever refused for cost.
 */
import { and, assistantUsage, eq, sql, type Database } from '@restomatch/db';

export const ASK_QUESTIONS_PER_DAY = 60;
/** $3/day per restaurant (micro-USD). */
export const ASK_COST_MICRO_USD_PER_DAY = 3_000_000;
export const ASK_BURST_PER_MINUTE = 6;
/** claude-opus-5-5 list price: $4 / $20 per MTok → micro-USD per token. */
export const INPUT_MICRO_USD_PER_TOKEN = 4;
export const OUTPUT_MICRO_USD_PER_TOKEN = 20;

const burst = new Map<string, { windowStart: number; count: number }>();

/** True when this restaurant may ask another question this minute (process-local). */
export function takeBurst(restaurantId: string, now: number = Date.now()): boolean {
  const slot = burst.get(restaurantId);
  if (!slot || now - slot.windowStart >= 60_000) {
    if (burst.size >= 10_000) burst.clear();
    burst.set(restaurantId, { windowStart: now, count: 1 });
    return true;
  }
  if (slot.count >= ASK_BURST_PER_MINUTE) return false;
  slot.count += 1;
  return true;
}

/** Test seam. */
export function __resetAskBurst(): void {
  burst.clear();
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface UsageToday {
  questions: number;
  claudeCalls: number;
  costMicroUsd: number;
}

export async function usageToday(db: Database, restaurantId: string, now: Date = new Date()): Promise<UsageToday> {
  const [row] = await db
    .select()
    .from(assistantUsage)
    .where(and(eq(assistantUsage.restaurantId, restaurantId), eq(assistantUsage.day, utcDay(now))))
    .limit(1);
  return {
    questions: row?.questions ?? 0,
    claudeCalls: row?.claudeCalls ?? 0,
    costMicroUsd: row?.costMicroUsd ?? 0,
  };
}

export function claudeAllowed(u: UsageToday): boolean {
  return u.questions < ASK_QUESTIONS_PER_DAY && u.costMicroUsd < ASK_COST_MICRO_USD_PER_DAY;
}

export function estimateCostMicroUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_MICRO_USD_PER_TOKEN + outputTokens * OUTPUT_MICRO_USD_PER_TOKEN;
}

/** Atomically add one question (and its Claude usage, if any) to today's row. */
export async function recordUsage(
  db: Database,
  restaurantId: string,
  add: { claudeCalls: number; inputTokens: number; outputTokens: number },
  now: Date = new Date(),
): Promise<void> {
  const cost = estimateCostMicroUsd(add.inputTokens, add.outputTokens);
  await db
    .insert(assistantUsage)
    .values({
      restaurantId,
      day: utcDay(now),
      questions: 1,
      claudeCalls: add.claudeCalls,
      inputTokens: add.inputTokens,
      outputTokens: add.outputTokens,
      costMicroUsd: cost,
    })
    .onConflictDoUpdate({
      target: [assistantUsage.restaurantId, assistantUsage.day],
      set: {
        questions: sql`${assistantUsage.questions} + 1`,
        claudeCalls: sql`${assistantUsage.claudeCalls} + ${add.claudeCalls}`,
        inputTokens: sql`${assistantUsage.inputTokens} + ${add.inputTokens}`,
        outputTokens: sql`${assistantUsage.outputTokens} + ${add.outputTokens}`,
        costMicroUsd: sql`${assistantUsage.costMicroUsd} + ${cost}`,
        updatedAt: sql`now()`,
      },
    });
}
