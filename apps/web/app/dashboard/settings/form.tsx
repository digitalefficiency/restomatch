'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';

type Settings = inferRouterOutputs<AppRouter>['settings']['get'];

/** Field descriptor: how a numeric setting maps to a UI input. */
type FieldKind = 'percent' | 'currency' | 'fraction';

type FieldKey = keyof (typeof settings.he)['matching']['fields'];

interface FieldDef {
  key: FieldKey;
  /** Message key of the hint under matching.fields, when there is one. */
  hint?: FieldKey;
  kind: FieldKind;
}

const TOLERANCE_FIELDS: FieldDef[] = [
  { key: 'pricePercent', kind: 'percent', hint: 'pricePercentHint' },
  { key: 'priceAbsolute', kind: 'currency', hint: 'priceAbsoluteHint' },
  { key: 'qtyPercent', kind: 'percent' },
  { key: 'qtyAbsolute', kind: 'currency' },
  { key: 'blockPricePercent', kind: 'percent', hint: 'blockPricePercentHint' },
];

const APPROVAL_FIELDS: FieldDef[] = [
  { key: 'largeInvoiceWithoutPo', kind: 'currency' },
  { key: 'unorderedItemSignificant', kind: 'currency' },
  { key: 'cumulativeLargeAmount', kind: 'currency' },
  { key: 'cumulativeLargePct', kind: 'percent' },
  { key: 'cumulativeMediumAmountMin', kind: 'currency' },
  { key: 'cumulativeMediumPctMin', kind: 'percent' },
];

// Percent fields are stored 0..1 but edited as whole percents (5 = 0.05).
function toDisplay(value: number | undefined, kind: FieldKind): string {
  if (value == null) return '';
  if (kind === 'percent') return String(Math.round(value * 1000) / 10);
  return String(value);
}

function toStored(raw: string, kind: FieldKind): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return kind === 'percent' ? n / 100 : n;
}

export function SettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const t = useT(settings);
  const locale = useLocale();
  // One flat string-state map keyed by field key (sections share no keys).
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of TOLERANCE_FIELDS) {
      out[f.key] = toDisplay(initial.tolerances?.[f.key as keyof typeof initial.tolerances], f.kind);
    }
    for (const f of APPROVAL_FIELDS) {
      out[f.key] = toDisplay(
        initial.approvalThresholds?.[f.key as keyof typeof initial.approvalThresholds],
        f.kind,
      );
    }
    return out;
  });
  const [ocr, setOcr] = useState<string>(toDisplay(initial.ocrReviewThreshold, 'percent'));

  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.settings.update.useMutation({
    onSuccess: () => setStatus({ ok: true, message: t('matching.saved') }),
    onError: (err) => setStatus({ ok: false, message: localizeServerError(err, locale, t('matching.failed')) }),
  });

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const tolerances: Record<string, number> = {};
    for (const f of TOLERANCE_FIELDS) {
      const v = toStored(values[f.key] ?? '', f.kind);
      if (v != null) tolerances[f.key] = v;
    }
    const approvalThresholds: Record<string, number> = {};
    for (const f of APPROVAL_FIELDS) {
      const v = toStored(values[f.key] ?? '', f.kind);
      if (v != null) approvalThresholds[f.key] = v;
    }
    const ocrReviewThreshold = toStored(ocr, 'percent');

    update.mutate({
      ...(Object.keys(tolerances).length ? { tolerances } : {}),
      ...(Object.keys(approvalThresholds).length ? { approvalThresholds } : {}),
      ...(ocrReviewThreshold != null ? { ocrReviewThreshold } : {}),
    });
  }

  const inputProps = (kind: FieldKind) =>
    kind === 'percent' ? { step: '0.1', min: '0', max: '100' } : { step: 'any', min: '0' };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!canEdit ? (
        <Card
          padding="md"
          className="flex items-center gap-3 border-warn/30 bg-warn/5 text-muted"
        >
          <Lock className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span>{t('readOnly.matching')}</span>
        </Card>
      ) : null}

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('matching.tolerancesTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('matching.tolerancesSubtitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TOLERANCE_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={t(`matching.fields.${f.key}`)}
              htmlFor={`set-${f.key}`}
              hint={f.hint ? t(`matching.fields.${f.hint}`) : undefined}
            >
              <Input
                id={`set-${f.key}`}
                type="number"
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={!canEdit}
                {...inputProps(f.kind)}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('matching.approvalsTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('matching.approvalsSubtitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {APPROVAL_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={t(`matching.fields.${f.key}`)}
              htmlFor={`set-${f.key}`}
              hint={f.hint ? t(`matching.fields.${f.hint}`) : undefined}
            >
              <Input
                id={`set-${f.key}`}
                type="number"
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={!canEdit}
                {...inputProps(f.kind)}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('matching.ocrTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('matching.ocrSubtitle')}
        </p>
        <Field label={t('matching.ocrLabel')} htmlFor="set-ocr" className="max-w-xs">
          <Input
            id="set-ocr"
            type="number"
            inputMode="decimal"
            value={ocr}
            onChange={(e) => setOcr(e.target.value)}
            disabled={!canEdit}
            step="0.1"
            min="0"
            max="100"
          />
        </Field>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" loading={update.isPending}>
            {t('matching.save')}
          </Button>
          {status ? (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-sm font-medium ${
                status.ok ? 'text-primary' : 'text-danger'
              }`}
            >
              {status.ok ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4" aria-hidden="true" />
              )}
              {status.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
