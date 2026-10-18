/**
 * Leak-check orchestration: validate → budget → OCR → analyse → persist in the
 * sandbox. Called by the public route handler on the OWNER connection (the
 * sandbox tables are RLS-closed to the tenant role by design — migration 0054).
 *
 * Nothing here takes a tenant id from the client: the sandbox is not a tenant.
 * File bytes live only in memory for the duration of the request.
 */
import { and, eq, gt, isNull, leakCheckSessions, lt, sql, type Database } from '@restomatch/db';
import type { InvoiceOcrResult, NormalizedPurchaseOrder } from '@restomatch/types';
import type { OcrProvider, PoDocumentParser } from '@restomatch/ocr';
import {
  analyzeLeakCheck,
  type LeakCheckInvoice,
  type LeakCheckReport,
  type PriceListEntry,
} from './analyze';
import { SAMPLE_PRICE_LIST, sampleInvoiceFor } from './sampleOcr';
import {
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  MAX_INVOICES,
  hashIp,
  sha256Hex,
  signResultLink,
  sniffMime,
  type LeakCheckOcrMode,
} from './security';

export type LeakCheckErrorCode =
  | 'no_files'
  | 'too_many_files'
  | 'file_too_large'
  | 'body_too_large'
  | 'bad_file_type'
  | 'budget_exhausted'
  | 'ocr_failed';

export class LeakCheckError extends Error {
  constructor(readonly code: LeakCheckErrorCode) {
    super(code);
    this.name = 'LeakCheckError';
  }
}

export interface LeakCheckUpload {
  name: string;
  bytes: Buffer;
}

export interface LeakCheckRequest {
  invoices: LeakCheckUpload[];
  priceList?: LeakCheckUpload | null;
  email: string;
  name?: string | null;
  locale: 'he' | 'en';
  ip: string;
}

export interface LeakCheckDeps {
  mode: LeakCheckOcrMode;
  secret: string;
  /** Real provider (mode 'claude'). */
  ocr?: OcrProvider;
  poParser?: PoDocumentParser;
  /** Max OCR calls per UTC day across every prospect (the Claude cost budget). */
  dailyOcrBudget: number;
}

export interface LeakCheckOutcome {
  sessionId: string;
  token: string;
  report: LeakCheckReport;
}

/** Default daily budget: 200 calls ≈ 20 full checks/day (≈ $0.05–0.10 per Claude call). */
export const DEFAULT_DAILY_OCR_BUDGET = 200;

export function dailyOcrBudget(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.LEAK_CHECK_DAILY_OCR_CALLS ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_OCR_BUDGET;
}

/** Reject anything outside the limits BEFORE any spend (type is sniffed from the bytes). */
export function validateUploads(req: Pick<LeakCheckRequest, 'invoices' | 'priceList'>): void {
  const all = [...req.invoices, ...(req.priceList ? [req.priceList] : [])];
  if (req.invoices.length === 0) throw new LeakCheckError('no_files');
  if (req.invoices.length > MAX_INVOICES) throw new LeakCheckError('too_many_files');
  let total = 0;
  for (const f of all) {
    if (f.bytes.length > MAX_FILE_BYTES) throw new LeakCheckError('file_too_large');
    if (!sniffMime(f.bytes)) throw new LeakCheckError('bad_file_type');
    total += f.bytes.length;
  }
  if (total > MAX_BODY_BYTES) throw new LeakCheckError('body_too_large');
}

/**
 * Atomically reserve `calls` OCR calls from today's budget. False when the
 * budget would be exceeded — nothing is reserved then.
 */
export async function reserveOcrBudget(db: Database, calls: number, maxPerDay: number): Promise<boolean> {
  if (calls > maxPerDay) return false;
  const rows = (await db.execute(sql`
    insert into leak_check_ocr_usage (day, calls)
    values ((now() at time zone 'utc')::date, ${calls})
    on conflict (day) do update
      set calls = leak_check_ocr_usage.calls + excluded.calls
      where leak_check_ocr_usage.calls + excluded.calls <= ${maxPerDay}
    returning calls
  `)) as unknown as Array<{ calls: number }>;
  return rows.length > 0;
}

/** Hard-delete every expired sandbox session (7-day retention). Returns the count. */
export async function purgeExpiredLeakChecks(db: Database, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(leakCheckSessions)
    .where(lt(leakCheckSessions.expiresAt, now))
    .returning({ id: leakCheckSessions.id });
  return rows.length;
}

function toIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const il = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s.trim());
  if (il) {
    const year = il[3]!.length === 2 ? `20${il[3]}` : il[3]!;
    return `${year}-${il[2]!.padStart(2, '0')}-${il[1]!.padStart(2, '0')}`;
  }
  return null;
}

const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

export function toLeakCheckInvoice(
  index: number,
  upload: Pick<LeakCheckUpload, 'name'>,
  fileHash: string,
  ocr: InvoiceOcrResult,
): LeakCheckInvoice {
  return {
    index,
    fileName: upload.name.slice(0, 120),
    fileHash,
    supplierName: ocr.supplier?.name?.slice(0, 200) ?? null,
    supplierBusinessId: ocr.supplier?.businessId?.slice(0, 20) ?? null,
    invoiceNumber: ocr.invoiceNumber?.slice(0, 60) ?? null,
    invoiceDate: toIsoDate(ocr.invoiceDate),
    subtotal: finite(ocr.totals?.subtotal),
    vat: finite(ocr.totals?.vat),
    total: finite(ocr.totals?.total),
    lines: (ocr.lines ?? []).slice(0, 200).flatMap((l) => {
      const qty = finite(l.qty);
      const unitPrice = finite(l.unitPrice);
      const lineTotal = finite(l.lineTotal);
      if (qty === null || unitPrice === null || lineTotal === null) return [];
      return [{ description: l.rawDescription.slice(0, 200), qty, unit: (l.unit ?? '').slice(0, 20), unitPrice, lineTotal }];
    }),
  };
}

function toPriceList(po: NormalizedPurchaseOrder): PriceListEntry[] {
  return po.lines
    .filter((l) => typeof l.unitPrice === 'number' && l.unitPrice > 0)
    .slice(0, 500)
    .map((l) => ({ description: l.rawDescription.slice(0, 200), unit: l.unit, unitPrice: l.unitPrice! }));
}

export async function runLeakCheck(
  db: Database,
  req: LeakCheckRequest,
  deps: LeakCheckDeps,
): Promise<LeakCheckOutcome> {
  validateUploads(req);
  if (deps.mode === 'claude' && !deps.ocr) throw new LeakCheckError('ocr_failed');

  const calls = req.invoices.length + (req.priceList ? 1 : 0);
  if (!(await reserveOcrBudget(db, calls, deps.dailyOcrBudget))) {
    throw new LeakCheckError('budget_exhausted');
  }
  // Retention is enforced on every submit, so expired rows never outlive the
  // next visitor even before a scheduled job is wired (OPERATING follow-up).
  await purgeExpiredLeakChecks(db);

  const invoices: LeakCheckInvoice[] = [];
  const sampleSlot = new Map<string, number>();
  let failures = 0;
  for (const [index, upload] of req.invoices.entries()) {
    const fileHash = sha256Hex(upload.bytes);
    try {
      let ocr: InvoiceOcrResult;
      if (deps.mode === 'stub') {
        if (!sampleSlot.has(fileHash)) sampleSlot.set(fileHash, sampleSlot.size);
        ocr = sampleInvoiceFor(sampleSlot.get(fileHash)!);
      } else {
        ocr = await deps.ocr!.extract(upload.bytes);
      }
      invoices.push(toLeakCheckInvoice(index, upload, fileHash, ocr));
    } catch (err) {
      failures++;
      console.warn('[leakCheck] OCR failed for one file:', err instanceof Error ? err.message : err);
    }
  }
  if (invoices.length === 0 || failures === req.invoices.length) throw new LeakCheckError('ocr_failed');

  let priceList: PriceListEntry[] = [];
  if (req.priceList) {
    try {
      priceList =
        deps.mode === 'stub'
          ? toPriceList(SAMPLE_PRICE_LIST)
          : deps.poParser
            ? toPriceList(await deps.poParser.parse(req.priceList.bytes))
            : [];
    } catch (err) {
      console.warn('[leakCheck] price list unreadable:', err instanceof Error ? err.message : err);
    }
  }

  const report = analyzeLeakCheck(invoices, priceList);
  const [row] = await db
    .insert(leakCheckSessions)
    .values({
      email: req.email.slice(0, 320),
      name: req.name?.slice(0, 200) || null,
      locale: req.locale,
      ipHash: hashIp(deps.secret, req.ip),
      ocrMode: deps.mode,
      invoiceCount: req.invoices.length,
      hasPriceList: priceList.length > 0,
      invoices,
      findings: { findings: report.findings, notes: report.notes, analysedInvoices: report.analysedInvoices, ocrFailures: failures },
      leakAgorot: report.leakAgorot,
      spendAgorot: report.spendAgorot,
    })
    .returning({ id: leakCheckSessions.id });
  const sessionId = row!.id;
  return { sessionId, token: signResultLink(deps.secret, sessionId), report };
}

