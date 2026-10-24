import { formatDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';

/** Storage areas in walk-through order (cold first, bar last). Mirrors the server's STORAGE_AREAS. */
export const AREAS = ['fridge', 'freezer', 'produce', 'dry', 'bar', 'other'] as const;
export type Area = (typeof AREAS)[number];

/** A local calendar date (YYYY-MM-DD) → "24 Oct 2026" / "24 באוק׳ 2026". Noon UTC is that date in Israel. */
export function dayText(ymd: string, locale: Locale): string {
  return formatDate(`${ymd}T12:00:00Z`, locale, { dateStyle: 'medium' });
}

/**
 * What a person types on a phone keypad → the server's qty format.
 * - A comma + exactly 3 digits is a thousands separator ("1,200" → 1200), after
 *   a first group of 1–3 digits that is not 0.
 * - A comma + 1–2 digits is the decimal ("2,5" → 2.5), and so is any comma
 *   after a lone 0 ("0,250" → 0.250).
 * Returns '' for blank (not counted), `undefined` while a trailing separator is
 * still being typed ("2," — no error, nothing to save) and null when invalid.
 */
export function normalizeQty(raw: string): string | null | undefined {
  const v = raw.trim();
  if (v === '') return '';
  if (/^\d+(,\d{3})*[.,]$/.test(v)) return undefined;
  let n: string;
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(v)) n = v.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(v) || /^0,\d{1,4}$/.test(v)) n = v.replace(',', '.');
  else n = v;
  return /^\d{1,8}(\.\d{1,4})?$/.test(n) ? n : null;
}

/** An unsaved line edit (qty null = cleared back to "not counted"). */
export type LineEdit = { qty?: string | null; storageArea?: Area };

/** A failed batch goes back into the queue UNDER newer edits, field by field (a newer area change keeps the failed qty). */
export function mergeRetry(failed: Record<string, LineEdit>, newer: Record<string, LineEdit>): Record<string, LineEdit> {
  const out: Record<string, LineEdit> = { ...newer };
  for (const [id, e] of Object.entries(failed)) out[id] = { ...e, ...newer[id] };
  return out;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Unsaved edits kept in the browser per count, so a reload, a dead battery or
 * a closed tab mid-save loses nothing: replayed on the next mount. Storage can
 * be missing or throw (private mode, quota) — then it is simply skipped.
 */
export function pendingStore(countId: string, storage: KV | null) {
  const key = `rm.inventory.pending.${countId}`;
  return {
    read(): Record<string, LineEdit> {
      try {
        const v = storage?.getItem(key);
        const parsed: unknown = v ? JSON.parse(v) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, LineEdit>) : {};
      } catch {
        return {};
      }
    },
    write(edits: Record<string, LineEdit>) {
      try {
        if (Object.keys(edits).length === 0) storage?.removeItem(key);
        else storage?.setItem(key, JSON.stringify(edits));
      } catch {
        // storage full / denied: the server copy and the in-memory queue still hold the edits
      }
    },
  };
}

/** NUMERIC string → input text ("2.5000" → "2.5"). */
export function qtyText(v: string | null | undefined): string {
  if (v == null) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}
