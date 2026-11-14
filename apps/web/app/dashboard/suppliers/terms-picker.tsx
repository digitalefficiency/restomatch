'use client';

import { useId } from 'react';
import { Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import {
  PAYMENT_LAW_MAX_DAYS_AFTER_EOM,
  TERMS_CHOICES,
  exceedsLawLimit,
  termsProblem,
  type TermsChoice,
  type TermsValue,
} from './terms';

/**
 * W2-11 · the structured payment-terms picker: מזומן / שוטף / שוטף+30/45/60/90
 * / שוטף+N / אחר. The parent stores `termsStringOf(value)` — a canonical
 * string W2-03's computeDueDate parses — and blocks Save on `termsProblem`.
 */
export function TermsPicker({
  value,
  onChange,
  showProblem,
}: {
  value: TermsValue;
  onChange: (v: TermsValue) => void;
  showProblem: boolean;
}) {
  const t = useT(suppliersNs);
  const id = useId();
  const problem = termsProblem(value);
  const choices: TermsChoice[] = ['none', ...TERMS_CHOICES];
  return (
    <div className="space-y-2">
      <select
        id="sup-terms"
        className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--c-focus))]"
        value={value.choice}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange({ ...value, choice: e.target.value as TermsChoice })}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {t(`terms.${c}`)}
          </option>
        ))}
      </select>
      {value.choice === 'eomN' ? (
        <label className="block text-sm text-muted">
          {t('terms.days')}
          <Input
            className="mt-1 w-32"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            dir="ltr"
            value={value.days}
            aria-invalid={(showProblem && problem === 'pickDays') || undefined}
            onChange={(e) => onChange({ ...value, days: e.target.value.replace(/\D/g, '') })}
          />
        </label>
      ) : null}
      {value.choice === 'other' ? (
        <label className="block text-sm text-muted">
          {t('terms.otherText')}
          <Input
            className="mt-1"
            maxLength={500}
            value={value.text}
            aria-invalid={(showProblem && problem === 'typeTerms') || undefined}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
        </label>
      ) : null}
      {showProblem && problem ? <p className="text-xs text-danger">{t(`terms.${problem}`)}</p> : null}
      {exceedsLawLimit(value) ? (
        <p className="text-xs font-semibold text-warn" data-testid="terms-law-warn">
          {t('terms.lawWarn', { max: PAYMENT_LAW_MAX_DAYS_AFTER_EOM })}
        </p>
      ) : null}
      <p id={`${id}-hint`} className="text-xs text-subtle">
        {t('terms.hint')}
      </p>
    </div>
  );
}
