import { describe, expect, it } from 'vitest';
import { IDLE, isCrossRouteClick, progressReducer, type ProgressState } from '../routeProgressState';

const here = { origin: 'https://app.test', pathname: '/dashboard', href: 'https://app.test/dashboard?p=quarter' };
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const go = (href: string, link: { target?: string | null; download?: boolean } = {}, ev = plain) =>
  isCrossRouteClick({ href, ...link }, ev, here);

describe('isCrossRouteClick', () => {
  it('shows the bar for a plain primary click to another route (absolute or relative)', () => {
    expect(go('https://app.test/dashboard/leaks')).toBe(true);
    expect(go('/dashboard/approvals?d=compact')).toBe(true);
    expect(go('/dashboard/leaks', { target: '_self' })).toBe(true);
  });

  it('each modifier key opts out', () => {
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(go('/dashboard/leaks', {}, { ...plain, [key]: true }), key).toBe(false);
    }
  });

  it('non-primary buttons opt out', () => {
    expect(go('/dashboard/leaks', {}, { ...plain, button: 1 })).toBe(false);
    expect(go('/dashboard/leaks', {}, { ...plain, button: 2 })).toBe(false);
  });

  it('other browsing contexts and downloads opt out', () => {
    expect(go('/dashboard/leaks', { target: '_blank' })).toBe(false);
    expect(go('/dashboard/leaks', { target: '_top' })).toBe(false);
    expect(go('/dashboard/leaks', { target: 'report' })).toBe(false);
    expect(go('/api/export.csv', { download: true })).toBe(false);
  });

  it('other origins and non-http schemes opt out', () => {
    expect(go('https://example.com/dashboard/leaks')).toBe(false);
    expect(go('mailto:owner@kfar-hazeitim.test')).toBe(false);
    expect(go('javascript:void(0)')).toBe(false);
    expect(go('tel:+97231234567')).toBe(false);
  });

  it('unparsable hrefs opt out', () => {
    expect(go('http://[::1')).toBe(false);
  });

  it('same path — hash only or different search — opts out (commits in place)', () => {
    expect(go('#activity')).toBe(false);
    expect(go('/dashboard#activity')).toBe(false);
    expect(go('/dashboard?p=ytd')).toBe(false);
  });
});

describe('progressReducer', () => {
  const run = (events: Parameters<typeof progressReducer>[1][], from: ProgressState = IDLE) =>
    events.reduce(progressReducer, from);

  it('start → frame → commit → reset', () => {
    let s = progressReducer(IDLE, { type: 'start', target: '/dashboard/leaks' });
    expect(s).toEqual({ phase: 'start', target: '/dashboard/leaks' });
    s = progressReducer(s, { type: 'frame' });
    expect(s.phase).toBe('run');
    s = progressReducer(s, { type: 'commit' });
    expect(s.phase).toBe('done');
    expect(progressReducer(s, { type: 'reset' })).toEqual(IDLE);
  });

  it('ANY commit ends a pending bar (superseded / redirected / replaced navigations)', () => {
    expect(run([{ type: 'start', target: '/dashboard/leaks' }, { type: 'commit' }]).phase).toBe('done');
    expect(run([{ type: 'start', target: '/x' }, { type: 'frame' }, { type: 'commit' }]).phase).toBe('done');
  });

  it('the cap fades out instead of snapping', () => {
    const s = run([{ type: 'start', target: '/x' }, { type: 'frame' }, { type: 'timeout' }]);
    expect(s.phase).toBe('done');
  });

  it('re-clicking the pending target keeps the bar where it is; a new target restarts it', () => {
    const running = run([{ type: 'start', target: '/dashboard/leaks' }, { type: 'frame' }]);
    expect(progressReducer(running, { type: 'start', target: '/dashboard/leaks' })).toBe(running);
    expect(progressReducer(running, { type: 'start', target: '/dashboard/approvals' })).toEqual({
      phase: 'start',
      target: '/dashboard/approvals',
    });
  });

  it('stray events while idle or fading are no-ops', () => {
    expect(progressReducer(IDLE, { type: 'commit' })).toBe(IDLE);
    expect(progressReducer(IDLE, { type: 'timeout' })).toBe(IDLE);
    expect(progressReducer(IDLE, { type: 'frame' })).toBe(IDLE);
    expect(progressReducer(IDLE, { type: 'reset' })).toBe(IDLE);
    const fading = run([{ type: 'start', target: '/x' }, { type: 'commit' }]);
    expect(progressReducer(fading, { type: 'commit' })).toBe(fading);
    expect(progressReducer(fading, { type: 'frame' })).toBe(fading);
  });

  it('a new navigation during the fade starts a fresh bar', () => {
    const fading = run([{ type: 'start', target: '/x' }, { type: 'commit' }]);
    expect(progressReducer(fading, { type: 'start', target: '/x' }).phase).toBe('start');
  });
});
