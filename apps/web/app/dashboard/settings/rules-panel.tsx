'use client';

import { Card, StatusChip } from '@/lib/components';
import { DateTime, Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';

/** `{ value, isDefault }` per knob, from `settings.effective` (plain props). */
export interface Eff {
  value: number;
  isDefault: boolean;
}
export interface EffectiveRules {
  tolerances: Record<'pricePercent' | 'priceAbsolute' | 'qtyPercent' | 'qtyAbsolute' | 'blockPricePercent', Eff>;
  approvalThresholds: Record<
    | 'largeInvoiceWithoutPo'
    | 'unorderedItemSignificant'
    | 'cumulativeLargeAmount'
    | 'cumulativeLargePct'
    | 'cumulativeMediumAmountMin'
    | 'cumulativeMediumPctMin',
    Eff
  >;
  ocrReviewThreshold: Eff;
}
export interface HistoryEntry {
  id: string;
  kind: 'rules' | 'profile';
  at: Date | string;
  byName: string | null;
}

type Part = { amount: number } | { pct: number } | { qty: number };

/**
 * The approval and matching rules IN FORCE (W2-14, admin-01): each rule is one
 * sentence with its ₪ / % value and a chip saying whether it is the engine
 * default or the restaurant's own setting. Values come from `settings.effective`
 * (the engine's resolvers), so a blank input can no longer hide ₪5,000 / ₪100.
 */
export function RulesPanel({ rules, history }: { rules: EffectiveRules; history: HistoryEntry[] | null }) {
  const t = useT(settingsMessages);
  const locale = useLocale();
  const pct = (v: number) =>
    new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'he-IL', { style: 'percent', maximumFractionDigits: 1 }).format(v);
  const num = (v: number) => new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'he-IL').format(v);

  /** Render a sentence template, replacing {a} {b} with the given parts in order. */
  function sentence(template: string, parts: Part[]) {
    const pieces = template.split(/\{[a-z]\}/);
    return pieces.map((piece, i) => {
      const p = parts[i];
      return (
        <span key={i}>
          {piece}
          {p === undefined ? null : 'amount' in p ? (
            <Money value={p.amount} context="line" decimals={0} className="font-semibold" />
          ) : 'pct' in p ? (
            <bdi className="font-semibold">{pct(p.pct)}</bdi>
          ) : (
            <bdi className="font-semibold">{num(p.qty)}</bdi>
          )}
        </span>
      );
    });
  }

  const chip = (...vals: Eff[]) =>
    vals.every((v) => v.isDefault) ? (
      <StatusChip tone="neutral" label={t('rules.default')} />
    ) : (
      <StatusChip tone="info" label={t('rules.custom')} />
    );

  const a = rules.approvalThresholds;
  const tol = rules.tolerances;
  const groups: Array<{ title: string; rows: Array<{ key: string; text: React.ReactNode; chip: React.ReactNode }> }> = [
    {
      title: t('rules.approvalsTitle'),
      rows: [
        {
          key: 'noPo',
          text: sentence(t('rules.largeInvoiceWithoutPo'), [{ amount: a.largeInvoiceWithoutPo.value }]),
          chip: chip(a.largeInvoiceWithoutPo),
        },
        {
          key: 'unordered',
          text: sentence(t('rules.unorderedItemSignificant'), [{ amount: a.unorderedItemSignificant.value }]),
          chip: chip(a.unorderedItemSignificant),
        },
        {
          key: 'cumLarge',
          text: sentence(t('rules.cumulativeLarge'), [
            { amount: a.cumulativeLargeAmount.value },
            { pct: a.cumulativeLargePct.value },
          ]),
          chip: chip(a.cumulativeLargeAmount, a.cumulativeLargePct),
        },
        {
          key: 'cumMedium',
          text: sentence(t('rules.cumulativeMedium'), [
            { amount: a.cumulativeMediumAmountMin.value },
            { pct: a.cumulativeMediumPctMin.value },
          ]),
          chip: chip(a.cumulativeMediumAmountMin, a.cumulativeMediumPctMin),
        },
      ],
    },
    {
      title: t('rules.tolerancesTitle'),
      rows: [
        {
          key: 'price',
          text: sentence(t('rules.price'), [{ pct: tol.pricePercent.value }, { amount: tol.priceAbsolute.value }]),
          chip: chip(tol.pricePercent, tol.priceAbsolute),
        },
        {
          key: 'qty',
          text: sentence(t('rules.qty'), [{ pct: tol.qtyPercent.value }, { qty: tol.qtyAbsolute.value }]),
          chip: chip(tol.qtyPercent, tol.qtyAbsolute),
        },
        {
          key: 'block',
          text: sentence(t('rules.blockPrice'), [{ pct: tol.blockPricePercent.value }]),
          chip: chip(tol.blockPricePercent),
        },
        {
          key: 'ocr',
          text: sentence(t('rules.ocrReview'), [{ pct: rules.ocrReviewThreshold.value }]),
          chip: chip(rules.ocrReviewThreshold),
        },
      ],
    },
  ];

  return (
    <Card flow elevated padding="lg" className="space-y-6" data-testid="rules-in-force">
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="mb-3 text-base font-semibold text-ink">{g.title}</h3>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm text-ink">
                <span className="min-w-0">{r.text}</span>
                {r.chip}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {history ? (
        <details className="rounded-xl border border-line-strong px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {t('rules.historyTitle', { n: history.length })}
          </summary>
          {history.length === 0 ? (
            <p className="py-2 text-sm text-muted">{t('rules.historyEmpty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 py-2 text-sm text-ink">
                  <DateTime value={h.at} />
                  <span>·</span>
                  <span>{h.kind === 'rules' ? t('rules.historyRules') : t('rules.historyProfile')}</span>
                  <span>·</span>
                  <bdi>{h.byName ?? t('rules.historyUnknown')}</bdi>
                </li>
              ))}
            </ul>
          )}
        </details>
      ) : null}
    </Card>
  );
}
