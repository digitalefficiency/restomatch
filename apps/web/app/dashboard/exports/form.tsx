'use client';

import { useState } from 'react';
import { AlertTriangle, FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  EntitlementUpsell,
  Input,
  cn,
  entitlementCauseOf,
  friendlyError,
  useToast,
  type EntitlementCause,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { accounting } from '@/lib/i18n/messages/accounting';
import { components } from '@/lib/i18n/messages/components';
import { presetRange, rangeError, withBom, type RangePreset } from './range';

const PRESETS: RangePreset[] = ['thisMonth', 'lastMonth', 'last30', 'thisYear'];

export function ExportsForm() {
  const t = useT(accounting);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const initial = presetRange('thisMonth');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState<'csv' | 'uniform1000' | null>(null);
  const [gated, setGated] = useState<EntitlementCause | null>(null);
  // Checked invoices with no invoice date in the last downloaded range: they
  // can't be placed in a period, so the file doesn't carry them.
  const [undated, setUndated] = useState<{ from: string; to: string; count: number } | null>(null);

  const utils = trpc.useUtils();
  const invalid = rangeError(from, to);
  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === from && r.to === to;
  });

  async function download(kind: 'csv' | 'uniform1000') {
    if (invalid) return;
    setBusy(kind);
    try {
      const data =
        kind === 'csv'
          ? await utils.exports.invoicesCsv.fetch({ from, to })
          : await utils.exports.uniform1000.fetch({ from, to });
      const content = kind === 'csv' ? withBom(data.content) : data.content;
      const blob = new Blob([content], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setUndated({ from, to, count: data.undatedCount });
      toast.success(
        data.rowCount === 0 ? t('downloadedEmpty') : t('downloaded', { count: formatNumber(data.rowCount, locale) }),
      );
    } catch (err) {
      const ent = entitlementCauseOf(err);
      if (ent) setGated(ent);
      else toast.error(`${t('failed')} ${friendlyError(err, tc)}`);
    } finally {
      setBusy(null);
    }
  }

  if (gated) return <EntitlementUpsell cause={gated} className="max-w-2xl" />;

  return (
    <Card flow elevated padding="lg" className="max-w-2xl">
      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-medium text-muted">{t('range')}</legend>
        <div role="group" aria-label={t('presets.label')} className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={activePreset === p}
              onClick={() => {
                const r = presetRange(p);
                setFrom(r.from);
                setTo(r.to);
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                activePreset === p
                  ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                  : 'bg-surface-2 text-muted hover:text-ink',
              )}
            >
              {t(`presets.${p}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <div>
            <label htmlFor="export-from" className="mb-1.5 block text-xs text-subtle">
              {t('from')}
            </label>
            <Input
              id="export-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-invalid={!!invalid || undefined}
              className="font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="export-to" className="mb-1.5 block text-xs text-subtle">
              {t('to')}
            </label>
            <Input
              id="export-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={!!invalid || undefined}
              className="font-mono tabular-nums"
            />
          </div>
        </div>
        {invalid ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {invalid === 'invalid' ? t('rangeInvalid') : t('rangeMissing')}
          </p>
        ) : null}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/25">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">{t('csv.title')}</p>
              <p className="text-xs text-subtle">{t('csv.body')}</p>
            </div>
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => download('csv')}
            disabled={busy !== null || !!invalid}
            loading={busy === 'csv'}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {t('csv.button')}
          </Button>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/12 text-gold ring-1 ring-gold/25">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">{t('uniform.title')}</p>
              <p className="text-xs text-subtle">{t('uniform.body')}</p>
            </div>
          </div>
          <Button
            variant="gold"
            className="w-full"
            onClick={() => download('uniform1000')}
            disabled={busy !== null || !!invalid}
            loading={busy === 'uniform1000'}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {t('uniform.button')}
          </Button>
        </div>
      </div>

      {undated && undated.from === from && undated.to === to && undated.count > 0 ? (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm text-warn"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('undated', { count: formatNumber(undated.count, locale) })}
        </p>
      ) : null}

      <p className="mt-6 border-t border-line pt-4 text-xs text-subtle">{t('note')}</p>
    </Card>
  );
}
