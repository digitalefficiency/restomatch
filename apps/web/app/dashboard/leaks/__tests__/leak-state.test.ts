import { describe, expect, it } from 'vitest';
import { he } from '@/lib/i18n/messages/leaks/he';
import { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import { canFollowPath } from '@/lib/nav/visibility';
import { NO_DATA_CTA_HREF, noDataCtaFor } from '../states';

/**
 * The "no checked invoice yet" CTA on the leak pages (explorer, breakdown, report).
 * A fresh restaurant — the pilot starts empty, ingest flags off — must never land
 * on a 404: the CTA goes where the HOME sends the same state (receiving, a route
 * every tenant has), and only for roles that may open it; the bookkeeper gets the hint.
 */
describe('the leak pages’ "no data yet" CTA', () => {
  it('goes to receiving — the home’s start — never the flag-gated inbox', () => {
    expect(NO_DATA_CTA_HREF).toBe('/dashboard/receiving');
    expect(noDataCtaFor('owner', 'x')).toEqual({ label: 'x', href: '/dashboard/receiving' });
    expect(noDataCtaFor('manager', 'x')?.href).toBe('/dashboard/receiving');
  });

  it('the target needs no feature flag, so it exists for a fresh tenant with every flag off', () => {
    expect(canFollowPath({ role: 'owner', features: [] }, NO_DATA_CTA_HREF)).toBe(true);
    // …unlike the inbox, which 404s with the ingest flags off.
    expect(canFollowPath({ role: 'owner', features: [] }, '/dashboard/inbox')).toBe(false);
  });

  it('roles that cannot open receiving get no CTA (the hint alone, as on the home)', () => {
    expect(noDataCtaFor('bookkeeper', 'x')).toBeUndefined();
    expect(noDataCtaFor(undefined, 'x')).toBeUndefined();
  });

  it('says what the home says — never promises an upload page that does not exist', () => {
    expect(he.states.noDataCta).toBe(overviewHe.hero.noData.cta);
    expect(he.states.noDataCta).not.toMatch(/העלו/);
  });
});
