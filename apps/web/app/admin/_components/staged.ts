/**
 * W3-07a: the pure half of a staged admin write. The console never writes on
 * change: it collects a diff (before → after per field), asks for a reason, and
 * only then calls the mutation. The server re-validates the reason (AdminReason).
 */
export interface StagedField {
  /** Stable key, used as the React key and in tests. */
  key: string;
  label: string;
  before: string;
  after: string;
}

/** Same rule as the server's AdminReason: trimmed, 3–500 characters. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function normalizeReason(raw: string): string | null {
  const r = raw.trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX ? r : null;
}

/** Keep only the fields whose value actually changes. */
export function changedFields(fields: StagedField[]): StagedField[] {
  return fields.filter((f) => f.before !== f.after);
}
