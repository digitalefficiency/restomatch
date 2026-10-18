'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Field,
  LinkButton,
  SectionHeader,
  Select,
  cn,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  catalogErrorKey,
  decodeCsvBytes,
  extensionOf,
  sampleCatalogCsv,
} from './file-logic';

type Outputs = inferRouterOutputs<AppRouter>;
type Preview = Outputs['catalog']['parsePreview'];
type CommitResult = Outputs['catalog']['commitImport'];
type Mapping = Preview['mapping'];
type FileInput = { filename: string; base64?: string; text?: string };

type Step = 'SUPPLIER' | 'UPLOAD' | 'MAP' | 'DONE';
const ORDER: Step[] = ['SUPPLIER', 'UPLOAD', 'MAP', 'DONE'];
const STEP_KEY = { SUPPLIER: 'supplier', UPLOAD: 'upload', MAP: 'map', DONE: 'done' } as const;

const FIELDS: Array<keyof Mapping> = ['name', 'price', 'sku', 'unit', 'barcode', 'packSize'];

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

export function ImportWizard({ initialSupplierId }: { initialSupplierId: string }) {
  const t = useT(catalogNs);
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
  const [result, setResult] = useState<CommitResult | null>(null);

  const suppliers = trpc.suppliers.list.useQuery({});
  const parsePreview = trpc.catalog.parsePreview.useMutation();
  const commitImport = trpc.catalog.commitImport.useMutation();
  const utils = trpc.useUtils();

  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const supplierName = supplier ? displayName(supplier.name, supplier.nameEn, locale).primary : '';

  const serverError = (e: unknown) => {
    const key = catalogErrorKey(e);
    return key ? t(`import.errors.${key}`) : friendlyError(e, tc);
  };

  async function acceptFile(f: File | undefined) {
    setFileError(null);
    parsePreview.reset();
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
      const res = await parsePreview.mutateAsync({ supplierId, file });
      setPreview(res);
      setMapping(res.mapping);
      setStep('MAP');
    } catch {
      // Rendered below from parsePreview.error.
    }
  }

  async function handleCommit() {
    if (!file || !supplierId) return;
    try {
      const res = await commitImport.mutateAsync({ supplierId, file, mapping });
      setResult(res);
      setStep('DONE');
      void utils.catalog.items.invalidate();
      if (!res.queued) toast.success(t('import.doneTitle', { count: formatNumber(res.rowCount, locale) }));
    } catch {
      // Rendered below from commitImport.error.
    }
  }

  function downloadSample() {
    const blob = new Blob([sampleCatalogCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'restomatch-catalog-sample.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const resetAll = () => {
    setStep('SUPPLIER');
    setFile(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    parsePreview.reset();
    commitImport.reset();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('import.breadcrumb'), href: '/dashboard/catalog' }, { label: t('import.title') }]}
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
          <Field label={t('import.pickSupplier')} htmlFor="imp-supplier">
            <Select id="imp-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
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
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
            <span>{t('import.formats')}</span>
            <button
              type="button"
              onClick={downloadSample}
              className="inline-flex items-center gap-1 rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> {t('import.sample')}
            </button>
          </div>
          {(fileError || parsePreview.error) && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {fileError ?? serverError(parsePreview.error)}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={!file} loading={parsePreview.isPending} onClick={handlePreview}>
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
              <Field key={key} label={t(`import.fields.${key}`)} htmlFor={`map-${key}`}>
                <Select
                  id={`map-${key}`}
                  value={mapping[key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))}
                  aria-invalid={(key === 'name' && !mapping.name) || undefined}
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

          {commitImport.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {serverError(commitImport.error)}
            </p>
          )}
          {!mapping.name && <p className="mt-3 text-xs text-warn">{t('import.mapNameRequired')}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!mapping.name}
              loading={commitImport.isPending}
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
          {result.queued ? (
            <p className="mt-3 text-ink" role="status">
              {t('import.queued', { count: formatNumber(result.rowCount, locale) })}
            </p>
          ) : (
            <>
              <p className="mt-3 text-lg font-semibold text-ink" role="status">
                {t('import.doneTitle', { count: formatNumber(result.rowCount, locale) })}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
                <Badge tone="accent">{t('import.created', { count: formatNumber(result.created, locale) })}</Badge>
                <Badge tone="info">{t('import.updated', { count: formatNumber(result.updated, locale) })}</Badge>
                <Badge tone="gold">
                  {t('import.createdProducts', { count: formatNumber(result.createdProducts, locale) })}
                </Badge>
                {result.ambiguous.length > 0 && (
                  <Badge tone="warning">
                    {t('import.ambiguous', { count: formatNumber(result.ambiguous.length, locale) })}
                  </Badge>
                )}
              </div>
              {result.ambiguous.length > 0 && (
                <div className="mx-auto mt-4 max-w-xl rounded-xl border border-warn/30 bg-warn/5 p-3 text-start">
                  <p className="mb-2 text-xs font-semibold text-warn">{t('import.ambiguousTitle')}</p>
                  <ul className="space-y-1 text-xs text-muted">
                    {result.ambiguous.slice(0, 10).map((a, i) => (
                      <li key={i}>
                        {t('import.ambiguousItem', {
                          raw: a.supplierNameRaw,
                          product: a.canonicalName,
                          confidence: formatPercent(a.confidence, locale, 0),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <LinkButton href="/dashboard/catalog" size="sm">
              {t('import.viewCatalog')}
            </LinkButton>
            <LinkButton href={`/dashboard/suppliers/${supplierId}?tab=catalog`} size="sm" variant="secondary">
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
