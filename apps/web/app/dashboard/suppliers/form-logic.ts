import type { DeliverySchedule } from '@restomatch/db';

/** Pure supplier-form helpers (shared by the manager + the details tab; unit-tested). */

export type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const DAY_KEYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface FormState {
  name: string;
  nameEn: string;
  businessId: string;
  contactEmail: string;
  contactWhatsapp: string;
  paymentTerms: string;
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
