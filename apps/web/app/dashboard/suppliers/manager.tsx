'use client';

import { useState } from 'react';
import type { DeliverySchedule } from '@restomatch/db';
import { Pencil, Plus, Power, Truck } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner } from '@/lib/components';

/**
 * Locally-declared row shape (the fields this manager uses). Avoids deriving
 * from the tRPC AppRouter output type, whose inference becomes too complex for
 * `inferRouterOutputs[...]` indexing as the router grows.
 */
interface Supplier {
  id: string;
  name: string;
  businessId: string | null;
  contactEmail: string | null;
  contactWhatsapp: string | null;
  paymentTerms: string | null;
  deliverySchedule: DeliverySchedule | null;
  active: boolean;
  sourcePlatform: string | null;
}

type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAYS: { key: Day; label: string }[] = [
  { key: 'sun', label: 'ראשון' },
  { key: 'mon', label: 'שני' },
  { key: 'tue', label: 'שלישי' },
  { key: 'wed', label: 'רביעי' },
  { key: 'thu', label: 'חמישי' },
  { key: 'fri', label: 'שישי' },
  { key: 'sat', label: 'שבת' },
];

interface FormState {
  name: string;
  businessId: string;
  contactEmail: string;
  contactWhatsapp: string;
  paymentTerms: string;
  /** day → expected delivery / cutoff time "HH:MM" (absent = no delivery that day) */
  schedule: Partial<Record<Day, string>>;
}

const emptyForm: FormState = {
  name: '',
  businessId: '',
  contactEmail: '',
  contactWhatsapp: '',
  paymentTerms: '',
  schedule: {},
};

/** Stored {day:["HH:MM"]} → form {day:"HH:MM"} (first time per day). */
function scheduleToForm(s: Supplier['deliverySchedule']): Partial<Record<Day, string>> {
  const out: Partial<Record<Day, string>> = {};
  if (!s) return out;
  for (const d of DAYS) {
    const arr = s[d.key];
    if (arr && arr.length > 0 && arr[0]) out[d.key] = arr[0];
  }
  return out;
}

function toPatch(form: FormState) {
  const deliverySchedule: Partial<Record<Day, string[]>> = {};
  let hasSchedule = false;
  for (const d of DAYS) {
    const t = form.schedule[d.key]?.trim();
    if (t) {
      deliverySchedule[d.key] = [t];
      hasSchedule = true;
    }
  }
  // Empty optional fields → undefined (omit), not null: SupplierCreate validates
  // these as optional strings and rejects null; SupplierPatch leaves them untouched.
  return {
    name: form.name.trim(),
    businessId: form.businessId.trim() || undefined,
    contactEmail: form.contactEmail.trim() || undefined,
    contactWhatsapp: form.contactWhatsapp.trim() || undefined,
    paymentTerms: form.paymentTerms.trim() || undefined,
    ...(hasSchedule ? { deliverySchedule } : {}),
  };
}

