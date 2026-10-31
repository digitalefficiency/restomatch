/**
 * "Ask RestoMatch" (wave 1, flag `aiAssistant`) — the ONLY data the assistant
 * can see. Every tool is read-only and runs the SAME tenant-scoped chart
 * computations the dashboard screens use (packages/charts), on the member
 * transaction (`db` has the RLS GUC set) and the SESSION restaurant id — never
 * an id from the model. The model can pick a month or a limit, nothing else:
 * no raw SQL, no writes, no other tenant.
 *
 * Untrusted text (supplier names, invoice line descriptions — OCR'd from paper)
 * is passed to the model only through `clip()`: control chars stripped, length
 * capped, inside a JSON tool_result. The system prompt states that tool results
 * are data, never instructions (see claude.ts) and the answer's links are
 * re-validated against `links` produced here (grounding.ts).
 */
import { computeLeakBreakdown, computeLeakHero, computeLeakReport, type LeakHero, type LeakReport } from '@restomatch/charts';
import type { Database } from '@restomatch/db';
import { z } from 'zod';
import { awaitingDecisionDetail, type AwaitingClaim } from '../approvals/awaiting';
import { leakComparison } from './compare';
import { monthKey, monthPeriod, restaurantTimezone, type Period } from './periods';

export { monthKey } from './periods';

export type ToolName = 'leak_hero' | 'leak_report' | 'leak_breakdown' | 'leak_change' | 'claimable_lines';

/** A screen the answer may link to (validated allow-list, built only here). */
export interface ScreenLink {
  href: string;
  /** Stable label key; the web renders it in the user's language. */
  screen: 'overview' | 'leaks' | 'report' | 'breakdown' | 'claims' | 'invoice' | 'supplier';
}

/** The figures in a tool result, by unit (from the field name: …Ils/…Price → ₪, …Pct → %). */
export interface Figures {
  ils: number[];
  pct: number[];
  count: number[];
}

export interface ToolOutput {
  data: unknown;
  links: ScreenLink[];
  /** Every number in `data`, by unit (for the grounding check). */
  figures: Figures;
  /** The period the figures cover (every period tool). */
  period?: Period;
  /** A like-for-like comparison: its delta must be quoted with its span label. */
  comparison?: { cur: Period; prev: Period; deltaIls: number; labels: string[] };
}

/** Monthly offset (0, -1, …) of a 'YYYY-MM' relative to now; null when out of range. */
function offsetOf(month: string, now: Date, tz: string): number | null {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const [cy, cm] = monthKey(0, now, tz).split('-').map(Number) as [number, number];
  const off = y * 12 + m - (cy * 12 + cm);
  return off <= 0 && off >= -24 ? off : null;
}

/** Untrusted text → a short, single-line, control-free string. */
export function clip(text: string | null | undefined, max = 60): string | null {
  if (text == null) return null;
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type AskLocale = 'he' | 'en';
/** The display name in the answer's language: Hebrew original, or English when available. */
function nm(locale: AskLocale, en: string | null | undefined, ...he: Array<string | null | undefined>): string | null {
  const heName = he.find((h) => h != null && h !== '') ?? null;
  return clip(locale === 'en' ? (en ?? heName) : (heName ?? en ?? null));
}
const pct = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 10);

function heroData(h: LeakHero) {
  return {
    month: h.monthStart.slice(0, 7),
    leakIls: r2(h.leakIls),
    spendIls: r2(h.spendIls),
    leakPctOfSpend: pct(h.leakPct),
    caughtBeforePaymentIls: r2(h.caughtBeforePaymentIls),
    recoveredIls: r2(h.recoveredIls),
    invoiceCount: h.invoiceCount,
    invoicesWithLeak: h.invoicesWithLeak,
    pendingLinkCount: h.pendingLinkCount,
  };
}

export function reportData(r: LeakReport, locale: AskLocale = 'en') {
  return {
    month: r.month,
    hero: heroData(r.hero),
    byType: r.byType.slice(0, 8).map((t) => ({ type: t.type, count: t.count, amountIls: r2(t.amountIls) })),
    bySupplier: r.bySupplier.slice(0, 8).map((s) => ({
      supplierId: s.supplierId,
      supplier: nm(locale, s.supplierNameEn, s.supplierName),
      invoiceCount: s.invoiceCount,
      spendIls: r2(s.spendIls),
      leakIls: r2(s.leakIls),
      leakPctOfSpend: pct(s.leakPct),
    })),
    priceIncreases: r.priceCreep.slice(0, 8).map((p) => ({
      product: nm(locale, p.productNameEn, p.productName),
      supplier: nm(locale, p.supplierNameEn, p.supplierName),
      beforePrice: r2(p.beforePrice),
      afterPrice: r2(p.afterPrice),
      deltaPct: pct(p.deltaPct),
      excessIls: r2(p.excessIls),
    })),
    status: {
      caughtBeforePaymentIls: r2(r.status.caughtBeforePaymentIls),
      stillOpenIls: r2(r.status.stillOpenIls),
      stillOpenCount: r.status.stillOpenCount,
      claimedIls: r2(r.status.claimedIls),
      waivedIls: r2(r.status.waivedIls),
    },
  };
}

