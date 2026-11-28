/**
 * Bookkeeper read tools (design §C.2): the pay run. The bookkeeper also has
 * the decision queue, VAT at risk and credit requests (owner.ts).
 */
import type { AgentTool } from '../registry';
import { count, money } from '../render';
import { arr, obj, procedureTool } from './common';
import { z } from 'zod';

export const payRunMonth = procedureTool<{ previous?: boolean }>({
  name: 'pay_run_month',
  roles: ['bookkeeper'],
  source: 'payRun.month',
  description: "This month's (or last month's) pay run: what to pay, what to hold, and what to claim, per supplier.",
  input: z.object({ previous: z.boolean().optional() }).strict(),
  inputJson: {
    type: 'object',
    properties: { previous: { type: 'boolean', description: 'true = last month' } },
    additionalProperties: false,
  },
  toInput: (i) => ({ monthOffset: i.previous ? -1 : 0 }),
  post: (r) => {
    const o = obj(r);
    return {
      enabled: o.enabled,
      totals: o.totals,
      suppliers: arr(o.suppliers)
        .slice(0, 8)
        .map((s) => ({
          supplier: s.supplierName,
          // What the pay-run page lets you pay: pay + claim (a credit still asked for doesn't stop it).
          payableIls: Math.round(((Number(s.payIls) || 0) + (Number(s.claimIls) || 0)) * 100) / 100,
          holdIls: s.holdIls,
          creditIls: s.creditIls,
          invoiceCount: arr(s.invoices).length,
        })),
    };
  },
  // The page these figures are: the pay run filtered to the same invoice month.
  links: (i) => [i.previous ? '/dashboard/approvals/pay-run?m=-1' : '/dashboard/approvals/pay-run?m=0'],
  facts: (d, i) => {
    const p = obj(d);
    if (!p.enabled) return ['ריצת התשלומים אינה פעילה במסעדה הזו.'];
    const t = obj(p.totals);
    const month = i?.previous ? 'בחודש שעבר' : 'החודש';
    const lines = [
      `${count(t.invoices)} חשבוניות ${month}`,
      // Same words and figures as the pay-run page (payRun.list totals for this month).
      `ניתן לשלם: ${money(t.payableIls)}`,
      `בהמתנה: ${money(t.holdIls)} (בלי חשבוניות שממתינות לקישור להזמנה)`,
      `זיכוי לבקש: ${money(t.creditIls)}`,
    ];
    if ((Number(t.linkCount) || 0) > 0) lines.push(`ממתינות לקישור להזמנה: ${count(t.linkCount)} · ${money(t.linkIls)}`);
    return lines;
  },
});

export const BOOKKEEPER_TOOLS: AgentTool[] = [payRunMonth];
