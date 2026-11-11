import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  page: {
    title: 'Automations',
    subtitle: 'What runs for you, when and for whom. Every change is logged.',
    readOnly: 'Only the owner can switch these on or off. You can see their state.',
    forbiddenTitle: 'The ‘Automations’ screen is not open to your role',
    forbiddenAllowed: 'This screen is available to: {roles}.',
    back: 'Back to settings',
    adminTitle: 'Automations (read-only)',
    adminHint: 'What the owner sees. Flags change only in the features panel.',
  },
  row: {
    what: 'What it does',
    when: 'When',
    who: 'Who gets it',
    withIls: 'Includes ₪ amounts',
    noIls: 'No amounts',
    lastRun: 'Last run: {when}',
    neverRan: 'Has not run yet',
    notMeasured: 'Not measured yet',
    week: 'This week: {count}',
    on: 'On',
    off: 'Off',
    killed: 'Turned off by the system administrator',
    blocked: 'Inactive: needs the WhatsApp channel',
    always: 'Always on',
    adminOnly: 'Switched on by the RestoMatch team',
    switchLabel: '{name}: {state}',
  },
  confirm: {
    onTitle: 'Turn on ‘{name}’?',
    onBody: 'From now on {roles} will get this. The first one comes at the next slot: {when}. Nothing is sent for the past.',
    offTitle: 'Turn off ‘{name}’?',
    offBody: 'From now on {roles} will not get this. You can turn it back on at any time.',
    on: 'Turn on',
    off: 'Turn off',
    cancel: 'Cancel',
    saved: 'Saved',
    killedNote: 'Saved, but the system administrator has turned this off for everyone for now.',
  },
  items: {
    priceAlerts: {
      name: 'Price increase alert',
      what: 'A supplier raised a product price beyond the usual: an email with the product, supplier and change.',
      when: 'Every day at 07:00',
    },
    recovery: {
      name: 'Open credit request reminder',
      what: 'A credit request still open after 7 days: a reminder listing the suppliers.',
      when: 'Every day at 08:30',
    },
    monthlyReport: {
      name: 'Monthly report',
      what: 'Last month in summary: what was found, sent and returned.',
      when: 'On the 1st of each month at 07:45',
    },
    vatAtRisk: {
      name: 'VAT at risk',
      what: 'A dashboard card: tax invoices without an allocation number.',
      when: 'Shown on the dashboard, no messages',
    },
    orderReminders: {
      name: 'Supplier order reminder',
      what: "On a supplier's regular order day: a reminder to prepare the order.",
      when: 'Every day at 09:00',
    },
    supplierDelays: {
      name: 'Late delivery',
      what: 'An order that did not arrive on time: a message with the supplier and order number.',
      when: 'Every day at 10:00',
    },
    eveningDigest: {
      name: 'Evening summary',
      what: 'What arrived today, what was checked and what awaits a decision.',
      when: 'Every day at 19:00',
    },
    receiverBrief: {
      name: 'Morning brief for the receiver',
      what: 'Which deliveries are due today and what to check on receipt.',
      when: 'Every day at 06:00',
    },
    matchAlerts: {
      name: 'Invoice gap alert',
      what: 'An invoice was checked and a gap was found against the order or the agreed price.',
      when: 'As soon as an invoice is checked',
    },
    recoveryBookkeeper: {
      name: 'Credit requests to the bookkeeper too',
      what: 'The bookkeeper also gets the open credit request reminder.',
      when: 'Every day at 08:30',
    },
    chaseAcknowledged: {
      name: 'Gentle reminder to a supplier who agreed',
      what: 'A supplier agreed to a credit request but has not sent the credit invoice: a reminder draft is ready, you send it.',
      when: 'Every day at 08:30',
    },
    orderCapture: {
      name: 'Order capture from WhatsApp',
      what: 'An order sent on WhatsApp becomes a draft in the system.',
      when: 'When a message arrives',
    },
    priceCreepDigest: {
      name: 'Price increase summary',
      what: "All of yesterday's price increases in one email.",
      when: 'Every day at 07:00',
    },
    contractExpiry: {
      name: 'Agreed price about to end',
      what: 'An agreed supplier price that ends within 14 days.',
      when: 'Every day at 07:00',
    },
    priceListDiff: {
      name: 'Supplier price list changes',
      what: 'A new price list was loaded: what changed from the previous one.',
      when: 'Every day at 07:00',
    },
  },
};
