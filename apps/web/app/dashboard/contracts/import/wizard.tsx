'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, CheckCircle2, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Field,
  Input,
  LinkButton,
  Money,
  SectionHeader,
  Select,
  cn,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  decodeCsvBytes,
  extensionOf,
} from '../../catalog/import/file-logic';
import { contractFileErrorKey, todayIso } from '../logic';

type Outputs = inferRouterOutputs<AppRouter>;
type Preview = Outputs['contracts']['importPreview'];
type CommitResult = Outputs['contracts']['importCommit'];
type Diff = Outputs['contracts']['importDiff'];
type DiffChip = Diff['rows'][number]['chip'];
type Mapping = Preview['mapping'];
type FileInput = { filename: string; base64?: string; text?: string };

type Step = 'SOURCE' | 'MAP' | 'REVIEW' | 'DONE';
const ORDER: Step[] = ['SOURCE', 'MAP', 'REVIEW', 'DONE'];
const STEP_LABEL = { SOURCE: 'import.sourceStep', MAP: 'import.steps.map', REVIEW: 'import.reviewStep', DONE: 'import.steps.done' } as const;
const CHIPS: DiffChip[] = ['up', 'down', 'new', 'unmatched', 'invalid', 'same'];
const CHIP_TONE: Record<DiffChip, 'warning' | 'accent' | 'info' | 'neutral' | 'danger'> = {
  up: 'warning',
  down: 'accent',
  new: 'info',
  same: 'neutral',
  unmatched: 'neutral',
  invalid: 'danger',
};

const FIELDS: Array<keyof Mapping> = ['name', 'sku', 'price', 'unit', 'validFrom', 'validTo'];

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readFile(file: File): Promise<FileInput> {
  if (extensionOf(file.name) === 'csv') {
    return { filename: file.name, text: decodeCsvBytes(new Uint8Array(await file.arrayBuffer())) };
  }
  return { filename: file.name, base64: arrayBufferToBase64(await file.arrayBuffer()) };
}

const fwd = 'h-4 w-4 rtl:-scale-x-100';

/**
 * Contract price-list import, modelled on the catalog import. W2-12: one
 * supplier + file step (CSV/XLSX, read in the browser) → contracts.importPreview
 * (auto-mapping) → column mapping + default valid-from/to → "בדיקה": the
 * contracts.importDiff against the contract in force (מוצר · חוזה נוכחי · חדש
 * · שינוי · ₪/חודש, chips, per-row exclude) → an effect-named commit
 * (contracts.importCommit with excludeRowIds) → summary. Parsed ₪ only, never
 * raw cells. PDF/photo price lists are out of scope (OCR).
 */
