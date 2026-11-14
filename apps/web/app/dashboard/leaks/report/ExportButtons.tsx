'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { leaks } from '@/lib/i18n/messages/leaks';
import { trpc } from '@/lib/trpc/client';

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** W2-09c · leaks-30: the monthly report as a 3-sheet XLSX, or one CSV per sheet. Built on the server. */
export function ReportExportButtons({ month }: { month: string }) {
  const locale = useLocale();
  const t = useT(leaks);
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(kind: 'xlsx' | 'type' | 'supplier' | 'creep') {
    setBusy(true);
    setFailed(false);
    try {
      const out = await utils.owner.leakReportExport.fetch({ month, locale: locale === 'en' ? 'en' : 'he' });
      if (kind === 'xlsx') {
        const bin = Uint8Array.from(atob(out.xlsxBase64), (c) => c.charCodeAt(0));
        download(`${out.filename}.xlsx`, new Blob([bin], { type: XLSX }));
      } else {
        // BOM so Excel opens Hebrew CSV as UTF-8.
        download(`${out.filename}-${kind}.csv`, new Blob(['﻿', out.csv[kind]], { type: 'text/csv;charset=utf-8' }));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-line hover:bg-surface-2 disabled:opacity-60';
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="report-export">
      <button type="button" className={btn} disabled={busy} onClick={() => void run('xlsx')}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {t('report.exportXlsx')}
      </button>
      <details className="relative">
        <summary className={`${btn} cursor-pointer list-none`}>{t('report.exportCsv')}</summary>
        <div className="absolute end-0 z-10 mt-1 flex min-w-48 flex-col rounded-xl bg-surface p-1 shadow-lg ring-1 ring-line">
          {(['type', 'supplier', 'creep'] as const).map((k) => (
            <button key={k} type="button" disabled={busy} onClick={() => void run(k)}
              className="min-h-11 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-surface-2">
              {t(`report.csv.${k}`)}
            </button>
          ))}
        </div>
      </details>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('report.exportFailed')}
        </p>
      ) : null}
    </div>
  );
}
