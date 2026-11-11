import { describe, expect, it } from 'vitest';
import { he } from '@/lib/i18n/messages/vat/he';
import { en } from '@/lib/i18n/messages/vat/en';
import {
  deadlineLine,
  groupStage,
  handoffCtaKey,
  newClientMutationId,
  normaliseAllocationInput,
  numberStateLine,
  numberStateOf,
  stageLine,
  type ViewLine,
} from '../caseView';

/** Every key a helper returns must exist in both catalogues (he/en parity). */
function exists(line: ViewLine) {
  const get = (cat: unknown) => line.key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cat);
  expect(typeof get(he), `he ${line.key}`).toBe('string');
  expect(typeof get(en), `en ${line.key}`).toBe('string');
}

describe('AU-08 caseView', () => {
  it('normalises the printed number and states the FORMAT only', () => {
    expect(normaliseAllocationInput(' 123-456 789 ')).toBe('123456789');
    expect(normaliseAllocationInput('12345678')).toBeNull();
    expect(numberStateOf(null)).toBe('missing');
    expect(numberStateOf('  ')).toBe('missing');
    expect(numberStateOf('1234')).toBe('invalid');
    expect(numberStateOf('123-456-789')).toBe('valid');
    expect(numberStateLine('valid')).toEqual({ key: 'field.validFormat' });
    for (const s of ['missing', 'invalid', 'valid'] as const) exists(numberStateLine(s));
  });

  it('stage line: "טרם נשלחה" → "נשלחה לפני N ימים" → "אין מענה N ימים" (Israel days)', () => {
    const today = '2026-11-20';
    expect(stageLine({ stage: 'new', requestedAt: null, daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageNew' });
    expect(stageLine({ stage: 'requested', requestedAt: '2026-11-20T06:00:00Z', daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageRequestedToday' });
    expect(stageLine({ stage: 'requested', requestedAt: '2026-11-19T06:00:00Z', daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageRequestedOne' });
    expect(stageLine({ stage: 'requested', requestedAt: '2026-11-16T06:00:00Z', daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageRequested', params: { days: 4 } });
    // 23:30 UTC on the 19th is already the 20th in Israel → "today", not "yesterday".
    expect(stageLine({ stage: 'requested', requestedAt: '2026-11-19T23:30:00Z', daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageRequestedToday' });
    expect(stageLine({ stage: 'overdue_request', requestedAt: '2026-11-11T06:00:00Z', daysLeft: 90, todayIso: today })).toEqual({ key: 'case.stageOverdue', params: { days: 9 } });
    expect(stageLine({ stage: 'closing', requestedAt: null, daysLeft: 12, todayIso: today })).toEqual({ key: 'case.stageClosing', params: { days: 12 } });
    expect(stageLine({ stage: 'expired', requestedAt: null, daysLeft: -3, todayIso: today })).toEqual({ key: 'case.stageExpired' });
    for (const stage of ['new', 'requested', 'overdue_request', 'closing', 'expired'] as const) {
      exists(stageLine({ stage, requestedAt: '2026-11-10T06:00:00Z', daysLeft: 5, todayIso: today }));
    }
  });

  it('a supplier group shows its worst stage; the CTA turns into a reminder once requested', () => {
    expect(groupStage(['new', 'requested'])).toBe('requested');
    expect(groupStage(['requested', 'overdue_request', 'new'])).toBe('overdue_request');
    expect(groupStage(['overdue_request', 'closing'])).toBe('closing');
    expect(groupStage([])).toBe('new');
    expect(handoffCtaKey(null)).toBe('case.requestCta');
    expect(handoffCtaKey('2026-11-10T06:00:00Z')).toBe('case.reminderCta');
    exists({ key: handoffCtaKey(null) });
    exists({ key: handoffCtaKey('x') });
  });

  it('deadline line: date + days left, today, or closed', () => {
    expect(deadlineLine('2027-03-31', 42)).toEqual({ key: 'field.deadline', params: { date: '31.03.2027', days: 42 } });
    expect(deadlineLine('2027-03-31', 0)).toEqual({ key: 'field.deadlineToday', params: { date: '31.03.2027' } });
    expect(deadlineLine('2027-03-31', -1)).toEqual({ key: 'field.expired', params: { date: '31.03.2027' } });
    for (const d of [42, 0, -1]) exists(deadlineLine('2027-03-31', d));
  });

  it('VAT copy never calls it a leak', () => {
    const blob = JSON.stringify({ c: he.case, f: he.field });
    expect(blob).not.toContain('דליפה');
    expect(JSON.stringify({ c: en.case, f: en.field }).toLowerCase()).not.toContain('leak');
  });

  it('client mutation ids are unique per action', () => {
    const a = newClientMutationId();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(newClientMutationId()).not.toBe(a);
  });
});
