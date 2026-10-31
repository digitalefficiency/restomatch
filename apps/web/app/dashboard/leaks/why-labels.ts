import type { AppLocale } from '@/lib/i18n/config';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import { leaks } from '@/lib/i18n/messages/leaks';
import type { WhyLabels } from '@/lib/components/flags/why';
import { discrepancyExplain, toleranceLabel } from '../approvals/vocab';

/**
 * The leak surfaces' why-line labels (W2-09b): the `leaks.why` ledger copy,
 * with type explanations and tolerance strings from the approvals glossary
 * (one source for those words). Feed to `whySegments(facts, leakWhyLabels(l))`.
 */
export function leakWhyLabels(locale: AppLocale): WhyLabels {
  const t = createTranslator(locale, leaks);
  const a = createTranslator(locale, approvals);
  return {
    locale: t.locale,
    layout: 'ledger',
    templates: {
      price: t('why.price'),
      priceNoQty: t('why.priceNoQty'),
      priceP90: t('why.priceP90'),
      priceP90NoQty: t('why.priceP90NoQty'),
      expected: t('why.expected'),
      sourcePo: t('why.sourcePo'),
      expectedP90: t('why.expectedP90'),
      sourceP90: t('why.sourceP90'),
      equals: t('why.equals'),
      qtyOver: t('why.qtyOver'),
      qtyShort: t('why.qtyShort'),
      threshold: t('why.threshold'),
      capped: t('why.capped'),
      unavailable: t('why.unavailable'),
    },
    explain: (type) => discrepancyExplain(a, type),
    tolerance: (raw) => toleranceLabel(a, raw),
  };
}
