/** W3-09 / AU-11 · English notices for the order autopilot. ₪-free (see he.ts). */
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** 'YYYY-MM-DD' → "Thursday 29/10" (see he.ts for the slash). */
function enDay(orderDay: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(orderDay ?? '');
  if (!m) return 'tomorrow';
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${EN_DAYS[dow]} ${Number(m[3])}/${Number(m[2])}`;
}

export const ordersAutopilotEn = {
  preparedTitle: (supplier: string, items: number, cutoff: string | null) =>
    `Draft ready for ${supplier} · ${items} items${cutoff ? ` · send by ${cutoff}` : ''}`,
  preparedTomorrowTitle: (supplier: string, items: number, cutoff: string | null, orderDay?: string) =>
    `Draft ready for ${supplier} for ${enDay(orderDay)} · ${items} items${cutoff ? ` · send by ${cutoff}` : ''}`,
  preparedCta: 'Open the draft',
  preparedDetailNote: 'Prepared automatically · check quantities before sending',
  preparedOpenBy: (name: string) => `Open with ${name}`,
  backorderTitle: (supplier: string, missing: number) =>
    `${missing} items were missing from ${supplier} · a follow-up draft is ready`,
  backorderCta: 'Open',
  backorderNotes: (poRef: string) => `Follow-up to order #${poRef}`,
  backorderBilledInFull: (product: string) =>
    `${product}: not added · the invoice already bills the missing quantity (credit request)`,
  backorderBilledInPart: (product: string) =>
    `${product}: reduced · the invoice already bills part of the missing quantity (credit request)`,
  backorderInvoiceNotMatched: 'The invoice is not matched yet · check the supplier did not bill the missing quantity before sending',
  rescueTitle: (supplier: string) => `The order to ${supplier} was not sent · send it from your own WhatsApp in one tap`,
  rescueCta: 'Open the order',
} as const;
