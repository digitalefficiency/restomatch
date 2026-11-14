import { describe, expect, it, vi } from 'vitest';
import { fetched, overviewCardState } from '../overview-state';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = { ok: false as const };

describe('overviewCardState (G-16 money-swallow fix)', () => {
  it('flag off, or enabled() failed → hidden (the feature stays invisible)', () => {
    expect(overviewCardState(ok({ enabled: false }), null, null)).toEqual({ kind: 'hidden' });
    expect(overviewCardState(fail, null, null)).toEqual({ kind: 'hidden' });
  });
  it('recipes.changes failed → "unavailable", never a hidden card that reads as calm news', () => {
    expect(overviewCardState(ok({ enabled: true }), fail, ok({ enabled: true }))).toEqual({ kind: 'unavailable' });
  });
  it('recipes.priceAlerts failed → alerts "unavailable", never "no alerts"', () => {
    const s = overviewCardState(ok({ enabled: true }), ok({ rows: [] }), fail);
    expect(s).toEqual({ kind: 'ready', changes: { rows: [] }, alerts: 'unavailable' });
  });
  it('alerts flag off → null (no note); alerts on → the data', () => {
    expect(overviewCardState(ok({ enabled: true }), ok(1), ok({ enabled: false }))).toMatchObject({ alerts: null });
    expect(overviewCardState(ok({ enabled: true }), ok(1), ok({ enabled: true, n: 2 }))).toMatchObject({ alerts: { enabled: true, n: 2 } });
  });
  it('fetched() logs a failure instead of swallowing it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetched(Promise.reject(new Error('boom')), 'recipes.priceAlerts')).toEqual({ ok: false });
    expect(spy).toHaveBeenCalledWith('[recipes-overview-card] recipes.priceAlerts failed', expect.any(Error));
    expect(await fetched(Promise.resolve(3), 'x')).toEqual({ ok: true, data: 3 });
    spy.mockRestore();
  });
});
