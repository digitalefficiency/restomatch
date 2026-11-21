import { formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { ask as askNs } from '@/lib/i18n/messages/ask';
import type { Translator } from '@/lib/i18n/translate';
import { formatIls } from '@/lib/money';

type T = Translator<typeof askNs.he>;
// The offline facts bag is the ops tool's data (packages/api/src/ask/opsTools.ts); read it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Facts = Record<string, any>;

/** AU-06 "what needs me": an unknown is a sentence, never ₪0. */
export function opsLines(intent: string, f: Facts, t: T, locale: Locale): string[] {
  const ils = (v: unknown) => formatIls(Number(v ?? 0), { locale, maximumFractionDigits: 2 });
  const n = (v: unknown) => formatNumber(Number(v ?? 0), locale);
  if (f.available !== true) {
    if (f.reason === 'due_dates_not_live') return [t('answers.dueDatesNotLive')];
    if (f.reason === 'feature_off') {
      if (f.feature === 'recovery') return [t('answers.recoveryOff')];
      if (f.feature === 'vatAtRisk') return [t('answers.vatAtRiskOff')];
      if (f.feature === 'payRun') return [t('answers.payRunOff')];
    }
    return [t('answers.notLive')];
  }
  switch (intent) {
    case 'waitingForMe': {
      if (!f.count) return [t('answers.waitingNone')];
      const vars = { count: n(f.count), amount: ils(f.awaitingIls), days: n(f.oldestAgeDays) };
      const out = [f.oldestAgeDays == null ? t('answers.waitingNoAge', vars) : t('answers.waiting', vars)];
      if (f.blockingCount) out.push(t('answers.waitingBlocking', { count: n(f.blockingCount) }));
      if (f.awaitingInclVatIls != null || f.awaitingVatIls != null) {
        out.push(t('answers.waitingOtherBasis', { incl: ils(f.awaitingInclVatIls), vat: ils(f.awaitingVatIls) }));
      }
      return out;
    }
    case 'intakeStuck': {
      const out: string[] = [];
      if (f.needsReviewCount) {
        out.push(t('answers.stuckReview', { count: n(f.needsReviewCount), hours: n(f.oldestReviewAgeHours) }));
      }
      if (f.ocrStuckCount) out.push(t('answers.stuckOcr', { count: n(f.ocrStuckCount) }));
      if (f.ocrFailedCount) out.push(t('answers.stuckFailed', { count: n(f.ocrFailedCount) }));
      if (f.noSupplierCount) out.push(t('answers.stuckNoSupplier', { count: n(f.noSupplierCount) }));
      return out.length ? out : [t('answers.stuckNone')];
    }
    case 'whoOwesMe': {
      const items = (f.suppliers ?? []) as Facts[];
      if (!f.supplierCount) return [t('answers.owedNone')];
      return [
        t('answers.owedIntro', { count: n(f.supplierCount), total: ils(f.outstandingIls), overdue: ils(f.overdueIls) }),
        ...items.map((s) =>
          t(s.overdue ? 'answers.owedItemOverdue' : 'answers.owedItem', {
            supplier: s.supplier ?? '—',
            amount: ils(s.outstandingIls),
            days: n(s.oldestWaitingDays),
          }),
        ),
      ];
    }
    case 'toPayThisWeek': {
      const out = [
        t('answers.toPay', {
          due: ils(f.dueIls),
          dueCount: n(f.dueCount),
          overdue: ils(f.overdueIls),
          overdueCount: n(f.overdueCount),
        }),
      ];
      if (f.heldCount) out.push(t('answers.toPayHeld', { count: n(f.heldCount), amount: ils(f.heldIls) }));
      return out;
    }
    case 'vatAtRisk': {
      const rows = (f.rows ?? []) as Facts[];
      if (!f.count) return [t('answers.vatNone')];
      return [
        t('answers.vatIntro', { count: n(f.count), total: ils(f.totalVatAtRiskIls) }),
        ...rows.map((v) =>
          t('answers.vatItem', {
            supplier: v.supplier ?? '—',
            invoice: v.invoiceNumber ?? '—',
            amount: ils(v.vatAtRiskIls),
            days: n(v.daysLeft),
          }),
        ),
      ];
    }
    default:
      return [t('answers.unknown')];
  }
}
