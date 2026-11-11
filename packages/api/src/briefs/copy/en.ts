import type { BriefCopy } from './types';

const days = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);
const hours = (n: number) => (n === 1 ? '1 hour' : `${n} hours`);
const lines = (n: number) => (n === 1 ? '1 line' : `${n} lines`);

/** English copy (glossary 7.11: "credit request", "no reply for 7+ days"). */
export const en: BriefCopy = {
  receiverMorning: {
    subject: (n) => (n === 1 ? 'Good morning · 1 delivery expected today' : `Good morning · ${n} deliveries expected today`),
    heading: "Today's deliveries",
    delivery: (s, t, l) => `${s} ${t ? `~${t}` : '(no time)'} (${lines(l)})`,
    lead: (n) => (n === 1 ? 'Good morning · 1 delivery expected today:' : `Good morning · ${n} deliveries expected today:`),
    cta: 'Open receiving',
  },
  evening: {
    subject: (n) => (n === 1 ? 'End of day · 1 thing is waiting for you' : `End of day · ${n} things are waiting for you`),
    heading: 'Waiting for you before tomorrow',
    awaiting: (n, ils, d) => `Waiting for your decision: ${n} · ${ils} · oldest ${days(d)}`,
    dueSoonHeld: (n) => `Invoices due within 2 days still on hold: ${n}`,
    openReceiptsToday: (n) => `Goods receipts still open from today: ${n}`,
    noReplyClaims: (n, ils) => `Credit requests with no reply for 7+ days: ${n} · ${ils}`,
    intake: (n, h) => `Documents waiting for review: ${n} · oldest ${hours(h)}`,
    open: 'Open',
  },
  lateTruck: {
    managerSubject: (s) => `The delivery from ${s} has not arrived`,
    managerLine: (s, ref, d, late, l) =>
      `Order ${ref} from ${s} was planned for ${d} and has not arrived (${days(late)}, ${lines(l)}).`,
    sendToSupplier: 'Message the supplier:',
    whatsapp: 'WhatsApp',
    email: 'Email',
    noContact: 'No supplier contact details · add them on the supplier card',
    openPo: 'View the order',
    supplierText: (s, ref, d, r) =>
      `שלום ${s}, ההזמנה ${ref} שתוכננה ל-${d} עדיין לא הגיעה. מתי צפוי המשלוח? תודה, ${r}`,
    supplierSubject: (ref) => `ההזמנה ${ref}: מתי צפוי המשלוח?`,
    receiverSubject: (s) => `The delivery from ${s} is late`,
    receiverLine: (s, d) => `The delivery from ${s} is late (planned for ${d}). The manager is following up with the supplier.`,
    receiverCta: 'Open receiving',
  },
  matchAlert: {
    subject: (n, s) => (n === 1 ? `A new gap on an invoice from ${s}` : `${n} new gaps on an invoice from ${s}`),
    line: (n, ref, s) => (n === 1 ? `A new gap was found on invoice ${ref} from ${s}.` : `${n} new gaps were found on invoice ${ref} from ${s}.`),
    ils: (ils) => `Credit you can request: ${ils}`,
    cta: 'Review the invoice',
  },
};
