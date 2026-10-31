'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-react';
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
  Spinner,
  cn,
  displayName,
  friendlyError,
  useToast,
  useSingleFlight,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';
import { formatIls } from '@/lib/money';
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  catalogErrorKey,
  decodeCsvBytes,
  extensionOf,
  sampleCatalogCsv,
} from './file-logic';
import { confidenceWord, suggestionBasis } from '../money-logic';

type Outputs = inferRouterOutputs<AppRouter>;
type Preview = Outputs['catalog']['parsePreview'];
type Check = Preview['check'];
type CommitResult = Outputs['catalog']['commitImport'];
type Ambiguous = CommitResult['ambiguous'][number];
type Mapping = Preview['mapping'];
type VatBasis = 'ex' | 'inc';
type FileInput = { filename: string; base64?: string; text?: string };

type Step = 'SUPPLIER' | 'UPLOAD' | 'MAP' | 'REVIEW' | 'DONE';
const STEP_KEY = {
  SUPPLIER: 'supplier',
  UPLOAD: 'upload',
  MAP: 'map',
  REVIEW: 'review',
  DONE: 'done',
} as const;

const FIELDS: Array<keyof Mapping> = ['name', 'price', 'sku', 'unit', 'barcode', 'packSize'];

/** A row of the "בדיקה" step: an import suggestion, or (background import) an unlinked row. */
interface ReviewItem {
  itemId: string;
  supplierNameRaw: string;
  supplierSku: string | null;
  unit: string | null;
  suggestion: Pick<
    Ambiguous,
    'productId' | 'canonicalName' | 'productUnit' | 'confidence' | 'matchedBy' | 'reasons'
  > | null;
}

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

