import { and, auditLog, eq, sql, type Database } from '@restomatch/db';
import { recordAudit, type AuditAction } from '../audit';
import { formatIlsAgorot, ilsToAgorot } from '../reports/money';
import { A13, VAT_ALLOCATION_REQUESTED, VAT_ALLOCATION_SET, israelDay } from './caseState';
import { vatAtRisk, type VatAtRiskRow } from './vatAtRisk';

/**
 * AU-08 (catalogue A13) — the allocation-number case: the request draft the
 * owner hands to the supplier (wa.me / mailto / copy — the server sends
 * nothing), the audit trail of requests and fixes, and the deadline items the
 * digests (AU-04 evening, AU-12 weekly) include.
 *
 * VAT ₪ is "מע״מ בסיכון": its own figure, never part of the leak, the hero,
 * claim letters or the pay-run credit.
 */

export { A13, VAT_ALLOCATION_REQUESTED, VAT_ALLOCATION_SET } from './caseState';

// ───────────────────────── audit (interim until G-05) ─────────────────────────

type AuditDb = Pick<Database, 'insert'>;

/**
 * The single write point for AU-08's audit rows. G-05 adds
 * `vat.allocation_requested` / `vat.allocation_set` to `AuditAction`; until it
 * lands on main the value is cast here (one-line swap: drop the cast).
 */
export async function recordAllocationEvent(
  db: AuditDb,
  e: {
    restaurantId: string;
    userId: string | null;
    action: typeof VAT_ALLOCATION_REQUESTED | typeof VAT_ALLOCATION_SET;
    invoiceId: string;
    before?: unknown;
    after: Record<string, unknown>;
  },
): Promise<void> {
  await recordAudit(db, {
    restaurantId: e.restaurantId,
    userId: e.userId,
    action: e.action as AuditAction,
    entityType: 'invoice',
    entityId: e.invoiceId,
    before: e.before,
    after: { ...e.after, automationId: A13 },
  });
}

/** Rows a previous call with the same `clientMutationId` wrote (replay detection). */
export async function priorAllocationEvents(
  db: Database,
  restaurantId: string,
  action: typeof VAT_ALLOCATION_REQUESTED | typeof VAT_ALLOCATION_SET,
  clientMutationId: string,
): Promise<Array<{ invoiceId: string | null; after: unknown; at: Date }>> {
  const rows = await db
    .select({ invoiceId: auditLog.entityId, after: auditLog.after, at: auditLog.at })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.restaurantId, restaurantId),
        eq(auditLog.action, action),
        eq(auditLog.entityType, 'invoice'),
        sql`${auditLog.after}->>'clientMutationId' = ${clientMutationId}`,
      ),
    );
  return rows;
}

// ───────────────────────── supplier hand-off ─────────────────────────

/**
 * An Israeli phone as printed ("054-123 4567", "+972 54 1234567", "0541234567")
 * → the digits wa.me wants ("972541234567"), or null when it is not a plausible
 * Israeli mobile/landline. Interim until W2-11's `E164Phone` (one-line swap).
 */
export function waDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  if (!/^\d+$/.test(d) || !d.startsWith('972')) return null;
  const national = d.slice(3);
  // Israeli national numbers: 8 digits (landline 2/3/4/8/9) or 9 digits (mobile 5x, 7x).
  if (!/^(?:[23489]\d{7}|[57]\d{8})$/.test(national)) return null;
  return d;
}

/** A plausible single e-mail address, or null. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v) ? v : null;
}

const heDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** ₪ in server text. Interim until G-13 `moneyText` (one-line swap). */
const ils = (n: number) => formatIlsAgorot(ilsToAgorot(n), { maximumFractionDigits: 2, locale: 'he' });

export interface DraftInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  totalExclVat: number;
  vatAtRisk: number;
  deductionDeadline: string;
  daysLeft: number;
}

/**
 * The request text, always Hebrew (it goes to an Israeli supplier whatever the
 * screen language). Partner tone (GLOSSARY §2): ask, the invoice is the
 * subject, keep the hard facts, thank them. Nothing is sent by the system.
 */
export function allocationRequestText(args: {
  supplierName: string;
  restaurantName: string;
  invoices: ReadonlyArray<Pick<DraftInvoice, 'invoiceNumber' | 'invoiceDate' | 'totalExclVat' | 'deductionDeadline'>>;
}): string {
  const one = args.invoices.length === 1;
  const lines = args.invoices.map(
    (i) =>
      `• חשבונית ${i.invoiceNumber ? `מס׳ ${i.invoiceNumber}` : 'ללא מספר'} מיום ${heDay(i.invoiceDate)} — ${ils(i.totalExclVat)} לפני מע״מ`,
  );
  const earliest = args.invoices.map((i) => i.deductionDeadline).sort()[0];
  return [
    `שלום ${args.supplierName},`,
    '',
    one
      ? 'החשבונית הבאה התקבלה אצלנו ללא מספר הקצאה תקין:'
      : 'החשבוניות הבאות התקבלו אצלנו ללא מספר הקצאה תקין:',
    ...lines,
    '',
    `לפי רפורמת חשבוניות ישראל נוכל לקזז את המע״מ ${one ? 'שלה' : 'שלהן'} רק עם מספר הקצאה מרשות המסים. נשמח ${one ? 'לחשבונית מתוקנת' : 'לחשבוניות מתוקנות'} עם מספר הקצאה${earliest ? `, אם אפשר לפני ${heDay(earliest)}` : ''}.`,
    '',
    'תודה רבה,',
    args.restaurantName,
  ].join('\n');
}

