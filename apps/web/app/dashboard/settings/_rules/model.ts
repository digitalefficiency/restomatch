import { normalizeDecimal } from '@/lib/components/form/parse';

/**
 * The restaurant thresholds form (DS3-06), as pure functions: field
 * definitions, the stored ⇄ displayed conversion, the save patch, the undo
 * patch and the history diff. The form keeps today's save model exactly:
 * one `settings.update` call; a typed value is stored, a cleared override is
 * sent as `null` (the server deletes the key, the engine default applies), an
 * untouched field is left out (the server merges key by key, so the stored
 * JSON and its audit row are what they were before DS3-06).
 */

export type KnobGroup = 'tolerances' | 'approvalThresholds' | 'ocr';
/** percent = stored as a fraction (0.05), shown as 5; currency = ₪; units = quantity units. */
export type FieldKind = 'percent' | 'currency' | 'units';

export type ToleranceKey =
  | 'pricePercent'
  | 'priceAbsolute'
  | 'qtyPercent'
  | 'qtyAbsolute'
  | 'blockPricePercent';
export type ApprovalKey =
  | 'largeInvoiceWithoutPo'
  | 'unorderedItemSignificant'
  | 'cumulativeLargeAmount'
  | 'cumulativeLargePct'
  | 'cumulativeMediumAmountMin'
  | 'cumulativeMediumPctMin';
export type FieldKey = ToleranceKey | ApprovalKey | 'ocrReviewThreshold';

export interface FieldDef {
  key: FieldKey;
  group: KnobGroup;
  kind: FieldKind;
  /** One stepper press, in displayed units (percent points, ₪, units). */
  step: number;
  /** The server's limit (zod in packages/api/src/routers/settings.ts), in STORED units. */
  max: number;
}

export const TOLERANCE_FIELDS: readonly FieldDef[] = [
  { key: 'pricePercent', group: 'tolerances', kind: 'percent', step: 1, max: 1 },
  { key: 'priceAbsolute', group: 'tolerances', kind: 'currency', step: 1, max: 1_000_000 },
  { key: 'qtyPercent', group: 'tolerances', kind: 'percent', step: 1, max: 1 },
  { key: 'qtyAbsolute', group: 'tolerances', kind: 'units', step: 1, max: 1_000_000 },
  { key: 'blockPricePercent', group: 'tolerances', kind: 'percent', step: 1, max: 1 },
];

export const APPROVAL_FIELDS: readonly FieldDef[] = [
  {
    key: 'largeInvoiceWithoutPo',
    group: 'approvalThresholds',
    kind: 'currency',
    step: 500,
    max: 100_000_000,
  },
  {
    key: 'unorderedItemSignificant',
    group: 'approvalThresholds',
    kind: 'currency',
    step: 10,
    max: 100_000_000,
  },
  {
    key: 'cumulativeLargeAmount',
    group: 'approvalThresholds',
    kind: 'currency',
    step: 50,
    max: 100_000_000,
  },
  { key: 'cumulativeLargePct', group: 'approvalThresholds', kind: 'percent', step: 1, max: 1 },
  {
    key: 'cumulativeMediumAmountMin',
    group: 'approvalThresholds',
    kind: 'currency',
    step: 10,
    max: 100_000_000,
  },
  { key: 'cumulativeMediumPctMin', group: 'approvalThresholds', kind: 'percent', step: 1, max: 1 },
];

export const OCR_FIELD: FieldDef = {
  key: 'ocrReviewThreshold',
  group: 'ocr',
  kind: 'percent',
  step: 1,
  max: 1,
};

export const ALL_FIELDS: readonly FieldDef[] = [...TOLERANCE_FIELDS, ...APPROVAL_FIELDS, OCR_FIELD];
export const fieldDef = (key: FieldKey): FieldDef => ALL_FIELDS.find((f) => f.key === key)!;

/** The stored overrides the form edits (restaurants.settings, the three knob groups). */
export interface StoredKnobs {
  tolerances?: Partial<Record<ToleranceKey, number>>;
  approvalThresholds?: Partial<Record<ApprovalKey, number>>;
  ocrReviewThreshold?: number | null;
}

