/**
 * AU-14 · Pay-run pre-flight: check before the money leaves (catalogue A19).
 *
 * PURE rules: no DB, no clock, no I/O. The reader (`preflightData.ts`) gathers
 * the facts, then `preflightFlags()` decides. Every ₪ is in INTEGER AGOROT here:
 * `total_incl_vat` is a NUMERIC string and is parsed once at the boundary.
 *
 * Five rules, one invoice at a time:
 *  • possible_duplicate (soft): a same-supplier twin from any month and channel,
 *    with |Δ| ≤ ₪1.00 or ≤ 0.5% of the larger total, and dated within ±3 Israel days.
 *  • confirmed_copy (hold): AU-10 ruled the row a cross-channel copy. Don't pay it.
 *  • first_payment (soft): this supplier was never paid. Check the bank details.
 *  • bank_changed (HARD): the bank details changed since the last payment (or
 *    within 90 days if no paid date is known), and the owner has not confirmed
 *    them. AD12: always on, whatever the option switch says.
 *  • unusual_amount (soft): more than 2× the median of the supplier's last 12
 *    checked invoices, given at least 3 of them.
 *
 * The pre-flight never pays, never marks paid and never changes a claim. A flag
 * is never a DiscrepancyType, a claim or leak ₪.
 */

export type PreflightKind =
  | 'possible_duplicate'
  | 'confirmed_copy'
  | 'first_payment'
  | 'bank_changed'
  | 'unusual_amount';

export type PreflightSeverity = 'soft' | 'hard' | 'hold';

export const PREFLIGHT_KINDS: readonly PreflightKind[] = [
  'bank_changed',
  'confirmed_copy',
  'possible_duplicate',
  'unusual_amount',
  'first_payment',
];

export const SEVERITY_OF: Record<PreflightKind, PreflightSeverity> = {
  possible_duplicate: 'soft',
  confirmed_copy: 'hold',
  first_payment: 'soft',
  bank_changed: 'hard',
  unusual_amount: 'soft',
};

/** Hard and hold flags block markPaid regardless of the option (AD12). */
export const isBlocking = (k: PreflightKind) => SEVERITY_OF[k] !== 'soft';

export type PreflightVars = Record<string, string | number | null>;

export interface PreflightFlag {
  kind: PreflightKind;
  severity: PreflightSeverity;
  /** i18n key under `preflight.reason.*` (copy/he.ts, copy/en.ts). */
  reasonKey: `preflight.reason.${PreflightKind}`;
  /** Inputs to the reason text. Money is in agorot (`*Agorot`); dates are Israel date keys (YYYY-MM-DD). */
  vars: PreflightVars;
  /** The invoice total incl. VAT, in integer agorot. */
  atRiskAgorot: number;
}

export interface PreflightInvoice {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  /** ISO instant (COALESCE(invoice_date, created_at)). */
  invoiceDate: string;
  /** Total incl. VAT in integer agorot (negative = credit note). */
  totalAgorot: number;
  status: string;
  source: string;
  /** H-03 `invoices.paid_at`. Null when unknown (pre-H-03 rows) or unpaid. */
  paidAt: string | null;
  /** AU-10 verdict marker `raw.duplicateOf` (ocr_payload). */
  duplicateOf: { invoiceId: string | null; basis: string | null } | null;
  /** W2-03 already holds this row as a DUPLICATE_INVOICE copy (or a G-04 note_billed_twice pair). */
  heldAsDuplicate: boolean;
}

export interface BankChange {
  id: string;
  supplierId: string;
  /** ISO instant. */
  changedAt: string;
  /** Only the last 4 digits ever reach this layer (never the full number). */
  accountLast4: string | null;
}

export interface PreflightFacts {
  /** The invoices about to be paid (unpaid, checked). */
  candidates: PreflightInvoice[];
  /** Every invoice of the candidates' suppliers, any month and status (the candidates included). */
  history: PreflightInvoice[];
  bankChanges: BankChange[];
  /** Change ids the owner confirmed (`payrun.bank_change_confirmed` audit, or W2-11 verified_at). */
  confirmedChangeIds: ReadonlySet<string>;
  /** "Now", for the 90-day bank window when no paid date is known. */
  now: Date;
  /** Restaurant timezone for Israel-day arithmetic. */
  tz?: string;
}

export const DUP_ABS_AGOROT = 100; // ₪1.00
export const DUP_REL_PER_MILLE = 5; // 0.5%
export const DUP_DAYS = 3;
export const BANK_WINDOW_DAYS = 90;
export const UNUSUAL_FACTOR = 2;
export const UNUSUAL_LOOKBACK = 12;
export const UNUSUAL_MIN_SAMPLES = 3;

const CHECKED = new Set(['matched', 'disputed', 'approved', 'paid']);
const isPaid = (i: PreflightInvoice) => i.status === 'paid' || i.paidAt != null;

/** NUMERIC string (shekels) → integer agorot, half-up at the agora. Null/garbage → 0. */
export function parseAgorot(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  const sign = m[1] === '-' ? -1 : 1;
  const frac = (m[3] ?? '').padEnd(3, '0');
  let ag = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) ag += 1;
  return sign * ag;
}

