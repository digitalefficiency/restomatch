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
type Mapping = Preview['mapping'];
type FileInput = { filename: string; base64?: string; text?: string };

type Step = 'SUPPLIER' | 'UPLOAD' | 'MAP' | 'DONE';
const ORDER: Step[] = ['SUPPLIER', 'UPLOAD', 'MAP', 'DONE'];
const STEP_KEY = { SUPPLIER: 'supplier', UPLOAD: 'upload', MAP: 'map', DONE: 'done' } as const;

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
 * Contract price-list import, modelled on the catalog import: supplier → file
 * (CSV/XLSX, read in the browser) → contracts.importPreview (auto-mapping) →
 * column mapping + default valid-from/to → contracts.importCommit → summary
 * with skipped rows and translated reasons.
 */
export function ContractImportWizard({ initialSupplierId }: { initialSupplierId: string }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const [step, setStep] = useState<Step>(initialSupplierId ? 'UPLOAD' : 'SUPPLIER');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [file, setFile] = useState<FileInput | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaultFrom, setDefaultFrom] = useState(todayIso());
  const [defaultTo, setDefaultTo] = useState('');
  const [result, setResult] = useState<CommitResult | null>(null);

  const suppliers = trpc.suppliers.list.useQuery({});
  const importPreview = trpc.contracts.importPreview.useMutation();
  const importCommit = trpc.contracts.importCommit.useMutation();
  const utils = trpc.useUtils();

  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const supplierName = supplier ? displayName(supplier.name, supplier.nameEn, locale).primary : '';
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

  async function handleCommit() {
    if (!file || !supplierId || !mappingOk || !datesOk) return;
    try {
      const res = await importCommit.mutateAsync({
        supplierId,
        file,
        mapping,
        defaultValidFrom: defaultFrom,
        defaultValidTo: defaultTo || null,
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
    setStep(initialSupplierId ? 'UPLOAD' : 'SUPPLIER');
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
            <span className="tabular-nums">{i + 1}.</span> {t(`import.steps.${STEP_KEY[s]}`)}
          </li>
        ))}
      </ol>

      {step === 'SUPPLIER' && (
        <Card elevated flow>
          <Field label={t('import.pickSupplier')} htmlFor="ci-supplier">
            <Select id="ci-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('import.pickSupplierOption')}</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {displayName(s.name, s.nameEn, locale).primary}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-4">
            <Button variant="primary" size="sm" disabled={!supplierId} onClick={() => setStep('UPLOAD')}>
              {t('import.continue')} <ArrowRight className={fwd} aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'UPLOAD' && (
        <Card elevated flow>
          <p className="mb-3 text-sm text-muted">
            {t('import.supplierLabel')} <span className="font-semibold text-ink">{supplierName}</span>
          </p>
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
              'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed bg-surface-2 px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-primary/60',
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
          {(fileError || importPreview.error) && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {fileError ?? serverError(importPreview.error)}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={!file} loading={importPreview.isPending} onClick={handlePreview}>
              {t('import.analyze')} <ArrowRight className={fwd} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep('SUPPLIER')}>
              {t('import.back')}
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
                          <span className="ms-1 rounded bg-primary/12 px-1 text-[10px] text-primary">
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

          {importCommit.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {serverError(importCommit.error)}
            </p>
          )}
          {!mappingOk && <p className="mt-3 text-xs text-warn">{t('import.mapRequired')}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!mappingOk || !datesOk}
              loading={importCommit.isPending}
              onClick={handleCommit}
            >
              {t('import.commit', { count: formatNumber(preview.rowCount, locale) })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep('UPLOAD')}>
              {t('import.back')}
            </Button>
          </div>
        </Card>
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
            <LinkButton href="/dashboard/contracts?tab=contracts" size="sm">
              {t('import.viewContracts')}
            </LinkButton>
            <LinkButton href={`/dashboard/suppliers/${supplierId}?tab=contract`} size="sm" variant="secondary">
              {t('import.viewSupplier')}
            </LinkButton>
            <Button variant="ghost" size="sm" onClick={resetAll}>
              {t('import.another')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
