/**
 * Manager read tools (design §C.2): deliveries, order send status, supplier
 * confirmations. The manager also has the leak tools and the decision queue
 * (owner.ts, shared `roles`).
 */
import type { AgentTool } from '../registry';
import { count, name } from '../render';
import { arr, obj, PO_INPUT, PO_INPUT_JSON, procedureTool } from './common';

const SEND_STATE_HE: Record<string, string> = {
  queued: 'בתור לשליחה',
  sent: 'נשלחה',
  failed: 'השליחה נכשלה',
  draft: 'טיוטה',
};

export const orderSendStatus = procedureTool<{ poId: string }>({
  name: 'order_send_status',
  roles: ['manager'],
  source: 'orders.sendStatus',
  description: 'Whether an order (by poId) reached the supplier: queued, sent or failed, and by which channel.',
  input: PO_INPUT,
  inputJson: PO_INPUT_JSON,
  links: (i) => [`/dashboard/orders/${i.poId}`],
  facts: (d) => {
    const s = obj(d);
    return [`מצב שליחת ההזמנה: ${SEND_STATE_HE[String(s.state)] ?? name(s.state)}`];
  },
});

export const supplierConfirmResponses = procedureTool<{ poId: string }>({
  name: 'supplier_confirm_responses',
  roles: ['manager'],
  source: 'supplierConfirm.responses',
  description: "The supplier's answer to an order confirmation link (by poId): confirmed or changes, per line.",
  input: PO_INPUT,
  inputJson: PO_INPUT_JSON,
  post: (r) => {
    const o = obj(r);
    const resp = o.response ? obj(o.response) : null;
    return {
      answered: Boolean(resp),
      status: resp?.status ?? null,
      changedLines: resp
        ? arr(resp.lines)
            .filter((l) => l.qtyAvailable != null && l.qtyAvailable !== l.qtyOrdered)
            .slice(0, 10)
            .map((l) => ({ item: l.description, unit: l.unit, qtyOrdered: l.qtyOrdered, qtyAvailable: l.qtyAvailable }))
        : [],
    };
  },
  links: (i) => [`/dashboard/orders/${i.poId}`],
  facts: (d) => {
    const s = obj(d);
    if (!s.answered) return ['הספק עדיין לא ענה על אישור ההזמנה.'];
    if (s.status === 'confirmed') return ['הספק אישר את ההזמנה כפי שהיא.'];
    return [
      `הספק עדכן ${count(arr(s.changedLines).length)} שורות`,
      ...arr(s.changedLines)
        .slice(0, 3)
        .map((l) => `${name(l.item)}: ${count(l.qtyAvailable)} במקום ${count(l.qtyOrdered)}`),
    ];
  },
});

export const MANAGER_TOOLS: AgentTool[] = [orderSendStatus, supplierConfirmResponses];
