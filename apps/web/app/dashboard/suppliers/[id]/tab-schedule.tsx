'use client';

import { useState } from 'react';
import type { OrderSchedule, OrderWindow } from '@restomatch/types';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';

type SupplierWithFlags = inferRouterOutputs<AppRouter>['suppliers']['get'];
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { DAY_KEYS, scheduleRowProblem } from '../form-logic';

/** Weekday keys, index = JS Date#getDay (0 = Sunday … 6 = Saturday). */
const WEEKDAYS = DAY_KEYS;

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
 * order wizard can DERIVE the expected delivery date. Empty → "set order days".
 * Removing every window of a SAVED schedule keeps a save button so the deletion
 * can actually be persisted (it used to fall back to the empty state, leaving
 * the old schedule in the database).
 */
export function SupplierScheduleTab({ supplierId, initial }: { supplierId: string; initial?: SupplierWithFlags }) {
  const t = useT(suppliersNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const supplier = trpc.suppliers.get.useQuery({ supplierId }, { initialData: initial });
  const [rows, setRows] = useState<WindowForm[] | null>(null);

  const update = trpc.suppliers.update.useMutation({
    onSuccess: (row) => {
      toast.success(row.orderSchedule ? t('schedule.saved') : t('schedule.cleared'));
      setRows(null);
      void utils.suppliers.get.invalidate({ supplierId });
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  if (supplier.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> {t('schedule.loading')}
      </div>
    );
  }
  const s = supplier.data;
  if (!s) return null;

  // Hydrate the editable rows from the saved schedule once.
  const current = rows ?? scheduleToForm(s.orderSchedule);

  const setRowsAnd = (next: WindowForm[]) => setRows(next);
  const hasSaved = !!s.orderSchedule && s.orderSchedule.windows.length > 0;
  const patchRow = (key: string, patch: Partial<WindowForm>) =>
    setRowsAnd(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const toggleDay = (key: string, day: number) => {
    const row = current.find((r) => r.key === key);
    if (!row) return;
    const has = row.orderDays.includes(day);
    patchRow(key, { orderDays: has ? row.orderDays.filter((d) => d !== day) : [...row.orderDays, day] });
  };

  const valid = current.length > 0 && current.every((r) => scheduleRowProblem(r) === null);

  function save() {
    update.mutate({ supplierId, patch: { orderSchedule: formToSchedule(current) } });
  }

  if (current.length === 0) {
    return (
      <Card elevated>
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={t('schedule.emptyTitle')}
          description={hasSaved ? t('schedule.clearedPending') : t('schedule.emptyBody')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => setRowsAnd([newWindow()])}>
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('schedule.define')}
              </Button>
              {hasSaved ? (
                <Button variant="danger" size="sm" loading={update.isPending} onClick={save}>
                  {t('schedule.saveCleared')}
                </Button>
              ) : null}
            </div>
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
            <h3 className="text-base font-bold text-ink">
              {current.length > 1 ? t('schedule.windowN', { n: i + 1 }) : t('schedule.window')}
            </h3>
            <button
              type="button"
              onClick={() => setRowsAnd(current.filter((r) => r.key !== row.key))}
              className="rounded p-1 text-subtle hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-label={t('schedule.removeWindow')}
              title={t('schedule.removeWindow')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium text-ink">{t('schedule.orderDays')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEKDAYS.map((key, day) => {
                  const on = row.orderDays.includes(day);
                  return (
                    <label
                      key={day}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary/60 ${
                        on ? 'border-primary/40 bg-primary/5' : 'border-line'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleDay(row.key, day)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-ink">{t(`days.${key}`)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('schedule.cutoff')} htmlFor={`cutoff-${row.key}`}>
                <Input
                  id={`cutoff-${row.key}`}
                  type="time"
                  value={row.cutoff}
                  onChange={(e) => patchRow(row.key, { cutoff: e.target.value })}
                />
              </Field>
              <Field label={t('schedule.fulfillment')} htmlFor={`fulfill-${row.key}`}>
                <Select
                  id={`fulfill-${row.key}`}
                  value={row.fulfillKind}
                  onChange={(e) =>
                    patchRow(row.key, { fulfillKind: e.target.value as Fulfillment['kind'] })
                  }
                >
                  <option value="lead_days">{t('schedule.leadDaysOption')}</option>
                  <option value="next_named_day">{t('schedule.namedDayOption')}</option>
                </Select>
              </Field>

              {row.fulfillKind === 'lead_days' ? (
                <Field label={t('schedule.leadDays')} htmlFor={`lead-${row.key}`}>
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
                <Field label={t('schedule.deliversOn')} htmlFor={`day-${row.key}`}>
                  <Select
                    id={`day-${row.key}`}
                    value={row.deliversOnDay}
                    onChange={(e) => patchRow(row.key, { deliversOnDay: Number(e.target.value) })}
                  >
                    {WEEKDAYS.map((key, day) => (
                      <option key={day} value={day}>
                        {t(`days.${key}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {scheduleRowProblem(row) ? (
              <p className="text-xs text-warn">{t(`schedule.${scheduleRowProblem(row)!}`)}</p>
            ) : null}
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={update.isPending} disabled={!valid} onClick={save}>
          {t('schedule.save')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRowsAnd([...current, newWindow()])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> {t('schedule.addWindow')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRowsAnd([])}
        >
          {t('schedule.clearAll')}
        </Button>
      </div>
    </div>
  );
}
