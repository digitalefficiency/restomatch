/**
 * 'receiverLangs' namespace (Hebrew — source of truth).
 * Owner: S14 wave 1 — receiver languages (ar/ru/th/ti): the language picker and
 * the receiver's line-name hints. The ar/ru/th/ti overlays of the receiver
 * namespaces (receiving, scans, nav, components, auth.login…) live in ./overlays.
 */
export const he = {
  picker: {
    label: 'שפה',
    title: 'בחירת שפת הממשק',
    hint: 'שפות למקבלי סחורה: ערבית, רוסית, תאילנדית, תיגרינית. מסכים אחרים יוצגו באנגלית.',
  },
  lines: {
    original: 'במקור',
    machine: 'תרגום אוטומטי — בדקו מול החשבונית',
    untranslated: 'אין תרגום — מוצג בשפת המקור',
  },
};