/**
 * What can be claimed now: the open claimable lines of `awaitingDecision` (ALL
 * open rows, the letters' per-invoice cap — no month window, no limit). ₪ per
 * VAT basis, never added together: `totalIls` is before VAT; a duplicate's ₪
 * (incl. VAT) and VAT amounts are reported apart.
 */
export function claimableData(claims: readonly AwaitingClaim[], locale: AskLocale = 'en') {
  const agorot = { excl: 0, incl: 0, vat: 0 };
  for (const c of claims) agorot[c.basis] += Math.round(c.amountIls * 100);
  const lines = claims.map((c) => ({
    invoiceId: c.invoice.invoiceId,
    invoiceNumber: clip(c.invoice.invoiceNumber, 30),
    supplier: nm(locale, c.invoice.supplierNameEn, c.invoice.supplierName),
    type: c.line.type,
    item: nm(locale, c.line.productNameEn ?? c.line.lineDescriptionEn, c.line.productName, c.line.lineDescription),
    amountIls: r2(c.amountIls),
    basis: c.basis,
  }));
  return {
    totalIls: agorot.excl / 100,
    duplicateInclVatIls: agorot.incl / 100,
    vatIls: agorot.vat / 100,
    count: claims.filter((c) => c.basis === 'excl').length,
    otherBasisCount: claims.filter((c) => c.basis !== 'excl').length,
    lines: lines.slice(0, 15),
  };
}

/** Open claimable lines for Ask: the whole restaurant (Ask is manager tier, which reads every routing with ₪). */
export async function claimableFor(db: Database, restaurantId: string, locale: AskLocale) {
  const { claims } = await awaitingDecisionDetail(db, { session: { restaurantId, role: 'manager' } }, { scope: 'all' });
  return claimableData(claims, locale);
}

export function figuresOf(value: unknown, key = '', out: Figures = { ils: [], pct: [], count: [] }): Figures {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (/(Ils|Price)$/.test(key)) out.ils.push(value);
    else if (/Pct$/i.test(key)) out.pct.push(value);
    else out.count.push(value);
  } else if (typeof value === 'string') {
    // Digits inside names ("Bleach 4 L", "INV-1042") may be quoted in prose.
    for (const d of value.match(/\d+(?:\.\d+)?/g) ?? []) out.count.push(Number(d));
  } else if (Array.isArray(value)) for (const v of value) figuresOf(v, key, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) figuresOf(v, k, out);
  return out;
}

const MonthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict();
const BreakdownInput = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  })
  .strict();

const MONTH_PROP = {
  type: 'string',
  description: "Calendar month 'YYYY-MM' (the restaurant's local time). Omit for the current month (to date).",
};

