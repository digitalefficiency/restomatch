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
        .map((s) => ({ supplier: s.supplierName, payIls: s.payIls, holdIls: s.holdIls, claimIls: s.claimIls, invoiceCount: arr(s.invoices).length })),
    };
  },
  links: () => ['/dashboard/approvals/pay-run'],
  facts: (d) => {
    const p = obj(d);
    if (!p.enabled) return ['ריצת התשלומים אינה פעילה במסעדה הזו.'];
    const t = obj(p.totals);
    return [
      `${count(t.invoices)} חשבוניות החודש`,
      `לתשלום: ${money(t.payIls)}`,
      `בהמתנה: ${money(t.holdIls)}`,
      `לבקשת זיכוי: ${money(t.claimIls)}`,
    ];
  },
});

export const BOOKKEEPER_TOOLS: AgentTool[] = [payRunMonth];
