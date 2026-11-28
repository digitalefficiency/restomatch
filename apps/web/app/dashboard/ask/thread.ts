/**
 * Ask thread state (W3-04b, independent of AU-06; wired into ask-client after
 * AU-06 merges). The thread lives in sessionStorage: it survives a reload and
 * a back-navigation inside the tab, and is gone when the tab closes (answers
 * can name suppliers and ₪, so nothing persists across sessions). Every storage
 * access is wrapped: private mode or a full quota just means no saved thread.
 */

export interface AskTurn {
  id: string;
  question: string;
  /** Plain answer text as shown; null while streaming or after "עצור". */
  answer: string | null;
  /** True when the answer was not grounded in the restaurant's data (banner above it). */
  ungrounded?: boolean;
  /** The server's structured answer (AskResult), kept so a reload re-renders it. */
  result?: unknown;
  /** Why there is no answer: a failure, the burst limit, or the user pressed "עצור". */
  error?: 'generic' | 'rateLimited' | 'stopped';
  /** ms since epoch. */
  at: number;
}

export const THREAD_KEY = 'rm.ask.thread.v1';
export const THREAD_MAX = 20;
export const Q_MIN = 2;
export const Q_MAX = 500;

export function loadThread(storage: Pick<Storage, 'getItem'> | undefined): AskTurn[] {
  try {
    const raw = storage?.getItem(THREAD_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is AskTurn =>
          !!t &&
          typeof t.id === 'string' &&
          typeof t.question === 'string' &&
          (t.answer === null || typeof t.answer === 'string') &&
          typeof t.at === 'number',
      )
      .slice(-THREAD_MAX);
  } catch {
    return [];
  }
}

export function saveThread(
  storage: Pick<Storage, 'setItem'> | undefined,
  turns: readonly AskTurn[],
): void {
  try {
    storage?.setItem(THREAD_KEY, JSON.stringify(turns.slice(-THREAD_MAX)));
  } catch {
    /* private mode / quota: no saved thread */
  }
}

/** Append a turn, keeping the newest `THREAD_MAX`. */
export function appendTurn(turns: readonly AskTurn[], turn: AskTurn): AskTurn[] {
  return [...turns, turn].slice(-THREAD_MAX);
}

/** Replace one turn's answer (stream chunk, final answer, or stop). */
export function settleTurn(
  turns: readonly AskTurn[],
  id: string,
  patch: Partial<Pick<AskTurn, 'answer' | 'ungrounded' | 'result' | 'error'>>,
): AskTurn[] {
  return turns.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * `?q=` auto-submit (the palette's "שאלו: …" and deep links): the question to
 * submit once, or null. Whitespace is collapsed; out-of-range lengths are
 * ignored rather than truncated, so a mangled link never asks half a question.
 */
export function autoSubmitQuestion(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const q = (params.get('q') ?? '').replace(/\s+/g, ' ').trim();
  return q.length >= Q_MIN && q.length <= Q_MAX ? q : null;
}

/**
 * The URL after consuming `?q=` (other params kept), for `history.replaceState`,
 * so a reload or Back does not ask the same question twice.
 */
export function withoutQ(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('q');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