/** Tool definitions sent to Claude (strict JSON schemas, read-only). */
export const TOOL_DEFINITIONS = [
  {
    name: 'leak_hero',
    description:
      "The restaurant's headline leak for ONE month: leaked ₪, % of checked food spend, ₪ caught before payment, recoveredIls (₪ accepted for claim — not yet money back), invoice counts. `period` says which days it covers and whether the month is complete; the current month is to date. To compare with an earlier month use leak_change, never two leak_hero results.",
    input_schema: { type: 'object', properties: { month: MONTH_PROP }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'leak_report',
    description:
      'The monthly leak report: the leak split by discrepancy type and by supplier (spend, leak, leak %), the products whose unit price rose vs the 90 days before (before/after price, % change, excess ₪), and what happened to the leak (open / claimed / waived). `period` says which days it covers and whether the month is complete.',
    input_schema: { type: 'object', properties: { month: MONTH_PROP }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'leak_breakdown',
    description: "The invoices behind a month's leak, biggest first, with their discrepancy lines. `period` says which days it covers.",
    input_schema: {
      type: 'object',
      properties: { month: MONTH_PROP, limit: { type: 'integer', description: '1–30, default 10' } },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'leak_change',
    description:
      "How the leak changed, like for like: this month from the 1st to today against the SAME days of the previous month (or a closed month in full against the month before it). Returns both spans, the delta and `spanLabel` — quote the span label whenever you state the change.",
    input_schema: { type: 'object', properties: { month: MONTH_PROP }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'claimable_lines',
    description:
      'Open gaps (not yet decided) with ₪ to claim back from suppliers, from every month, biggest first, capped per invoice like the credit letters. totalIls is before VAT; duplicate invoices (incl. VAT) and VAT amounts are separate totals — never add them.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
] as const;

export interface ToolContext {
  db: Database;
  restaurantId: string;
  now?: Date;
  /** Language of the answer (names are given in it). */
  locale?: AskLocale;
}

/** Execute one tool. Throws on invalid input (the loop returns it as an is_error tool_result). */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const now = ctx.now ?? new Date();
  const tz = await restaurantTimezone(ctx.db, ctx.restaurantId);
  switch (name as ToolName) {
    case 'leak_hero': {
      const input = MonthInput.parse(rawInput ?? {});
      const offset = input.month ? offsetOf(input.month, now, tz) : 0;
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const hero = await computeLeakHero(ctx.db, ctx.restaurantId, { monthOffset: offset, now });
      const period = monthPeriod(offset, now, tz);
      const data = { period, ...heroData(hero) };
      return {
        data,
        period,
        figures: figuresOf(data),
        links: [
          { screen: 'overview', href: '/dashboard' },
          { screen: 'breakdown', href: `/dashboard/leaks/breakdown?m=${offset}` },
        ],
      };
    }
    case 'leak_report': {
      const input = MonthInput.parse(rawInput ?? {});
      const month = input.month ?? monthKey(0, now, tz);
      const offset = offsetOf(month, now, tz);
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const period = monthPeriod(offset, now, tz);
      const data = { period, ...reportData(await computeLeakReport(ctx.db, ctx.restaurantId, month), ctx.locale) };
      const links: ScreenLink[] = [{ screen: 'report', href: `/dashboard/leaks/report?month=${month}` }];
      for (const s of data.bySupplier) {
        if (s.supplierId) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${s.supplierId}` });
      }
      return { data, period, figures: figuresOf(data), links };
    }
    case 'leak_breakdown': {
      const input = BreakdownInput.parse(rawInput ?? {});
      const offset = input.month ? offsetOf(input.month, now, tz) : 0;
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const rows = await computeLeakBreakdown(ctx.db, ctx.restaurantId, {
        monthOffset: offset,
        limit: input.limit ?? 10,
        now,
      });
      const period = monthPeriod(offset, now, tz);
      const invoices = rows.map((inv) => ({
        invoiceId: inv.invoiceId,
        invoiceNumber: clip(inv.invoiceNumber, 30),
        invoiceDate: inv.invoiceDate,
        supplier: nm(ctx.locale ?? 'en', inv.supplierNameEn, inv.supplierName),
        totalInclVatIls: r2(inv.totalInclVat),
        leakIls: r2(inv.leakIls),
        pendingLink: inv.pendingLink,
        lines: inv.lines.slice(0, 6).map((l) => ({
          type: l.type,
          status: l.resolutionStatus,
          item: nm(ctx.locale ?? 'en', l.productNameEn ?? l.lineDescriptionEn, l.productName, l.lineDescription),
          deltaIls: r2(l.deltaAmount),
          countsAsLeak: l.countsAsLeak,
        })),
      }));
      const data = { period, invoices };
      return {
        data,
        period,
        figures: figuresOf(data),
        links: [
          { screen: 'breakdown', href: `/dashboard/leaks/breakdown?m=${offset}` },
          ...invoices.map((d) => ({ screen: 'invoice' as const, href: `/dashboard/invoices/${d.invoiceId}` })),
        ],
      };
    }
    case 'leak_change': {
      const input = MonthInput.parse(rawInput ?? {});
      const offset = input.month ? offsetOf(input.month, now, tz) : 0;
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const c = await leakComparison(ctx.db, ctx.restaurantId, now, ctx.locale ?? 'en', offset);
      const data = {
        period: { from: c.cur.from, through: c.cur.through, complete: c.cur.complete },
        comparedWith: { from: c.prev.from, through: c.prev.through, complete: c.prev.complete },
        spanLabel: c.spanLabel,
        leakIls: c.cur.leakIls,
        prevLeakIls: c.prev.leakIls,
        deltaIls: c.deltaIls,
        topSupplier: c.topSupplier?.name ?? null,
        topSupplierDeltaIls: c.topSupplier?.deltaIls ?? null,
        topType: c.topType?.type ?? null,
        topTypeDeltaIls: c.topType?.deltaIls ?? null,
      };
      const links: ScreenLink[] = [
        { screen: 'report', href: `/dashboard/leaks/report?month=${c.cur.from.slice(0, 7)}` },
        { screen: 'report', href: `/dashboard/leaks/report?month=${c.prev.from.slice(0, 7)}` },
      ];
      if (c.topSupplier?.id) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${c.topSupplier.id}` });
      return {
        data,
        period: c.cur,
        comparison: { cur: c.cur, prev: c.prev, deltaIls: c.deltaIls, labels: [c.spanLabel, c.prevSpanLabel] },
        figures: figuresOf(data),
        links,
      };
    }
    case 'claimable_lines': {
      z.object({}).strict().parse(rawInput ?? {});
      const data = await claimableFor(ctx.db, ctx.restaurantId, ctx.locale ?? 'en');
      return {
        data,
        figures: figuresOf(data),
        links: [
          { screen: 'claims', href: '/dashboard/leaks/claims' },
          { screen: 'leaks', href: '/dashboard/leaks' },
          ...data.lines.map((l) => ({ screen: 'invoice' as const, href: `/dashboard/invoices/${l.invoiceId}` })),
        ],
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
