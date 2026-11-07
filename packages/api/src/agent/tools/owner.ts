/**
 * Owner read tools (design §C.2): leak (Ask's tools), decisions, claims, VAT.
 * Several are shared with the manager / bookkeeper (see each `roles`).
 * Data here is redacted before `facts`/`links` run; owner/manager/bookkeeper
 * see ₪ (profile `none`).
 */
import { computeLeakBreakdown } from '@restomatch/charts';
import { and, eq, suppliers } from '@restomatch/db';
import { z } from 'zod';
import { HE } from '../copy/he';
import { money, moneyAgorot, count, name, qty } from '../render';
import type { AgentTool } from '../registry';
import { arr, dropMissingOnInvoice, MONTH, MONTH_JSON, NO_INPUT, NO_INPUT_JSON, num, obj, procedureTool, runAskTool } from './common';

const LEAK_ROLES = ['owner', 'manager'] as const;
const MonthIn = z.object({ month: MONTH.optional() }).strict();
const MonthInJson = { type: 'object', properties: { month: MONTH_JSON }, additionalProperties: false };

export const leakHero: AgentTool<z.infer<typeof MonthIn>> = {
  name: 'leak_hero',
  roles: LEAK_ROLES,
  source: 'ask.leak_hero',
  kind: 'read',
  description: "The restaurant's headline leak for a month: leaked ₪, % of checked spend, ₪ caught before payment, ₪ recovered, invoice counts.",
  input: MonthIn,
  inputJson: MonthInJson,
  run: (ctx, input) => runAskTool(ctx, 'leak_hero', input),
  facts: (d) => {
    const h = obj(d);
    if (!('leakIls' in h)) return [];
    const out = [`הדליפה בחודש ${name(h.month)}: ${money(h.leakIls)}${num(h.leakPctOfSpend) != null ? ` (${qty(h.leakPctOfSpend)}% מההוצאה שנבדקה)` : ''}`];
    if (num(h.caughtBeforePaymentIls)) out.push(`נתפס לפני תשלום: ${money(h.caughtBeforePaymentIls)}`);
    if (num(h.recoveredIls)) out.push(`הוחזר: ${money(h.recoveredIls)}`);
    return out;
  },
};

export const leakReport: AgentTool<z.infer<typeof MonthIn>> = {
  name: 'leak_report',
  roles: LEAK_ROLES,
  source: 'ask.leak_report',
  kind: 'read',
  description: 'The monthly leak report: leak by discrepancy type and by supplier, products whose price rose, and what happened to the leak (open / claimed / waived).',
  input: MonthIn,
  inputJson: MonthInJson,
  run: (ctx, input) => runAskTool(ctx, 'leak_report', input),
  facts: (d) => {
    const r = obj(d);
    const top = arr(r.bySupplier).filter((s) => num(s.leakIls)).slice(0, 3);
    const out = top.map((s) => `${name(s.supplier)}: ${money(s.leakIls)}`);
    const st = obj(r.status);
    if (num(st.stillOpenIls)) out.push(`עדיין פתוח: ${money(st.stillOpenIls)} (${count(st.stillOpenCount)} שורות)`);
    return out;
  },
};

const BreakdownIn = z.object({ month: MONTH.optional(), limit: z.number().int().min(1).max(10).optional() }).strict();
export const leakBreakdown: AgentTool<z.infer<typeof BreakdownIn>> = {
  name: 'leak_breakdown',
  roles: LEAK_ROLES,
  source: 'ask.leak_breakdown',
  kind: 'read',
  description: "The invoices behind a month's leak, biggest first, with their discrepancy lines.",
  input: BreakdownIn,
  inputJson: {
    type: 'object',
    properties: { month: MONTH_JSON, limit: { type: 'integer', description: '1–10, default 5' } },
    additionalProperties: false,
  },
  run: (ctx, input) => runAskTool(ctx, 'leak_breakdown', { ...input, limit: input.limit ?? 5 }),
  facts: (d) =>
    arr(d)
      .filter((i) => num(i.leakIls))
      .slice(0, 3)
      .map((i) => `${name(i.supplier)} · חשבונית ${name(i.invoiceNumber)}: ${money(i.leakIls)}`),
};