/** The engine defaults per field, in stored units (read on the server from the engines' own constants). */
export type Defaults = Record<FieldKey, number>;

/** Per field: null = no override (the engine default applies); a string = the typed value. */
export type FormValues = Record<FieldKey, string | null>;

export function storedOf(knobs: StoredKnobs | null | undefined, f: FieldDef): number | null {
  const v =
    f.group === 'tolerances'
      ? knobs?.tolerances?.[f.key as ToleranceKey]
      : f.group === 'approvalThresholds'
        ? knobs?.approvalThresholds?.[f.key as ApprovalKey]
        : knobs?.ocrReviewThreshold;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Stored → shown (0.075 → "7.5"; ₪ and units as they are). */
export function toDisplay(stored: number, kind: FieldKind): string {
  if (kind === 'percent') return String(Math.round(stored * 1000) / 10);
  return String(Math.round(stored * 10000) / 10000);
}

/** Typed text → stored number ("7,5" and "7.5" both work); NaN when it is not a number. */
export function toStored(raw: string, kind: FieldKind): number {
  const canonical = normalizeDecimal(raw);
  const n = canonical === null ? NaN : Number(canonical);
  return kind === 'percent' ? n / 100 : n;
}

export function valuesFrom(knobs: StoredKnobs | null | undefined): FormValues {
  const out = {} as FormValues;
  for (const f of ALL_FIELDS) {
    const s = storedOf(knobs, f);
    out[f.key] = s === null ? null : toDisplay(s, f.kind);
  }
  return out;
}

export type FieldError = 'percentRange' | 'amountInvalid' | null;

/** Why a typed value cannot be saved (the server's limits, said only when they are broken). */
export function errorOf(raw: string | null, f: FieldDef): FieldError {
  if (raw === null) return null;
  const v = toStored(raw, f.kind);
  if (!Number.isFinite(v) || v < 0) return f.kind === 'percent' ? 'percentRange' : 'amountInvalid';
  if (v > f.max) return f.kind === 'percent' ? 'percentRange' : 'amountInvalid';
  return null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * The value a field stands for, in stored units: null = default. A typed value
 * equal to the engine default counts as the default when the saved state is
 * the default too (stepping 2 → 3 → 2 is no change, and no override is
 * written); otherwise a typed value is an override, even if it equals it.
 */
export function intentOf(
  values: FormValues,
  saved: FormValues,
  defaults: Defaults,
  f: FieldDef,
): number | null {
  const raw = values[f.key];
  if (raw === null) return null;
  const v = toStored(raw, f.kind);
  if (!Number.isFinite(v)) return NaN;
  if (saved[f.key] === null && near(v, defaults[f.key])) return null;
  return v;
}

function sameIntent(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return near(a, b);
}

export function isFieldDirty(
  values: FormValues,
  saved: FormValues,
  defaults: Defaults,
  f: FieldDef,
): boolean {
  const now = intentOf(values, saved, defaults, f);
  const before = saved[f.key] === null ? null : toStored(saved[f.key]!, f.kind);
  return !sameIntent(now, before);
}

export function isDirty(values: FormValues, saved: FormValues, defaults: Defaults): boolean {
  return ALL_FIELDS.some((f) => isFieldDirty(values, saved, defaults, f));
}

/** The settings.update input (the same shape and semantics as before DS3-06); null when nothing changed. */
export interface UpdatePatch {
  tolerances?: Partial<Record<ToleranceKey, number | null>>;
  approvalThresholds?: Partial<Record<ApprovalKey, number | null>>;
  ocrReviewThreshold?: number | null;
}

function put(patch: UpdatePatch, f: FieldDef, v: number | null) {
  if (f.group === 'tolerances') (patch.tolerances ??= {})[f.key as ToleranceKey] = v;
  else if (f.group === 'approvalThresholds')
    (patch.approvalThresholds ??= {})[f.key as ApprovalKey] = v;
  else patch.ocrReviewThreshold = v;
}

export function savePatch(
  values: FormValues,
  saved: FormValues,
  defaults: Defaults,
): UpdatePatch | null {
  const patch: UpdatePatch = {};
  let any = false;
  for (const f of ALL_FIELDS) {
    if (!isFieldDirty(values, saved, defaults, f)) continue;
    put(patch, f, intentOf(values, saved, defaults, f));
    any = true;
  }
  return any ? patch : null;
}

/** After a save: what the form now holds as saved (a typed default-equal value collapses to the default). */
export function savedAfter(values: FormValues, saved: FormValues, defaults: Defaults): FormValues {
  const out = { ...saved };
  for (const f of ALL_FIELDS) {
    if (!isFieldDirty(values, saved, defaults, f)) continue;
    const v = intentOf(values, saved, defaults, f);
    out[f.key] = v === null ? null : toDisplay(v, f.kind);
  }
  return out;
}

/** The undo: put back exactly what `before` held for every field the save changed (null = the default again). */
export function undoPatch(before: FormValues, after: FormValues): UpdatePatch | null {
  const patch: UpdatePatch = {};
  let any = false;
  for (const f of ALL_FIELDS) {
    const b = before[f.key] === null ? null : toStored(before[f.key]!, f.kind);
    const a = after[f.key] === null ? null : toStored(after[f.key]!, f.kind);
    if (sameIntent(a, b)) continue;
    put(patch, f, b);
    any = true;
  }
  return any ? patch : null;
}

/** One step of a stepper from what the field shows now, clamped to [0, max]; returns the new typed text. */
export function stepValue(
  values: FormValues,
  defaults: Defaults,
  f: FieldDef,
  direction: 1 | -1,
): string {
  const raw = values[f.key];
  const current = raw === null ? defaults[f.key] : toStored(raw, f.kind);
  const base = Number.isFinite(current) ? current : defaults[f.key];
  const unit = f.kind === 'percent' ? f.step / 100 : f.step;
  const next = Math.min(f.max, Math.max(0, Math.round((base + direction * unit) * 1e6) / 1e6));
  return toDisplay(next, f.kind);
}

export function canStep(
  values: FormValues,
  defaults: Defaults,
  f: FieldDef,
  direction: 1 | -1,
): boolean {
  const raw = values[f.key];
  const current = raw === null ? defaults[f.key] : toStored(raw, f.kind);
  if (!Number.isFinite(current)) return true;
  return direction === 1 ? current < f.max - 1e-9 : current > 1e-9;
}

/** A history entry's change of one field: before/after in stored units, null = the default. */
export interface FieldChange {
  key: FieldKey;
  from: number | null;
  to: number | null;
}

/** What a `settings.updated` audit row changed, field by field (before/after hold the stored overrides). */
export function changesOf(before: unknown, after: unknown): FieldChange[] {
  const b = (before ?? {}) as StoredKnobs;
  const a = (after ?? {}) as StoredKnobs;
  const out: FieldChange[] = [];
  for (const f of ALL_FIELDS) {
    const from = storedOf(b, f);
    const to = storedOf(a, f);
    if (sameIntent(from, to)) continue;
    out.push({ key: f.key, from, to });
  }
  return out;
}

/** The form values a history entry's `before` stands for (restore = these, unsaved). */
export function valuesOfAudit(snapshot: unknown): FormValues {
  return valuesFrom((snapshot ?? {}) as StoredKnobs);
}

/** Does the form's saved state equal a snapshot (so "restore previous values" applies to it)? */
export function sameAsSnapshot(saved: FormValues, snapshot: unknown): boolean {
  const snap = valuesOfAudit(snapshot);
  return ALL_FIELDS.every((f) => {
    const x = saved[f.key] === null ? null : toStored(saved[f.key]!, f.kind);
    const y = snap[f.key] === null ? null : toStored(snap[f.key]!, f.kind);
    return sameIntent(x, y);
  });
}
