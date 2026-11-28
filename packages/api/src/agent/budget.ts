/**
 * Per-person budgets of the WhatsApp agent (WA-02, WD8), INSIDE the
 * restaurant's Ask budget (ask/budget.ts: 60 questions and ≈ $3 a day; one
 * usage record, one cost cap):
 *  - 30 model turns per person per day. A person past it gets the fixed
 *    "quota" copy and model-off handling; colleagues are unaffected until the
 *    restaurant budget is spent.
 *  - One in-flight model task per conversation (binding).
 *
 * Interim store: `rate_limit_counters` is deny-all for the app role and the
 * WA-03ʰ conversation table does not exist yet, so the per-person counter is a
 * registrable store (like `setAskBurstLimiter`): the web app may register a
 * shared one at boot; the process-local window below is the default.
 */
import { utcDay } from '../ask/budget';

export const AGENT_TURNS_PER_PERSON_PER_DAY = 30;

export interface PersonTurnStore {
  /** Turns used today by `key` (no increment). */
  used(key: string): Promise<number>;
  /** Atomically count one turn when below `limit`; false (nothing counted) at the limit. */
  take(key: string, limit: number): Promise<boolean>;
}

function memoryStore(): PersonTurnStore & { clear(): void } {
  const counts = new Map<string, number>();
  return {
    async used(key) {
      return counts.get(key) ?? 0;
    },
    async take(key, limit) {
      const n = counts.get(key) ?? 0;
      if (n >= limit) return false;
      if (counts.size >= 50_000) counts.clear();
      counts.set(key, n + 1);
      return true;
    },
    clear() {
      counts.clear();
    },
  };
}

const local = memoryStore();
const STORE_KEY = Symbol.for('restomatch.agentTurnStore');
type Holder = { [STORE_KEY]?: PersonTurnStore | null };

export function setAgentTurnStore(store: PersonTurnStore | null): void {
  (globalThis as Holder)[STORE_KEY] = store;
}

function store(): PersonTurnStore {
  return (globalThis as Holder)[STORE_KEY] ?? local;
}

export function personKey(restaurantId: string, userId: string, now: Date = new Date()): string {
  return `wa:turns:${restaurantId}:${userId}:${utcDay(now)}`;
}

/** True while this person still has a model turn today. */
export async function personHasTurn(restaurantId: string, userId: string, now: Date = new Date()): Promise<boolean> {
  return (await store().used(personKey(restaurantId, userId, now))) < AGENT_TURNS_PER_PERSON_PER_DAY;
}

/** Count one model turn for the person (after the restaurant reservation succeeded). */
export async function takePersonTurn(restaurantId: string, userId: string, now: Date = new Date()): Promise<boolean> {
  return store().take(personKey(restaurantId, userId, now), AGENT_TURNS_PER_PERSON_PER_DAY);
}

const inFlight = new Set<string>();

/** Claim the conversation's single in-flight slot; returns the release, or null when busy. */
export function beginTask(conversationKey: string): (() => void) | null {
  if (inFlight.has(conversationKey)) return null;
  inFlight.add(conversationKey);
  return () => {
    inFlight.delete(conversationKey);
  };
}

/** Test seam. */
export function __resetAgentBudget(): void {
  local.clear();
  inFlight.clear();
}
