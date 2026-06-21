'use client';

import { useState } from 'react';
import type { OrderSchedule, OrderWindow } from '@restomatch/types';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@/lib/components';

/** Weekday labels, index = JS Date#getDay (0 = Sunday … 6 = Saturday). */
const WEEKDAYS: string[] = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type Fulfillment = OrderWindow['fulfillment'];

interface WindowForm {
  key: string;
  orderDays: number[];
  cutoff: string;
  fulfillKind: Fulfillment['kind'];
  leadDays: number;
  deliversOnDay: number;
}

function newWindow(): WindowForm {
  return { key: crypto.randomUUID(), orderDays: [], cutoff: '12:00', fulfillKind: 'lead_days', leadDays: 1, deliversOnDay: 0 };
}

/** Stored OrderSchedule → editable rows. */
function scheduleToForm(s: OrderSchedule | null | undefined): WindowForm[] {
  if (!s || s.windows.length === 0) return [];
  return s.windows.map((w) => ({
    key: crypto.randomUUID(),
    orderDays: [...w.orderDays].sort((a, b) => a - b),
    cutoff: w.cutoff,
    fulfillKind: w.fulfillment.kind,
    leadDays: w.fulfillment.kind === 'lead_days' ? w.fulfillment.leadDays : 1,
    deliversOnDay: w.fulfillment.kind === 'next_named_day' ? w.fulfillment.deliversOnDay : 0,
  }));
}

/** Editable rows → OrderSchedule (or null when no rows). */
function formToSchedule(rows: WindowForm[]): OrderSchedule | null {
  if (rows.length === 0) return null;
  const windows: OrderWindow[] = rows.map((r) => ({
    orderDays: [...r.orderDays].sort((a, b) => a - b),
    cutoff: r.cutoff,
    fulfillment:
      r.fulfillKind === 'lead_days'
        ? { kind: 'lead_days', leadDays: r.leadDays }
        : { kind: 'next_named_day', deliversOnDay: r.deliversOnDay },
  }));
  return { windows };
}

/**
 * Schedule tab — a SIMPLE form (no grid/SVG): one row per order window with
 * order-day checkboxes, a cutoff time, and how the order maps to a delivery
 * (lead days or a named delivery weekday). Saves via suppliers.update so the
 * order wizard can DERIVE the expected delivery date. Empty → "הגדר ימי הזמנה".
 */
export function SupplierScheduleTab({ supplierId }: { supplierId: string }) {
  const utils = trpc.useUtils();
  const supplier = trpc.suppliers.get.useQuery({ supplierId });
  const [rows, setRows] = useState<WindowForm[] | null>(null);
  const [saved, setSaved] = useState(false);

  const update = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.suppliers.get.invalidate({ supplierId });
    },
  });

  if (supplier.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> טוען לוח הזמנות…
      </div>
    );
  }
  const s = supplier.data;
  if (!s) return null;

  // Hydrate the editable rows from the saved schedule once.
  const current = rows ?? scheduleToForm(s.orderSchedule);

  const setRowsAnd = (next: WindowForm[]) => {
    setSaved(false);
    setRows(next);
  };
  const patchRow = (key: string, patch: Partial<WindowForm>) =>
    setRowsAnd(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const toggleDay = (key: string, day: number) => {
    const row = current.find((r) => r.key === key);
    if (!row) return;
    const has = row.orderDays.includes(day);
    patchRow(key, { orderDays: has ? row.orderDays.filter((d) => d !== day) : [...row.orderDays, day] });
  };

  const valid = current.length > 0 && current.every((r) => r.orderDays.length > 0);

  function save() {
    setSaved(false);
    update.mutate({ supplierId, patch: { orderSchedule: formToSchedule(current) } });
  }

  if (current.length === 0) {
    return (
      <Card elevated>
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title="לא הוגדר לוח הזמנות לספק"
          description="הגדירו אילו ימים אפשר להזמין, עד איזו שעה, וכמה ימים לוקח המשלוח — וההזמנות יקבלו תאריך אספקה אוטומטי."
          action={
            <Button variant="primary" size="sm" onClick={() => setRowsAnd([newWindow()])}>
              <Plus className="h-4 w-4" /> הגדר ימי הזמנה
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {current.map((row, i) => (
        <Card key={row.key} elevated flow>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">חלון הזמנה {current.length > 1 ? i + 1 : ''}</h3>
            <button
              type="button"
              onClick={() => setRowsAnd(current.filter((r) => r.key !== row.key))}
              className="text-subtle hover:text-danger"
              aria-label="הסר חלון"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium text-ink">ימי הזמנה</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEKDAYS.map((label, day) => {
                  const on = row.orderDays.includes(day);
                  return (
                    <label
                      key={day}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        on ? 'border-primary/40 bg-primary/5' : 'border-line'
                      }`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleDay(row.key, day)} />
                      <span className="text-ink">{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="שעת יעד אחרונה להזמנה" htmlFor={`cutoff-${row.key}`}>
                <Input
                  id={`cutoff-${row.key}`}
                  type="time"
                  value={row.cutoff}
                  onChange={(e) => patchRow(row.key, { cutoff: e.target.value })}
                />
              </Field>
              <Field label="אופן האספקה" htmlFor={`fulfill-${row.key}`}>
                <select
                  id={`fulfill-${row.key}`}
                  value={row.fulfillKind}
                  onChange={(e) =>
                    patchRow(row.key, { fulfillKind: e.target.value as Fulfillment['kind'] })
                  }
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
                >
                  <option value="lead_days">משלוח כעבור מספר ימים</option>
                  <option value="next_named_day">משלוח ביום קבוע בשבוע</option>
                </select>
              </Field>

              {row.fulfillKind === 'lead_days' ? (
                <Field label="ימים עד אספקה (0 = באותו יום)" htmlFor={`lead-${row.key}`}>
                  <Input
                    id={`lead-${row.key}`}
                    type="number"
                    min={0}
                    max={30}
                    value={row.leadDays}
                    onChange={(e) =>
                      patchRow(row.key, { leadDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })
                    }
                  />
                </Field>
              ) : (
                <Field label="יום האספקה הקבוע" htmlFor={`day-${row.key}`}>
                  <select
                    id={`day-${row.key}`}
                    value={row.deliversOnDay}
                    onChange={(e) => patchRow(row.key, { deliversOnDay: Number(e.target.value) })}
                    className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink focus:border-primary/50 focus:outline-none"
                  >
                    {WEEKDAYS.map((label, day) => (
                      <option key={day} value={day}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {row.orderDays.length === 0 && (
              <p className="text-xs text-warn">בחרו לפחות יום הזמנה אחד.</p>
            )}
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={update.isPending} disabled={!valid} onClick={save}>
          שמירת לוח הזמנות
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRowsAnd([...current, newWindow()])}>
          <Plus className="h-4 w-4" /> הוסף חלון הזמנה
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRowsAnd([])}
        >
          נקה הכל
        </Button>
      </div>
      {update.error && <p className="text-sm text-danger">{update.error.message}</p>}
      {saved && !update.isPending && <p className="text-sm text-primary">לוח ההזמנות נשמר.</p>}
    </div>
  );
}
