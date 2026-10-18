/**
 * Receiver languages (S14, flag `receiverLanguages`): swap the display-only
 * English names the wizard carries (`rawDescriptionEn` / `productNameEn`) for
 * the ar/ru/th/ti rendering of the Hebrew original, when we have one. Names
 * without a local rendering keep their English (then Hebrew) — never blank.
 * Pure; the map comes from `receiverLangs.localNames` (DB-cached server-side).
 */
import type { InvoiceLineRow, PoLineRow, ReceiptLineRow } from './_adapters';

export type LocalNames = Readonly<Record<string, string>>;

function pick(names: LocalNames, ...hebrew: Array<string | null | undefined>): string | undefined {
  for (const h of hebrew) {
    const v = h?.trim();
    if (v && Object.hasOwn(names, v) && typeof names[v] === 'string') return names[v];
  }
  return undefined;
}

export function localizePoLines<T extends PoLineRow>(lines: T[], names: LocalNames): T[] {
  return lines.map((l) => {
    const local = pick(names, l.rawDescription);
    return local ? { ...l, rawDescriptionEn: local, productNameEn: local } : l;
  });
}

export function localizeReceiptLines<T extends ReceiptLineRow>(lines: T[], names: LocalNames): T[] {
  return lines.map((l) => {
    const local = pick(names, l.rawDescription, l.productName);
    return local ? { ...l, productNameEn: local } : l;
  });
}

export function localizeInvoiceLines<T extends InvoiceLineRow>(lines: T[], names: LocalNames): T[] {
  return lines.map((l) => {
    const local = pick(names, l.rawDescription);
    return local ? { ...l, rawDescriptionEn: local, productNameEn: local } : l;
  });
}
