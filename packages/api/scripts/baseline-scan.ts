/**
 * Offline baseline scan (pilot brief S15, part B): a believable day-1 ₪ number
 * from a restaurant's last 1–3 months of supplier invoices, computed OUTSIDE the
 * live tenant. Uploading history into the tenant would raise UNORDERED_ARRIVAL
 * blocks for whole invoices and burn the scan quota, so this reads local files
 * and writes local files only.
 *
 *   pnpm --filter @restomatch/api baseline:scan -- --dir <folder> --estimate
 *   ANTHROPIC_API_KEY=… OCR_CLAUDE_MODEL=… OCR_CLAUDE_EFFORT=low \
 *     pnpm --filter @restomatch/api baseline:scan -- --dir <folder> --max-docs 250 --i-approved-spend
 *
 * Input — one subfolder per supplier:
 *   <dir>/<supplier>/*.pdf|*.jpg|*.jpeg|*.png   the invoices
 *   <dir>/<supplier>/*.csv                      optional contract prices (one file):
 *        מק״ט, תיאור, יחידה, מחיר חוזה לפני מע״מ, בתוקף מתאריך, בתוקף עד
 *   <dir>/<supplier>/supplier.json              optional {"zeroVat": true} for 0%-VAT produce
 *
 * What counts (overcharges only, integer agorot, each finding = one file + line):
 *   the pure analyzeLeakCheck (src/leakCheck/analyze.ts) per supplier in date
 *   order — VAT above 18%, line and total arithmetic, price creep within the
 *   supplier — plus price above the contract valid on the invoice date, plus
 *   any VAT billed by a supplier marked zeroVat.
 *
 * Safety: never opens a database or storage connection (no @restomatch/db, no
 * postgres, no supabase import); `--estimate` makes no Claude call; Claude is
 * called only with `--i-approved-spend`, and never more than `--max-docs`
 * (default 50) times — a folder with more documents is refused up front.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';
import type { InvoiceOcrResult } from '@restomatch/types';
import {
  ARITHMETIC_TOLERANCE_AGOROT,
  analyzeLeakCheck,
  diceSimilarity,
  normalizeText,
  normalizeUnit,
  type LeakCheckInvoice,
  type LeakFindingKind,
  type PriceListEntry,
} from '../src/leakCheck/analyze';
import { formatIlsAgorot, ilsToAgorot } from '../src/reports/money';

// ── Costs (brief: Opus 5.5, effort low) ────────────────────────────────────────
export const USD_PER_PHOTO = 0.055;
/** $0.12 per 2-page PDF. */
export const USD_PER_PDF_PAGE = 0.06;
export const DEFAULT_MAX_DOCS = 50;

export const REPORT_LABEL = 'ממצאים מחשבוניות בלבד (אוגוסט–אוקטובר) — ללא בדיקת קבלת סחורה';

const DOC_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
/** Same threshold analyze.ts uses to match a line to a price-list entry. */
const CONTRACT_MATCH = 0.85;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ContractEntry extends PriceListEntry {
  sku: string | null;
  /** Inclusive ISO dates; null = open-ended. */
  validFrom: string | null;
  validTo: string | null;
}

export interface SupplierInput {
  name: string;
  /** Absolute paths, sorted. */
  docs: string[];
  contract: ContractEntry[];
  zeroVat: boolean;
}

export interface Extractor {
  extract(image: Buffer): Promise<InvoiceOcrResult>;
}

export type BaselineFindingKind = LeakFindingKind | 'vat_on_zero_rated';

export interface BaselineFinding {
  supplier: string;
  /** Path relative to --dir. */
  file: string;
  /** "1" for a photo, "1–N" for an N-page PDF (the extractor reads the whole document). */
  pages: string;
  /** 1-based position in the invoice's line table; null for invoice-level findings. */
  line: number | null;
  description: string;
  kind: BaselineFindingKind;
  amountAgorot: number;
  expectedAgorot: number;
  actualAgorot: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** Price creep: the earlier invoice line the price is compared to. */
  ref: string | null;
}

