'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, CalendarClock, CheckCircle2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SectionHeader,
  Spinner,
  entitlementCauseOf,
} from '@/lib/components';
import { formatIls } from '@/lib/money';

type Outputs = inferRouterOutputs<AppRouter>;
type Channel = 'email' | 'whatsapp' | 'none';

interface DraftLine {
  key: string;
  productId?: string;
  rawDescription: string;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
}

type Step = 'SUPPLIER' | 'BUILD' | 'REVIEW' | 'SENT';

const lineTotal = (l: DraftLine) => (l.unitPriceExpected ?? 0) * l.qty;

type DeliveryPreview = NonNullable<Outputs['orders']['previewDelivery']>;

/** Hebrew long date (weekday + day + month) in Asia/Jerusalem wall clock. */
function formatDeliveryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Shows the DERIVED delivery date for the manager to confirm. When the order is
 * placed after today's cutoff we say so explicitly instead of silently rolling.
 */
function DeliveryPanel({ d }: { d: DeliveryPreview }) {
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
      <p className="flex items-center gap-2 text-ink">
        <CalendarClock className="h-4 w-4 text-primary" />
        <span>
          אספקה צפויה:{' '}
          <span className="font-semibold">{formatDeliveryDate(d.expectedDeliveryAt)}</span>
        </span>
      </p>
      {d.missedCutoff && (
        <p className="mt-2 text-xs text-warn">
          הוקדם המועד האחרון להזמנה להיום — המשלוח הקרוב ביותר הוא{' '}
          {formatDeliveryDate(d.expectedDeliveryAt)}.
        </p>
      )}
      <p className="mt-1 text-xs text-subtle">התאריך נגזר מלוח ההזמנות של הספק. אשרו או ערכו ידנית בהמשך.</p>
    </div>
  );
}