export interface AllocationRequestDraft {
  supplierId: string;
  supplierName: string;
  text: string;
  /** https://wa.me/972…?text=… — only from a valid `contact_whatsapp`. */
  waHref: string | null;
  /** mailto:…?subject=…&body=… — only from `contact_email`. */
  mailtoHref: string | null;
  /** True when neither channel exists: copy only, hint "הוסיפו טלפון או מייל לספק". */
  needsContact: boolean;
  /** Where the hint links. */
  supplierHref: string;
  invoices: DraftInvoice[];
}

/**
 * The draft for one supplier's OPEN rows (period 'open'). Null when the
 * supplier is not in this restaurant; `invoices: []` when nothing is at risk.
 */
export async function allocationRequestDraft(
  db: Database,
  restaurantId: string,
  supplierId: string,
  opts: { now?: Date } = {},
): Promise<AllocationRequestDraft | null> {
  const [sup] = (await db.execute(sql`
    select s.id::text as id, s.name, s.contact_email, s.contact_whatsapp, r.name as restaurant_name
    from suppliers s join restaurants r on r.id = s.restaurant_id
    where s.id = ${supplierId}::uuid and s.restaurant_id = ${restaurantId}
    limit 1
  `)) as unknown as Array<{
    id: string;
    name: string;
    contact_email: string | null;
    contact_whatsapp: string | null;
    restaurant_name: string;
  }>;
  if (!sup) return null;
  const res = await vatAtRisk(db, restaurantId, 'open', { now: opts.now });
  const invoices: DraftInvoice[] = res.rows
    .filter((r) => r.supplierId === supplierId)
    .map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      totalExclVat: r.totalExclVat,
      vatAtRisk: r.vatAtRisk,
      deductionDeadline: r.deductionDeadline,
      daysLeft: r.daysLeft,
    }));
  const text = invoices.length
    ? allocationRequestText({ supplierName: sup.name, restaurantName: sup.restaurant_name, invoices })
    : '';
  const wa = waDigits(sup.contact_whatsapp);
  const email = cleanEmail(sup.contact_email);
  const subject = invoices.length === 1 ? 'בקשה לחשבונית מתוקנת עם מספר הקצאה' : 'בקשה לחשבוניות מתוקנות עם מספר הקצאה';
  return {
    supplierId,
    supplierName: sup.name,
    text,
    waHref: wa && text ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null,
    mailtoHref:
      email && text
        ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
        : null,
    needsContact: !wa && !email,
    supplierHref: `/dashboard/suppliers/${supplierId}`,
    invoices,
  };
}

// ───────────────────────── deadline items for digests ─────────────────────────

/** Days-before-deadline buckets a digest mentions an invoice at (each once). */
export const DEADLINE_BUCKETS = [30, 14, 7, 3, 1] as const;
export type DeadlineBucket = (typeof DEADLINE_BUCKETS)[number];

/** The smallest bucket that `daysLeft` has reached (so a missed day still fires once), or null. */
export function deadlineBucket(daysLeft: number): DeadlineBucket | null {
  if (daysLeft < 0 || daysLeft > DEADLINE_BUCKETS[0]) return null;
  let b: DeadlineBucket = DEADLINE_BUCKETS[0];
  for (const x of DEADLINE_BUCKETS) if (daysLeft <= x) b = x;
  return b;
}

export interface AllocationDeadlineItem {
  /** `au:A13:<restaurantId>:<invoiceId>:<bucket>` — stable across runs. */
  dedupeKey: string;
  invoiceId: string;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  invoiceDate: string;
  deductionDeadline: string;
  daysLeft: number;
  bucket: DeadlineBucket;
  stage: VatAtRiskRow['stage'];
  /** Present only when the caller passed `withMoney: true` (a role that may see VAT ₪). */
  vatAtRisk?: number;
}

/**
 * The deadline reminders due now, for AU-04 / AU-12 to include in their
 * digests. AU-08 sends nothing itself. ₪ is left out unless `withMoney` (the
 * caller decides per recipient role; receiver and chef never get it).
 */
export async function allocationDeadlineItems(
  db: Database,
  restaurantId: string,
  now: Date,
  opts: { withMoney?: boolean } = {},
): Promise<AllocationDeadlineItem[]> {
  const res = await vatAtRisk(db, restaurantId, 'open', { now });
  const out: AllocationDeadlineItem[] = [];
  for (const r of res.rows) {
    const bucket = deadlineBucket(r.daysLeft);
    if (bucket == null) continue;
    const item: AllocationDeadlineItem = {
      dedupeKey: `au:${A13}:${restaurantId}:${r.invoiceId}:${bucket}`,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      invoiceDate: r.invoiceDate,
      deductionDeadline: r.deductionDeadline,
      daysLeft: r.daysLeft,
      bucket,
      stage: r.stage,
    };
    if (opts.withMoney) item.vatAtRisk = r.vatAtRisk;
    out.push(item);
  }
  return out;
}

/** Roles that may see VAT ₪ (receiver and chef never do). */
export const VAT_MONEY_ROLES = ['owner', 'manager', 'bookkeeper'] as const;

export { israelDay };
