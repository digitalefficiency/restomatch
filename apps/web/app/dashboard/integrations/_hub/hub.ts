/**
 * W3-07a slice 2 · the pure half of the "חיבורים" hub (no React, unit-tested).
 *
 * The page groups every connection into four fixed groups, gives each a status
 * chip, and lights the nav dot ONLY when something needs the owner's action
 * (an error with a fix). "Not connected" is neutral (T4), never an alarm.
 */

export const HUB_GROUPS = ['accounting', 'pos', 'procurement', 'intake'] as const;
export type HubGroup = (typeof HUB_GROUPS)[number];

/**
 * - connected: live and syncing.
 * - sample: running on recorded sample data (no account yet).
 * - error: the last sync / import failed; carries a plain-Hebrew error + one fix.
 * - not_connected: available, not set up (neutral).
 * - contact: no self-serve adapter yet; the tile offers a real contact path.
 */
export type HubStatus = 'connected' | 'sample' | 'error' | 'not_connected' | 'contact';

export interface HubTile {
  key: string;
  group: HubGroup;
  status: HubStatus;
  lastSyncAt: Date | null;
  /** Message key of a plain-Hebrew last error (status 'error' only). */
  errorKey?: string;
}

/** Tone vocabulary (AGENTS.md design tiers): T2 act-now, T3 good news, T4 neutral. */
export function toneOf(status: HubStatus): 'T2' | 'T3' | 'T4' {
  if (status === 'error') return 'T2';
  if (status === 'connected') return 'T3';
  return 'T4';
}

/** Nav dot: only when at least one tile needs action. */
export function needsAction(tiles: readonly HubTile[]): boolean {
  return tiles.some((t) => t.status === 'error');
}

/** Tiles in the fixed group order, each group's errors first, then by key. */
export function groupTiles(tiles: readonly HubTile[]): { group: HubGroup; tiles: HubTile[] }[] {
  const rank: Record<HubStatus, number> = { error: 0, connected: 1, sample: 2, not_connected: 3, contact: 4 };
  return HUB_GROUPS.map((group) => ({
    group,
    tiles: tiles
      .filter((t) => t.group === group)
      .slice()
      .sort((a, b) => rank[a.status] - rank[b.status] || a.key.localeCompare(b.key)),
  })).filter((g) => g.tiles.length > 0);
}

/** The shape `integrations.procurementProviders` returns today (read-only use). */
export interface ProcurementProviderRow {
  platform: string;
  adapter: boolean;
  connected: boolean;
  mode: 'sample' | 'live' | null;
  lastSyncAt: Date | string | null;
  /** Server-computed (integrations isSyncStale): live but not synced for 48 h. */
  syncStale?: boolean;
}

/** MarketMan / Zester rows → tiles. No adapter → a contact path, never a dead button. */
export function procurementTiles(rows: readonly ProcurementProviderRow[]): HubTile[] {
  return rows.map((r) => ({
    key: r.platform,
    group: 'procurement' as const,
    status: !r.adapter
      ? ('contact' as const)
      : !r.connected
        ? ('not_connected' as const)
        : r.syncStale
          ? ('error' as const)
          : r.mode === 'sample'
            ? ('sample' as const)
            : ('connected' as const),
    lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
    ...(r.connected && r.syncStale ? { errorKey: 'hub.errors.syncStale' } : {}),
  }));
}
