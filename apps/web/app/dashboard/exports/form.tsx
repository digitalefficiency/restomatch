'use client';

import { useState } from 'react';
import { CheckCircle2, FileDown, XCircle } from 'lucide-react';
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
    <Card elevated padding="lg" className="max-w-2xl">
      <div className="mb-6 grid grid-cols-2 gap-4">
        <Field label="מתאריך" htmlFor="export-from">
          <Input
            id="export-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="עד תאריך" htmlFor="export-to">
          <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <div className="flex gap-3">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => download('csv')}
          disabled={busy !== null}
          loading={busy === 'csv'}
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          הורד CSV
        </Button>
        <Button
          variant="accent"
          className="flex-1"
          onClick={() => download('uniform1000')}
          disabled={busy !== null}
          loading={busy === 'uniform1000'}
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          הורד קובץ אחיד (1000)
        </Button>
      </div>

      {status ? (
        <p
          role="status"
          className={`mt-4 flex items-center gap-1.5 text-sm ${
            status.ok ? 'text-accent' : 'text-danger'
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

      <p className="mt-6 text-xs text-slate-500">
        רק חשבוניות בסטטוס "matched", "approved" או "paid" נכללות בייצוא. חשבוניות עם חריגות פתוחות
        לא תופענה.
      </p>
    </Card>
  );
}