export interface SupplierResult {
  name: string;
  docs: number;
  analysedInvoices: number;
  spendAgorot: number;
  leakAgorot: number;
  findings: BaselineFinding[];
  notes: string[];
  failures: Array<{ file: string; error: string }>;
}

export interface BaselineResult {
  suppliers: SupplierResult[];
  findings: BaselineFinding[];
  leakAgorot: number;
  spendAgorot: number;
  docs: number;
  calls: number;
}

// ── Args ──────────────────────────────────────────────────────────────────────
export interface Args {
  dir: string;
  out: string;
  estimate: boolean;
  maxDocs: number;
  approved: boolean;
}

export function parseArgs(argv: string[], cwd = process.env.INIT_CWD ?? process.cwd()): Args {
  let dir = '';
  let out = '';
  let estimate = false;
  let maxDocs = DEFAULT_MAX_DOCS;
  let approved = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    else if (a === '--dir') dir = argv[++i] ?? '';
    else if (a === '--out') out = argv[++i] ?? '';
    else if (a === '--estimate') estimate = true;
    else if (a === '--i-approved-spend') approved = true;
    else if (a === '--max-docs') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error('--max-docs must be a positive integer');
      maxDocs = n;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!dir) throw new Error('--dir <folder of supplier subfolders> is required');
  const absDir = path.resolve(cwd, dir);
  return {
    dir: absDir,
    out: path.resolve(cwd, out || path.join(path.dirname(absDir), `${path.basename(absDir)}-baseline`)),
    estimate,
    maxDocs,
    approved,
  };
}

