import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { Task } from './model';

/** The answer window the claims follow-up names (= @restomatch/api CLAIM_ANSWER_DAYS). */
const ANSWER_DAYS = 7;

export type RowTone = 'danger' | 'warn' | 'neutral';

/** One "מחכה לך" row, as the home strip and the bell render it. */
export interface TaskRow {
  key: string;
  type: Task['type'];
  tone: RowTone;
  /** Solid badge word / the row's label. */
  label: string;
  /** ₪ in agorot (rendered by <Money>), or null for a count row. */
  agorot: number | null;
  /** Decimals for the ₪: claims show the agora, like the recovery page. */
  decimals: 0 | 2;
  /** Count text when there is no ₪ (or for staff). */
  countText: string | null;
  sub?: string;
  notes?: string;
  verb: string;
  href: string;
}

type T = Translator<typeof overviewHe>;

/**
 * Stable row keys (the `needs-<key>` test ids and `data-needs-row`) — the W1-05
 * names, so specs and deep links that pin them keep working.
 */
const ROW_KEY: Partial<Record<Task['type'], string>> = {
  decision: 'decide',
  claim_to_send: 'claimsUnsent',
  credit_to_match: 'claimsWaiting',
  allocation_missing: 'vat',
  payment_due: 'payRun',
  delivery_due: 'deliveries',
  delivery_late: 'deliveries',
  close_step: 'count',
  order_due: 'cutoffs',
};

/**
 * Task → row words. The ₪ is the task's own (server) figure; this only names it.
 * `others` tasks become the one "waiting on others" line, not a row.
 */
export function taskRow(task: Task, t: T, locale: Locale, sideMoney: (agorot: number) => string): TaskRow | null {
  const n = (v: number | string | null | undefined) => formatNumber(Number(v ?? 0), locale);
  const d = task.detail ?? {};
  const age =
    task.ageDays === null ? null : task.ageDays === 0 ? t('needs.age.today') : t('needs.age.days', { days: n(task.ageDays) });
  const join = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(' · ') || undefined;
  const base = { key: ROW_KEY[task.type] ?? task.entityId, type: task.type, tone: task.tone as RowTone, href: task.deepLink, agorot: task.ilsAgorot, decimals: 0 as 0 | 2, countText: null as string | null };
  switch (task.type) {
    case 'decision':
      return {
        ...base,
        label: t('needs.decide.label'),
        countText: task.ilsAgorot === null ? n(task.count) : null,
        sub: join(
          task.blocking > 0 ? t('needs.decide.subBlocking', { count: n(task.count), blocking: n(task.blocking) }) : t('needs.decide.sub', { count: n(task.count) }),
          Number(d.toReview) > 0 && t('needs.decide.review', { count: n(d.toReview) }),
          age,
        ),
        notes: join(
          Number(d.duplicateAgorot) > 0 && t('needs.decide.duplicates', { amount: sideMoney(Number(d.duplicateAgorot)) }),
          Number(d.vatAgorot) > 0 && t('needs.decide.vat', { amount: sideMoney(Number(d.vatAgorot)) }),
        ),
        verb: t('needs.decide.verb'),
      };
    case 'claim_to_send':
      return { ...base, decimals: 2, label: t('needs.claimsUnsent.label'), sub: join(t('needs.claimsUnsent.sub', { count: n(task.count) }), age), verb: t('needs.claimsUnsent.verb') };
    case 'credit_to_match':
      return { ...base, decimals: 2, label: t('needs.claimsWaiting.label', { days: n(ANSWER_DAYS) }), sub: join(t('needs.claimsWaiting.sub', { count: n(task.count) }), age), verb: t('needs.claimsWaiting.verb') };
    case 'allocation_missing':
      return { ...base, label: t('needs.vat.label'), sub: t('needs.vat.sub', { count: n(task.count), days: n(d.daysLeft) }), verb: t('needs.vat.verb') };
    case 'payment_due':
      return { ...base, label: t('needs.payRun.label'), sub: t('needs.payRun.sub', { count: n(task.count) }), verb: t('needs.payRun.verb') };
    case 'delivery_due':
    case 'delivery_late':
      return {
        ...base,
        agorot: null,
        label: t('needs.deliveries.label'),
        countText: t('needs.deliveriesValue', { count: n(d.total) }),
        sub: t('needs.deliveries.sub', { received: n(d.received), late: n(d.late) }),
        verb: t('needs.deliveries.verb'),
      };
    case 'close_step':
      return {
        ...base,
        agorot: null,
        label: t('needs.count.label'),
        countText: t('needs.countValue', { counted: n(d.counted), lines: n(d.lines) }),
        sub: t('needs.count.sub', { counted: n(d.counted), lines: n(d.lines) }),
        verb: t('needs.count.verb'),
      };
    case 'order_due':
      return {
        ...base,
        agorot: null,
        label: t('needs.cutoffs.label'),
        countText: t('needs.cutoffsValue', { count: n(task.count) }),
        sub: t('needs.cutoffs.sub', { supplier: String(locale === 'en' && d.supplierEn ? d.supplierEn : d.supplier ?? ''), time: String(d.time ?? '') }),
        verb: t('needs.cutoffs.verb'),
      };
    default:
      return null;
  }
}

/** "אצלך הכול מטופל · 4 ממתינים אצל הבעלים · ₪296" — the whole restaurant, when mine is empty. */
export function othersLine(tasks: readonly Task[], t: T, locale: Locale, money: (agorot: number) => string): string | null {
  const others = tasks.filter((x) => x.scope === 'others');
  if (others.length === 0) return null;
  const count = others.reduce((s, x) => s + x.count, 0);
  const agorot = others.reduce((s, x) => s + (x.ilsAgorot ?? 0), 0);
  const roles = [...new Set(others.map((x) => x.withRole ?? 'owner'))];
  const who = roles.map((r) => t(`needs.who.${r}` as 'needs.who.owner')).join(', ');
  const hasMoney = others.some((x) => x.ilsAgorot !== null) && agorot > 0;
  return hasMoney
    ? t('needs.othersLine', { count: formatNumber(count, locale), who, amount: money(agorot) })
    : t('needs.othersLineCount', { count: formatNumber(count, locale), who });
}
