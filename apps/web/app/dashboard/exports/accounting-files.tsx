'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpenCheck, FileDown, Settings2 } from 'lucide-react';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { Button, friendlyError, useSingleFlight, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { base64ToBytes } from '../integrations/logic';

type Format = inferRouterInputs<AppRouter>['integrations']['accountingExport']['format'];
const FORMATS: Format[] = ['hashavshevet', 'priority', 'rivhit'];

/**
 * Accounting-package files (wave-1 `integrations`) for the export page's date
 * range. Rendered only when the restaurant has the flag; the procedure checks
 * it again.
 */
export function AccountingFiles({ from, to, disabled }: { from: string; to: string; disabled: boolean }) {
  const t = useT(integrationsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const once = useSingleFlight();
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState<Format | null>(null);

  function download(format: Format) {
    once(async () => {
      setBusy(format);
      try {
        const data = await utils.integrations.accountingExport.fetch({ format, from, to });
        const blob = new Blob([base64ToBytes(data.base64)], { type: data.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(
          data.rowCount === 0
            ? t('accounting.empty')
            : t('accounting.downloaded', { count: formatNumber(data.rowCount, locale) }),
        );
        if (data.skippedCount > 0) toast.error(t('accounting.skipped', { count: formatNumber(data.skippedCount, locale) }));
      } catch (err) {
        toast.error(`${t('accounting.failed')} ${friendlyError(err, tc)}`);
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <section aria-labelledby="acc-files-title" className="mt-6 border-t border-line pt-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="acc-files-title" className="flex items-center gap-2 text-base font-bold text-ink">
            <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden="true" /> {t('accounting.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('accounting.body')}</p>
        </div>
        <Link
          href="/dashboard/integrations#accounting"
          className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" /> {t('accounting.mappingLink')}
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FORMATS.map((f) => (
          <li key={f} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <div>
              <p className="text-sm font-bold text-ink">{t(`accounting.formats.${f}.name`)}</p>
              <p className="text-xs text-subtle" dir="auto">
                {t(`accounting.formats.${f}.hint`)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-auto w-full"
              onClick={() => download(f)}
              disabled={disabled || busy !== null}
              loading={busy === f}
              aria-label={`${t('accounting.download')} — ${t(`accounting.formats.${f}.name`)}`}
            >
              <FileDown className="h-4 w-4" aria-hidden="true" /> {t('accounting.download')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