export default function NewOrderPage() {
  const [step, setStep] = useState<Step>('SUPPLIER');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [channel, setChannel] = useState<Channel>('email');
  const [search, setSearch] = useState('');

  const suppliers = trpc.suppliers.list.useQuery({});
  const supplierName = suppliers.data?.find((s) => s.id === supplierId)?.name ?? '';

  const catalog = trpc.catalog.items.useQuery(
    { supplierId, search: search.trim() || undefined, limit: 20 },
    { enabled: step === 'BUILD' && !!supplierId },
  );

  // Cadence: derive the delivery date for the manager to CONFIRM (never silent).
  // null = supplier has no order schedule → no derived date is shown.
  const delivery = trpc.orders.previewDelivery.useQuery(
    { supplierId },
    { enabled: !!supplierId, retry: false },
  );

  const total = useMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0), [lines]);
  const pricedLines = useMemo(
    () =>
      lines
        .filter((l) => l.productId && typeof l.unitPriceExpected === 'number')
        .map((l) => ({ productId: l.productId!, unitPriceExpected: l.unitPriceExpected! })),
    [lines],
  );

  const guardrail = trpc.orders.guardrail.useQuery(
    { supplierId, lines: pricedLines },
    { enabled: step === 'REVIEW' && pricedLines.length > 0, retry: false },
  );
  const guardrailGated = guardrail.error ? !!entitlementCauseOf(guardrail.error) : false;
  const warningsByProduct = new Map(
    (guardrail.data?.warnings ?? []).map((w) => [w.productId, w]),
  );

  const createDraft = trpc.orders.createDraft.useMutation();
  const placeOrder = trpc.orders.placeOrder.useMutation();

  function addLine(line: Omit<DraftLine, 'key'>) {
    setLines((ls) => [...ls, { ...line, key: crypto.randomUUID() }]);
  }
  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function submit() {
    const draft = await createDraft.mutateAsync({
      supplierId,
      lines: lines.map((l) => ({
        productId: l.productId,
        rawDescription: l.rawDescription || undefined,
        qty: l.qty,
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected,
      })),
    });
    await placeOrder.mutateAsync({ poId: draft.poId, channel });
    setStep('SENT');
  }

  const placeErr = placeOrder.error;
  const whatsappGated = placeErr ? !!entitlementCauseOf(placeErr) : false;

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader level={1} title="הזמנה חדשה" subtitle="בנו הזמנה מתוך קטלוג הספק והגישו אותה." />

      {step === 'SUPPLIER' && (
        <Card elevated flow className="mt-4">
          <Field label="בחרו ספק" htmlFor="ord-supplier">
            <select
              id="ord-supplier"
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
          {supplierId && delivery.data && <DeliveryPanel d={delivery.data} />}
          <div className="mt-4">
            <Button variant="primary" size="sm" disabled={!supplierId} onClick={() => setStep('BUILD')}>
              המשך <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'BUILD' && (
        <div className="mt-4 space-y-4">
          <Card elevated>
            <p className="mb-3 text-sm text-muted">ספק: <span className="font-semibold text-ink">{supplierName}</span></p>
            <Field label="הוספה מהקטלוג" htmlFor="ord-search">
              <Input id="ord-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש מוצר…" />
            </Field>
            {search.trim() && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
                {catalog.isFetching ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted"><Spinner className="h-4 w-4" /> מחפש…</div>
                ) : (catalog.data ?? []).length === 0 ? (
                  <p className="p-3 text-sm text-subtle">לא נמצאו פריטים</p>
                ) : (
                  (catalog.data ?? []).map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() =>
                        addLine({
                          productId: it.productId ?? undefined,
                          rawDescription: it.supplierNameRaw,
                          qty: 1,
                          unit: it.unit ?? 'יח׳',
                          unitPriceExpected: it.listPrice != null ? Number(it.listPrice) : undefined,
                        })
                      }
                      className="flex w-full items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-right text-sm last:border-0 hover:bg-surface-2"
                    >
                      <span className="min-w-0 truncate text-ink">{it.supplierNameRaw}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {it.listPrice != null ? formatIls(Number(it.listPrice), { maximumFractionDigits: 2 }) : '—'}
                        <Plus className="mr-1 inline h-3.5 w-3.5 text-primary" />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </Card>

          <Card elevated>
            {lines.length === 0 ? (
              <EmptyState title="ההזמנה ריקה" description="הוסיפו פריטים מהקטלוג למעלה." />
            ) : (
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.key} className="flex flex-wrap items-end gap-3 border-b border-line/60 pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{l.rawDescription}</p>
                    </div>
                    <label className="text-xs text-subtle">
                      כמות
                      <Input
                        type="number"
                        min={0}
                        value={l.qty}
                        onChange={(e) => patchLine(l.key, { qty: Number(e.target.value) || 0 })}
                        className="mt-0.5 w-20 text-sm"
                      />
                    </label>
                    <span className="pb-2 text-xs text-muted">{l.unit}</span>
                    <label className="text-xs text-subtle">
                      מחיר
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.unitPriceExpected ?? ''}
                        onChange={(e) => patchLine(l.key, { unitPriceExpected: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className="mt-0.5 w-24 text-sm"
                      />
                    </label>
                    <span className="pb-2 font-mono text-sm tabular-nums text-ink">{formatIls(lineTotal(l))}</span>
                    <button type="button" onClick={() => removeLine(l.key)} className="pb-2 text-subtle hover:text-danger" aria-label="הסר">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-between pt-2 text-sm font-semibold text-ink">
                  <span>סה״כ משוער</span>
                  <span className="font-mono tabular-nums">{formatIls(total)}</span>
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={lines.length === 0} onClick={() => setStep('REVIEW')}>
                המשך לסקירה <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('SUPPLIER')}>חזרה</Button>
            </div>
          </Card>
        </div>
      )}

      {step === 'REVIEW' && (
        <Card elevated flow className="mt-4">
          <h3 className="mb-3 text-base font-bold text-ink">סקירת הזמנה — {supplierName}</h3>
          <div className="space-y-2">
            {lines.map((l) => {
              const w = l.productId ? warningsByProduct.get(l.productId) : undefined;
              return (
                <div key={l.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{l.rawDescription}</span>
                  <span className="text-xs text-muted">{l.qty} {l.unit}</span>
                  <span className="font-mono text-sm tabular-nums text-ink">{formatIls(lineTotal(l))}</span>
                  {w && (
                    <Badge tone={w.level === 'high' ? 'danger' : 'warning'} icon={<TriangleAlert className="h-3 w-3" />}>
                      {w.level === 'high'
                        ? 'מעל אחוזון 90'
                        : `${(w.pctOverMedian * 100).toFixed(0)}% מעל החציון`}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-sm font-semibold text-ink">
            <span>סה״כ משוער</span>
            <span className="font-mono tabular-nums">{formatIls(total)}</span>
          </div>

          {delivery.data && <DeliveryPanel d={delivery.data} />}

          {guardrail.isFetching && (
            <p className="mt-3 flex items-center gap-2 text-xs text-subtle"><Spinner className="h-3.5 w-3.5" /> בודק מול בסיס המחירים…</p>
          )}
          {guardrailGated && (
            <p className="mt-3 text-xs text-subtle">מגן הדליפה בזמן הזמנה זמין בחבילה מתקדמת.</p>
          )}

          <div className="mt-5 space-y-3 border-t border-line pt-4">
            <Field label="ערוץ שליחה" htmlFor="ord-channel">
              <select
                id="ord-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
              >
                <option value="email">אימייל</option>
                <option value="whatsapp">וואטסאפ</option>
                <option value="none">ללא שליחה (טיוטה בלבד שתסומן כנשלחה)</option>
              </select>
            </Field>
            {whatsappGated && (
              <p className="text-sm text-warn">שליחת וואטסאפ זמינה בחבילה הכוללת התראות וואטסאפ. בחרו אימייל או שדרגו.</p>
            )}
            {placeErr && !whatsappGated && <p className="text-sm text-danger">{placeErr.message}</p>}
            {createDraft.error && <p className="text-sm text-danger">{createDraft.error.message}</p>}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={createDraft.isPending || placeOrder.isPending}
                onClick={submit}
              >
                שלח הזמנה
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('BUILD')}>חזרה</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'SENT' && (
        <Card elevated flow className="mt-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          <p className="mt-3 text-ink">ההזמנה הוגשה בהצלחה.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/dashboard/orders"><Button variant="primary" size="sm">לרשימת ההזמנות</Button></Link>
          </div>
        </Card>
      )}
    </div>
  );
}
