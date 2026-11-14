'use client';

import { useEffect, useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Lock, RotateCcw, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input, StatusChip, normalizeDecimal } from '@/lib/components';
import { NUM_ALIGN } from '@/lib/components/money/format';
import type { EffectiveRules } from './rules-panel';
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

/**
 * Typed text → stored number. Accepts "7,5" and "7.5" (normalizeDecimal).
 * '' → undefined (no value typed); NaN → the field is invalid.
 */
function toStored(raw: string, kind: FieldKind): number | undefined {
  if (raw.trim() === '') return undefined;
  const canonical = normalizeDecimal(raw);
  const n = canonical === null ? NaN : Number(canonical);
  return kind === 'percent' ? n / 100 : n;
}

/** The validation message key for a typed value, or null when it is fine. */
function invalidKey(raw: string, kind: FieldKind): 'matching.percentRange' | 'matching.amountInvalid' | null {
  if (raw.trim() === '') return null;
  const v = toStored(raw, kind);
  if (v === undefined || !Number.isFinite(v) || v < 0) {
    return kind === 'percent' ? 'matching.percentRange' : 'matching.amountInvalid';
  }
  if (kind === 'percent' && v > 1) return 'matching.percentRange';
  return null;
}

/** The effective { value, isDefault } for a field key (from settings.effective). */
function effOf(eff: EffectiveRules, key: string) {
  const tol = eff.tolerances as Record<string, { value: number; isDefault: boolean }>;
  const appr = eff.approvalThresholds as Record<string, { value: number; isDefault: boolean }>;
  return tol[key] ?? appr[key] ?? null;
}

export function SettingsForm({
  initial,
  canEdit,
  effective,
}: {
  initial: Settings;
  canEdit: boolean;
  /** The values the engine enforces (settings.effective), for placeholders and chips. */
  effective: EffectiveRules;
}) {
  const t = useT(settings);
  const locale = useLocale();
  // One flat string-state map keyed by field key (sections share no keys).
  // Blank = no override: the engine default (shown as the placeholder) applies.
  const [initialValues] = useState<Record<string, string>>(() => {
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
    out.ocr = toDisplay(initial.ocrReviewThreshold, 'percent');
    return out;
  });
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saved, setSaved] = useState<Record<string, string>>(initialValues);
  const ocr = values.ocr ?? '';
  const dirty = useMemo(
    () => Object.keys(values).some((k) => (values[k] ?? '').trim() !== (saved[k] ?? '').trim()),
    [values, saved],
  );
  // Leave guard: unsaved rule changes are lost on navigation.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      setSaved(values);
      setStatus({ ok: true, message: t('matching.saved') });
    },
    onError: (err) => setStatus({ ok: false, message: localizeServerError(err, locale, t('matching.failed')) }),
  });

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  const ALL_FIELDS = [...TOLERANCE_FIELDS, ...APPROVAL_FIELDS];
  const errors: Record<string, ReturnType<typeof invalidKey>> = Object.fromEntries([
    ...ALL_FIELDS.map((f) => [f.key, invalidKey(values[f.key] ?? '', f.kind)]),
    ['ocr', invalidKey(ocr, 'percent')],
  ]);
  const hasErrors = Object.values(errors).some(Boolean);

  /**
   * A typed value → the number; a cleared field that HAD an override → null
   * (removes it, the engine default applies again); untouched blank → omitted.
   */
  function patchValue(key: string, kind: FieldKind): number | null | undefined {
    const raw = (values[key] ?? '').trim();
    if (raw === '') return (saved[key] ?? '').trim() !== '' ? null : undefined;
    return toStored(raw, kind);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (hasErrors) return;

    const tolerances: Record<string, number | null> = {};
    for (const f of TOLERANCE_FIELDS) {
      const v = patchValue(f.key, f.kind);
      if (v !== undefined) tolerances[f.key] = v;
    }
    const approvalThresholds: Record<string, number | null> = {};
    for (const f of APPROVAL_FIELDS) {
      const v = patchValue(f.key, f.kind);
      if (v !== undefined) approvalThresholds[f.key] = v;
    }
    const ocrReviewThreshold = patchValue('ocr', 'percent');

    update.mutate({
      ...(Object.keys(tolerances).length ? { tolerances } : {}),
      ...(Object.keys(approvalThresholds).length ? { approvalThresholds } : {}),
      ...(ocrReviewThreshold !== undefined ? { ocrReviewThreshold } : {}),
    });
  }

  /**
   * One ₪ / % input: text + inputMode=decimal (no type=number), the unit as an
   * end adornment, numbers right-aligned (NUM_ALIGN), the engine default as the
   * placeholder, a default/custom chip, and "restore default" for an override.
   */
  function knobField(f: { key: string; kind: FieldKind; hint?: string }, label: string, idKey = f.key) {
    const eff = idKey === 'ocr' ? effective.ocrReviewThreshold : effOf(effective, f.key);
    const raw = values[idKey] ?? '';
    const custom = raw.trim() !== '';
    const err = errors[idKey];
    return (
      <Field
        key={idKey}
        label={
          <span className="flex flex-wrap items-center gap-2">
            {label}
            <StatusChip tone={custom ? 'info' : 'neutral'} label={custom ? t('rules.custom') : t('rules.default')} />
          </span>
        }
        htmlFor={`set-${idKey}`}
        hint={err ? t(err) : f.hint ? t(`matching.fields.${f.hint}` as never) : undefined}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              id={`set-${idKey}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={raw}
              placeholder={eff ? toDisplay(eff.value, f.kind === 'fraction' ? 'percent' : f.kind) : undefined}
              onChange={(e) => set(idKey, e.target.value)}
              disabled={!canEdit}
              aria-invalid={!!err || undefined}
              className={`${NUM_ALIGN} pe-9`}
            />
            <span
              className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted"
              aria-hidden="true"
            >
              {f.kind === 'currency' ? '₪' : '%'}
            </span>
          </div>
          {canEdit && custom ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set(idKey, '')}
              aria-label={t('matching.restoreDefaultFor', { field: label })}
              title={t('matching.restoreDefault')}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </Field>
    );
  }

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
          {TOLERANCE_FIELDS.map((f) => knobField(f, t(`matching.fields.${f.key}`)))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('matching.approvalsTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('matching.approvalsSubtitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {APPROVAL_FIELDS.map((f) => knobField(f, t(`matching.fields.${f.key}`)))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('matching.ocrTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('matching.ocrSubtitle')}
        </p>
        <div className="max-w-xs">{knobField({ key: 'ocrReviewThreshold', kind: 'percent' }, t('matching.ocrLabel'), 'ocr')}</div>
      </Card>

      {canEdit && dirty ? (
        <div
          role="region"
          aria-label={t('matching.dirty')}
          data-testid="settings-dirty-bar"
          className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line-strong bg-surface p-3 shadow-lg"
        >
          <span className="text-sm font-medium text-ink">{t('matching.dirty')}</span>
          <Button type="submit" variant="primary" size="sm" loading={update.isPending} disabled={hasErrors}>
            {t('matching.saveShort')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValues(saved);
              setStatus(null);
            }}
          >
            {t('matching.discard')}
          </Button>
        </div>
      ) : null}
      {status ? (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-sm font-medium ${status.ok ? 'text-primary' : 'text-danger'}`}
        >
          {status.ok ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          )}
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
