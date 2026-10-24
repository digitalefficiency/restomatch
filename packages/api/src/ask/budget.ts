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
/**
 * Anti-hammering only (offline answers run DB aggregates): roomy enough that a
 * person clicking through every suggestion in he and en never sees a 429. Spend
 * is bounded by the daily caps above, not by this.
 */
export const ASK_BURST_PER_MINUTE = 30;
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

/**
 * The app's rate limiter (`enforceRateLimit` from apps/web/lib/rateLimit.ts),
 * injected by the web app at boot — the assistant has no limiter of its own.
 * Kept on globalThis so every server bundle of this package in the process sees
 * the same registration. The process-local window above is only a FALLBACK:
 * when nothing is registered (tests, scripts) or the shared limiter throws.
 */
export type AskBurstLimiter = (restaurantId: string) => Promise<boolean>;
const LIMITER_KEY = Symbol.for('restomatch.askBurstLimiter');
type LimiterHolder = { [LIMITER_KEY]?: AskBurstLimiter | null };

export function setAskBurstLimiter(fn: AskBurstLimiter | null): void {
  (globalThis as LimiterHolder)[LIMITER_KEY] = fn;
}

/** The registered shared limiter decides; the process-local window only when there is none (or it throws). */
export async function allowAskBurst(restaurantId: string, now: number = Date.now()): Promise<boolean> {
  const shared = (globalThis as LimiterHolder)[LIMITER_KEY];
  if (shared) {
    try {
      return await shared(restaurantId);
    } catch {
      // limiter outage → fall back to the local window below
    }
  }
  return takeBurst(restaurantId, now);
}

/** The shared limiter's policy (ASK_BURST_PER_MINUTE questions / minute / restaurant). */
export const ASK_BURST_LIMIT = { limit: ASK_BURST_PER_MINUTE, windowSec: 60, prefix: 'ask' } as const;

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

/**
 * Atomically count one question against today's caps BEFORE calling Claude:
 * the upsert only increments while both caps hold, and the row lock makes
 * concurrent asks of one restaurant serialize on it (no check-then-act race).
 * Returns false (nothing counted) when the day is spent.
 */
export async function reserveQuestion(db: Database, restaurantId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .insert(assistantUsage)
    .values({ restaurantId, day: utcDay(now), questions: 1 })
    .onConflictDoUpdate({
      target: [assistantUsage.restaurantId, assistantUsage.day],
      set: { questions: sql`${assistantUsage.questions} + 1`, updatedAt: sql`now()` },
      setWhere: sql`${assistantUsage.questions} < ${ASK_QUESTIONS_PER_DAY} and ${assistantUsage.costMicroUsd} < ${ASK_COST_MICRO_USD_PER_DAY}`,
    })
    .returning({ questions: assistantUsage.questions });
  return rows.length > 0;
}

/** Add a reserved question's Claude spend (also on failure — tokens were billed). */
export async function addClaudeSpend(
  db: Database,
  restaurantId: string,
  add: { claudeCalls: number; inputTokens: number; outputTokens: number },
  now: Date = new Date(),
): Promise<void> {
  const cost = estimateCostMicroUsd(add.inputTokens, add.outputTokens);
  await db
    .update(assistantUsage)
    .set({
      claudeCalls: sql`${assistantUsage.claudeCalls} + ${add.claudeCalls}`,
      inputTokens: sql`${assistantUsage.inputTokens} + ${add.inputTokens}`,
      outputTokens: sql`${assistantUsage.outputTokens} + ${add.outputTokens}`,
      costMicroUsd: sql`${assistantUsage.costMicroUsd} + ${cost}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(assistantUsage.restaurantId, restaurantId), eq(assistantUsage.day, utcDay(now))));
}

/** Count one question (no caps; offline answers and over-budget questions). */
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