// ── Input folder ──────────────────────────────────────────────────────────────
function parseNumber(raw: string | undefined): number | null {
  const s = (raw ?? '').replace(/[₪,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** DD/MM/YYYY, D.M.YYYY or YYYY-MM-DD → YYYY-MM-DD; empty → null. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  throw new Error(`unreadable date "${s}" (use DD/MM/YYYY or YYYY-MM-DD)`);
}

const normHeader = (h: string) => h.replace(/["״'׳]/g, '').replace(/\s+/g, ' ').trim();
const HEADERS = {
  sku: normHeader('מק״ט'),
  description: normHeader('תיאור'),
  unit: normHeader('יחידה'),
  price: normHeader('מחיר חוזה לפני מע״מ'),
  from: normHeader('בתוקף מתאריך'),
  to: normHeader('בתוקף עד'),
};

export function parseContractCsv(text: string, fileLabel = 'contract.csv'): ContractEntry[] {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normHeader,
  });
  const fields = parsed.meta.fields ?? [];
  for (const need of [HEADERS.description, HEADERS.unit, HEADERS.price]) {
    if (!fields.includes(need)) throw new Error(`${fileLabel}: missing column "${need}"`);
  }
  return parsed.data.map((row, i) => {
    const unitPrice = parseNumber(row[HEADERS.price]);
    const description = (row[HEADERS.description] ?? '').trim();
    if (unitPrice === null || unitPrice <= 0 || !description) {
      throw new Error(`${fileLabel} row ${i + 2}: needs a description and a positive contract price`);
    }
    return {
      sku: (row[HEADERS.sku] ?? '').trim() || null,
      description,
      unit: (row[HEADERS.unit] ?? '').trim(),
      unitPrice,
      validFrom: parseDate(row[HEADERS.from]),
      validTo: parseDate(row[HEADERS.to]),
    };
  });
}

export async function readInputFolder(dir: string): Promise<SupplierInput[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const suppliers: SupplierInput[] = [];
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(dir, e.name);
    const files = (await readdir(folder, { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name).sort();
    const docs = files.filter((f) => DOC_EXT.has(path.extname(f).toLowerCase())).map((f) => path.join(folder, f));
    const csvs = files.filter((f) => path.extname(f).toLowerCase() === '.csv');
    if (csvs.length > 1) throw new Error(`${e.name}: more than one contract CSV (${csvs.join(', ')})`);
    const contract = csvs.length
      ? parseContractCsv(await readFile(path.join(folder, csvs[0]!), 'utf8'), `${e.name}/${csvs[0]}`)
      : [];
    let zeroVat = false;
    if (files.includes('supplier.json')) {
      const cfg = JSON.parse(await readFile(path.join(folder, 'supplier.json'), 'utf8')) as { zeroVat?: unknown };
      zeroVat = cfg.zeroVat === true;
    }
    suppliers.push({ name: e.name, docs, contract, zeroVat });
  }
  return suppliers;
}

/** Page count of a PDF (leaf /Type /Page objects); 1 for anything else. */
export function pdfPageCount(bytes: Buffer): number {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return 1;
  const n = bytes.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return Math.max(1, n);
}

// ── Estimate ──────────────────────────────────────────────────────────────────
export interface Estimate {
  docs: number;
  photos: number;
  pdfs: number;
  pdfPages: number;
  usd: number;
}

export async function estimateSpend(suppliers: SupplierInput[]): Promise<Estimate> {
  let photos = 0;
  let pdfs = 0;
  let pdfPages = 0;
  for (const s of suppliers) {
    for (const doc of s.docs) {
      if (path.extname(doc).toLowerCase() === '.pdf') {
        pdfs++;
        pdfPages += pdfPageCount(await readFile(doc));
      } else photos++;
    }
  }
  const usd = Math.round((photos * USD_PER_PHOTO + pdfPages * USD_PER_PDF_PAGE) * 100) / 100;
  return { docs: photos + pdfs, photos, pdfs, pdfPages, usd };
}

// ── Contract matching ─────────────────────────────────────────────────────────
const normSku = (s: string | null | undefined) => (s ?? '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();

function validOn(entries: ContractEntry[], date: string | null): ContractEntry[] {
  // No date read → only open-ended contract rows can apply.
  if (!date) return entries.filter((c) => !c.validFrom && !c.validTo);
  return entries.filter((c) => (!c.validFrom || c.validFrom <= date) && (!c.validTo || date <= c.validTo));
}

function matchesContract(line: { description: string; unit: string }, entries: ContractEntry[]): boolean {
  const desc = normalizeText(line.description);
  const unit = normalizeUnit(line.unit);
  return entries.some(
    (c) => normalizeUnit(c.unit) === unit && diceSimilarity(desc, normalizeText(c.description)) >= CONTRACT_MATCH,
  );
}

// ── Core run ──────────────────────────────────────────────────────────────────
export class SpendNotApprovedError extends Error {}
export class MaxDocsExceededError extends Error {}

interface Doc {
  file: string;
  pages: number;
  invoice: LeakCheckInvoice;
}

/**
 * Extract every document with `extractor` (one call per document) and analyse
 * each supplier. Throws before the first call unless `approved`, and refuses a
 * folder holding more than `maxDocs` documents.
 */
export async function runBaseline(opts: {
  dir: string;
  suppliers: SupplierInput[];
  extractor: Extractor;
  maxDocs: number;
  approved: boolean;
  log?: (msg: string) => void;
}): Promise<BaselineResult> {
  const log = opts.log ?? (() => undefined);
  const total = opts.suppliers.reduce((n, s) => n + s.docs.length, 0);
  if (!opts.approved) {
    throw new SpendNotApprovedError(
      `refusing to call Claude for ${total} document(s) without --i-approved-spend (run --estimate first)`,
    );
  }
  if (total > opts.maxDocs) {
    throw new MaxDocsExceededError(
      `${total} documents found, above --max-docs ${opts.maxDocs}; nothing was sent. Raise --max-docs after reading --estimate.`,
    );
  }

  let calls = 0;
  const results: SupplierResult[] = [];
  for (const s of opts.suppliers) {
    const docs: Doc[] = [];
    const failures: SupplierResult['failures'] = [];
    for (const abs of s.docs) {
      const file = path.relative(opts.dir, abs);
      const bytes = await readFile(abs);
      if (calls >= opts.maxDocs) throw new MaxDocsExceededError(`--max-docs ${opts.maxDocs} reached`);
      calls++;
      log(`[${calls}/${total}] ${file}`);
      try {
        const ocr = await opts.extractor.extract(bytes);
        docs.push({ file, pages: pdfPageCount(bytes), invoice: toInvoice(docs.length, file, bytes, ocr, s) });
      } catch (err) {
        failures.push({ file, error: err instanceof Error ? err.message : String(err) });
      }
    }
    results.push(analyseSupplier(s, docs, failures));
  }

  const findings = results
    .flatMap((r) => r.findings)
    .sort((a, b) => b.amountAgorot - a.amountAgorot || a.file.localeCompare(b.file));
  return {
    suppliers: results,
    findings,
    leakAgorot: results.reduce((n, r) => n + r.leakAgorot, 0),
    spendAgorot: results.reduce((n, r) => n + r.spendAgorot, 0),
    docs: total,
    calls,
  };
}

function toInvoice(
  index: number,
  file: string,
  bytes: Buffer,
  ocr: InvoiceOcrResult,
  supplier: SupplierInput,
): LeakCheckInvoice {
  const bySku = new Map(supplier.contract.filter((c) => normSku(c.sku)).map((c) => [normSku(c.sku), c]));
  return {
    index,
    fileName: file,
    fileHash: createHash('sha256').update(bytes).digest('hex'),
    // The folder is the supplier: every document in it is compared with the others.
    supplierName: supplier.name,
    supplierBusinessId: null,
    invoiceNumber: ocr.invoiceNumber ?? null,
    invoiceDate: ocr.invoiceDate ? safeDate(ocr.invoiceDate) : null,
    subtotal: ocr.totals.subtotal ?? null,
    vat: ocr.totals.vat ?? null,
    total: ocr.totals.total ?? null,
    lines: ocr.lines.map((l) => ({
      // A printed מק״ט that is in the contract names the line the contract's way,
      // so the description match below (and creep across invoices) is exact.
      description: bySku.get(normSku(l.sku))?.description ?? l.rawDescription,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  };
}

function safeDate(raw: string): string | null {
  try {
    return parseDate(raw);
  } catch {
    return null;
  }
}

function analyseSupplier(s: SupplierInput, docs: Doc[], failures: SupplierResult['failures']): SupplierResult {
  const invoices = docs.map((d) => d.invoice);
  const base = analyzeLeakCheck(invoices);
  const excluded = new Set(
    base.notes.filter((n) => n.kind === 'same_file_twice' || n.kind === 'possible_duplicate').map((n) => n.invoiceIndex),
  );
  const byIndex = new Map(invoices.map((inv) => [inv.index, inv]));

  type Raw = Omit<BaselineFinding, 'supplier' | 'file' | 'pages' | 'invoiceNumber' | 'invoiceDate' | 'description' | 'ref'> & {
    invoiceIndex: number;
    lineIndex: number | null;
    refInvoiceIndex?: number;
    refLineIndex?: number;
  };
  const raw: Raw[] = [];
  const push = (f: {
    kind: BaselineFindingKind;
    invoiceIndex: number;
    lineIndex: number | null;
    amountAgorot: number;
    expectedAgorot: number;
    actualAgorot: number;
    refInvoiceIndex?: number;
    refLineIndex?: number;
  }) => raw.push({ ...f, line: f.lineIndex === null ? null : f.lineIndex + 1 });

  for (const f of base.findings) {
    const inv = byIndex.get(f.invoiceIndex)!;
    // 0% produce: any VAT is the finding (below), not the part above 18%.
    if (f.kind === 'vat_overcharge' && s.zeroVat) continue;
    // The contract is the stronger reference for a line it covers (same rule as analyze.ts).
    if (f.kind === 'price_creep' && f.lineIndex !== null) {
      if (matchesContract(inv.lines[f.lineIndex]!, validOn(s.contract, inv.invoiceDate))) continue;
    }
    push(f);
  }

  for (const inv of invoices) {
    if (excluded.has(inv.index)) continue;
    if (s.zeroVat && inv.vat != null) {
      const vat = ilsToAgorot(inv.vat);
      if (vat > ARITHMETIC_TOLERANCE_AGOROT) {
        push({ kind: 'vat_on_zero_rated', invoiceIndex: inv.index, lineIndex: null, amountAgorot: vat, expectedAgorot: 0, actualAgorot: vat });
      }
    }
    const contract = validOn(s.contract, inv.invoiceDate);
    if (contract.length) {
      for (const f of analyzeLeakCheck([inv], contract).findings) if (f.kind === 'above_price_list') push(f);
    }
  }

  const docByIndex = new Map(docs.map((d) => [d.invoice.index, d]));
  const findings: BaselineFinding[] = raw.map((f) => {
    const d = docByIndex.get(f.invoiceIndex)!;
    const refDoc = f.refInvoiceIndex !== undefined ? docByIndex.get(f.refInvoiceIndex) : undefined;
    return {
      supplier: s.name,
      file: d.file,
      pages: d.pages > 1 ? `1–${d.pages}` : '1',
      line: f.line,
      description: f.lineIndex === null ? '' : d.invoice.lines[f.lineIndex]!.description,
      kind: f.kind,
      amountAgorot: f.amountAgorot,
      expectedAgorot: f.expectedAgorot,
      actualAgorot: f.actualAgorot,
      invoiceNumber: d.invoice.invoiceNumber,
      invoiceDate: d.invoice.invoiceDate,
      ref: refDoc ? `${refDoc.file} שורה ${(f.refLineIndex ?? 0) + 1}` : null,
    };
  });
  findings.sort((a, b) => b.amountAgorot - a.amountAgorot || a.file.localeCompare(b.file));

  const fileOf = (i: number | undefined) => (i === undefined ? '' : (docByIndex.get(i)?.file ?? ''));
  const notes = base.notes.map((n) => {
    const amount = n.amountAgorot ? ` ${formatIlsAgorot(n.amountAgorot, { maximumFractionDigits: 2 })}` : '';
    switch (n.kind) {
      case 'same_file_twice':
        return `${fileOf(n.invoiceIndex)}: אותו קובץ כמו ${fileOf(n.refInvoiceIndex)} — לא נספר`;
      case 'possible_duplicate':
        return `${fileOf(n.invoiceIndex)}: אותו מספר חשבונית כמו ${fileOf(n.refInvoiceIndex)}${amount} — חשבונית כפולה אפשרית, לא נספרה`;
      case 'undercharge':
        return `${fileOf(n.invoiceIndex)} שורה ${(n.lineIndex ?? 0) + 1}: חויב פחות מהחישוב${amount} — לטובתכם, לא נספר`;
      case 'subtotal_mismatch':
        return `${fileOf(n.invoiceIndex)}: סכום ביניים גבוה מסכום השורות${amount} — כנראה דמי משלוח, לא נספר`;
    }
  });

  return {
    name: s.name,
    docs: s.docs.length,
    analysedInvoices: base.analysedInvoices,
    spendAgorot: base.spendAgorot,
    leakAgorot: findings.reduce((n, f) => n + f.amountAgorot, 0),
    findings,
    notes,
    failures,
  };
}

// ── Output ────────────────────────────────────────────────────────────────────
export const KIND_HE: Record<BaselineFindingKind, string> = {
  vat_overcharge: 'מע״מ מעל 18%',
  vat_on_zero_rated: 'מע״מ על ספק פטור (0%)',
  line_arithmetic: 'שורה: סכום מעל מחיר × כמות',
  total_arithmetic: 'סה״כ מעל סכום ביניים + מע״מ',
  price_creep: 'עליית מחיר אצל אותו ספק',
  above_price_list: 'מחיר מעל החוזה',
};

const ils = (agorot: number) => formatIlsAgorot(agorot, { maximumFractionDigits: 2 });
/** OCR text inside a Markdown table cell: escape backslashes first, then pipes; one line. */
export const cell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function toCsv(result: BaselineResult): string {
  const header = [
    'supplier', 'file', 'pages', 'line', 'invoice_number', 'invoice_date', 'kind', 'kind_he',
    'description', 'amount_agorot', 'expected_agorot', 'actual_agorot', 'amount_ils', 'compared_to',
  ];
  const rows = result.findings.map((f) => [
    f.supplier, f.file, f.pages, f.line ?? '', f.invoiceNumber ?? '', f.invoiceDate ?? '', f.kind, KIND_HE[f.kind],
    f.description, f.amountAgorot, f.expectedAgorot, f.actualAgorot, ils(f.amountAgorot), f.ref ?? '',
  ]);
  // BOM so Excel opens the Hebrew as UTF-8.
  return '﻿' + Papa.unparse([header, ...rows]) + '\n';
}

export function toMarkdown(result: BaselineResult, generatedAt: string): string {
  const L: string[] = [];
  const where = (f: BaselineFinding) => `${cell(f.file)} · עמ׳ ${f.pages} · ${f.line === null ? 'כל החשבונית' : `שורה ${f.line}`}`;
  L.push('<div dir="rtl">', '');
  L.push('# בדיקת בסיס — דליפה בחשבוניות ספקים', '');
  L.push(`**${REPORT_LABEL}**`, '');
  L.push(
    `סה״כ ממצאים: **${ils(result.leakAgorot)}** מתוך ${ils(result.spendAgorot)} בחשבוניות שנבדקו · ${result.docs} מסמכים · ${result.suppliers.length} ספקים · הופק ${generatedAt}`,
    '',
  );
  L.push(
    '> זה **לא** מספר הדליפה של מסך הבית ואין לחבר אותו אליו: כאן נבדקות חשבוניות בלבד, בלי הזמנה ובלי קבלת סחורה. כל שורה למטה מפנה לקובץ, לעמוד ולשורה — יש לבדוק אותה מול החשבונית המודפסת לפני שמציגים אותה.',
    '',
  );

  L.push('## 10 הממצאים הגדולים', '');
  if (result.findings.length === 0) L.push('לא נמצאו חיובי יתר.', '');
  else {
    L.push('| # | ספק | איפה | מה | פריט | סכום |', '|---|---|---|---|---|---|');
    result.findings.slice(0, 10).forEach((f, i) => {
      L.push(`| ${i + 1} | ${cell(f.supplier)} | ${where(f)} | ${KIND_HE[f.kind]} | ${cell(f.description)} | ${ils(f.amountAgorot)} |`);
    });
    L.push('');
  }

  L.push('## לפי ספק', '', '| ספק | מסמכים | חשבוניות שנבדקו | רכש שנבדק | ממצאים | סכום |', '|---|---|---|---|---|---|');
  for (const s of result.suppliers) {
    L.push(`| ${cell(s.name)} | ${s.docs} | ${s.analysedInvoices} | ${ils(s.spendAgorot)} | ${s.findings.length} | ${ils(s.leakAgorot)} |`);
  }
  L.push(`| **סה״כ** | ${result.docs} | ${result.suppliers.reduce((n, s) => n + s.analysedInvoices, 0)} | ${ils(result.spendAgorot)} | ${result.findings.length} | **${ils(result.leakAgorot)}** |`, '');

  for (const s of result.suppliers) {
    L.push(`## ${cell(s.name)} — ${ils(s.leakAgorot)}`, '');
    if (s.findings.length) {
      L.push('| איפה | חשבונית | מה | פריט | צפוי | חויב | סכום | מול |', '|---|---|---|---|---|---|---|---|');
      for (const f of s.findings) {
        L.push(
          `| ${where(f)} | ${cell(f.invoiceNumber ?? '—')} ${f.invoiceDate ?? ''} | ${KIND_HE[f.kind]} | ${cell(f.description)} | ${ils(f.expectedAgorot)} | ${ils(f.actualAgorot)} | ${ils(f.amountAgorot)} | ${cell(f.ref ?? '')} |`,
        );
      }
      L.push('');
    } else L.push('לא נמצאו חיובי יתר.', '');
    if (s.notes.length) {
      L.push('הערות (לא נספרו):', '', ...s.notes.map((n) => `- ${cell(n)}`), '');
    }
    if (s.failures.length) {
      L.push('לא נקראו (לא נספרו — לבדוק ידנית):', '', ...s.failures.map((f) => `- ${cell(f.file)}: ${cell(f.error)}`), '');
    }
  }

  L.push('## איך נספר', '');
  L.push(
    '- רק חיובי יתר נספרים: מע״מ מעל 18% (או כל מע״מ אצל ספק שסומן פטור), שורה שסכומה מעל מחיר × כמות, סה״כ מעל סכום ביניים + מע״מ, מחיר מעל החוזה שבתוקף בתאריך החשבונית, ועליית מחיר מעל 2% לעומת המחיר הראשון של אותו פריט אצל אותו ספק.',
    `- טעות לטובתכם, חשבונית כפולה אפשרית ופער בסכום הביניים מוצגים כהערה ולא נספרים. פער של עד ${formatIlsAgorot(ARITHMETIC_TOLERANCE_AGOROT)} לא נחשב ממצא.`,
    '- כל הסכומים באגורות שלמות; הסך = סכום השורות בדיוק.',
    '- "שורה" = מיקום השורה בטבלת החשבונית כפי שנקראה; בקובץ PDF של כמה עמודים יש לחפש את השורה לפי הסדר.',
    '',
    '</div>',
    '',
  );
  return L.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
export async function main(
  argv: string[],
  deps: { makeExtractor?: () => Promise<Extractor>; log?: (m: string) => void; now?: () => Date } = {},
): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const args = parseArgs(argv);
  const suppliers = await readInputFolder(args.dir);
  const est = await estimateSpend(suppliers);
  log(
    `[baseline] ${suppliers.length} suppliers · ${est.docs} documents (${est.photos} photos, ${est.pdfs} PDFs / ${est.pdfPages} pages) · estimated $${est.usd.toFixed(2)} · --max-docs ${args.maxDocs}`,
  );
  for (const s of suppliers) {
    log(`  ${s.name}: ${s.docs.length} documents${s.contract.length ? ` · contract ${s.contract.length} rows` : ''}${s.zeroVat ? ' · 0% VAT' : ''}`);
  }
  if (args.estimate) {
    log('[baseline] --estimate: no Claude call made.');
    return 0;
  }
  if (!args.approved) {
    log('[baseline] refusing to call Claude without --i-approved-spend. Run --estimate, then re-run with the flag.');
    return 2;
  }
  if (est.docs > args.maxDocs) {
    log(`[baseline] ${est.docs} documents > --max-docs ${args.maxDocs}: nothing sent. Raise --max-docs if the estimate is approved.`);
    return 2;
  }
  const extractor = await (deps.makeExtractor ?? claudeExtractor)();
  const result = await runBaseline({ dir: args.dir, suppliers, extractor, maxDocs: args.maxDocs, approved: true, log });
  await mkdir(args.out, { recursive: true });
  const stamp = (deps.now ?? (() => new Date()))().toISOString();
  await writeFile(path.join(args.out, 'baseline-findings.csv'), toCsv(result), 'utf8');
  await writeFile(path.join(args.out, 'baseline-report.md'), toMarkdown(result, stamp.slice(0, 16).replace('T', ' ')), 'utf8');
  log(`[baseline] ${result.calls} Claude calls · findings ${ils(result.leakAgorot)} of ${ils(result.spendAgorot)} · written to ${args.out}`);
  return 0;
}

async function claudeExtractor(): Promise<Extractor> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const { ClaudeVision } = await import('@restomatch/ocr');
  // Model and effort come from OCR_CLAUDE_MODEL / OCR_CLAUDE_EFFORT, like production.
  return new ClaudeVision({ apiKey });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`[baseline] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
