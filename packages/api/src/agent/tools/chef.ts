/**
 * Chef read tools (design §C.2): own-restaurant orders. The chef's ₪ comes
 * ONLY from `orders.*` (and later recipe) procedures: redact.ts exempts those
 * sources and strips money from everything else. No leak, decision or claim
 * tool is in the chef's list.
 */
import { z } from 'zod';
import type { AgentTool } from '../registry';
import { count, money, name } from '../render';
import { arr, num, obj, PO_INPUT, PO_INPUT_JSON, procedureTool } from './common';

const STATUS_HE: Record<string, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  confirmed: 'אושרה',
  partial: 'התקבלה חלקית',
  closed: 'סגורה',
  cancelled: 'בוטלה',
};

export const ordersList = procedureTool<{ status?: string }>({
  name: 'orders_list',
  roles: ['chef'],
  source: 'orders.list',
  description: "The restaurant's recent orders to suppliers (open by default), with status and estimated total.",
  input: z.object({ status: z.enum(['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled']).optional() }).strict(),
  inputJson: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled'] } },
    additionalProperties: false,
  },
  toInput: (i) => ({ ...i, limit: 10 }),
  post: (rows) =>
    arr(rows).map((r) => ({
      poId: r.id,
      supplier: r.supplierName,
      status: r.status,
      expectedAt: r.expectedDeliveryAt ?? null,
      totalEstimatedIls: num(r.totalEstimated),
    })),
  links: () => ['/dashboard/orders'],
  facts: (d) => {
    const rows = arr(d);
    if (rows.length === 0) return ['אין הזמנות פתוחות.'];
    return rows
      .slice(0, 4)
      .map((r) => `${name(r.supplier)} · ${STATUS_HE[String(r.status)] ?? name(r.status)}${num(r.totalEstimatedIls) != null ? `: ${money(r.totalEstimatedIls)}` : ''}`);
  },
});

export const orderDetail = procedureTool<{ poId: string }>({
  name: 'order_detail',
  roles: ['chef'],
  source: 'orders.get',
  description: 'One order (by poId): supplier, status and lines with quantities and prices.',
  input: PO_INPUT,
  inputJson: PO_INPUT_JSON,
  post: (r) => {
    const o = obj(r);
    const po = obj(o.po);
    return {
      poId: po.id,
      supplier: o.supplierName,
      status: po.status,
      totalEstimatedIls: num(po.totalEstimated),
      lines: arr(o.lines)
        .slice(0, 20)
        .map((l) => ({ item: l.rawDescription ?? null, qty: num(l.qtyOrdered), unit: l.unit ?? null, unitPrice: num(l.unitPriceExpected) })),
    };
  },
  links: (i) => [`/dashboard/orders/${i.poId}`],
  facts: (d) => {
    const o = obj(d);
    const out = [`הזמנה מ${name(o.supplier)} · ${STATUS_HE[String(o.status)] ?? name(o.status)}`];
    if (num(o.totalEstimatedIls) != null) out.push(`סך משוער: ${money(o.totalEstimatedIls)}`);
    out.push(`${count(arr(o.lines).length)} שורות`);
    return out;
  },
});

export const CHEF_TOOLS: AgentTool[] = [ordersList, orderDetail];
