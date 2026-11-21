/**
 * G-08 kill switch: what the features panel says after a save released the
 * invoices waiting for order questions — only when something needs ops' hand
 * (the release threw, or some re-matches could not be queued). Null = nothing to say.
 */
export type ReleaseOutcome =
  | { ok: true; released: number; requeued: number; failed: number }
  | { ok: false; error: string };

export function releaseNotice(release: ReleaseOutcome | undefined, restaurantId: string): string | null {
  if (!release) return null;
  if (!release.ok) return release.error;
  if (release.failed > 0) {
    return `saved; released ${release.released}, ${release.failed} re-match(es) not queued — run release-order-holds --restaurant ${restaurantId}`;
  }
  return null;
}
