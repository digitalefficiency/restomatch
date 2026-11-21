import { describe, expect, it } from 'vitest';
import type { AskResult } from '@restomatch/api';
import { createTranslator } from '@/lib/i18n/translate';
import { ask } from '@/lib/i18n/messages/ask';
import { formatIls } from '@/lib/money';
import { opsLines } from '../ops-lines';

/** AU-06: the five "what needs me" offline answers, he + en; unknown is a sentence, never ₪0. */
const he = createTranslator('he', ask);
const en = createTranslator('en', ask);
/** The translator wraps inserted values in bidi isolates (U+2068…U+2069); compare the visible text. */
const plain = (x: string) => x.replace(/[\u2068\u2069]/g, '');
const res = (intent: string, facts: Record<string, unknown>): AskResult =>
  ({ mode: 'offline', answer: null, citations: [], grounded: true, intent, facts, links: [], reason: 'noKey' }) as unknown as AskResult;

describe('offline answers for the AU-06 intents', () => {
  it('who owes me: total, overdue, per supplier; ₪ via formatIls', () => {
    const r = res('whoOwesMe', {
      available: true,
      supplierCount: 1,
      outstandingIls: 120,
      overdueIls: 120,
      suppliers: [{ supplier: 'ספק X', outstandingIls: 120, oldestWaitingDays: 9, overdue: true }],
    });
    const lines = opsLines(r.intent!, r.facts, he, 'he');
    expect(lines[0]).toContain(formatIls(120, { locale: 'he', maximumFractionDigits: 2 }));
    expect(plain(lines[1]!)).toBe(`ספק X חייב ${formatIls(120, { locale: 'he', maximumFractionDigits: 2 })} · 9 ימים בלי תשובה (באיחור)`);
    expect(lines.join(' ')).not.toMatch(/תביע|דריש|מחלוקת|חוב/);
    expect(opsLines(r.intent!, r.facts, en, 'en')[1]).toContain('(overdue)');
  });

  it('honest unknowns: never ₪0', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['toPayThisWeek', { available: false, reason: 'due_dates_not_live' }, 'מועדי תשלום עוד לא מחושבים במערכת.'],
      ['whoOwesMe', { available: false, reason: 'feature_off', feature: 'recovery' }, 'כדי לענות על זיכויים, הפעילו מעקב החזרים.'],
      ['vatAtRisk', { available: false, reason: 'feature_off', feature: 'vatAtRisk' }, 'בדיקת מע״מ בסיכון כבויה.'],
      ['waitingForMe', { available: false, reason: 'not_live' }, he('answers.notLive')],
    ];
    for (const [intent, facts, text] of cases) {
      const lines = opsLines(intent, facts, he, 'he');
      expect(lines.map(plain)).toEqual([text]);
      expect(lines.join('')).not.toContain('₪');
    }
  });

  it('waiting, stuck and VAT render their figures', () => {
    expect(
      plain(opsLines('waitingForMe', { available: true, count: 4, awaitingIls: 296, oldestAgeDays: 3, blockingCount: 0 }, he, 'he')[0]!),
    ).toBe(`4 פערים מחכים להחלטה שלך · ${formatIls(296, { locale: 'he', maximumFractionDigits: 2 })} · הוותיק ביותר 3 ימים`);
    expect(opsLines('intakeStuck', { available: true, needsReviewCount: 3, oldestReviewAgeHours: 26 }, he, 'he').map(plain)).toEqual([
      '3 מסמכים מחכים לבדיקה בקליטה · הוותיק 26 שעות',
    ]);
    const vat = opsLines(
      'vatAtRisk',
      { available: true, count: 1, totalVatAtRiskIls: 2160, rows: [{ supplier: 'ספק', invoiceNumber: '77', vatAtRiskIls: 2160, daysLeft: 175 }] },
      he,
      'he',
    );
    expect(vat[0]).toContain('נפרד מהדליפה');
    expect(vat[1]).toContain('175');
  });
});