/** The Israel calendar date (YYYY-MM-DD) of an instant. */
export function israelDateKey(iso: string, tz = 'Asia/Jerusalem'): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

/** Whole calendar days between two date keys (b − a). */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** |Δ| ≤ ₪1.00, or |Δ| ≤ 0.5% of the larger total (integer-exact). */
export function amountsClose(a: number, b: number): boolean {
  const delta = Math.abs(a - b);
  if (delta <= DUP_ABS_AGOROT) return true;
  return delta * 1000 <= DUP_REL_PER_MILLE * Math.max(Math.abs(a), Math.abs(b));
}

export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function flag(kind: PreflightKind, atRiskAgorot: number, vars: PreflightVars): PreflightFlag {
  return { kind, severity: SEVERITY_OF[kind], reasonKey: `preflight.reason.${kind}`, vars, atRiskAgorot };
}

/** All flags for every candidate, keyed by invoice id (an invoice with no flags is absent). */
export function preflightFlags(facts: PreflightFacts): Map<string, PreflightFlag[]> {
  const tz = facts.tz ?? 'Asia/Jerusalem';
  const bySupplier = new Map<string, PreflightInvoice[]>();
  for (const inv of facts.history) {
    if (!inv.supplierId) continue;
    const list = bySupplier.get(inv.supplierId) ?? [];
    list.push(inv);
    bySupplier.set(inv.supplierId, list);
  }
  const changesBySupplier = new Map<string, BankChange[]>();
  for (const c of facts.bankChanges) {
    const list = changesBySupplier.get(c.supplierId) ?? [];
    list.push(c);
    changesBySupplier.set(c.supplierId, list);
  }

  const out = new Map<string, PreflightFlag[]>();
  for (const inv of facts.candidates) {
    const flags: PreflightFlag[] = [];
    const peers = inv.supplierId ? (bySupplier.get(inv.supplierId) ?? []).filter((p) => p.id !== inv.id) : [];

    // 1 · bank_changed (HARD, AD12). The newest change after the last known payment that the owner has not confirmed.
    if (inv.supplierId) {
      const paidDates = peers.map((p) => p.paidAt).filter((d): d is string => d != null);
      const since =
        paidDates.length > 0
          ? Math.max(...paidDates.map((d) => Date.parse(d)))
          : facts.now.getTime() - BANK_WINDOW_DAYS * 86_400_000;
      const open = (changesBySupplier.get(inv.supplierId) ?? [])
        .filter((c) => Date.parse(c.changedAt) > since)
        .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt));
      // Only the newest change can be confirmed (confirmBankChange refuses an older one), so it decides.
      const latest = open[0];
      if (latest && !facts.confirmedChangeIds.has(latest.id)) {
        flags.push(
          flag('bank_changed', inv.totalAgorot, {
            supplierName: inv.supplierName,
            changeId: latest.id,
            changedOn: israelDateKey(latest.changedAt, tz),
            accountLast4: latest.accountLast4,
          }),
        );
      }
    }

    // 2 · confirmed_copy (hold): AU-10's cross-channel verdict.
    const confirmedCopy = inv.duplicateOf?.basis === 'cross_channel';
    if (confirmedCopy) {
      const original = facts.history.find((h) => h.id === inv.duplicateOf?.invoiceId) ?? null;
      flags.push(
        flag('confirmed_copy', inv.totalAgorot, {
          originalId: inv.duplicateOf?.invoiceId ?? null,
          originalNumber: original?.invoiceNumber ?? null,
        }),
      );
    }

    // 3 · possible_duplicate (soft). Not for a copy that is already held, a credit note or an already-linked pair.
    if (!confirmedCopy && !inv.heldAsDuplicate && inv.totalAgorot > 0) {
      const day = israelDateKey(inv.invoiceDate, tz);
      const linked = (p: PreflightInvoice) =>
        p.duplicateOf?.invoiceId === inv.id || inv.duplicateOf?.invoiceId === p.id;
      const twins = peers
        .filter((p) => p.totalAgorot > 0 && !p.heldAsDuplicate && !linked(p))
        .filter((p) => amountsClose(inv.totalAgorot, p.totalAgorot))
        .filter((p) => Math.abs(dayDiff(day, israelDateKey(p.invoiceDate, tz))) <= DUP_DAYS)
        .sort(
          (a, b) =>
            Math.abs(a.totalAgorot - inv.totalAgorot) - Math.abs(b.totalAgorot - inv.totalAgorot) ||
            Math.abs(Date.parse(a.invoiceDate) - Date.parse(inv.invoiceDate)) -
              Math.abs(Date.parse(b.invoiceDate) - Date.parse(inv.invoiceDate)) ||
            a.id.localeCompare(b.id),
        );
      const twin = twins[0];
      if (twin) {
        flags.push(
          flag('possible_duplicate', inv.totalAgorot, {
            otherId: twin.id,
            otherNumber: twin.invoiceNumber,
            otherDate: israelDateKey(twin.invoiceDate, tz),
            otherTotalAgorot: twin.totalAgorot,
            otherSource: twin.source,
          }),
        );
      }
    }

    // 4 · unusual_amount (soft): > 2× the median of the last 12 checked invoices (≥ 3 samples).
    if (inv.supplierId && inv.totalAgorot > 0) {
      const samples = peers
        .filter((p) => CHECKED.has(p.status) && p.totalAgorot > 0 && p.duplicateOf == null)
        .sort((a, b) => Date.parse(b.invoiceDate) - Date.parse(a.invoiceDate))
        .slice(0, UNUSUAL_LOOKBACK)
        .map((p) => p.totalAgorot);
      if (samples.length >= UNUSUAL_MIN_SAMPLES) {
        const med = median(samples);
        if (med > 0 && inv.totalAgorot > UNUSUAL_FACTOR * med) {
          flags.push(
            flag('unusual_amount', inv.totalAgorot, {
              ratio: Math.round((inv.totalAgorot / med) * 10) / 10,
              medianAgorot: Math.round(med),
            }),
          );
        }
      }
    }

    // 5 · first_payment (soft): no invoice of this supplier was ever paid.
    if (inv.supplierId && !peers.some(isPaid)) {
      flags.push(flag('first_payment', inv.totalAgorot, { supplierName: inv.supplierName }));
    }

    if (flags.length > 0) {
      flags.sort((a, b) => PREFLIGHT_KINDS.indexOf(a.kind) - PREFLIGHT_KINDS.indexOf(b.kind));
      out.set(inv.id, flags);
    }
  }
  return out;
}

