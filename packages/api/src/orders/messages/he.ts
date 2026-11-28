/**
 * W3-09 / AU-11 · Hebrew notices for the order autopilot (owner / manager / chef).
 * ₪-free by rule: no amount and no price ever appears here, even though the chef
 * may see ₪ on the orders screen. Wording follows GLOSSARY §1 ("בקשת זיכוי").
 */
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** 'YYYY-MM-DD' → "יום חמישי 29/10" (a slash, never "29.10": the ₪-free guard reads that as an amount). */
function heDay(orderDay: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(orderDay ?? '');
  if (!m) return 'מחר';
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `יום ${HE_DAYS[dow]} ${Number(m[3])}/${Number(m[2])}`;
}

export const ordersAutopilotHe = {
  preparedTitle: (supplier: string, items: number, cutoff: string | null) =>
    `טיוטה מוכנה ל${supplier} · ${items} פריטים${cutoff ? ` · השליחה עד ${cutoff}` : ''}`,
  // Names the order day, not "מחר": a capped row can be delivered on the order day itself.
  preparedTomorrowTitle: (supplier: string, items: number, cutoff: string | null, orderDay?: string) =>
    `טיוטה מוכנה ל${supplier} ל${heDay(orderDay)} · ${items} פריטים${cutoff ? ` · השליחה עד ${cutoff}` : ''}`,
  preparedCta: 'פתחו את הטיוטה',
  preparedDetailNote: 'הוכנה אוטומטית · בדקו כמויות לפני שליחה',
  preparedOpenBy: (name: string) => `פתוחה אצל ${name}`,
  backorderTitle: (supplier: string, missing: number) =>
    `חסרו ${missing} פריטים מ${supplier} · הכנו טיוטת השלמה`,
  backorderCta: 'פתחו',
  backorderNotes: (poRef: string) => `השלמה להזמנה #${poRef}`,
  backorderBilledInFull: (product: string) =>
    `${product}: לא נוסף · החשבונית כבר מחייבת את הכמות החסרה (בקשת זיכוי)`,
  backorderBilledInPart: (product: string) =>
    `${product}: הכמות הוקטנה · החשבונית כבר מחייבת חלק מהכמות החסרה (בקשת זיכוי)`,
  backorderInvoiceNotMatched: 'החשבונית עוד לא הותאמה · בדקו שהספק לא חייב על הכמות החסרה לפני שליחה',
  rescueTitle: (supplier: string) => `ההזמנה ל${supplier} לא נשלחה · שלחו מהוואטסאפ שלכם בלחיצה`,
  rescueCta: 'פתחו את ההזמנה',
} as const;
