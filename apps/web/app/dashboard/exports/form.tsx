'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

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
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<'csv' | 'uniform1000' | null>(null);

  const utils = trpc.useUtils();

  async function download(kind: 'csv' | 'uniform1000') {
    setStatus('');
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
      setStatus(`✓ הורד: ${data.rowCount} שורות`);
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-2xl">
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-slate-700 mb-1.5">מתאריך</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-700 mb-1.5">עד תאריך</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-slate-900"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => download('csv')}
          disabled={busy !== null}
          className="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 rounded-md py-2.5 font-medium"
        >
          {busy === 'csv' ? 'מכין…' : 'הורד CSV'}
        </button>
        <button
          onClick={() => download('uniform1000')}
          disabled={busy !== null}
          className="flex-1 bg-accent hover:bg-accent/80 text-bg disabled:opacity-50 rounded-md py-2.5 font-medium"
        >
          {busy === 'uniform1000' ? 'מכין…' : 'הורד קובץ 1000'}
        </button>
      </div>

      {status ? (
        <p
          className={`mt-4 text-sm ${status.startsWith('✓') ? 'text-accent' : 'text-danger'}`}
        >
          {status}
        </p>
      ) : null}

      <p className="mt-6 text-xs text-slate-500">
        רק חשבוניות בסטטוס "matched", "approved" או "paid" נכללות בייצוא. חשבוניות עם
        חריגות פתוחות לא תופענה.
      </p>
    </div>
  );
}
