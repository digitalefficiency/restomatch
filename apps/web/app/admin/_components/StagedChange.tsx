'use client';

import { useId, useState } from 'react';
import { Button } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { REASON_MAX, normalizeReason, type StagedField } from './staged';

/**
 * A pending admin change: the before → after table, a required reason and the
 * one primary action. Nothing is written until "אישור השינוי"; "ביטול" hands
 * control back to the form so it can restore its fields.
 */
export function StagedChange({
  fields,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  fields: StagedField[];
  pending: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const t = useT(admin);
  const id = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = normalizeReason(reason);
  const showInvalid = touched && valid === null;

  return (
    <section
      role="region"
      aria-labelledby={`${id}-title`}
      className="mt-4 rounded-xl border border-line-strong bg-surface-2 p-4"
      data-testid="staged-change"
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
        {t('staged.title')}
      </h3>
      <p className="mt-0.5 text-xs text-muted">{t('staged.hint')}</p>

      <table className="mt-3 w-full text-start text-sm">
        <thead className="text-xs text-subtle">
          <tr>
            <th className="py-1 text-start font-medium">{t('staged.colField')}</th>
            <th className="py-1 text-start font-medium">{t('staged.colBefore')}</th>
            <th className="py-1 text-start font-medium">{t('staged.colAfter')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {fields.map((f) => (
            <tr key={f.key} data-field={f.key}>
              <td className="py-1.5 text-muted">{f.label}</td>
              <td className="py-1.5 text-muted line-through decoration-line-strong">{f.before || t('staged.empty')}</td>
              <td className="py-1.5 font-medium text-ink">{f.after || t('staged.empty')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <label htmlFor={`${id}-reason`} className="mt-4 block text-xs font-medium text-ink">
        {t('staged.reasonLabel')}
      </label>
      <textarea
        id={`${id}-reason`}
        value={reason}
        maxLength={REASON_MAX}
        rows={2}
        required
        aria-invalid={showInvalid}
        aria-describedby={`${id}-reason-hint`}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <p id={`${id}-reason-hint`} className={`mt-1 text-xs ${showInvalid ? 'text-danger' : 'text-subtle'}`}>
        {showInvalid ? t('staged.reasonTooShort') : t('staged.reasonHint')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || valid === null}
          onClick={() => {
            setTouched(true);
            if (valid) onConfirm(valid);
          }}
        >
          {pending ? t('staged.confirming') : t('staged.confirm')}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          {t('staged.cancel')}
        </Button>
        {error ? (
          <span className="text-xs text-danger" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}
