import { describe, expect, it } from 'vitest';
import { SOURCES_BY_ROLE } from '../tasks/collect';
import { invoiceLineTasks } from '../tasks/sources';
import { BADGE_OF } from '../tasks/badges';

/**
 * Train B's "invoices waiting for you" (invoices.needsLines) is a task-spine
 * source, so the home row, the bell and the badge read the same count.
 */
describe('invoiceLineTasks — invoices.needsLines on the spine', () => {
  it('nothing waiting → no task', () => {
    expect(invoiceLineTasks({ count: 0, rows: [] }, '2026-11-11')).toEqual([]);
    expect(invoiceLineTasks(null, '2026-11-11')).toEqual([]);
  });
  it('only held invoices → neutral T4 (never a false alarm)', () => {
    const [t] = invoiceLineTasks({ count: 2, rows: [{ reason: 'held' }, { reason: 'held' }] }, '2026-11-11');
    expect(t).toMatchObject({ type: 'doc_review', count: 2, tone: 'neutral', tier: 'T4', ilsAgorot: null, deepLink: '/dashboard/invoices', scope: 'mine' });
  });
  it('an unread / failed photo invoice → warn T2, count only (no ₪)', () => {
    const [t] = invoiceLineTasks({ count: 2, rows: [{ reason: 'held' }, { reason: 'ocr_failed' }] }, '2026-11-11');
    expect(t).toMatchObject({ tone: 'warn', tier: 'T2', ilsAgorot: null, blocking: 0 });
  });
  it('owner and manager read it; bookkeeper, receiver and chef do not (as main’s home)', () => {
    expect(SOURCES_BY_ROLE.owner).toContain('invoiceLines');
    expect(SOURCES_BY_ROLE.manager).toContain('invoiceLines');
    for (const r of ['bookkeeper', 'receiver', 'chef'] as const) expect(SOURCES_BY_ROLE[r]).not.toContain('invoiceLines');
  });
  it('folds into the intake badge (G-06 interim)', () => expect(BADGE_OF.doc_review).toBe('intake'));
});
