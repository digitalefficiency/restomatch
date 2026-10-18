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
import {
  computeLeakBreakdown,
  computeLeakHero,
  computeLeakReport,
  type LeakBreakdownInvoice,
  type LeakHero,
  type LeakReport,
} from '@restomatch/charts';
import type { Database } from '@restomatch/db';
import { z } from 'zod';

export type ToolName = 'leak_hero' | 'leak_report' | 'leak_breakdown' | 'claimable_lines';

/** A screen the answer may link to (validated allow-list, built only here). */
export interface ScreenLink {
  href: string;
  /** Stable label key; the web renders it in the user's language. */
  screen: 'overview' | 'leaks' | 'report' | 'breakdown' | 'claims' | 'invoice' | 'supplier';
}

export interface ToolOutput {
  data: unknown;
  links: ScreenLink[];
  /** Every ₪ / % figure in `data` (for the grounding check). */
  numbers: number[];
}

/** 'YYYY-MM' of `offset` months from now in Israel time. */
export function monthKey(offset = 0, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const idx = y * 12 + (m - 1) + offset;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Monthly offset (0, -1, …) of a 'YYYY-MM' relative to now; null when out of range. */
function offsetOf(month: string, now: Date): number | null {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const [cy, cm] = monthKey(0, now).split('-').map(Number) as [number, number];
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

export function reportData(r: LeakReport) {
  return {
    month: r.month,
    hero: heroData(r.hero),
    byType: r.byType.slice(0, 8).map((t) => ({ type: t.type, count: t.count, amountIls: r2(t.amountIls) })),
    bySupplier: r.bySupplier.slice(0, 8).map((s) => ({
      supplierId: s.supplierId,
      supplier: clip(s.supplierNameEn ?? s.supplierName),
      invoiceCount: s.invoiceCount,
      spendIls: r2(s.spendIls),
      leakIls: r2(s.leakIls),
      leakPctOfSpend: pct(s.leakPct),
    })),
    priceIncreases: r.priceCreep.slice(0, 8).map((p) => ({
      product: clip(p.productNameEn ?? p.productName),
      supplier: clip(p.supplierNameEn ?? p.supplierName),
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

/** Open, leak-counting discrepancy lines (what can still be claimed), biggest first. */
export function claimableData(invoices: LeakBreakdownInvoice[]) {
  const lines = invoices.flatMap((inv) =>
    inv.lines
      .filter((l) => l.countsAsLeak && (l.resolutionStatus === 'open' || l.resolutionStatus === 'escalated'))
      .map((l) => ({
        invoiceId: inv.invoiceId,
        invoiceNumber: clip(inv.invoiceNumber, 30),
        supplier: clip(inv.supplierNameEn ?? inv.supplierName),
        type: l.type,
        item: clip(l.productNameEn ?? l.lineDescriptionEn ?? l.productName ?? l.lineDescription),
        amountIls: r2(Math.abs(l.deltaAmount)),
      })),
  );
  lines.sort((a, b) => b.amountIls - a.amountIls);
  return { totalIls: r2(lines.reduce((s, l) => s + l.amountIls, 0)), count: lines.length, lines: lines.slice(0, 15) };
}

function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

const MonthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict();
const BreakdownInput = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  })
  .strict();

const MONTH_PROP = { type: 'string', description: "Calendar month 'YYYY-MM' (Israel time). Omit for the current month." };

/** Tool definitions sent to Claude (strict JSON schemas, read-only). */
export const TOOL_DEFINITIONS = [
  {
    name: 'leak_hero',
    description:
      "The restaurant's headline leak for a month: leaked ₪, % of checked food spend, ₪ caught before payment, ₪ recovered, invoice counts. Use it to compare months.",
    input_schema: { type: 'object', properties: { month: MONTH_PROP }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'leak_report',
    description:
      'The monthly leak report: the leak split by discrepancy type and by supplier (spend, leak, leak %), the products whose unit price rose vs the 90 days before (before/after price, % change, excess ₪), and what happened to the leak (open / claimed / waived).',
    input_schema: { type: 'object', properties: { month: MONTH_PROP }, additionalProperties: false },
    strict: true,
  },
  {
    name: 'leak_breakdown',
    description: "The invoices behind a month's leak, biggest first, with their discrepancy lines.",
    input_schema: {
      type: 'object',
      properties: { month: MONTH_PROP, limit: { type: 'integer', description: '1–30, default 10' } },
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'claimable_lines',
    description:
      'Discrepancy lines still open (not yet claimed or waived) that count toward the leak, across this and last month — i.e. what can be claimed back from suppliers now, biggest first, with the total.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
] as const;

export interface ToolContext {
  db: Database;
  restaurantId: string;
  now?: Date;
}

/** Execute one tool. Throws on invalid input (the loop returns it as an is_error tool_result). */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const now = ctx.now ?? new Date();
  switch (name as ToolName) {
    case 'leak_hero': {
      const input = MonthInput.parse(rawInput ?? {});
      const offset = input.month ? offsetOf(input.month, now) : 0;
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const hero = await computeLeakHero(ctx.db, ctx.restaurantId, { monthOffset: offset, now });
      const data = heroData(hero);
      return {
        data,
        numbers: numbersIn(data),
        links: [
          { screen: 'overview', href: '/dashboard' },
          { screen: 'breakdown', href: `/dashboard/leaks/breakdown?m=${offset}` },
        ],
      };
    }
    case 'leak_report': {
      const input = MonthInput.parse(rawInput ?? {});
      const month = input.month ?? monthKey(0, now);
      if (offsetOf(month, now) === null) throw new Error('month out of range (last 24 months only)');
      const data = reportData(await computeLeakReport(ctx.db, ctx.restaurantId, month));
      const links: ScreenLink[] = [{ screen: 'report', href: `/dashboard/leaks/report?month=${month}` }];
      for (const s of data.bySupplier) {
        if (s.supplierId) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${s.supplierId}` });
      }
      return { data, numbers: numbersIn(data), links };
    }
    case 'leak_breakdown': {
      const input = BreakdownInput.parse(rawInput ?? {});
      const offset = input.month ? offsetOf(input.month, now) : 0;
      if (offset === null) throw new Error('month out of range (last 24 months only)');
      const rows = await computeLeakBreakdown(ctx.db, ctx.restaurantId, {
        monthOffset: offset,
        limit: input.limit ?? 10,
        now,
      });
      const data = rows.map((inv) => ({
        invoiceId: inv.invoiceId,
        invoiceNumber: clip(inv.invoiceNumber, 30),
        invoiceDate: inv.invoiceDate,
        supplier: clip(inv.supplierNameEn ?? inv.supplierName),
        totalInclVatIls: r2(inv.totalInclVat),
        leakIls: r2(inv.leakIls),
        pendingLink: inv.pendingLink,
        lines: inv.lines.slice(0, 6).map((l) => ({
          type: l.type,
          status: l.resolutionStatus,
          item: clip(l.productNameEn ?? l.lineDescriptionEn ?? l.productName ?? l.lineDescription),
          deltaIls: r2(l.deltaAmount),
          countsAsLeak: l.countsAsLeak,
        })),
      }));
      return {
        data,
        numbers: numbersIn(data),
        links: [
          { screen: 'breakdown', href: `/dashboard/leaks/breakdown?m=${offset}` },
          ...data.map((d) => ({ screen: 'invoice' as const, href: `/dashboard/invoices/${d.invoiceId}` })),
        ],
      };
    }
    case 'claimable_lines': {
      z.object({}).strict().parse(rawInput ?? {});
      const [cur, prev] = await Promise.all([
        computeLeakBreakdown(ctx.db, ctx.restaurantId, { monthOffset: 0, limit: 100, now }),
        computeLeakBreakdown(ctx.db, ctx.restaurantId, { monthOffset: -1, limit: 100, now }),
      ]);
      const data = claimableData([...cur, ...prev]);
      return {
        data,
        numbers: numbersIn(data),
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