export interface PreflightSummary {
  /** Number of flags of each kind. */
  counts: Record<PreflightKind, number>;
  flags: number;
  /** Invoices with at least one flag. */
  invoices: number;
  /** Σ totals of the flagged invoices (each invoice counted once), in agorot. */
  atRiskAgorot: number;
  /** Invoices with a hard or hold flag. */
  blocked: number;
}

export function summarize(byInvoice: Map<string, PreflightFlag[]>): PreflightSummary {
  const counts = Object.fromEntries(PREFLIGHT_KINDS.map((k) => [k, 0])) as Record<PreflightKind, number>;
  let flags = 0;
  let atRiskAgorot = 0;
  let blocked = 0;
  for (const list of byInvoice.values()) {
    for (const f of list) counts[f.kind] += 1;
    flags += list.length;
    atRiskAgorot += list[0]?.atRiskAgorot ?? 0;
    if (list.some((f) => isBlocking(f.kind))) blocked += 1;
  }
  return { counts, flags, invoices: byInvoice.size, atRiskAgorot, blocked };
}

export type AcknowledgedFlags = ReadonlyArray<{ invoiceId: string; kinds: readonly PreflightKind[] }>;

export type PreflightVerdict =
  | { ok: true; acknowledged: Map<string, PreflightKind[]> }
  | { ok: false; reason: 'preflight_hold'; invoiceId: string; kind: PreflightKind }
  | { ok: false; reason: 'preflight_unacknowledged'; invoiceId: string; missing: PreflightKind[] };

/**
 * The core of the `markPaid` guard (all-or-nothing, like W2-03's markPaid):
 *  • any hard/hold flag on any item → refused (`preflight_hold`), even with the option off (AD12);
 *  • with the option on, every soft flag must be acknowledged for its invoice → else `preflight_unacknowledged`.
 * Holds are checked across the whole batch before acknowledgments, so a hold always wins.
 */
export function checkPreflightClear(
  byInvoice: Map<string, PreflightFlag[]>,
  invoiceIds: readonly string[],
  acknowledged: AcknowledgedFlags = [],
  opts: { softChecks?: boolean } = {},
): PreflightVerdict {
  const softChecks = opts.softChecks ?? true;
  for (const id of invoiceIds) {
    const hold = (byInvoice.get(id) ?? []).find((f) => isBlocking(f.kind));
    if (hold) return { ok: false, reason: 'preflight_hold', invoiceId: id, kind: hold.kind };
  }
  const ackBy = new Map<string, Set<PreflightKind>>();
  for (const a of acknowledged) {
    const s = ackBy.get(a.invoiceId) ?? new Set<PreflightKind>();
    for (const k of a.kinds) s.add(k);
    ackBy.set(a.invoiceId, s);
  }
  const result = new Map<string, PreflightKind[]>();
  for (const id of invoiceIds) {
    const soft = (byInvoice.get(id) ?? []).filter((f) => !isBlocking(f.kind)).map((f) => f.kind);
    if (!softChecks || soft.length === 0) continue;
    const have = ackBy.get(id) ?? new Set<PreflightKind>();
    const missing = soft.filter((k) => !have.has(k));
    if (missing.length > 0) return { ok: false, reason: 'preflight_unacknowledged', invoiceId: id, missing };
    result.set(id, soft);
  }
  return { ok: true, acknowledged: result };
}
