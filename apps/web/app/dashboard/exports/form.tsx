'use client';

import { useState } from 'react';
import { CheckCircle2, FileDown, FileSpreadsheet, FileText, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input } from '@/lib/components';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function ExportsForm() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<'csv' | 'uniform1000' | null>(null);

  const utils = trpc.useUtils();

  async function download(kind: 'csv' | 'uniform1000') {
    setStatus(null);
    setBusy(kind);
    try {
      const data =
        kind === 'csv'
          ? await utils.exports.invoicesCsv.fetch({ from, to })
          : await utils.exports.uniform1000.fetch({ from, to });
      const blob = new Blob([data.content], {
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
      setStatus({ ok: true, message: `הורד בהצלחה — ${data.rowCount} שורות` });
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card flow elevated padding="lg" className="max-w-2xl">
      <Field label="טווח תאריכים" htmlFor="export-from" className="mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="export-from" className="mb-1.5 block text-xs text-subtle">
              מתאריך
            </label>
            <Input
              id="export-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="export-to" className="mb-1.5 block text-xs text-subtle">
              עד תאריך
            </label>
            <Input
              id="export-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/25">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">CSV</p>
              <p className="text-xs text-subtle">לצרכים כלליים וגיליונות</p>
            </div>
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => download('csv')}
            disabled={busy !== null}
            loading={busy === 'csv'}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            הורד CSV
          </Button>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/12 text-gold ring-1 ring-gold/25">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">קובץ אחיד (1000)</p>
              <p className="text-xs text-subtle">להעלאה לרשויות המס</p>
            </div>
          </div>
          <Button
            variant="gold"
            className="w-full"
            onClick={() => download('uniform1000')}
            disabled={busy !== null}
            loading={busy === 'uniform1000'}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            הורד קובץ אחיד
          </Button>
        </div>
      </div>

      {status ? (
        <p
          role="status"
          className={`mt-4 flex items-center gap-1.5 text-sm font-medium ${
            status.ok ? 'text-primary' : 'text-danger'
          }`}
        >
          {status.ok ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          )}
          {status.message}
        </p>
      ) : null}

      <p className="mt-6 border-t border-line pt-4 text-xs text-subtle">
        רק חשבוניות בסטטוס "matched", "approved" או "paid" נכללות בייצוא. חשבוניות עם חריגות פתוחות
        לא תופענה.
      </p>
    </Card>
  );
}