export interface LeakCheckView {
  id: string;
  ocrMode: LeakCheckOcrMode;
  locale: string;
  invoices: LeakCheckInvoice[];
  report: LeakCheckReport & { ocrFailures: number };
  hasPriceList: boolean;
  createdAt: Date;
  expiresAt: Date;
  claimed: boolean;
}

function toView(row: typeof leakCheckSessions.$inferSelect): LeakCheckView {
  const f = row.findings as {
    findings: LeakCheckReport['findings'];
    notes: LeakCheckReport['notes'];
    analysedInvoices: number;
    ocrFailures?: number;
  };
  return {
    id: row.id,
    ocrMode: row.ocrMode as LeakCheckOcrMode,
    locale: row.locale,
    invoices: row.invoices as LeakCheckInvoice[],
    report: {
      findings: f.findings ?? [],
      notes: f.notes ?? [],
      analysedInvoices: f.analysedInvoices ?? 0,
      ocrFailures: f.ocrFailures ?? 0,
      leakAgorot: Number(row.leakAgorot),
      spendAgorot: Number(row.spendAgorot),
    },
    hasPriceList: row.hasPriceList,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    claimed: row.claimedRestaurantId !== null,
  };
}

/** Load an UNEXPIRED session by id (the id comes only from a verified signed link). */
export async function getLeakCheckSession(db: Database, sessionId: string): Promise<LeakCheckView | null> {
  const [row] = await db
    .select()
    .from(leakCheckSessions)
    .where(and(eq(leakCheckSessions.id, sessionId), gt(leakCheckSessions.expiresAt, new Date())))
    .limit(1);
  return row ? toView(row) : null;
}

/** Record that the prospect asked for a demo; returns the email/name for the lead row. */
export async function markLeadRequested(
  db: Database,
  sessionId: string,
): Promise<{ email: string; name: string | null; leakAgorot: number; spendAgorot: number; firstTime: boolean } | null> {
  const [row] = await db
    .select()
    .from(leakCheckSessions)
    .where(and(eq(leakCheckSessions.id, sessionId), gt(leakCheckSessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  const updated = await db
    .update(leakCheckSessions)
    .set({ leadRequestedAt: new Date() })
    .where(and(eq(leakCheckSessions.id, sessionId), isNull(leakCheckSessions.leadRequestedAt)))
    .returning({ id: leakCheckSessions.id });
  return {
    email: row.email,
    name: row.name,
    leakAgorot: Number(row.leakAgorot),
    spendAgorot: Number(row.spendAgorot),
    firstTime: updated.length > 0,
  };
}

/**
 * Attach a sandbox session to the restaurant that signed up from it ("start a
 * trial with the data carried over"). First claim wins; a session already
 * claimed by another restaurant is never re-pointed.
 */
export async function claimLeakCheck(
  db: Database,
  sessionId: string,
  restaurantId: string,
): Promise<boolean> {
  const rows = await db
    .update(leakCheckSessions)
    .set({ claimedRestaurantId: restaurantId, claimedAt: new Date() })
    .where(
      and(
        eq(leakCheckSessions.id, sessionId),
        gt(leakCheckSessions.expiresAt, new Date()),
        sql`(${leakCheckSessions.claimedRestaurantId} is null or ${leakCheckSessions.claimedRestaurantId} = ${restaurantId})`,
      ),
    )
    .returning({ id: leakCheckSessions.id });
  return rows.length > 0;
}

/** The unexpired sessions a restaurant has claimed (the tenant's own view only). */
export async function listClaimedLeakChecks(db: Database, restaurantId: string): Promise<LeakCheckView[]> {
  const rows = await db
    .select()
    .from(leakCheckSessions)
    .where(and(eq(leakCheckSessions.claimedRestaurantId, restaurantId), gt(leakCheckSessions.expiresAt, new Date())));
  return rows.map(toView);
}
