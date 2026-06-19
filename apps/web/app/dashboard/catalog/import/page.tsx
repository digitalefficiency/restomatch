'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Field, SectionHeader, Spinner } from '@/lib/components';

type Outputs = inferRouterOutputs<AppRouter>;
type Preview = Outputs['catalog']['parsePreview'];
type CommitResult = Outputs['catalog']['commitImport'];
type Mapping = Preview['mapping'];
type FileInput = { filename: string; base64?: string; text?: string };

type Step = 'SUPPLIER' | 'UPLOAD' | 'MAP' | 'DONE';

const FIELD_LABELS: Array<{ key: keyof Mapping; label: string }> = [
  { key: 'name', label: 'תיאור / שם מוצר *' },
  { key: 'price', label: 'מחיר' },
  { key: 'sku', label: 'מק״ט' },
  { key: 'unit', label: 'יחידה' },
  { key: 'barcode', label: 'ברקוד' },
  { key: 'packSize', label: 'גודל אריזה' },
];

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
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv') {
    return { filename: file.name, text: await file.text() };
  }
  return { filename: file.name, base64: arrayBufferToBase64(await file.arrayBuffer()) };
}

export default function CatalogImportPage() {
  const [step, setStep] = useState<Step>('SUPPLIER');
  const [supplierId, setSupplierId] = useState('');
  const [file, setFile] = useState<FileInput | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<CommitResult | null>(null);

  const suppliers = trpc.suppliers.list.useQuery({});
  const parsePreview = trpc.catalog.parsePreview.useMutation();
  const commitImport = trpc.catalog.commitImport.useMutation();

  const supplierName = suppliers.data?.find((s) => s.id === supplierId)?.name ?? '';

  async function handlePreview() {
    if (!file || !supplierId) return;
    const res = await parsePreview.mutateAsync({ supplierId, file });
    setPreview(res);
    setMapping(res.mapping);
    setStep('MAP');
  }

  async function handleCommit() {
    if (!file || !supplierId) return;
    const res = await commitImport.mutateAsync({ supplierId, file, mapping });
    setResult(res);
    setStep('DONE');
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader
        level={1}
        title="ייבוא קטלוג"
        subtitle="טענו מחירון ספק מקובץ Excel או CSV — המערכת תזהה את העמודות ותמזג למוצרים קיימים."
      />
      <Steps step={step} />

      {step === 'SUPPLIER' && (
        <Card elevated flow className="mt-4">
          <Field label="בחרו ספק" htmlFor="imp-supplier">
            <select
              id="imp-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
            >
              <option value="">— בחרו ספק —</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <div className="mt-4">
            <Button variant="primary" size="sm" disabled={!supplierId} onClick={() => setStep('UPLOAD')}>
              המשך <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'UPLOAD' && (
        <Card elevated flow className="mt-4">
          <p className="mb-3 text-sm text-muted">ספק: <span className="font-semibold text-ink">{supplierName}</span></p>
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-10 text-center hover:border-primary/40">
            <FileSpreadsheet className="h-8 w-8 text-subtle" />
            <span className="text-sm text-muted">{file ? file.filename : 'בחרו קובץ .xlsx / .xls / .csv'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setFile(await readFile(f));
              }}
            />
          </label>
          {parsePreview.error && <p className="mt-3 text-sm text-danger">{parsePreview.error.message}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={!file} loading={parsePreview.isPending} onClick={handlePreview}>
              נתח קובץ <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep('SUPPLIER')}>חזרה</Button>
          </div>
        </Card>
      )}

      {step === 'MAP' && preview && (
        <Card elevated flow className="mt-4">
          <p className="mb-3 text-sm text-muted">
            זוהו <span className="font-semibold text-ink">{preview.rowCount}</span> שורות. התאימו את העמודות:
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_LABELS.map(({ key, label }) => (
              <Field key={key} label={label} htmlFor={`map-${key}`}>
                <select
                  id={`map-${key}`}
                  value={mapping[key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
                >
                  <option value="">— ללא —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-line text-subtle">
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.slice(0, 6).map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {preview.headers.map((h) => (
                      <td key={h} className="px-3 py-1.5 text-muted">{row[h] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {commitImport.error && <p className="mt-3 text-sm text-danger">{commitImport.error.message}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={!mapping.name} loading={commitImport.isPending} onClick={handleCommit}>
              ייבא קטלוג
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep('UPLOAD')}>חזרה</Button>
          </div>
          {!mapping.name && <p className="mt-2 text-xs text-warn">חובה להתאים עמודת "תיאור / שם מוצר".</p>}
        </Card>
      )}

      {step === 'DONE' && result && (
        <Card elevated flow className="mt-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          {result.queued ? (
            <p className="mt-3 text-ink">הקובץ ({result.rowCount} שורות) נשלח לעיבוד ברקע.</p>
          ) : (
            <>
              <p className="mt-3 text-ink">הייבוא הושלם — {result.rowCount} שורות.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
                <Badge tone="accent">{result.created} פריטים חדשים</Badge>
                <Badge tone="info">{result.updated} עודכנו</Badge>
                <Badge tone="gold">{result.createdProducts} מוצרים חדשים</Badge>
                {result.ambiguous.length > 0 && (
                  <Badge tone="warning">{result.ambiguous.length} דורשים אישור</Badge>
                )}
              </div>
            </>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/dashboard/catalog"><Button variant="primary" size="sm">לצפייה בקטלוג</Button></Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStep('SUPPLIER'); setFile(null); setPreview(null); setResult(null); setMapping({}); }}
            >
              ייבוא נוסף
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['SUPPLIER', 'UPLOAD', 'MAP', 'DONE'];
  const labels: Record<Step, string> = {
    SUPPLIER: 'ספק',
    UPLOAD: 'קובץ',
    MAP: 'מיפוי',
    DONE: 'סיום',
  };
  const idx = order.indexOf(step);
  return (
    <ol className="mt-4 flex items-center gap-2 text-xs">
      {order.map((s, i) => (
        <li
          key={s}
          className={
            i <= idx
              ? 'rounded-full bg-primary/12 px-3 py-1 font-semibold text-primary ring-1 ring-primary/25'
              : 'rounded-full bg-surface-2 px-3 py-1 text-subtle'
          }
        >
          {labels[s]}
        </li>
      ))}
    </ol>
  );
}
