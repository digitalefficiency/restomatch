/**
 * Palette copy (he / en). Kept beside the component until a `messages/palette`
 * namespace is granted; the shape matches a messages module so the move is
 * mechanical.
 */
export const paletteCopy = {
  he: {
    label: 'חיפוש ופקודות',
    placeholder: 'לאן? חיפוש מסך, ספק, חשבונית, הזמנה…',
    placeholderScreens: 'לאן? חיפוש מסך…',
    sections: {
      waiting: 'מחכה לך',
      recents: 'אחרונים',
      screens: 'מסכים',
      records: 'רשומות',
      actions: 'פעולות',
      ask: 'שאלו',
    },
    ask: (q: string) => `שאלו: ${q}`,
    order: (supplier: string, ref: string | null) =>
      ref ? `הזמנה ${ref} · ${supplier}` : `הזמנה · ${supplier}`,
    noInvoiceNumber: 'חשבונית ללא מספר',
    searching: 'מחפש…',
    noResults: 'לא נמצא. נסו מילה אחרת.',
    error: 'החיפוש נכשל. נסו שוב.',
    footer: '↑↓ לניווט · Enter לפתיחה · Esc לסגירה · # מספר · @ ספק · > פעולה',
    close: 'סגירה',
    cheatTitle: 'קיצורי מקלדת',
    cheatGroups: { general: 'כללי', go: 'מעבר מהיר (G ואז אות)' },
    actions: {
      newOrder: 'הזמנה חדשה',
      receive: 'קבלת משלוח',
      approvals: 'החלטה על פערים',
      payRun: 'אישור ריצת תשלומים',
      claims: 'דרישות זיכוי לשליחה',
      newRecipe: 'מתכון חדש',
    },
  },
  en: {
    label: 'Search and commands',
    placeholder: 'Go to a screen, supplier, invoice, order…',
    placeholderScreens: 'Go to a screen…',
    sections: {
      waiting: 'Waiting for you',
      recents: 'Recent',
      screens: 'Screens',
      records: 'Records',
      actions: 'Actions',
      ask: 'Ask',
    },
    ask: (q: string) => `Ask: ${q}`,
    order: (supplier: string, ref: string | null) =>
      ref ? `Order ${ref} · ${supplier}` : `Order · ${supplier}`,
    noInvoiceNumber: 'Invoice without a number',
    searching: 'Searching…',
    noResults: 'Nothing found. Try another word.',
    error: 'Search failed. Try again.',
    footer: '↑↓ move · Enter open · Esc close · # number · @ supplier · > action',
    close: 'Close',
    cheatTitle: 'Keyboard shortcuts',
    cheatGroups: { general: 'General', go: 'Go to (G, then a letter)' },
    actions: {
      newOrder: 'New order',
      receive: 'Receive a delivery',
      approvals: 'Decide on discrepancies',
      payRun: 'Approve the pay run',
      claims: 'Credit claims to send',
      newRecipe: 'New recipe',
    },
  },
} as const;

export type PaletteCopy = (typeof paletteCopy)['he' | 'en'];
