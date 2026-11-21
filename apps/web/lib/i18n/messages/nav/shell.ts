import { defineMessages, withReceiverLocales, type Shape } from '../../translate';

/**
 * 'navShell' namespace (DS3-02): the side menu, the top bar and the palette's
 * display commands, added after 'nav' became receiver-complete. 'nav' is held
 * by `CompleteOverlays<typeof he>` (receiverLangs/overlays/nav.ts), so a new
 * key there would need four receiver files at once; new shell copy lives here.
 *
 * Receivers: the flat rail and the account menu read 'nav' keys (complete in
 * every receiver language). The few strings below that a receiver can meet
 * have no overlay yet, so they fall back to Hebrew, the floor's language
 * (`withReceiverLocales(…, {})`, translate.ts) — never English.
 */
export const he = {
  /** <aside aria-label>: the whole side menu (sidebar spec §9). */
  aside: 'תפריט צד',
  /** <nav aria-label> around the top bar's crumbs (§9). */
  crumbs: 'מיקום',
  /** The top item that lists everything waiting for me (§4.1). */
  queue: 'לטיפולי',
  favourites: 'מועדפים',
  search: {
    field: 'חיפוש או פקודה',
    tile: 'חיפוש',
  },
  short: {
    contracts: 'חוזים',
    accessibility: 'נגישות',
    contact: 'צרו קשר',
  },
  /** Screen-reader suffix on a folded group or a rail tile that holds the current page. */
  here: 'המסך הנוכחי כאן',
  /** Screen-reader suffix on a folded group that holds T2 money (§5.1: a dot, never an amount). */
  t2: {
    danger: 'יש בפנים תשלום שמחכה להחלטה',
    warn: 'יש בפנים כסף שמחכה לך',
  },
  viewOnly: 'צפייה בלבד',
  /** The fit rule's polite announcement, also shown beside the folded group (§4.2). */
  fit: 'קיפלנו את {groups} כדי שהתפריט ייכנס במסך',
  /** Tooltip meaning line on a rail group tile (keyboard focus only). */
  groupTip: 'Enter או חץ שמאלה פותחים את הרשימה',
  pin: {
    label: 'הצמדת התפריט הפתוח עם {group}',
    title: 'הצמדת התפריט',
    meaning: 'פותח את התפריט המלא עם {group}',
  },
  toggle: {
    meaning: 'הבחירה נשמרת בדפדפן הזה',
    closeOverlay: 'סגירת התפריט',
  },
  star: {
    add: 'הוספה למועדפים',
    remove: 'הסרה מהמועדפים',
    meaning: 'עד 5 מסכים בראש התפריט',
    added: '{page} נוסף למועדפים, בראש התפריט',
    removed: '{page} הוסר מהמועדפים',
    full: 'אפשר לשמור עד 5 מסכים במועדפים',
  },
  account: {
    settings: 'הגדרות אישיות',
    shortcuts: 'קיצורי מקלדת',
    singleKeys: 'קיצורים בתו אחד',
  },
  switcher: {
    title: 'סניפים · נשארים באותו מסך',
    count: '{count} סניפים',
  },
  /** Display commands in Ctrl K (DS3 SPEC §10.5). */
  commands: {
    collapse: 'כיווץ התפריט',
    expand: 'הרחבת התפריט',
    singleKeysOn: 'הפעלת קיצורים בתו אחד',
    singleKeysOff: 'כיבוי קיצורים בתו אחד',
    shortcuts: 'קיצורי מקלדת',
    densityCompact: 'מעבר למצב צפוף',
    densityRegular: 'מעבר למצב רגיל',
    textLarge: 'מעבר לטקסט גדול',
    textRegular: 'מעבר לטקסט רגיל',
  },
};

export const en: Shape<typeof he> = {
  aside: 'Side menu',
  crumbs: 'Location',
  queue: 'My queue',
  favourites: 'Favourites',
  search: {
    field: 'Search or command',
    tile: 'Search',
  },
  short: {
    contracts: 'Contracts',
    accessibility: 'Accessibility',
    contact: 'Contact',
  },
  here: 'you are here',
  t2: {
    danger: 'a payment inside waits for a decision',
    warn: 'money inside waits for you',
  },
  viewOnly: 'view only',
  fit: 'Folded {groups} so the menu fits on the screen',
  groupTip: 'Enter or the right arrow opens the list',
  pin: {
    label: 'Pin the open menu with {group}',
    title: 'Pin the menu',
    meaning: 'Opens the full menu with {group}',
  },
  toggle: {
    meaning: 'Your choice is kept in this browser',
    closeOverlay: 'Close the menu',
  },
  star: {
    add: 'Add to favourites',
    remove: 'Remove from favourites',
    meaning: 'Up to 5 screens at the top of the menu',
    added: '{page} added to favourites, at the top of the menu',
    removed: '{page} removed from favourites',
    full: 'You can keep up to 5 favourite screens',
  },
  account: {
    settings: 'Personal settings',
    shortcuts: 'Keyboard shortcuts',
    singleKeys: 'Single-key shortcuts',
  },
  switcher: {
    title: 'Branches · you stay on this screen',
    count: '{count} branches',
  },
  commands: {
    collapse: 'Collapse the menu',
    expand: 'Expand the menu',
    singleKeysOn: 'Turn on single-key shortcuts',
    singleKeysOff: 'Turn off single-key shortcuts',
    shortcuts: 'Keyboard shortcuts',
    densityCompact: 'Switch to compact density',
    densityRegular: 'Switch to regular density',
    textLarge: 'Switch to large text',
    textRegular: 'Switch to regular text',
  },
};

export const navShell = withReceiverLocales(defineMessages('navShell', he, en), {});
