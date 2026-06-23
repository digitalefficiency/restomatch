'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Field, Input } from '@/lib/components';
import { formatIls } from '@/lib/money';

type Outputs = inferRouterOutputs<AppRouter>;
type Detail = NonNullable<Outputs['catalog']['productDetail']>;
type Supplier = Outputs['suppliers']['list'][number];

export function ProductEditor({
  detail,
  suppliers,
  canEdit,
}: {
  detail: Detail;
  suppliers: Supplier[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const p = detail.product;

  const [name, setName] = useState(p.canonicalName);
  const [category, setCategory] = useState(p.category ?? '');
  const [unit, setUnit] = useState(p.defaultUnit ?? '');
  const [barcode, setBarcode] = useState(p.barcodeEan ?? '');
  const [supplierId, setSupplierId] = useState(p.supplierId ?? '');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      setStatus({ ok: true, message: 'המוצר נשמר.' });
      router.refresh();
    },
    onError: (e) => setStatus({ ok: false, message: e.message || 'השמירה נכשלה.' }),
  });
  const del = trpc.products.delete.useMutation({
    onSuccess: () => router.push('/dashboard/catalog'),
    onError: (e) => setStatus({ ok: false, message: e.message || 'המחיקה נכשלה.' }),
  });

  function save() {
    setStatus(null);
    update.mutate({
      productId: p.id,
      patch: {
        canonicalName: name.trim(),
        category: category.trim() || null,
        defaultUnit: unit.trim() || null,
        barcodeEan: barcode.trim() || null,
        supplierId: supplierId || null,
      },
    });
  }

  return (
    <div className="space-y-6">
      {status && (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-sm font-medium ${status.ok ? 'text-primary' : 'text-danger'}`}
        >
          {status.ok ? <CheckCircle2 className="h-4 w-4" /> : null} {status.message}
        </p>
      )}

      <Card flow elevated padding="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="שם המוצר (קנוני)" htmlFor="pr-name">
            <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} required maxLength={200} />
          </Field>
          <Field label="קטגוריה" htmlFor="pr-cat">
            <Input id="pr-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit} maxLength={100} />
          </Field>
          <Field label="יחידת ברירת מחדל" htmlFor="pr-unit">
            <Input id="pr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!canEdit} maxLength={32} placeholder="ק״ג / יח׳" />
          </Field>
          <Field label="ברקוד" htmlFor="pr-barcode">
            <Input id="pr-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={!canEdit} maxLength={32} />
          </Field>
          <Field label="ספק בלעדי (exclusivity)" htmlFor="pr-supplier" hint="המוצר משויך לספק זה בלבד. ריק = ללא בלעדיות.">
            <select
              id="pr-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none disabled:opacity-50"
            >
              <option value="">— ללא ספק בלעדי —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {canEdit && (
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" size="sm" loading={update.isPending} onClick={save}>
              שמור מוצר
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={del.isPending}
              onClick={() => {
                if (confirm(`למחוק את "${p.canonicalName}"?`)) del.mutate({ productId: p.id });
              }}
            >
              <Trash2 className="h-4 w-4 text-danger" /> מחק מוצר
            </Button>
          </div>
        )}
      </Card>

      <Card elevated padding="none" className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">ספק</th>
              <th className="px-4 py-3 font-medium">מק״ט</th>
              <th className="px-4 py-3 font-medium">יחידה</th>
              <th className="px-4 py-3 font-medium">מחיר מחירון</th>
              <th className="px-4 py-3 font-medium">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 text-ink">{it.supplierName}</td>
                <td className="px-4 py-3 font-mono text-xs text-subtle">{it.supplierSku ?? '—'}</td>
                <td className="px-4 py-3 text-muted">{it.unit ?? '—'}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">
                  {it.listPrice != null ? formatIls(Number(it.listPrice), { maximumFractionDigits: 2 }) : '—'}
                </td>
                <td className="px-4 py-3">{it.active ? null : <Badge tone="neutral">לא פעיל</Badge>}</td>
              </tr>
            ))}
            {detail.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-subtle">
                  אין מחירוני ספק למוצר זה.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