export const claimableLines: AgentTool<Record<string, never>> = {
  name: 'claimable_lines',
  roles: LEAK_ROLES,
  source: 'ask.claimable_lines',
  kind: 'read',
  description: 'Discrepancy lines still open (not yet claimed or waived) that can go into a credit request to suppliers now, biggest first, with the total.',
  input: NO_INPUT,
  inputJson: NO_INPUT_JSON,
  run: (ctx, input) => runAskTool(ctx, 'claimable_lines', input),
  facts: (d) => {
    const c = obj(d);
    if (!num(c.count)) return ['אין שורות פתוחות לבקשת זיכוי.'];
    return [`אפשר לבקש זיכוי על ${count(c.count)} שורות, סך ${money(c.totalIls)}`];
  },
};

/** Loose Hebrew/Latin name key: niqqud, quotes, punctuation and case out (interim for W3-04a normalizeHe). */
export function nameKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`״׳.,\-_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SupplierIn = z.object({ supplier: z.string().trim().min(1).max(80) }).strict();
/**
 * The open leak toward ONE supplier this month, MISSING_ON_INVOICE excluded
 * (never claimable, never leak), summed in integer agorot. The supplier is
 * resolved by name inside the binding's tenant only (RLS + the restaurant
 * filter): another restaurant's supplier is "not found".
 */
export const supplierLeak: AgentTool<z.infer<typeof SupplierIn>> = {
  name: 'supplier_leak',
  roles: LEAK_ROLES,
  source: 'ask.supplier_leak',
  kind: 'read',
  description: "This month's open leak toward one supplier, by the supplier's name as the person wrote it.",
  input: SupplierIn,
  inputJson: {
    type: 'object',
    properties: { supplier: { type: 'string', description: "The supplier's name as written in the question." } },
    required: ['supplier'],
    additionalProperties: false,
  },
  async run(ctx, input) {
    return ctx.tx(async (tx) => {
      const rid = ctx.binding.restaurantId;
      const rows = await tx
        .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn })
        .from(suppliers)
        .where(and(eq(suppliers.restaurantId, rid)));
      const want = nameKey(input.supplier);
      const exact = rows.filter((r) => nameKey(r.name) === want || (r.nameEn && nameKey(r.nameEn) === want));
      // Partial match only on keys of ≥3 chars both ways, and only when it is unambiguous.
      const partial = want.length >= 3
        ? rows.filter((r) => {
            const k = nameKey(r.name);
            return k.length >= 3 && (k.includes(want) || want.includes(k));
          })
        : [];
      const candidates = exact.length ? exact : partial;
      const match = candidates.length === 1 ? candidates[0] : undefined;
      if (!match) return { data: { found: false } };
      const invoices = dropMissingOnInvoice(await computeLeakBreakdown(tx, rid, { monthOffset: 0, limit: 200, now: ctx.now }));
      let agorot = 0;
      let lines = 0;
      for (const inv of invoices) {
        if (inv.supplierName !== match.name) continue;
        for (const l of inv.lines) {
          if (!l.countsAsLeak || l.type === 'MISSING_ON_INVOICE') continue;
          agorot += Math.abs(Math.round(Number(l.deltaAmount) * 100));
          lines += 1;
        }
      }
      return {
        data: { found: true, supplierId: match.id, supplier: match.name, openLeakIls: agorot / 100, openLeakAgorot: agorot, lineCount: lines },
        links: [`/dashboard/suppliers/${match.id}`, '/dashboard/leaks'],
      };
    });
  },
  facts: (d) => {
    const s = obj(d);
    if (!s.found) return [HE.supplierNotFound];
    if (!num(s.openLeakAgorot)) return [HE.noSupplierLeak(name(s.supplier))];
    return [HE.supplierLeak(name(s.supplier), moneyAgorot(num(s.openLeakAgorot)!), num(s.lineCount) ?? 0)];
  },
  verdict: (d) => {
    const s = obj(d);
    if (!s.found) return HE.supplierNotFound;
    if (s.found && 'openLeakAgorot' in s && !num(s.openLeakAgorot)) return HE.noSupplierLeak(name(s.supplier));
    return null;
  },
};

export const approvalsQueue = procedureTool<{ limit?: number }>({
  name: 'approvals_queue',
  roles: ['owner', 'manager', 'bookkeeper'],
  source: 'approvals.myQueue',
  description: 'The decisions waiting for this person (supplier gaps to approve or reject), most urgent first.',
  input: z.object({ limit: z.number().int().min(1).max(10).optional() }).strict(),
  inputJson: { type: 'object', properties: { limit: { type: 'integer', description: '1–10, default 5' } }, additionalProperties: false },
  toInput: (i) => ({ limit: i.limit ?? 5 }),
  post: (rows) =>
    arr(rows).map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      supplier: r.supplierName,
      product: r.productName,
      invoiceNumber: r.invoiceNumber,
      deltaIls: num(r.deltaAmount),
    })),
  links: () => ['/dashboard/approvals'],
  facts: (d) => {
    const rows = arr(d);
    if (rows.length === 0) return ['אין החלטות שמחכות לך.'];
    return [
      `${count(rows.length)} החלטות מחכות לך`,
      ...rows.slice(0, 3).map((r) => `${name(r.supplier)} · ${name(r.product)}${num(r.deltaIls) != null ? `: ${money(Math.abs(num(r.deltaIls)!))}` : ''}`),
    ];
  },
});

export const approvalsSummary = procedureTool<Record<string, never>>({
  name: 'approvals_summary',
  roles: ['owner'],
  source: 'approvals.queueSummary',
  description: 'A summary of the decision queue: how many wait, how many block payment, and the ₪ involved, including other roles.',
  input: NO_INPUT,
  inputJson: NO_INPUT_JSON,
  toInput: () => undefined,
  links: () => ['/dashboard/approvals'],
  facts: (d) => {
    const s = obj(d);
    if (!num(s.count)) return ['אין החלטות שמחכות.'];
    const out = [`${count(s.count)} החלטות מחכות, ${count(s.blockers)} מהן חוסמות תשלום`];
    if (num(obj(s.toDecide).amountIls)) out.push(`להחלטה: ${money(obj(s.toDecide).amountIls)}`);
    return out;
  },
});

export const recoveryClaims = procedureTool<{ limit?: number }>({
  name: 'recovery_claims',
  roles: ['owner', 'bookkeeper'],
  source: 'recovery.list',
  description: 'Credit requests to suppliers and their status (drafted, sent, credited), with outstanding ₪.',
  input: z.object({ limit: z.number().int().min(1).max(10).optional() }).strict(),
  inputJson: { type: 'object', properties: { limit: { type: 'integer', description: '1–10, default 5' } }, additionalProperties: false },
  toInput: (i) => ({ limit: i.limit ?? 5 }),
  post: (rows) =>
    arr(rows).map((r) => ({
      id: r.id,
      status: r.status,
      supplier: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      amountIls: num(r.amountAgorot) != null ? num(r.amountAgorot)! / 100 : null,
      outstandingIls: num(r.outstandingAgorot) != null ? num(r.outstandingAgorot)! / 100 : null,
    })),
  links: () => ['/dashboard/recovery'],
  facts: (d) => {
    const rows = arr(d);
    if (rows.length === 0) return ['אין בקשות זיכוי פתוחות.'];
    return rows.slice(0, 3).map((r) => `${name(r.supplier)} · חשבונית ${name(r.invoiceNumber)}: ${money(r.outstandingIls ?? r.amountIls)}`);
  },
});

export const vatAtRisk = procedureTool<Record<string, never>>({
  name: 'vat_at_risk',
  roles: ['owner', 'bookkeeper'],
  source: 'owner.vatAtRisk',
  description: 'Open invoices whose VAT cannot be deducted yet (no allocation number), with the VAT at risk.',
  input: NO_INPUT,
  inputJson: NO_INPUT_JSON,
  toInput: () => ({ period: 'open' }),
  post: (r) => {
    const o = obj(r);
    return {
      count: o.count,
      totalVatAtRiskIls: num(o.totalVatAtRisk),
      rows: arr(o.rows).slice(0, 5).map((x) => ({ supplier: x.supplierName, invoiceNumber: x.invoiceNumber, invoiceDate: x.invoiceDate, vatAtRiskIls: num(x.vatAtRisk) })),
    };
  },
  links: () => ['/dashboard'],
  facts: (d) => {
    const v = obj(d);
    if (!num(v.count)) return ['אין חשבוניות עם מע"מ בסיכון.'];
    return [`${count(v.count)} חשבוניות עם מע"מ בסיכון, סך ${money(v.totalVatAtRiskIls)}`];
  },
});

export const OWNER_TOOLS: AgentTool[] = [
  leakHero,
  leakReport,
  leakBreakdown,
  claimableLines,
  supplierLeak,
  approvalsQueue,
  approvalsSummary,
  recoveryClaims,
  vatAtRisk,
];