/** Supplier setup CRUD — list, create, inline-edit, soft-deactivate. */
export function SupplierManager() {
  const utils = trpc.useUtils();
  const list = trpc.suppliers.list.useQuery({ includeInactive: true });
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const invalidate = () => utils.suppliers.list.invalidate();
  const create = trpc.suppliers.create.useMutation({ onSuccess: () => { setCreating(false); void invalidate(); } });
  const update = trpc.suppliers.update.useMutation({ onSuccess: () => { setEditId(null); void invalidate(); } });
  const setActive = trpc.suppliers.setActive.useMutation({ onSuccess: () => void invalidate() });

  if (list.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> טוען ספקים…
      </div>
    );
  }

  const suppliers = (list.data ?? []) as Supplier[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{suppliers.length} ספקים</p>
        {!creating && (
          <Button variant="primary" size="sm" onClick={() => { setEditId(null); setCreating(true); }}>
            <Plus className="h-4 w-4" /> ספק חדש
          </Button>
        )}
      </div>

      {creating && (
        <SupplierForm
          title="ספק חדש"
          initial={emptyForm}
          submitting={create.isPending}
          error={create.error?.message ?? null}
          onCancel={() => setCreating(false)}
          onSubmit={(form) => create.mutate(toPatch(form))}
        />
      )}

      {suppliers.length === 0 && !creating ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="אין עדיין ספקים"
          description="הוסיפו את הספקים שאתם מזמינים מהם — אחר כך תוכלו לטעון את הקטלוג שלהם ולבצע הזמנות."
        />
      ) : (
        <div className="space-y-3">
          {suppliers.map((s) =>
            editId === s.id ? (
              <SupplierForm
                key={s.id}
                title={`עריכת ${s.name}`}
                initial={{
                  name: s.name,
                  businessId: s.businessId ?? '',
                  contactEmail: s.contactEmail ?? '',
                  contactWhatsapp: s.contactWhatsapp ?? '',
                  paymentTerms: s.paymentTerms ?? '',
                  schedule: scheduleToForm(s.deliverySchedule),
                }}
                submitting={update.isPending}
                error={update.error?.message ?? null}
                onCancel={() => setEditId(null)}
                onSubmit={(form) => update.mutate({ supplierId: s.id, patch: toPatch(form) })}
              />
            ) : (
              <SupplierRow
                key={s.id}
                supplier={s}
                onEdit={() => { setCreating(false); setEditId(s.id); }}
                onToggleActive={() => setActive.mutate({ supplierId: s.id, active: !s.active })}
                toggling={setActive.isPending}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SupplierRow({
  supplier,
  onEdit,
  onToggleActive,
  toggling,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onToggleActive: () => void;
  toggling: boolean;
}) {
  return (
    <Card as="article" elevated className={supplier.active ? '' : 'opacity-60'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold text-ink">{supplier.name}</h3>
            {!supplier.active && <Badge tone="neutral">לא פעיל</Badge>}
            {supplier.sourcePlatform && <Badge tone="info">{supplier.sourcePlatform}</Badge>}
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
            {supplier.businessId && <span>ח.פ. {supplier.businessId}</span>}
            {supplier.contactEmail && <span>{supplier.contactEmail}</span>}
            {supplier.contactWhatsapp && <span>וואטסאפ {supplier.contactWhatsapp}</span>}
            {supplier.paymentTerms && <span>תנאי תשלום: {supplier.paymentTerms}</span>}
            {supplier.deliverySchedule &&
            DAYS.some((d) => supplier.deliverySchedule?.[d.key]?.length) ? (
              <span>
                אספקה:{' '}
                {DAYS.filter((d) => supplier.deliverySchedule?.[d.key]?.length)
                  .map((d) => `${d.label} ${supplier.deliverySchedule![d.key]![0]}`)
                  .join(' · ')}
              </span>
            ) : null}
          </dl>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> עריכה
          </Button>
          <Button variant="ghost" size="sm" loading={toggling} onClick={onToggleActive}>
            <Power className="h-3.5 w-3.5" /> {supplier.active ? 'השבת' : 'הפעל'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SupplierForm({
  title,
  initial,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: FormState;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (form: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = (k: Exclude<keyof FormState, 'schedule'>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleDay = (day: Day) => () =>
    setForm((f) => {
      const next = { ...f.schedule };
      if (next[day] !== undefined) delete next[day];
      else next[day] = '08:00';
      return { ...f, schedule: next };
    });
  const setDayTime = (day: Day) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, schedule: { ...f.schedule, [day]: e.target.value } }));

  return (
    <Card as="form" elevated flow
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (form.name.trim()) onSubmit(form);
      }}
    >
      <h3 className="mb-4 text-base font-bold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="שם ספק" htmlFor="sup-name">
          <Input id="sup-name" value={form.name} onChange={set('name')} required placeholder="תנובה" />
        </Field>
        <Field label="ח.פ. / עוסק" htmlFor="sup-biz">
          <Input id="sup-biz" value={form.businessId} onChange={set('businessId')} placeholder="514...." />
        </Field>
        <Field label="אימייל" htmlFor="sup-email">
          <Input id="sup-email" type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="orders@supplier.co.il" />
        </Field>
        <Field label="וואטסאפ" htmlFor="sup-wa">
          <Input id="sup-wa" value={form.contactWhatsapp} onChange={set('contactWhatsapp')} placeholder="+9725..." />
        </Field>
        <Field label="תנאי תשלום" htmlFor="sup-terms" className="sm:col-span-2">
          <Input id="sup-terms" value={form.paymentTerms} onChange={set('paymentTerms')} placeholder="שוטף + 30" />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-2 text-sm font-medium text-ink">לוח אספקה — ימים ושעת יעד</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DAYS.map((d) => {
              const active = form.schedule[d.key] !== undefined;
              return (
                <label
                  key={d.key}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    active ? 'border-primary/40 bg-primary/5' : 'border-line'
                  }`}
                >
                  <input type="checkbox" checked={active} onChange={toggleDay(d.key)} />
                  <span className="w-12 text-ink">{d.label}</span>
                  {active ? (
                    <input
                      type="time"
                      value={form.schedule[d.key] ?? ''}
                      onChange={setDayTime(d.key)}
                      className="ms-auto rounded border border-line bg-surface-2 px-1.5 py-0.5 text-ink tabular-nums"
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-subtle">
            שעת היעד = עד מתי הסחורה אמורה להגיע. אם השעה תעבור ולא נקלטה תעודת קבלה — תופיע התראת
            איחור.
          </p>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!form.name.trim()}>
          שמירה
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </Card>
  );
}
