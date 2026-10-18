import { describe, expect, it } from 'vitest';
import { isCrossRouteClick } from '../RouteProgress';

const here = { origin: 'https://app.test', pathname: '/dashboard' };
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe('isCrossRouteClick', () => {
  it('shows the bar for a plain click to another route', () => {
    expect(isCrossRouteClick({ href: 'https://app.test/dashboard/leaks' }, plain, here)).toBe(true);
    expect(isCrossRouteClick({ href: '/dashboard/approvals?d=compact' }, plain, here)).toBe(true);
  });

  it('never for same-route search-param or hash changes (they commit in place)', () => {
    expect(isCrossRouteClick({ href: '/dashboard?p=ytd' }, plain, here)).toBe(false);
    expect(isCrossRouteClick({ href: '/dashboard#activity' }, plain, here)).toBe(false);
  });

  it('never for new tabs, downloads, other origins or modified / non-primary clicks', () => {
    expect(isCrossRouteClick({ href: '/dashboard/leaks', target: '_blank' }, plain, here)).toBe(false);
    expect(isCrossRouteClick({ href: '/api/export.csv', download: true }, plain, here)).toBe(false);
    expect(isCrossRouteClick({ href: 'https://example.com/x' }, plain, here)).toBe(false);
    expect(isCrossRouteClick({ href: '/dashboard/leaks' }, { ...plain, metaKey: true }, here)).toBe(false);
    expect(isCrossRouteClick({ href: '/dashboard/leaks' }, { ...plain, button: 1 }, here)).toBe(false);
  });
});
