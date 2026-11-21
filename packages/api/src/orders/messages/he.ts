/**
 * W3-09 / AU-11 · Hebrew notices for the order autopilot (owner / manager / chef).
 * ₪-free by rule: no amount and no price ever appears here, even though the chef
 * may see ₪ on the orders screen. Wording follows GLOSSARY §1 ("בקשת זיכוי").
 */
export const ordersAutopilotHe = {
  preparedTitle: (supplier: string, items: number, cutoff: string | null) =>
    `טיוטה מוכנה ל${supplier} · ${items} פריטים${cutoff ? ` · השליחה עד ${cutoff}` : ''}`,
  preparedTomorrowTitle: (supplier: string, items: number, cutoff: string | null) =>
    `טיוטה מוכנה למחר ל${supplier} · ${items} פריטים${cutoff ? ` · השליחה עד ${cutoff}` : ''}`,
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
