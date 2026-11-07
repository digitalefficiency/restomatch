/**
 * Receiver read tools (design §C.2): today's deliveries and one delivery's
 * lines. NO ₪ ANYWHERE: the receiver profile in redact.ts deletes every money
 * key and every ₪ string before the model or these renderers see the data
 * (`receiving.getPo` returns `totalEstimated` and line prices to any member;
 * tier middleware is not redaction).
 */
import { z } from 'zod';
import type { AgentTool } from '../registry';
import { count, name, qty } from '../render';
import { arr, obj, PO_INPUT, PO_INPUT_JSON, procedureTool } from './common';

const RECEIPT_HE: Record<string, string> = {
  open: 'בקבלה',
  in_progress: 'בקבלה',
  submitted: 'התקבלה',
  closed: 'התקבלה',
};

export const todayDeliveries = procedureTool<{ includeLate?: boolean }>({
  name: 'today_deliveries',
  roles: ['manager', 'receiver'],
  source: 'receiving.todayExpectations',
  description: "Deliveries expected today (and, optionally, late ones from the last week): supplier, expected time, line count, receipt status. Each has a poId.",
  input: z.object({ includeLate: z.boolean().optional() }).strict(),
  inputJson: {
    type: 'object',
    properties: { includeLate: { type: 'boolean', description: 'Also late deliveries of the last week.' } },
    additionalProperties: false,
  },
  // Allow-list (not only the strip): the receiver's model sees these fields and nothing else.
  post: (rows) =>
    arr(rows).map((r) => ({
      poId: r.poId,
      supplierName: r.supplierName,
      expectedAt: r.expectedAt,
      lineCount: r.lineCount,
      status: r.status,
      receiptStatus: r.receiptStatus,
    })),
  links: () => ['/dashboard/receiving'],
  facts: (d) => {
    const rows = arr(d);
    if (rows.length === 0) return ['אין משלוחים צפויים היום.'];
    return [
      `${count(rows.length)} משלוחים צפויים`,
      ...rows.slice(0, 4).map((r) => `${name(r.supplierName)} · ${count(r.lineCount)} שורות${r.receiptStatus ? ` · ${RECEIPT_HE[String(r.receiptStatus)] ?? name(r.receiptStatus)}` : ''}`),
    ];
  },
});

export const deliveryDetail = procedureTool<{ poId: string }>({
  name: 'delivery_detail',
  roles: ['receiver'],
  source: 'receiving.getPo',
  description: 'One expected delivery (by poId): supplier, expected time and the lines with quantities and units.',
  input: PO_INPUT,
  inputJson: PO_INPUT_JSON,
  // Allow-list: no notes, SKUs or prices (free text can carry a price in any spelling).
  post: (r) => {
    const o = obj(r);
    const po = obj(o.po);
    return {
      poId: po.id,
      supplierName: po.supplierName,
      expectedAt: po.expectedAt,
      status: po.status,
      lines: arr(o.lines).map((l) => ({ rawDescription: l.rawDescription, qtyOrdered: l.qtyOrdered, unit: l.unit })),
    };
  },
  links: (i) => [`/dashboard/receiving/${i.poId}`],
  facts: (d) => {
    const o = obj(d);
    const lines = arr(o.lines);
    return [
      `משלוח מ${name(o.supplierName)} · ${count(lines.length)} שורות`,
      ...lines.slice(0, 5).map((l) => `${name(l.rawDescription)}: ${qty(l.qtyOrdered)} ${name(l.unit, '')}`),
    ];
  },
});

export const RECEIVER_TOOLS: AgentTool[] = [todayDeliveries, deliveryDetail];