export function ContractImportWizard({ initialSupplierId }: { initialSupplierId: string }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const [step, setStep] = useState<Step>('SOURCE');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [file, setFile] = useState<FileInput | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaultFrom, setDefaultFrom] = useState(todayIso());
  const [defaultTo, setDefaultTo] = useState('');
  const [result, setResult] = useState<CommitResult | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [chipFilter, setChipFilter] = useState<DiffChip | null>(null);

  const suppliers = trpc.suppliers.list.useQuery({});
  const importPreview = trpc.contracts.importPreview.useMutation();
  const importCommit = trpc.contracts.importCommit.useMutation();
  const importDiff = trpc.contracts.importDiff.useMutation();
  const utils = trpc.useUtils();

  const mappingOk = !!mapping.price && (!!mapping.name || !!mapping.sku);
  const datesOk = !!defaultFrom && (!defaultTo || defaultTo >= defaultFrom);

  const serverError = (e: unknown) => {
    const key = contractFileErrorKey(e);
    return key ? t(`import.errors.${key}`) : friendlyError(e, tc);
  };

  async function acceptFile(f: File | undefined) {
    setFileError(null);
    importPreview.reset();
    if (!f) return;
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(f.name))) {
      setFile(null);
      setFileError(extensionOf(f.name) === 'xls' ? t('import.errors.LEGACY_XLS') : t('import.unsupportedType'));
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(t('import.tooBig'));
      return;
    }
    try {
      setFile(await readFile(f));
    } catch {
      setFile(null);
      setFileError(t('import.readFailed'));
    }
  }

  async function handlePreview() {
    if (!file || !supplierId) return;
    try {
      const res = await importPreview.mutateAsync({ supplierId, file });
      setPreview(res);
      setMapping(res.mapping);
      setStep('MAP');
    } catch {
      // Rendered below from importPreview.error.
    }
  }

  async function handleReview() {
    if (!file || !supplierId || !mappingOk || !datesOk) return;
    try {
      const res = await importDiff.mutateAsync({
        supplierId,
        file,
        mapping,
        defaultValidFrom: defaultFrom,
        defaultValidTo: defaultTo || null,
      });
      setDiff(res);
      setExcluded(new Set());
      setChipFilter(null);
      setStep('REVIEW');
    } catch {
      // Rendered below from importDiff.error.
    }
  }

  async function handleCommit() {
    if (!file || !supplierId || !mappingOk || !datesOk) return;
    try {
      const res = await importCommit.mutateAsync({
        supplierId,
        file,
        mapping,
        defaultValidFrom: defaultFrom,
        defaultValidTo: defaultTo || null,
        excludeRowIds: [...excluded],
      });
      setResult(res);
      setStep('DONE');
      void utils.contracts.list.invalidate();
      toast.success(t('import.doneTitle'));
    } catch {
      // Rendered below from importCommit.error.
    }
  }

  const resetAll = () => {
    setStep('SOURCE');
    setDiff(null);
    setExcluded(new Set());
    importDiff.reset();
    setSupplierId(initialSupplierId);
    setFile(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    importPreview.reset();
    importCommit.reset();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('breadcrumb'), href: '/dashboard/contracts' }, { label: t('import.title') }]}
      />
      <SectionHeader level={1} title={t('import.title')} subtitle={t('import.subtitle')} />
      <ol aria-label={t('import.stepsLabel')} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {ORDER.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'rounded-full px-3 py-1',
              i <= ORDER.indexOf(step)
                ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                : 'bg-surface-2 text-subtle',
            )}
          >
            <span className="num">{i + 1}.</span> {t(STEP_LABEL[s])}
          </li>
        ))}
      </ol>

      {step === 'SOURCE' && (
        <Card elevated flow>
          <Field label={t('import.pickSupplier')} htmlFor="ci-supplier" className="mb-4">
            <Select id="ci-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('import.pickSupplierOption')}</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {displayName(s.name, s.nameEn, locale).primary}
                </option>
              ))}
            </Select>
          </Field>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed bg-surface-2 px-6 py-10 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[rgb(var(--c-focus))]',
              dragging ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/40',
            )}
          >
            <FileSpreadsheet className="h-8 w-8 text-subtle" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">{file ? file.filename : t('import.choose')}</span>
            <span className="text-xs text-subtle">{file ? t('import.changeFile') : t('import.dropHint')}</span>
            <input
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                void acceptFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <p className="mt-2 text-xs text-subtle">{t('import.formats')}</p>
          <p className="mt-1 text-xs text-subtle">{t('import.scope')}</p>
          {(fileError || importPreview.error) && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {fileError ?? serverError(importPreview.error)}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" disabled={!file || !supplierId} loading={importPreview.isPending} onClick={handlePreview}>
              {t('import.analyze')} <ArrowRight className={fwd} aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'MAP' && preview && (
        <Card elevated flow>
          <p className="mb-3 text-sm text-muted">
            {t('import.rowsDetected', { count: formatNumber(preview.rowCount, locale) })}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((key) => (
              <Field key={key} label={t(`import.fields.${key}`)} htmlFor={`cmap-${key}`}>
                <Select
                  id={`cmap-${key}`}
                  value={mapping[key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))}
                  aria-invalid={(key === 'price' && !mapping.price) || undefined}
                >
                  <option value="">{t('import.none')}</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          <h2 className="mb-2 mt-5 text-sm font-semibold text-ink">{t('import.defaultsTitle')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('import.defaultValidFrom')} htmlFor="ci-from">
              <Input id="ci-from" type="date" value={defaultFrom} onChange={(e) => setDefaultFrom(e.target.value)} />
            </Field>
            <Field label={t('import.defaultValidTo')} htmlFor="ci-to">
              <Input
                id="ci-to"
                type="date"
                value={defaultTo}
                min={defaultFrom}
                onChange={(e) => setDefaultTo(e.target.value)}
              />
            </Field>
          </div>

          <h2 className="mb-2 mt-5 text-sm font-semibold text-ink">{t('import.previewTitle')}</h2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-line text-subtle">
                  {preview.headers.map((h) => {
                    const mappedTo = FIELDS.find((f) => mapping[f] === h);
                    return (
                      <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-medium">
                        {h}
                        {mappedTo ? (
                          <span className="ms-1 rounded bg-primary/12 px-1 text-xs text-primary">
                            {t(`import.fields.${mappedTo}`).replace(' *', '')}
                          </span>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.sample.slice(0, 6).map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {preview.headers.map((h) => (
                      <td key={h} className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {row[h] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {importDiff.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {serverError(importDiff.error)}
            </p>
          )}
          {!mappingOk && <p className="mt-3 text-sm text-warn">{t('import.mapRequired')}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" disabled={!mappingOk || !datesOk} loading={importDiff.isPending} onClick={handleReview}>
              {t('import.review')} <ArrowRight className={fwd} aria-hidden="true" />
            </Button>
            <Button variant="ghost" onClick={() => setStep('SOURCE')}>
              {t('import.back')}
            </Button>
          </div>
        </Card>
      )}

      {step === 'REVIEW' && diff && (
        <ReviewStep
          diff={diff}
          excluded={excluded}
          setExcluded={setExcluded}
          chipFilter={chipFilter}
          setChipFilter={setChipFilter}
          committing={importCommit.isPending}
          commitError={importCommit.error ? serverError(importCommit.error) : null}
          onCommit={handleCommit}
          onBack={() => setStep('MAP')}
        />
      )}

      {step === 'DONE' && result && (
        <Card elevated flow className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-ink" role="status">
            {t('import.doneTitle')}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
            <Badge tone="accent">{t('import.created', { count: formatNumber(result.created, locale) })}</Badge>
            <Badge tone="info">{t('import.updated', { count: formatNumber(result.updated, locale) })}</Badge>
            {result.excluded > 0 && <Badge tone="neutral">{t('import.excluded', { count: result.excluded })}</Badge>}
            {result.skipped.length > 0 && (
              <Badge tone="warning">
                {t('import.skippedCount', { count: formatNumber(result.skipped.length, locale) })}
              </Badge>
            )}
          </div>
          {result.skipped.length > 0 && (
            <div className="mx-auto mt-4 max-w-xl rounded-xl border border-warn/30 bg-warn/5 p-3 text-start">
              <p className="mb-2 text-xs font-semibold text-warn">{t('import.skippedTitle')}</p>
              <ul className="space-y-1 text-xs text-muted">
                {result.skipped.slice(0, 20).map((s) => (
                  <li key={`${s.row}-${s.reason}`}>
                    {t('import.skippedItem', {
                      row: formatNumber(s.row, locale),
                      label: s.label,
                      reason: t(`import.reasons.${s.reason}`),
                    })}
                  </li>
                ))}
              </ul>
              {result.skipped.length > 20 ? (
                <p className="mt-2 text-xs text-subtle">
                  {t('import.skippedMore', { count: formatNumber(result.skipped.length - 20, locale) })}
                </p>
              ) : null}
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <LinkButton href="/dashboard/contracts?tab=contracts">
              {t('import.viewContracts')}
            </LinkButton>
            <LinkButton href={`/dashboard/suppliers/${encodeURIComponent(supplierId)}?tab=contract`} variant="secondary">
              {t('import.viewSupplier')}
            </LinkButton>
            <Button variant="ghost" onClick={resetAll}>
              {t('import.another')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function ReviewStep({
  diff,
  excluded,
  setExcluded,
  chipFilter,
  setChipFilter,
  committing,
  commitError,
  onCommit,
  onBack,
}: {
  diff: Diff;
  excluded: Set<number>;
  setExcluded: (s: Set<number>) => void;
  chipFilter: DiffChip | null;
  setChipFilter: (c: DiffChip | null) => void;
  committing: boolean;
  commitError: string | null;
  onCommit: () => void;
  onBack: () => void;
}) {
  const t = useT(contractsNs);
  const locale = useLocale();
  const writable = (r: Diff['rows'][number]) => r.chip !== 'unmatched' && r.chip !== 'invalid';
  const included = diff.rows.filter((r) => writable(r) && !excluded.has(r.rowId));
  // Σ ₪/month over the INCLUDED rows only — the commit button names what it does.
  const monthly = included.reduce((s, r) => s + (r.monthlyAgorot ?? 0), 0);
  const rows = chipFilter ? diff.rows.filter((r) => r.chip === chipFilter) : diff.rows;

  function toggle(rowId: number) {
    const next = new Set(excluded);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setExcluded(next);
  }

  return (
    <Card elevated flow>
      <h2 className="text-base font-semibold text-ink">{t('import.reviewTitle')}</h2>
      <p className="mt-1 text-sm text-muted">{t('import.reviewBody')}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('import.reviewCaption')}>
        {CHIPS.filter((c) => diff.counts[c] > 0).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={chipFilter === c}
            onClick={() => setChipFilter(chipFilter === c ? null : c)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm',
              chipFilter === c ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line text-muted',
            )}
          >
            {t(`import.chips.${c}`)} <span className="num font-semibold">{formatNumber(diff.counts[c], locale)}</span>
          </button>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line" aria-label={t('import.reviewCaption')} data-testid="import-diff">
        {rows.map((r) => {
          const name = r.productName ? displayName(r.productName, r.productNameEn, locale).primary : r.label;
          const ok = writable(r);
          const on = ok && !excluded.has(r.rowId);
          return (
            <li key={r.rowId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-sm" data-chip={r.chip}>
              {ok ? (
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={on}
                  onChange={() => toggle(r.rowId)}
                  aria-label={t('import.includeRow', { label: name })}
                />
              ) : (
                <span className="w-5" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{name}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <Badge tone={CHIP_TONE[r.chip]}>{t(`import.chips.${r.chip}`)}</Badge>
                  {r.reason ? <span>{t(`import.reasons.${r.reason}`)}</span> : null}
                  {r.deltaPct != null ? (
                    <span className="num">
                      {t('import.colDelta')} {formatNumber(r.deltaPct * 100, locale, { maximumFractionDigits: 1 })}%
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="text-right">
                {r.newPrice != null && ok ? (
                  <p className="flex flex-wrap items-baseline justify-end gap-1">
                    {r.currentPrice != null ? (
                      <>
                        <span className="sr-only">{t('import.colCurrent')}</span>
                        <Money value={r.currentPrice} context="unit" className="text-muted line-through" />
                        <span aria-hidden="true">{locale === 'he' ? '←' : '→'}</span>
                      </>
                    ) : (
                      <span className="text-xs text-subtle">{t('import.noCurrent')}</span>
                    )}
                    <span className="sr-only">{t('import.colNew')}</span>
                    <Money value={r.newPrice} context="unit" className="font-semibold" />
                  </p>
                ) : (
                  <p className="text-xs text-subtle">{t('import.heldOut')}</p>
                )}
                {r.monthlyAgorot != null && r.monthlyAgorot !== 0 ? (
                  <p className="text-xs text-muted">
                    <Money agorot={Math.abs(r.monthlyAgorot)} context="line" />{' '}
                    {r.monthlyAgorot > 0 ? t('import.perMonthMore') : t('import.perMonthLess')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {commitError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {commitError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={included.length === 0} loading={committing} onClick={onCommit} data-testid="import-commit">
          {t('import.commitEffect', { count: included.length })}
          {monthly !== 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <Money agorot={Math.abs(monthly)} context="line" />
              {monthly > 0 ? t('import.perMonthMore') : t('import.perMonthLess')}
            </>
          ) : null}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('import.back')}
        </Button>
      </div>
    </Card>
  );
}
