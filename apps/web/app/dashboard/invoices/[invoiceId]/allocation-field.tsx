'use client';

import { useId, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Button, Input, StatusChip, friendlyError, useToast, type StatusTone } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { vat } from '@/lib/i18n/messages/vat';
import { trpc } from '@/lib/trpc/client';
import {
  deadlineLine,
  newClientMutationId,
  normaliseAllocationInput,
  numberStateLine,
  type NumberState,
} from '@/lib/vat/caseView';

const STATE_TONE: Record<NumberState, StatusTone> = { missing: 'warn', invalid: 'danger', valid: 'success' };

/**
 * AU-08 (A13): the "מספר הקצאה" field of the invoice cockpit.
 *
 * Shows the stored number and its FORMAT state, an inline editor for the write
 * roles (owner + bookkeeper), the one-tap suggestion from a corrected copy, the
 * deduction deadline and the Tax Authority copy fields. Renders nothing when
 * the `vatAtRisk` flag is off (`vat.invoiceCase` → null). No ₪ is shown here:
 * the VAT figure lives on the card and the cockpit badge; the ITA amounts are
 * plain copy values for the Tax Authority form.
 *
 * Mounted by the cockpit (W2-02) with one line: `<AllocationField invoiceId={id} />`.
 */
export function AllocationField({ invoiceId }: { invoiceId: string }) {
  const t = useT(vat);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const q = trpc.vat.invoiceCase.useQuery({ invoiceId }, { retry: false });
  const save = trpc.vat.setAllocationNumber.useMutation({
    onSuccess: async () => {
      setEditing(false);
      setDraft('');
      setError(null);
      toast.success(t('field.saved'));
      await Promise.all([utils.vat.invoiceCase.invalidate({ invoiceId }), utils.owner.vatAtRisk.invalidate()]);
    },
    onError: (e) => setError(friendlyError(e, tc, { BAD_REQUEST: t('field.formatError') })),
  });

  const data = q.data;
  if (!data) return null;
  const row = data.row;
  const state = data.numberState;

  const submit = (value: string, source: 'typed' | 'corrected_copy') => {
    const normalised = normaliseAllocationInput(value);
    if (!normalised) {
      setError(t('field.formatError'));
      return;
    }
    save.mutate({ invoiceId, allocationNumber: normalised, source, clientMutationId: newClientMutationId() });
  };

  const copy = async (key: string, value: string) => {
    await navigator.clipboard?.writeText(value).catch(() => null);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const deadline = row ? deadlineLine(row.deductionDeadline, row.daysLeft) : null;

  return (
    <section
      data-testid="allocation-field"
      data-state={state}
      aria-labelledby={`${inputId}-label`}
      className="rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${inputId}-label`} className="text-sm font-semibold text-ink">
          {t('field.label')}
        </h3>
        {data.allocationNumber ? (
          <span dir="ltr" className="font-medium tabular-nums text-ink" data-testid="allocation-value">
            {data.allocationNumber}
          </span>
        ) : null}
        {/* StatusChip takes no test id: the wrapper carries it. */}
        <span data-testid="allocation-state">
          <StatusChip tone={STATE_TONE[state]} label={t(numberStateLine(state).key as never)} />
        </span>
        {data.canWrite && !editing ? (
          <Button variant="tertiary" size="sm" onClick={() => setEditing(true)} data-testid="allocation-edit">
            {t('field.edit')}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft, 'typed');
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="sr-only">
              {t('field.label')}
            </label>
            <Input
              id={inputId}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              placeholder={t('field.placeholder')}
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              data-testid="allocation-input"
            />
            {error ? (
              <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={save.isPending} data-testid="allocation-save">
            {t('field.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setDraft('');
              setError(null);
            }}
          >
            {t('field.cancel')}
          </Button>
        </form>
      ) : null}

      {row?.suggestedNumber && data.canWrite ? (
        <button
          type="button"
          data-testid="allocation-suggestion"
          disabled={save.isPending}
          onClick={() => submit(row.suggestedNumber!.value, 'corrected_copy')}
          className="mt-3 block w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-start text-sm text-ink transition-colors duration-micro hover:border-primary"
        >
          {t('field.suggestion', { number: row.suggestedNumber.value })}
        </button>
      ) : null}

      {deadline ? (
        <p className="mt-3 text-sm text-muted" data-testid="allocation-deadline">
          {t(deadline.key as never, deadline.params as never)}
        </p>
      ) : null}

      {row && data.ita.fields.length ? (
        <div className="mt-4 border-t border-line pt-3" data-testid="allocation-ita">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">{t('field.itaTitle')}</h4>
            {data.ita.url ? (
              <a
                href={data.ita.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4"
              >
                {t('field.itaOpen')}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {data.ita.fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-2 rounded-control bg-surface-2 px-2 py-1">
                <dt className="text-muted">{f.labelHe}</dt>
                <dd className="flex items-center gap-1">
                  <span dir="ltr" className="tabular-nums text-ink">
                    {f.value ?? t('field.unknown')}
                  </span>
                  {f.value ? (
                    <button
                      type="button"
                      onClick={() => void copy(f.key, f.value!)}
                      aria-label={`${t('field.copy')}: ${f.labelHe}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-control text-subtle hover:bg-surface hover:text-ink"
                    >
                      {copiedKey === f.key ? <span className="text-xs">✓</span> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">{t('field.itaDisclaimer')}</p>
        </div>
      ) : null}
    </section>
  );
}
