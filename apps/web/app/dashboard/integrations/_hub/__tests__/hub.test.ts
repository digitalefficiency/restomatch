import { describe, expect, it } from 'vitest';
import { groupTiles, needsAction, procurementTiles, toneOf, type HubTile } from '../hub';

const t = (key: string, group: HubTile['group'], status: HubTile['status']): HubTile => ({
  key,
  group,
  status,
  lastSyncAt: null,
});

describe('hub grouping', () => {
  it('keeps the fixed group order and drops empty groups', () => {
    const out = groupTiles([t('zester', 'procurement', 'contact'), t('hashavshevet', 'accounting', 'connected')]);
    expect(out.map((g) => g.group)).toEqual(['accounting', 'procurement']);
  });
  it('puts errors first inside a group', () => {
    const out = groupTiles([t('a', 'pos', 'not_connected'), t('b', 'pos', 'error'), t('c', 'pos', 'connected')]);
    expect(out[0]!.tiles.map((x) => x.key)).toEqual(['b', 'c', 'a']);
  });
});

describe('nav dot and tone', () => {
  it('lights only on an error', () => {
    expect(needsAction([t('a', 'pos', 'not_connected'), t('b', 'intake', 'contact')])).toBe(false);
    expect(needsAction([t('a', 'pos', 'error')])).toBe(true);
  });
  it('not connected is neutral, never an alarm', () => {
    expect(toneOf('not_connected')).toBe('T4');
    expect(toneOf('error')).toBe('T2');
    expect(toneOf('connected')).toBe('T3');
  });
});

describe('procurementTiles', () => {
  it('maps adapter / connection / mode to a status', () => {
    const tiles = procurementTiles([
      { platform: 'marketman', adapter: true, connected: true, mode: 'sample', lastSyncAt: '2026-10-25T09:00:00Z' },
      { platform: 'zester', adapter: false, connected: false, mode: null, lastSyncAt: null },
    ]);
    expect(tiles.map((x) => x.status)).toEqual(['sample', 'contact']);
    expect(tiles[0]!.lastSyncAt?.toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });
});

describe('a stuck live connection needs action', () => {
  it('syncStale → error chip with a plain reason, and lights the nav dot', () => {
    const tiles = procurementTiles([
      { platform: 'marketman', adapter: true, connected: true, mode: 'live', lastSyncAt: '2026-10-20T09:00:00Z', syncStale: true },
      { platform: 'zester', adapter: true, connected: true, mode: 'live', lastSyncAt: '2026-10-25T09:00:00Z', syncStale: false },
    ]);
    expect(tiles.map((x) => x.status)).toEqual(['error', 'connected']);
    expect(tiles[0]!.errorKey).toBe('hub.errors.syncStale');
    expect(needsAction(tiles)).toBe(true);
    expect(needsAction([tiles[1]!])).toBe(false);
  });
});
