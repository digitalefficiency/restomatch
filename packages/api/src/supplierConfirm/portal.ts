/**
 * W3-09 · Supplier portal 2.0: answer validation (pure).
 *
 * Extends the wave-1 answer (`submitSupplierAnswer`: qty / price per line) with
 * three things the supplier can say per line — "✓ as ordered", "shortage"
 * (a stepper, 0 ≤ qty < ordered) or "substitution" (another product at a
 * price) — plus a delivery-window confirm or proposal, a 10-minute edit window
 * after submit and a locale (he / ar / ru).
 *
 * Pure: it validates and folds; it never writes. Persisting substitutions and
 * the window needs a wider `SupplierResponseLine` jsonb type (schema.ts is
 * immutable) and is wired in slice b. `toResponseLines` folds a 2.0 answer down
 * to today's stored shape so the existing diff keeps working meanwhile.
 *
 * Wording toward the supplier is partner wording (GLOSSARY §2) and lives in the
 * `supplierConfirm` message namespace, not here.
 */
import type { SupplierResponseLine } from '@restomatch/db';

export const PORTAL_LOCALES = ['he', 'ar', 'ru'] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];

/** `?lang=` / Accept-Language → a portal locale; Hebrew when unknown. */
export function pickPortalLocale(...candidates: Array<string | null | undefined>): PortalLocale {
  for (const c of candidates) {
    if (!c) continue;
    for (const part of c.split(',')) {
      const tag = part.split(';')[0]!.trim().toLowerCase().split('-')[0]!;
      if ((PORTAL_LOCALES as readonly string[]).includes(tag)) return tag as PortalLocale;
    }
  }
  return 'he';
}

export const EDIT_WINDOW_MS = 10 * 60 * 1000;

/** The supplier may change a submitted answer for 10 minutes; then it is locked. */
export function canEditAnswer(submittedAt: Date, now: Date): boolean {
  const age = now.getTime() - submittedAt.getTime();
  return age >= 0 && age <= EDIT_WINDOW_MS;
}

export function editWindowEndsAt(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + EDIT_WINDOW_MS);
}

export type PortalLineAnswer =
  | { poLineId: string; kind: 'ok' }
  | { poLineId: string; kind: 'shortage'; qtyAvailable: number }
  | { poLineId: string; kind: 'substitution'; productName: string; unitPrice: number; qty?: number | null };

export type WindowAnswer =
  | { kind: 'confirm' }
  | { kind: 'propose'; start: Date; end: Date };

export interface PortalAnswerInput {
  lines: PortalLineAnswer[];
  window?: WindowAnswer | null;
  note?: string | null;
}

export interface OrderLineRef {
  id: string;
  qtyOrdered: number;
  unitPrice: number | null;
}

export type PortalError =
  | 'BAD_LINE'
  | 'DUPLICATE_LINE'
  | 'BAD_QTY'
  | 'BAD_PRICE'
  | 'BAD_PRODUCT'
  | 'BAD_WINDOW';

export interface ValidAnswer {
  lines: PortalLineAnswer[];
  window: WindowAnswer | null;
  note: string | null;
  /** 'confirmed' only when every line is ✓, the window is confirmed (or not asked) and there is no note. */
  status: 'confirmed' | 'changes';
}

const MAX_QTY = 1_000_000;
const MAX_PRICE = 10_000_000;
const MAX_PRODUCT = 120;
const MAX_NOTE = 1000;
/** A proposed window may not start before now − 1 h or last longer than 24 h. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAST_SLACK_MS = 60 * 60 * 1000;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function validatePortalAnswer(
  order: readonly OrderLineRef[],
  input: PortalAnswerInput,
  now: Date,
): { ok: true; answer: ValidAnswer } | { ok: false; error: PortalError; poLineId?: string } {
  const byId = new Map(order.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const lines: PortalLineAnswer[] = [];
  for (const l of input.lines) {
    const mine = byId.get(l.poLineId);
    if (!mine) return { ok: false, error: 'BAD_LINE', poLineId: l.poLineId };
    if (seen.has(l.poLineId)) return { ok: false, error: 'DUPLICATE_LINE', poLineId: l.poLineId };
    seen.add(l.poLineId);
    if (l.kind === 'ok') {
      lines.push({ poLineId: l.poLineId, kind: 'ok' });
    } else if (l.kind === 'shortage') {
      const q = l.qtyAvailable;
      if (!Number.isFinite(q) || q < 0 || r3(q) >= r3(mine.qtyOrdered)) {
        return { ok: false, error: 'BAD_QTY', poLineId: l.poLineId };
      }
      lines.push({ poLineId: l.poLineId, kind: 'shortage', qtyAvailable: r3(q) });
    } else if (l.kind === 'substitution') {
      const name = (l.productName ?? '').trim();
      if (!name || name.length > MAX_PRODUCT) return { ok: false, error: 'BAD_PRODUCT', poLineId: l.poLineId };
      if (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0 || l.unitPrice > MAX_PRICE) {
        return { ok: false, error: 'BAD_PRICE', poLineId: l.poLineId };
      }
      const qty = l.qty ?? null;
      if (qty !== null && (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY)) {
        return { ok: false, error: 'BAD_QTY', poLineId: l.poLineId };
      }
      lines.push({ poLineId: l.poLineId, kind: 'substitution', productName: name, unitPrice: r4(l.unitPrice), qty: qty === null ? null : r3(qty) });
    } else {
      return { ok: false, error: 'BAD_LINE', poLineId: (l as { poLineId: string }).poLineId };
    }
  }
  // Lines the supplier did not touch are "as ordered".
  for (const l of order) if (!seen.has(l.id)) lines.push({ poLineId: l.id, kind: 'ok' });

  let window: WindowAnswer | null = null;
  if (input.window) {
    if (input.window.kind === 'confirm') window = { kind: 'confirm' };
    else {
      const { start, end } = input.window;
      const s = start?.getTime?.();
      const e = end?.getTime?.();
      if (
        !Number.isFinite(s) ||
        !Number.isFinite(e) ||
        s! >= e! ||
        e! - s! > MAX_WINDOW_MS ||
        s! < now.getTime() - PAST_SLACK_MS
      ) {
        return { ok: false, error: 'BAD_WINDOW' };
      }
      window = { kind: 'propose', start, end };
    }
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
  const allOk = lines.every((l) => l.kind === 'ok');
  const status = allOk && (window === null || window.kind === 'confirm') && !note ? 'confirmed' : 'changes';
  return { ok: true, answer: { lines, window, note, status } };
}

/**
 * Fold a 2.0 answer to today's stored `SupplierResponseLine[]` (qty / price
 * only). A substitution is stored as "0 of the ordered item" here, and its
 * product + price are carried in the note until slice b widens the stored type
 * — so the restaurant never reads a substitution as "as ordered".
 */
export function toResponseLines(order: readonly OrderLineRef[], answer: ValidAnswer): SupplierResponseLine[] {
  const byId = new Map(order.map((l) => [l.id, l]));
  const out: SupplierResponseLine[] = [];
  for (const l of answer.lines) {
    if (l.kind === 'ok' || !byId.has(l.poLineId)) continue;
    if (l.kind === 'shortage') out.push({ poLineId: l.poLineId, qtyAvailable: l.qtyAvailable, proposedUnitPrice: null });
    else out.push({ poLineId: l.poLineId, qtyAvailable: 0, proposedUnitPrice: null });
  }
  return out;
}
