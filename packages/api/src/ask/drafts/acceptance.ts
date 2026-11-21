/**
 * Draft acceptance tracking and the kill-switch (W3-04b). Each draft ends as
 * accepted (sent as is), edited (sent after a change), or discarded. Drafts
 * switch off for a restaurant when fewer than 60 % are used (accepted +
 * edited), measured once enough drafts were decided, so one bad week on two
 * drafts doesn't kill the feature. Pure; storage and the flag write live with
 * the router.
 */

export type DraftOutcome = 'accepted' | 'edited' | 'discarded';

export interface AcceptanceStats {
  offered: number;
  accepted: number;
  edited: number;
  discarded: number;
}

export const EMPTY_STATS: AcceptanceStats = { offered: 0, accepted: 0, edited: 0, discarded: 0 };
export const KILL_THRESHOLD = 0.6;
export const KILL_MIN_DECIDED = 20;

export function recordOffered(s: AcceptanceStats): AcceptanceStats {
  return { ...s, offered: s.offered + 1 };
}

export function recordOutcome(s: AcceptanceStats, outcome: DraftOutcome): AcceptanceStats {
  return { ...s, [outcome]: s[outcome] + 1 };
}

export function decided(s: AcceptanceStats): number {
  return s.accepted + s.edited + s.discarded;
}

/** Share of decided drafts that were used (accepted or edited); null before any decision. */
export function acceptanceRate(s: AcceptanceStats): number | null {
  const d = decided(s);
  return d === 0 ? null : (s.accepted + s.edited) / d;
}

/** True when drafts must switch off: ≥ `minDecided` decisions and rate < threshold. */
export function shouldKill(
  s: AcceptanceStats,
  opts: { threshold?: number; minDecided?: number } = {},
): boolean {
  const rate = acceptanceRate(s);
  if (rate === null || decided(s) < (opts.minDecided ?? KILL_MIN_DECIDED)) return false;
  return rate < (opts.threshold ?? KILL_THRESHOLD);
}
