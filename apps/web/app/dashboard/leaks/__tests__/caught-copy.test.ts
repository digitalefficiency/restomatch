import { describe, expect, it } from 'vitest';
import { he as proofHe } from '@/lib/i18n/messages/leakProof/he';
import { en as proofEn } from '@/lib/i18n/messages/leakProof/en';
import { he as leaksHe } from '@/lib/i18n/messages/leaks/he';
import { en as leaksEn } from '@/lib/i18n/messages/leaks/en';
import { he as chainHe } from '@/lib/i18n/messages/chain/he';
import { en as chainEn } from '@/lib/i18n/messages/chain/en';
import { he as viewsHe } from '@/lib/i18n/messages/views/he';
import { en as viewsEn } from '@/lib/i18n/messages/views/en';

/**
 * W1-08 train B: nothing marks an invoice paid yet (markPaid / due_date arrive in
 * W2-03), so "caught before payment" equals the whole leak. The proof card and the
 * report chip, the chain KPI (and its hint) and the views KPI label must not claim
 * a payment state; they say the gaps were identified before the payment was approved.
 */
describe('"caught before payment" copy claims no payment state (W1-08 train B)', () => {
  const he = [
    proofHe.caughtTitle,
    proofHe.caught,
    leaksHe.report.caughtChip,
    chainHe.dashboard.kpis.caught,
    chainHe.dashboard.kpis.caughtHint,
    viewsHe.kpis.caught,
  ];
  const en = [
    proofEn.caughtTitle,
    proofEn.caught,
    leaksEn.report.caughtChip,
    chainEn.dashboard.kpis.caught,
    chainEn.dashboard.kpis.caughtHint,
    viewsEn.kpis.caught,
  ];

  it('he: names payment approval, never "not paid" / "stop before payment"', () => {
    for (const s of he) {
      expect(s).toMatch(/אישור התשלום|אושרו לתשלום/);
      expect(s).not.toMatch(/שולמו|לעצור|נתפס לפני תשלום/);
    }
  });

  it('en: names payment approval, never "not yet paid" / "stopped before payment"', () => {
    for (const s of en) {
      expect(s).toMatch(/payment approval|approved for payment/i);
      expect(s).not.toMatch(/not (yet )?(marked )?paid|stopped before payment|caught before payment/i);
    }
  });

  it('keeps {amount} where it was (he/en parity)', () => {
    expect(proofHe.caught).toContain('{amount}');
    expect(proofEn.caught).toContain('{amount}');
    expect(leaksHe.report.caughtChip).toContain('{amount}');
    expect(leaksEn.report.caughtChip).toContain('{amount}');
  });
});
