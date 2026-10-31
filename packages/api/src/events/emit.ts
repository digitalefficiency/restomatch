import type { Database } from '@restomatch/db';
import { effectHandler, EVENT_EFFECTS, type EffectKind } from './effects';
import type { DomainEvent } from './types';

export interface EmitResult {
  ran: EffectKind[];
  /** Kinds with no registered handler (logged, never thrown). */
  skipped: EffectKind[];
  /** Kinds whose handler threw; its inserts were rolled back to the savepoint. */
  failed: EffectKind[];
}

/**
 * Run the effects of a committed fact. Each effect runs in its own SAVEPOINT
 * (`tx.transaction`), so a failing effect is logged and rolled back alone: it
 * never voids the decision that emitted it, and never reports a silent success
 * for a decision that did not commit. `audit` is skipped here: the kernel
 * writes it inline, inside the decision.
 *
 * Pass the caller's tenant transaction (`ctx.db`); never a new connection.
 */
const loggedSkips = new Set<string>();

export async function emit(tx: Database, event: DomainEvent): Promise<EmitResult> {
  const result: EmitResult = { ran: [], skipped: [], failed: [] };
  for (const kind of EVENT_EFFECTS[event.type] ?? []) {
    if (kind === 'audit') continue;
    const handler = effectHandler(kind);
    if (!handler) {
      result.skipped.push(kind);
      const k = `${event.type}:${kind}`;
      if (!loggedSkips.has(k)) {
        loggedSkips.add(k); // once per process: an unregistered kind is expected until its owner ships
        console.info(`[events] ${event.type}: no '${kind}' handler registered — skipped`);
      }
      continue;
    }
    try {
      await tx.transaction(async (sp) => {
        await handler(sp as unknown as Database, event);
      });
      result.ran.push(kind);
    } catch (err) {
      result.failed.push(kind);
      console.error(`[events] ${event.type}: '${kind}' effect failed — rolled back to its savepoint`, err);
    }
  }
  return result;
}
