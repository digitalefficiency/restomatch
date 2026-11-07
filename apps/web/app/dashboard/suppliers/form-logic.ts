import { CutoffTime } from '@restomatch/types';
import type { DeliverySchedule } from '@restomatch/db';

/** Pure supplier-form helpers (shared by the manager + the details tab; unit-tested). */

export type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const DAY_KEYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The VAT select: 18% standard, 0% fresh produce, the restaurant default, or a stored rate the form can't set. */
export type VatChoice = 'default' | '0' | '0.18' | 'other';

/** Stored suppliers.vat_rate (NUMERIC string, e.g. "0.0000") → the select value. */
export function vatChoiceOf(raw: string | number | null | undefined): VatChoice {
  if (raw === null || raw === undefined || raw === '') return 'default';
  const n = Number(raw);
  if (n === 0) return '0';
  if (Math.round(n * 10000) === 1800) return '0.18';
  return 'other';
}

/** The select value → the API's vatRate; undefined = leave the stored rate as it is. */
export function vatRateOfChoice(c: VatChoice): 0 | 0.18 | null | undefined {
  if (c === '0') return 0;
  if (c === '0.18') return 0.18;
  if (c === 'default') return null;
  return undefined;
}

/** Which duplicate the server refused, from the tRPC error code (see suppliers router). */
export function duplicateKindOf(code: string | undefined): 'businessId' | 'name' | null {
  if (code === 'CONFLICT') return 'businessId';
  if (code === 'PRECONDITION_FAILED') return 'name';
  return null;
}

export interface FormState {
  name: string;
  nameEn: string;
  businessId: string;
  contactEmail: string;
  contactWhatsapp: string;
  paymentTerms: string;
  vatRate: VatChoice;
  /** day → expected delivery / cutoff time "HH:MM" (absent = no delivery that day) */
  schedule: Partial<Record<Day, string>>;
}

export const emptyForm: FormState = {
  name: '',
  nameEn: '',
  businessId: '',
  contactEmail: '',
  contactWhatsapp: '',
  paymentTerms: '',
  vatRate: 'default',
  schedule: {},
};

/** Stored {day:["HH:MM"]} → form {day:"HH:MM"} (first time per day). */
export function scheduleToForm(s: DeliverySchedule | null | undefined): Partial<Record<Day, string>> {
  const out: Partial<Record<Day, string>> = {};
  if (!s) return out;
  for (const d of DAY_KEYS) {
    const arr = s[d];
    if (arr && arr.length > 0 && arr[0]) out[d] = arr[0];
  }
  return out;
}

function deliveryScheduleOf(form: FormState): Partial<Record<Day, string[]>> | null {
  const out: Partial<Record<Day, string[]>> = {};
  let any = false;
  for (const d of DAY_KEYS) {
    const t = form.schedule[d]?.trim();
    if (t) {
      out[d] = [t];
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * `suppliers.create` input: empty optional fields are omitted (the create
 * schema validates them as optional strings and rejects null).
 */
export function toCreateInput(form: FormState) {
  const deliverySchedule = deliveryScheduleOf(form);
  return {
    name: form.name.trim(),
    nameEn: form.nameEn.trim() || undefined,
    businessId: form.businessId.trim() || undefined,
    contactEmail: form.contactEmail.trim() || undefined,
    contactWhatsapp: form.contactWhatsapp.trim() || undefined,
    paymentTerms: form.paymentTerms.trim() || undefined,
    ...(vatRateOfChoice(form.vatRate) != null ? { vatRate: vatRateOfChoice(form.vatRate) } : {}),
    ...(deliverySchedule ? { deliverySchedule } : {}),
  };
}

/**
 * `suppliers.update` patch: a cleared field is sent as `null` so it is really
 * cleared (the patch schema treats `undefined` as "leave untouched" — sending
 * undefined meant an emptied email/phone/terms or an unticked delivery grid
 * silently came back after save).
 */
export function toUpdatePatch(form: FormState) {
  return {
    name: form.name.trim(),
    nameEn: form.nameEn.trim() || null,
    businessId: form.businessId.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    contactWhatsapp: form.contactWhatsapp.trim() || null,
    paymentTerms: form.paymentTerms.trim() || null,
    ...(vatRateOfChoice(form.vatRate) !== undefined ? { vatRate: vatRateOfChoice(form.vatRate) } : {}),
    deliverySchedule: deliveryScheduleOf(form),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side validation mirroring the router's zod rules; returns error keys. */
export function validateSupplierForm(form: FormState): Array<'nameRequired' | 'emailInvalid'> {
  const errors: Array<'nameRequired' | 'emailInvalid'> = [];
  if (!form.name.trim()) errors.push('nameRequired');
  const email = form.contactEmail.trim();
  if (email && !EMAIL.test(email)) errors.push('emailInvalid');
  return errors;
}

/** Case-insensitive filter over the fields a manager types to find a supplier. */
export function matchesSupplierFilter(
  s: { name: string; nameEn?: string | null; businessId: string | null; contactEmail: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.nameEn, s.businessId, s.contactEmail].some(
    (v) => !!v && v.toLowerCase().includes(q),
  );
}

/**
 * Common Israeli payment-terms shorthands, so English screens can show them in
 * English: "שוטף + 30" (end of month + 30 days) and "מזומן" (cash). Anything
 * else is free text and is shown as written.
 */
export type PaymentTerms = { kind: 'eom'; days: number } | { kind: 'cash' };

export function parsePaymentTerms(raw: string | null | undefined): PaymentTerms | null {
  const s = raw?.trim();
  if (!s) return null;
  if (/^מזומן$/.test(s)) return { kind: 'cash' };
  const m = /^שוטף(?:\s*\+\s*(\d{1,3}))?$/.exec(s);
  if (m) return { kind: 'eom', days: m[1] ? Number(m[1]) : 0 };
  return null;
}

/**
 * What blocks saving one order-schedule window, or null. The time input can be
 * cleared to '', which the server rejects with a generic "invalid fields".
 */
export function scheduleRowProblem(row: { orderDays: number[]; cutoff: string }): 'pickDay' | 'pickCutoff' | null {
  if (row.orderDays.length === 0) return 'pickDay';
  if (!CutoffTime.safeParse(row.cutoff).success) return 'pickCutoff';
  return null;
}
