import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Control room',
  subtitle: 'Where money is leaking — and what needs your decision right now.',
  loading: 'Loading',
  hero: {
    eyebrow: 'Leak detected · {month}',
    leakedLabel: 'Leaked this month',
    pctOfSpend: '{pct} of food spend',
    spendBase: 'out of {spend} before VAT',
    noSpend: 'No invoices yet this month',
    caught: 'Caught before payment',
    caughtHint: 'On invoices not paid yet — you can still hold payment or ask for a credit',
    recovered: 'Claimed from suppliers',
    recoveredHint: 'Discrepancies you approved to claim back',
    invoices: 'Invoices with a discrepancy',
    invoicesValue: '{withLeak} of {total}',
    drill: 'What is behind this number',
    pending: '{count} invoices ({amount}) are waiting to be linked to an order — probably consolidated invoices. They are counted in neither the leak nor the spend.',
    lastMonth: 'Last month: {amount}',
    target: 'Target: 1.5% of spend',
    clean: 'No leak this month — every matched invoice agrees with its order and goods receipt.',
    calc: 'Warning- and blocker-level discrepancies, capped at each invoice total. Excludes lower-than-expected prices and invoices with no order.',
  },
  kpis: {
    pending: 'Waiting for approval',
    pendingHint: 'Discrepancies in the queue — owner, manager, bookkeeping',
    clean: 'Clean matches this week',
    cleanHint: 'Average of the last seven days',
  },
  leaks: {
    title: 'Price creep · last 30 days',
    subtitle: "Products you paid above their usual price for. A separate, rolling measure — not part of this month's leak above.",
    all: 'All leaks',
    upsell: 'Upgrade to unlock the leak detective',
  },
  activity: {
    title: 'Recent activity',
    subtitle: 'What happened in the system lately.',
    emptyTitle: 'No activity yet',
    emptyDescription: 'Once you receive invoices and handle discrepancies, the log fills up here.',
  },
};
