'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useT } from '@/lib/i18n/client';
import { recovery } from '@/lib/i18n/messages/recovery';
import { Button } from '@/lib/components';

/** CSV / XLSX of EVERY claim plus its history (recovery.export) — never a silent 200-row cut. */
export function ExportButtons() {
  const t = useT(recovery);
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null);
  const [failed, setFailed] = useState(false);
  async function run(format: 'csv' | 'xlsx') {
    setBusy(format);
    setFailed(false);
    try {
      const out = await utils.recovery.export.fetch({ format });
      const bytes = Uint8Array.from(atob(out.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: out.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="recovery-export">
      {(['csv', 'xlsx'] as const).map((f) => (
        <Button key={f} size="sm" variant="ghost" className="min-h-11 md:min-h-9" loading={busy === f} onClick={() => void run(f)}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {t(`exportMenu.${f}`)}
        </Button>
      ))}
      {failed ? (
        <span role="alert" className="text-xs text-danger">
          {t('exportMenu.failed')}
        </span>
      ) : null}
    </div>
  );
}