export function ImportWizard({
  initialSupplierId,
  reviewImportId,
}: {
  initialSupplierId: string;
  /** `?review=<importId>` (from the import history): reopen that import's "בדיקה" — it lives on the server. */
  reviewImportId?: string;
}) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const once = useSingleFlight();
  const router = useRouter();
  const [step, setStep] = useState<Step>(
    reviewImportId ? 'REVIEW' : initialSupplierId ? 'UPLOAD' : 'SUPPLIER',
  );
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [newSupplier, setNewSupplier] = useState('');
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [file, setFile] = useState<FileInput | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [vatBasis, setVatBasis] = useState<VatBasis | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [flaggedOk, setFlaggedOk] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [lastResolved, setLastResolved] = useState<string | null>(null);
  /** The mapping / VAT basis changed and the re-check hasn't answered yet: the shown flags are stale. */
  const [checkStale, setCheckStale] = useState(false);

  const suppliers = trpc.suppliers.list.useQuery({});
  const createSupplier = trpc.suppliers.create.useMutation();
  const parsePreview = trpc.catalog.parsePreview.useMutation();
  const recheck = trpc.catalog.parsePreview.useMutation();
  const commitImport = trpc.catalog.commitImport.useMutation();
  const utils = trpc.useUtils();

  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const supplierName = supplier ? displayName(supplier.name, supplier.nameEn, locale).primary : '';
  const noSuppliers = suppliers.isSuccess && (suppliers.data?.length ?? 0) === 0;
  const money = (v: number | null) =>
    v == null ? '—' : formatIls(v, { locale, maximumFractionDigits: 2 });

  // Background import (>200 rows): poll the import row for a determinate progress card.
  const queuedId = result?.queued ? result.importId : null;
  const imports = trpc.catalog.imports.useQuery(
    { supplierId, limit: 10 },
    {
      enabled: !!queuedId,
      refetchInterval: (q) =>
        q.state.data?.find((i) => i.id === queuedId)?.status === 'pending' ? 2000 : false,
    },
  );
  const job = queuedId ? imports.data?.find((i) => i.id === queuedId) : undefined;
  const jobDone = job?.status === 'committed';
  // The review queue is the server's: this import's rows saved without a product
  // link. It survives leaving the page ("אבדוק אחר כך" → the import history links
  // back here with ?review=). The inline commit's suggestions pre-fill it.
  const reviewId = result?.importId ?? reviewImportId ?? null;
  const unlinked = trpc.catalog.items.useQuery(
    { importId: reviewId ?? undefined, unlinkedOnly: true, limit: 200 },
    { enabled: !!reviewId && (!result?.queued || jobDone) },
  );
  const suggestions = new Map((result?.ambiguous ?? []).map((a) => [a.itemId, a]));
  const review: ReviewItem[] = unlinked.data
    ? unlinked.data.map((it) => ({
        itemId: it.id,
        supplierNameRaw: it.supplierNameRaw,
        supplierSku: it.supplierSku,
        unit: it.unit,
        suggestion: suggestions.get(it.id) ?? null,
      }))
    : (result?.ambiguous ?? []).map((a) => ({
        itemId: a.itemId,
        supplierNameRaw: a.supplierNameRaw,
        supplierSku: a.supplierSku,
        unit: a.unit,
        suggestion: a,
      }));

  const serverError = (e: unknown) => {
    const key = catalogErrorKey(e);
    return key ? t(`import.errors.${key}`) : friendlyError(e, tc);
  };

  async function addSupplier() {
    const name = newSupplier.trim();
    if (!name) return setSupplierError(t('import.supplierRequired'));
    try {
      const s = await createSupplier.mutateAsync({ name });
      await utils.suppliers.list.invalidate();
      setSupplierId(s.id);
      setNewSupplier('');
      setSupplierError(null);
      setStep('UPLOAD');
    } catch (e) {
      setSupplierError(friendlyError(e, tc));
    }
  }

  async function acceptFile(f: File | undefined) {
    setFileError(null);
    parsePreview.reset();
    if (!f) return;
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(f.name))) {
      setFile(null);
      setFileError(
        extensionOf(f.name) === 'xls' ? t('import.errors.LEGACY_XLS') : t('import.unsupportedType'),
      );
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
      setVatBasis(res.vatBasisDetected);
      setCheck(res.check);
      setFlaggedOk(false);
      setCommitError(null);
      setStep('MAP');
    } catch {
      // Rendered below from parsePreview.error.
    }
  }

  // Re-check the prices whenever the mapping or the VAT basis changes (debounced; nothing is written).
  const firstCheck = useRef(true);
  useEffect(() => {
    if (step !== 'MAP' || !file || !supplierId) return;
    if (firstCheck.current) {
      firstCheck.current = false;
      return;
    }
    setCheckStale(true);
    const timer = setTimeout(() => void runRecheck(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on the inputs only
  }, [mapping, vatBasis]);

  async function runRecheck(): Promise<Check | null> {
    if (!file || !supplierId) return null;
    try {
      const res = await recheck.mutateAsync({
        supplierId,
        file,
        mapping,
        ...(vatBasis ? { vatBasis } : {}),
      });
      setCheck(res.check);
      setFlaggedOk(false);
      setCheckStale(false);
      return res.check;
    } catch {
      // Keeps the stale flag: the commit stays blocked until a check answers.
      return null;
    }
  }

  async function handleCommit() {
    setCommitError(null);
    if (!mapping.name) return setCommitError(t('import.mapNameRequired'));
    if (!vatBasis) return setCommitError(t('import.vat.required'));
    // Never decide on a stale check: the flags shown may not be this mapping's.
    // Wait for the fresh one; a confirmation given to the old flags doesn't carry over.
    let current = check;
    let confirmed = flaggedOk;
    if (checkStale || recheck.isPending) {
      const fresh = await runRecheck();
      if (!fresh) return setCommitError(t('import.check.checking'));
      current = fresh;
      confirmed = false;
    }
    if ((current?.flaggedCount ?? 0) > 0 && !confirmed)
      return setCommitError(t('import.check.confirmFlaggedRequired'));
    once(commit);
  }

  async function commit() {
    if (!file || !supplierId || !vatBasis) return;
    try {
      const res = await commitImport.mutateAsync({
        supplierId,
        file,
        mapping,
        vatBasis,
        confirmFlagged: flaggedOk,
      });
      setResult(res);
      setLastResolved(null);
      setStep(!res.queued && res.ambiguous.length > 0 ? 'REVIEW' : 'DONE');
      void utils.catalog.items.invalidate();
      void utils.catalog.imports.invalidate();
      if (!res.queued)
        toast.success(t('import.doneTitle', { count: formatNumber(res.rowCount, locale) }));
    } catch (e) {
      setCommitError(serverError(e));
      // The server found flags this screen didn't show: refresh the check so they appear.
      if (catalogErrorKey(e) === 'FLAGGED_PRICES') void runRecheck();
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
    setVatBasis(null);
    setCheck(null);
    setLastResolved(null);
    firstCheck.current = true;
    parsePreview.reset();
    commitImport.reset();
  };

  const pending = review;
  const order: Step[] = [
    'SUPPLIER',
    'UPLOAD',
    'MAP',
    ...(review.length > 0 ? (['REVIEW'] as const) : []),
    'DONE',
  ];
  const vatRate = preview ? formatPercent(Number(preview.vatRate), locale, 0) : '';

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[
          { label: t('import.breadcrumb'), href: '/dashboard/catalog' },
          { label: t('import.title') },
        ]}
      />
      <SectionHeader level={1} title={t('import.title')} subtitle={t('import.subtitle')} />
      <ol
        aria-label={t('import.stepsLabel')}
        className="mb-4 flex flex-wrap items-center gap-2 text-xs"
      >
        {order.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'rounded-full px-3 py-1',
              i <= order.indexOf(step)
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
          {noSuppliers ? (
            <p className="mb-3 text-sm text-muted">{t('import.noSuppliers')}</p>
          ) : (
            <Field label={t('import.pickSupplier')} htmlFor="imp-supplier">
              <Select
                id="imp-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t('import.pickSupplierOption')}</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {displayName(s.name, s.nameEn, locale).primary}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <form
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void addSupplier();
            }}
          >
            <Field
              label={noSuppliers ? t('import.newSupplierName') : t('import.newSupplier')}
              htmlFor="imp-new-supplier"
              className="min-w-[14rem] flex-1"
            >
              <Input
                id="imp-new-supplier"
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                maxLength={200}
                autoFocus={noSuppliers}
              />
            </Field>
            <Button
              type="submit"
              variant={noSuppliers ? 'primary' : 'secondary'}
              loading={createSupplier.isPending}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('import.newSupplierAdd')}
            </Button>
          </form>
          {supplierError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {supplierError}
            </p>
          )}
          {!noSuppliers && (
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() =>
                  supplierId ? setStep('UPLOAD') : setSupplierError(t('import.supplierRequired'))
                }
              >
                {t('import.continue')} <ArrowRight className={fwd} aria-hidden="true" />
              </Button>
            </div>
          )}
        </Card>
      )}

      {step === 'UPLOAD' && (
        <Card elevated flow>
          <p className="mb-3 text-sm text-muted">
            {t('import.supplierLabel')}{' '}
            <span className="font-semibold text-ink">{supplierName}</span>
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
            <span className="text-sm font-medium text-ink">
              {file ? file.filename : t('import.choose')}
            </span>
            <span className="text-xs text-subtle">
              {file ? t('import.changeFile') : t('import.dropHint')}
            </span>
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
              className="inline-flex min-h-[44px] items-center gap-1 rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
            <Button
              variant="primary"
              disabled={!file}
              loading={parsePreview.isPending}
              onClick={handlePreview}
            >
              {t('import.analyze')} <ArrowRight className={fwd} aria-hidden="true" />
            </Button>
            <Button variant="ghost" onClick={() => setStep('SUPPLIER')}>
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
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))
                  }
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

          <fieldset
            className="mt-5 rounded-xl border border-line p-3"
            aria-describedby="imp-vat-hint"
          >
            <legend className="px-1 text-sm font-semibold text-ink">
              {t('import.vat.legend')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['ex', 'inc'] as const).map((v) => (
                <label
                  key={v}
                  className={cn(
                    'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-2 focus-within:ring-primary/60',
                    vatBasis === v
                      ? 'border-primary bg-primary/5 font-semibold text-ink'
                      : 'border-line text-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="imp-vat"
                    value={v}
                    checked={vatBasis === v}
                    onChange={() => setVatBasis(v)}
                    className="h-4 w-4"
                  />
                  {t(`import.vat.${v}`)}
                </label>
              ))}
            </div>
            <p id="imp-vat-hint" className="mt-2 text-xs text-subtle">
              {preview.vatBasisDetected && vatBasis === preview.vatBasisDetected
                ? `${t('import.vat.detected')} `
                : ''}
              {t('import.vat.hint', { rate: vatRate })}
            </p>
          </fieldset>

          <PriceCheck check={check} busy={recheck.isPending} money={money} />

          {(check?.flaggedCount ?? 0) > 0 && (
            <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={flaggedOk}
                onChange={(e) => setFlaggedOk(e.target.checked)}
                className="h-4 w-4"
              />
              {t('import.check.confirmFlagged')}
            </label>
          )}

          {commitError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {commitError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              loading={commitImport.isPending}
              onClick={() => void handleCommit()}
            >
              {t('import.commit', {
                count: formatNumber(check?.committable ?? preview.rowCount, locale),
              })}
            </Button>
            <Button variant="ghost" onClick={() => setStep('UPLOAD')}>
              {t('import.back')}
            </Button>
          </div>
        </Card>
      )}

      {step === 'REVIEW' && (
        <ReviewStep
          items={review}
          loading={unlinked.isLoading}
          lastResolved={lastResolved}
          onResolved={setLastResolved}
          onFinish={() =>
            result
              ? setStep('DONE')
              : router.push(`/dashboard/suppliers/${encodeURIComponent(supplierId)}?tab=catalog`)
          }
        />
      )}

      {step === 'DONE' && result && (
        <Card elevated flow className="text-center">
          {result.queued && !jobDone ? (
            <ImportProgress job={job} rowCount={result.rowCount} />
          ) : (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-ink" role="status">
                {t('import.doneTitle', { count: formatNumber(result.rowCount, locale) })}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
                <Badge tone="accent">
                  {t('import.created', {
                    count: formatNumber(job?.createdItems ?? result.created, locale),
                  })}
                </Badge>
                <Badge tone="info">
                  {t('import.updated', {
                    count: formatNumber(job?.updatedItems ?? result.updated, locale),
                  })}
                </Badge>
                {!result.queued && (
                  <Badge tone="gold">
                    {t('import.createdProducts', {
                      count: formatNumber(result.createdProducts, locale),
                    })}
                  </Badge>
                )}
              </div>
            </>
          )}
          {result.heldCount > 0 && (
            <HeldList
              held={result.held}
              count={result.heldCount}
              className="mx-auto mt-4 max-w-xl text-start"
            />
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {pending.length > 0 ? (
              <Button variant="primary" onClick={() => setStep('REVIEW')}>
                {t('import.doneReviewCta', { count: formatNumber(pending.length, locale) })}
              </Button>
            ) : null}
            <LinkButton
              href="/dashboard/catalog"
              variant={pending.length > 0 ? 'secondary' : 'primary'}
            >
              {t('import.viewCatalog')}
            </LinkButton>
            <LinkButton
              href={`/dashboard/suppliers/${encodeURIComponent(supplierId)}?tab=catalog`}
              variant="secondary"
            >
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

/** The parsed "₪ שיובא" next to the file's own cell, flagged against the current price; held rows below. */
function PriceCheck({
  check,
  busy,
  money,
}: {
  check: Check | null;
  busy: boolean;
  money: (v: number | null) => string;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();
  if (!check) return null;
  return (
    <section aria-labelledby="imp-check" className="mt-5" aria-busy={busy || undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="imp-check" className="text-sm font-semibold text-ink">
          {t('import.check.title')}
        </h2>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <Spinner className="h-3.5 w-3.5" /> {t('import.check.checking')}
          </span>
        )}
      </div>
      {check.flaggedCount > 0 && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          {t('import.check.flaggedSummary', { count: formatNumber(check.flaggedCount, locale) })}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-subtle">
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('import.check.name')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('import.check.inFile')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('import.check.imported')}
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                {t('import.check.current')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('import.check.note')}
              </th>
            </tr>
          </thead>
          <tbody>
            {check.rows.map((r) => (
              <tr
                key={r.rowNumber}
                className={cn('border-b border-line/60 last:border-0', r.flag && 'bg-warn/5')}
              >
                <td
                  className="max-w-[12rem] truncate px-3 py-1.5 text-ink"
                  title={r.supplierNameRaw}
                >
                  {r.supplierNameRaw}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-subtle">
                  <bdi dir="ltr">{r.rawPrice ?? '—'}</bdi>
                </td>
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-ink"
                  data-testid="imported-price"
                >
                  {r.price == null ? (
                    <span className="font-normal text-subtle">{t('import.check.noPrice')}</span>
                  ) : (
                    money(r.price)
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted sm:table-cell">
                  {money(r.currentPrice)}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {r.flag ? (
                    <span className="font-semibold text-ink">
                      {t(`import.check.flags.${r.flag}`)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-subtle">{t('import.check.sampleNote')}</p>
      {check.heldCount > 0 && (
        <HeldList held={check.held} count={check.heldCount} className="mt-3" />
      )}
    </section>
  );
}

function HeldList({
  held,
  count,
  className,
}: {
  held: Check['held'];
  count: number;
  className?: string;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const shown = held.slice(0, 8);
  return (
    <div
      className={cn('rounded-xl border border-danger/30 bg-danger/5 p-3', className)}
      role="group"
      aria-labelledby="imp-held"
    >
      <p id="imp-held" className="text-sm font-semibold text-ink">
        {t('import.check.heldTitle', { count: formatNumber(count, locale) })}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm text-muted">
        {shown.map((h) => (
          <li key={h.rowNumber}>
            {t('import.check.heldItem', {
              row: formatNumber(h.rowNumber, locale),
              name: h.supplierNameRaw,
            })}{' '}
            {/* The file's own characters, isolated: "-5" must not read "5-" in RTL. */}
            <bdi dir="ltr">&quot;{h.rawPrice}&quot;</bdi>
          </li>
        ))}
        {count > shown.length && (
          <li>
            {t('import.check.heldMore', { count: formatNumber(count - shown.length, locale) })}
          </li>
        )}
      </ul>
      <p className="mt-1 text-xs text-subtle">{t('import.check.heldHint')}</p>
    </div>
  );
}

function ImportProgress({
  job,
  rowCount,
}: {
  job:
    | { status: string; createdItems: number; updatedItems: number; error: string | null }
    | undefined;
  rowCount: number;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const done = Math.min(rowCount, (job?.createdItems ?? 0) + (job?.updatedItems ?? 0));
  const pct = rowCount > 0 ? Math.round((done / rowCount) * 100) : 0;
  if (job?.status === 'failed') {
    return (
      <p role="alert" className="text-sm text-danger">
        {t('import.progress.failed', { error: job.error ?? '' })}
      </p>
    );
  }
  return (
    <div className="text-start">
      <p className="font-semibold text-ink">{t('import.progress.title')}</p>
      <div
        role="progressbar"
        aria-label={t('import.progress.label')}
        aria-valuemin={0}
        aria-valuemax={rowCount}
        aria-valuenow={done}
        aria-valuetext={t('import.progress.rows', {
          done: formatNumber(done, locale),
          total: formatNumber(rowCount, locale),
        })}
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm tabular-nums text-muted" aria-live="polite">
        {t('import.progress.rows', {
          done: formatNumber(done, locale),
          total: formatNumber(rowCount, locale),
        })}
      </p>
      <p className="mt-1 text-xs text-subtle">{t('import.progress.leave')}</p>
    </div>
  );
}

/**
 * "בדיקה · N התאמות דורשות אישור": accept / choose another / new — nothing is
 * linked until a person says so. The rows come from the server (the import's
 * unlinked rows), so a resolved row leaves the list; focus moves to the next
 * row (or the finish button) and the outcome is announced.
 */
function ReviewStep({
  items,
  loading,
  lastResolved,
  onResolved,
  onFinish,
}: {
  items: ReviewItem[];
  loading: boolean;
  lastResolved: string | null;
  onResolved: (label: string) => void;
  onFinish: () => void;
}) {
  const t = useT(catalogNs);
  const locale = useLocale();
  /** Where focus goes once the resolved row has left the list. */
  const focusAt = useRef<{ index: number; itemId: string } | null>(null);
  useEffect(() => {
    const target = focusAt.current;
    // Wait for the refetch that drops the resolved row; until then it is still listed.
    if (!target || items.some((i) => i.itemId === target.itemId)) return;
    const next = items[Math.min(target.index, items.length - 1)];
    document.getElementById(next ? `rv-row-${next.itemId}` : 'rv-finish')?.focus();
    focusAt.current = null;
  }, [items]);
  return (
    <Card elevated flow>
      <h2 className="text-base font-bold text-ink">
        {t('import.review.title', { count: formatNumber(items.length, locale) })}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('import.review.intro')}</p>
      {/* Always mounted, so each change is announced. */}
      <p className="mt-2 text-sm text-ink" role="status" aria-live="polite">
        {lastResolved ? (
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <Check className="h-4 w-4" aria-hidden="true" />{' '}
            {t('import.review.resolved', { product: lastResolved })} ·{' '}
          </span>
        ) : null}
        <span className="text-xs text-subtle">
          {t('import.review.remaining', { count: formatNumber(items.length, locale) })}
        </span>
      </p>
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((it, i) => (
            <li key={it.itemId}>
              <ReviewRow
                item={it}
                onResolved={(label) => {
                  focusAt.current = { index: i, itemId: it.itemId };
                  onResolved(label);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Button
          id="rv-finish"
          variant={items.length === 0 ? 'primary' : 'secondary'}
          onClick={onFinish}
        >
          {items.length === 0 ? t('import.review.finish') : t('import.review.later')}
        </Button>
        {items.length > 0 && (
          <p className="mt-2 text-xs text-subtle">{t('import.review.laterHint')}</p>
        )}
      </div>
    </Card>
  );
}

function ReviewRow({
  item,
  onResolved,
}: {
  item: ReviewItem;
  onResolved: (label: string) => void;
}) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const [choosing, setChoosing] = useState(false);
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = trpc.catalog.updateItem.useMutation();
  const utils = trpc.useUtils();
  useEffect(() => {
    const timer = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(timer);
  }, [raw]);
  const results = trpc.mapping.searchProducts.useQuery(
    { q, limit: 6 },
    { enabled: choosing && q.length >= 1 },
  );
  const s = item.suggestion;

  async function link(patch: { productId: string } | { newProductName: string }, label: string) {
    setError(null);
    try {
      await update.mutateAsync({ itemId: item.itemId, patch });
      onResolved(label);
      await utils.catalog.items.invalidate();
      void utils.catalog.imports.invalidate();
    } catch (e) {
      setError(friendlyError(e, tc));
    }
  }

  const panelId = `rv-${item.itemId}`;
  const headingId = `rv-row-${item.itemId}`;
  return (
    <div className="rounded-xl border border-warn/40 p-3" role="group" aria-labelledby={headingId}>
      <p
        id={headingId}
        tabIndex={-1}
        className="rounded font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {item.supplierNameRaw}
      </p>
      <p className="text-xs text-subtle">
        {item.supplierSku ? <bdi className="font-mono">{item.supplierSku}</bdi> : null}
        {item.supplierSku && item.unit ? ' · ' : null}
        {item.unit}
      </p>
      {s ? (
        <p className="mt-2 text-sm text-ink">
          {t('import.review.suggestion', { product: s.canonicalName })}{' '}
          <span className="text-muted">
            · {t(`import.review.confidence.${confidenceWord(s.confidence)}`)} ·{' '}
            {suggestionBasis({
              matchedBy: s.matchedBy,
              unit: item.unit,
              productUnit: s.productUnit,
              reasons: s.reasons,
            })
              .map((b) => t(`import.review.basis.${b}`))
              .join(' · ')}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">{t('import.review.noSuggestion')}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {s && (
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => void link({ productId: s.productId }, s.canonicalName)}
          >
            <Check className="h-4 w-4" aria-hidden="true" /> {t('import.review.accept')}
          </Button>
        )}
        <Button
          variant="secondary"
          aria-expanded={choosing}
          aria-controls={panelId}
          onClick={() => setChoosing((v) => !v)}
        >
          <Search className="h-4 w-4" aria-hidden="true" /> {t('import.review.choose')}
        </Button>
        <Button
          variant="ghost"
          disabled={update.isPending}
          onClick={() => void link({ newProductName: item.supplierNameRaw }, item.supplierNameRaw)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {t('import.review.createNew')}
        </Button>
      </div>
      {choosing && (
        <div id={panelId} className="mt-3">
          <Input
            type="search"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t('import.review.searchPlaceholder')}
            aria-label={t('import.review.searchLabel')}
            autoFocus
          />
          <div className="mt-2 space-y-1.5" aria-live="polite">
            {results.isFetching && <Spinner className="h-3.5 w-3.5" />}
            {(results.data ?? []).map((p) => {
              const name = displayName(p.canonicalName, p.nameEn, locale);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={update.isPending}
                  onClick={() => void link({ productId: p.id }, name.primary)}
                  aria-label={t('import.review.linkTo', { name: name.primary })}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 text-start text-ink hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{name.primary}</span>
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                </button>
              );
            })}
            {q.length >= 1 && !results.isFetching && (results.data?.length ?? 0) === 0 && (
              <p className="text-sm text-subtle">{t('import.review.noMatches')}</p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
