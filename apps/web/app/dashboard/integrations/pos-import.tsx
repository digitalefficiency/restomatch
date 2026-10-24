'use client';

import { useRef, useState } from 'react';
import { ReceiptText, Upload } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, cn, friendlyError, useSingleFlight, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { formatIls } from '@/lib/money';
import { MAX_POS_FILE_BYTES, bytesToBase64, posErrorOf } from './logic';

type Preview = inferRouterOutputs<AppRouter>['integrations']['posPreview'];
const FIELDS = ['date', 'itemRef', 'itemName', 'qty', 'net'] as const;

/** POS "sales by item" CSV → preview → import (replaces the days it covers). */
export function PosImport() {
  const t = useT(integrationsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  // Separate guards: picking a new file while the last import is still settling
  // must still preview it (one shared guard silently dropped that preview).
  const oncePreview = useSingleFlight();
  const onceImport = useSingleFlight();
  const utils = trpc.useUtils();
  const imports = trpc.integrations.posImports.useQuery();
  const preview = trpc.integrations.posPreview.useMutation();
  const doImport = trpc.integrations.posImport.useMutation();
  const [file, setFile] = useState<{ filename: string; base64: string } | null>(null);
  const fileRef = useRef<typeof file>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const day = (iso: string) => formatDate(`${iso}T12:00:00Z`, locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const errorText = (e: unknown) => {
    const pe = posErrorOf(e);
    if (!pe) return friendlyError(e, tc);
    const missing = pe.missing.map((f) => (f === 'item' ? t('pos.fields.itemName') : t(`pos.fields.${f as (typeof FIELDS)[number]}`)));
    return t(`pos.errors.${pe.key}`, { missing: missing.join(', ') });
  };

  async function pick(f: File | undefined) {
    setFileError(null);
    setResult(null);
    preview.reset();
    if (!f) return;
    if (f.size > MAX_POS_FILE_BYTES) return setFileError(t('pos.errors.TOO_LARGE'));
    try {
      const picked = { filename: f.name, base64: bytesToBase64(new Uint8Array(await f.arrayBuffer())) };
      fileRef.current = picked;
      setFile(picked);
      oncePreview(async () => {
        try {
          setResult(await preview.mutateAsync(picked));
        } catch {
          /* shown from preview.error */
        }
      });
    } catch {
      setFileError(t('pos.errors.readFailed'));
    }
  }

  function save() {
    if (!file) return;
    const submitted = file;
    onceImport(async () => {
      try {
        const r = await doImport.mutateAsync(submitted);
        toast.success(t('pos.imported', { count: formatNumber(r.rowCount, locale), from: day(r.from!), to: day(r.to!) }));
        if (r.replacedRows > 0) toast.success(t('pos.replaced', { count: formatNumber(r.replacedRows, locale) }));
        if (r.rejectedDays.length > 0) toast.error(t('pos.rejectedDays', { days: r.rejectedDays.map(day).join(', ') }));
        // Only clear what was imported: a file picked meanwhile stays.
        if (fileRef.current === submitted) {
          fileRef.current = null;
          setFile(null);
          setResult(null);
        }
        await utils.integrations.posImports.invalidate();
      } catch (e) {
        toast.error(errorText(e));
      }
    });
  }

  return (
    <section aria-labelledby="int-pos-title">
      <h2 id="int-pos-title" className="mb-1 flex items-center gap-2 text-lg font-bold text-ink">
        <ReceiptText className="h-5 w-5 text-primary" aria-hidden="true" /> {t('pos.title')}
      </h2>
      <p className="mb-3 text-sm text-muted">{t('pos.body')}</p>
      <Card elevated flow>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-8 text-center transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-primary/60">
          <Upload className="h-6 w-6 text-subtle" aria-hidden="true" />
          <span className="text-sm font-medium text-ink" dir="auto">
            {file ? file.filename : t('pos.choose')}
          </span>
          {file ? <span className="text-xs text-subtle">{t('pos.change')}</span> : null}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>

        {fileError || preview.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {fileError ?? errorText(preview.error)}
          </p>
        ) : null}

        {result ? (
          <div className="mt-4 space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-subtle">{t('pos.rows')}</dt>
                <dd className="font-mono tabular-nums text-ink">{formatNumber(result.rowCount, locale)}</dd>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <dt className="text-xs text-subtle">{t('pos.range')}</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {result.from && result.to ? `${day(result.from)} – ${day(result.to)}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('pos.total')}</dt>
                <dd className="font-mono tabular-nums text-ink">{ils(result.totalNetAgorot)}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-xs text-subtle">{t('pos.columns')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {FIELDS.map((f) => (
                  <li key={f}>
                    <Badge tone={result.columns[f] ? 'accent' : 'neutral'}>
                      {t(`pos.fields.${f}`)}: <span dir="auto">{result.columns[f] ?? '—'}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
            {result.rejectedDays.length > 0 ? (
              <p role="status" className="text-sm text-warn">
                {t('pos.rejectedDays', { days: result.rejectedDays.map(day).join(', ') })}
              </p>
            ) : null}
            {result.issueCount > 0 ? (
              <details className="text-sm text-warn">
                <summary className="cursor-pointer">{t('pos.issues', { count: formatNumber(result.issueCount, locale) })}</summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {result.issues.map((i) => (
                    <li key={i.line}>{t('pos.issueLine', { line: i.line, reason: t(`pos.reasons.${i.code}`) })}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Button variant="primary" size="sm" disabled={result.rowCount === 0} loading={doImport.isPending} onClick={save}>
              {t('pos.import', { count: formatNumber(result.rowCount, locale) })}
            </Button>
          </div>
        ) : null}
      </Card>

      <h3 className="mb-2 mt-5 text-sm font-bold text-ink">{t('pos.history')}</h3>
      {(imports.data ?? []).length === 0 ? (
        <p className="text-sm text-subtle">{t('pos.none')}</p>
      ) : (
        <ul className="divide-y divide-line/60 rounded-xl border border-line text-sm">
          {imports.data!.map((imp) => (
            <li
              key={imp.id}
              className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5', imp.liveRows === 0 && 'opacity-60')}
            >
              <span className="min-w-0 basis-full truncate text-ink sm:basis-auto sm:flex-1" dir="auto" title={imp.filename}>
                {imp.filename}
              </span>
              {imp.liveRows === 0 ? <Badge tone="neutral">{t('pos.replacedBadge')}</Badge> : null}
              <span className="font-mono text-xs tabular-nums text-muted">
                {day(imp.periodFrom)} – {day(imp.periodTo)}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted">{formatNumber(imp.rowCount, locale)}</span>
              <span className="font-mono text-xs tabular-nums text-ink">
                {formatIls(Number(imp.totalNet), { locale, maximumFractionDigits: 2 })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
