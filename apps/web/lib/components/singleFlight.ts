'use client';

import { useMemo } from 'react';

/**
 * Drop re-entrant calls while one is in flight. A double-click fires both
 * clicks before React re-renders the button as `loading`/disabled, so a
 * `disabled={isPending}` alone let a double-click create two suppliers / two
 * orders. Wrap the async submit: `run(() => create.mutateAsync(input))`.
 * Rejections are swallowed — callers surface errors via the mutation state.
 */
export function createSingleFlight() {
  let busy = false;
  return function run(fn: () => Promise<unknown>): boolean {
    if (busy) return false;
    busy = true;
    let p: Promise<unknown>;
    try {
      p = fn();
    } catch {
      busy = false;
      return true;
    }
    p.catch(() => {}).finally(() => {
      busy = false;
    });
    return true;
  };
}

/** One single-flight guard per component instance. */
export function useSingleFlight() {
  return useMemo(() => createSingleFlight(), []);
}
