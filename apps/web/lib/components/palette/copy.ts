/**
 * Palette copy (he / en). TODO(W3-08): move to `messages/palette` (W3-08 owns
 * `messages/index.ts`). The shape matches a messages module so the move is
 * mechanical. Vocabulary per W2-13: "פער" for an undecided gap, "דליפה" only
 * for the monthly leak.
 *
 * `{q}` marks where the typed query goes: the palette renders it as text in its
 * own `<bdi>` (never as HTML), so a Latin or numeric query keeps its order
 * inside the Hebrew sentence. The zero-result and footer lines are the
 * sidebar spec's §1.6 copy, verbatim.
 */
export const paletteCopy = {
  he: {
    label: 'חיפוש ופקודות',
    placeholder: 'לאן? חיפוש מסך, ספק, חשבונית, הזמנה…',
    placeholderScreens: 'לאן? חיפוש מסך…',
    sections: {
      waiting: 'מחכה לך',
      recents: 'אחרונים',
      screens: 'מעבר אל',
      records: 'רשומות',
      actions: 'פעולות',
      display: 'תצוגה',
      settings: 'הגדרות',
      ask: 'שאלו',
    },
    ask: (q: string) => `שאלו: ${q}`,
    order: (supplier: string, ref: string | null) =>
      ref ? `הזמנה ${ref} · ${supplier}` : `הזמנה · ${supplier}`,
    noInvoiceNumber: 'חשבונית ללא מספר',
    searching: 'מחפש…',
    noResults: 'אין תוצאות ל„{q}". נסו שם ספק, מספר חשבונית או מסך.',
    /** For a role whose palette finds screens only (no records to suggest). */
    noResultsScreens: 'אין תוצאות ל„{q}". נסו שם של מסך.',
    error: 'החיפוש נכשל. נסו שוב.',
    /**
     * Footer hints, each a key and its words. The key renders in its own
     * `<kbd dir="ltr">` (sidebar spec §9): bare in a Hebrew line, ">" is a
     * mirrored character and would show as "<".
     */
    footerHints: [
      ['↑↓', 'לניווט'],
      ['Enter', 'לפתיחה'],
      ['Esc', 'לסגירה'],
      ['#', 'מספר'],
      ['@', 'ספק'],
      ['>', 'פעולה'],
    ],
    footerMoney: 'פעולת כסף נפתחת במסך שלה · לא מאשרים מכאן',
    /** Screen-reader words before an option's shortcut keys (the chip itself is hidden). */
    shortcut: 'קיצור',
    close: 'סגירה',
    cheatTitle: 'קיצורי מקלדת',
    cheatGroups: { general: 'כללי', go: 'מעבר מהיר (G ואז אות)' },
    singleKeys: 'קיצורים בתו אחד',
    singleKeysHint: (mod: string) => `צירופי ${mod} תמיד פעילים`,
    actions: {
      newOrder: 'הזמנה חדשה',
      receive: 'קבלת משלוח',
      approvals: 'החלטה על פערים',
      payRun: 'אישור ריצת תשלומים',
      claims: 'בקשות זיכוי לשליחה',
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
      screens: 'Go to',
      records: 'Records',
      actions: 'Actions',
      display: 'Display',
      settings: 'Settings',
      ask: 'Ask',
    },
    ask: (q: string) => `Ask: ${q}`,
    order: (supplier: string, ref: string | null) =>
      ref ? `Order ${ref} · ${supplier}` : `Order · ${supplier}`,
    noInvoiceNumber: 'Invoice without a number',
    searching: 'Searching…',
    noResults: 'No results for “{q}”. Try a supplier name, an invoice number or a screen.',
    noResultsScreens: 'No results for “{q}”. Try a screen name.',
    error: 'Search failed. Try again.',
    footerHints: [
      ['↑↓', 'move'],
      ['Enter', 'open'],
      ['Esc', 'close'],
      ['#', 'number'],
      ['@', 'supplier'],
      ['>', 'action'],
    ],
    footerMoney: 'A money action opens on its own screen · nothing is approved here',
    shortcut: 'shortcut',
    close: 'Close',
    cheatTitle: 'Keyboard shortcuts',
    cheatGroups: { general: 'General', go: 'Go to (G, then a letter)' },
    singleKeys: 'Single-key shortcuts',
    singleKeysHint: (mod: string) => `${mod} combinations always work`,
    actions: {
      newOrder: 'New order',
      receive: 'Receive a delivery',
      approvals: 'Decide on discrepancies',
      payRun: 'Approve the pay run',
      claims: 'Credit requests to send',
      newRecipe: 'New recipe',
    },
  },
} as const;

export type PaletteCopy = (typeof paletteCopy)['he' | 'en'];
