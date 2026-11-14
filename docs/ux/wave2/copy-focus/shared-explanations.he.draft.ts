/**
 * shared-explanations.he.draft.ts — DRAFT (31.10.2026). Not wired into the app; W2-16 turns Part 1 into
 * `apps/web/lib/i18n/messages/explain/he.ts`, and each namespace owner applies Parts 2–3 in its own catalog.
 *
 * Owner request (31.10): "לא חייב מקום אחד להסברים, אפשר להשאיר איפה שקיים אבל בצורה יעילה יותר".
 * So nothing here is a help centre or a glossary page. Every string below is shown IN PLACE, on the screens
 * listed in `screens`. It is either a visible line, a short tag appended to a status, or the body of an
 * in-place fold (`<Explain>`, MECHANISM.md §2) that starts closed.
 *
 * One concept = one key = one wording. The keys that carry the same idea today are listed in `replaces`.
 * Each of them either reads this key (W2, key merge) or takes this exact value (Batch P, value merge).
 *
 *   Part 1  `explain.*`       used by screens of 2+ namespaces → new namespace `messages/explain/` (W2-16 owns).
 *                             Rules (MECHANISM §3.4, enforced by the W2-16 guard): ≤40 words, ≤12 words per
 *                             sentence, NO ₪ and no money placeholder, so the receiver and the chef can see
 *                             every one of them; plural imperative; binding terms; never "יעד".
 *   Part 2  `<ns>.explain.*`  used by one namespace only → stays in that catalog (its owner edits it).
 *   Part 3  canonical keys    statuses, errors, empty states and labels repeated across screens. The key that
 *                             already exists becomes the one wording; the others copy it or read it.
 *
 * Source of truth: rw-release @ 96d47226. Inputs: inventory-{A..F}.json (concept ids), MECHANISM.md, RULES.he.md.
 * Word counts use the MECHANISM §5.1 metric. `batch`: P = value set in train B (BATCH-P-BRIEF.md);
 * W2 = needs the key, the fold or a component change; P+W2 = an interim value now, the key/fold in W2.
 *
 * Corrections to the MECHANISM §3.6 seeds:
 *   - `explain.pendingNotCounted` ("…הן לא נספרות בדליפה ובהוצאה") is FALSE for findings on those invoices:
 *     packages/charts/src/leak-hero.ts sums LEAST(raw_leak, total) over ALL invoices; only their SPEND is left
 *     out. Renamed `explain.pendingLink` and reworded to say only what is true everywhere it renders.
 *   - `explain.separateFromLeak` is split into a 3-word tag (`explain.notInLeak`, visible) and the method
 *     (`explain.creepHow`, folded): the auditors found the tag needed on the line itself, the method only sometimes.
 *   - `explain.uncountedNotZero` is dropped: `inventory.count.notCountedWarn` already says it on the line (E).
 */

export type ExplainUse =
  | 'fold' //   body of an in-place <Explain> toggle, closed by default
  | 'line' //   one short visible line next to the thing it explains
  | 'tag' //    ≤5 words appended to a visible status ("… · לא חלק מהדליפה")
  | 'status' // a status / empty-state / result line (Part 3)
  | 'error' //  what happened + what to do (Part 3)
  | 'label'; // a label or button (Part 3)

export type ExplainToggle = 'why' | 'details' | 'how';

export interface SharedExplanation {
  /** Proposed catalog key. */
  key: string;
  /** The one Hebrew wording (≤ 2 short sentences). */
  he: string;
  use: ExplainUse;
  /** For folds: which toggle label sits next to the thing it explains. */
  toggle?: ExplainToggle;
  /** Screens that show it IN PLACE: route · where on the screen · roles. */
  screens: readonly string[];
  /** Keys that carry the same idea today (another wording). They point to `key` or copy `he`. */
  replaces: readonly string[];
  batch: 'P' | 'W2' | 'P+W2';
  /** Namespace owner who applies it (MECHANISM §6.4; README §9). */
  owner: string;
  /** Rendered on a receiver screen → needs ar/ru/th/ti in `explain.receiver.ts` (W2-05 reviews). */
  receiverOverlay?: boolean;
  /** inventory conceptId(s) it resolves. */
  concepts: readonly string[];
  note?: string;
}

/** Toggle labels (`explain.toggle.*`). Buttons, ≤ 2 words. */
export const EXPLAIN_TOGGLES = {
  why: 'למה?', //          a reason behind a status, number or rule
  details: 'פרטים', //     supporting conditions or steps that are not a reason
  how: 'איך חישבנו?', //   only next to a ₪ figure we computed (same words as `overview.hero.howCalc`)
} as const;

export const SHARED_EXPLANATIONS = {
  // ═══════════════════════════════════════ Part 1 · explain.* (cross-namespace, no ₪) ═══════════════════════════════════════

  threeWayMatch: {
    key: 'explain.threeWayMatch',
    he: 'כל חשבונית נבדקת מול ההזמנה ומול קבלת הסחורה. בלי הזמנה אין מול מה לבדוק.',
    use: 'fold',
    toggle: 'why',
    screens: [
      '/dashboard/orders · "למה?" at the end of the page header (PageHeader explain) · owner, manager, chef',
      '/dashboard/orders/capture · next to "הדביקו את ההזמנה ששלחתם לספק" · owner, manager, chef',
    ],
    replaces: [
      'orders.subtitle', 'ingest.orderCapture.subtitle (tail)', 'suppliers.ordersTab.emptyBody (tail)',
      'suppliers.catalogTab.emptyBody (tail)', 'catalog.subtitle', 'products.subtitle', 'suppliers.leakCard.printFooter',
      'leaks.states.cleanHint', 'leaks.breakdown.emptyDescription', 'leaks.hub.subtitle (restatement only; the definition of דליפה stays)',
    ],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-06 orders, W2-02 ingest (screens) · W2-11/W2-16b cut the restatements',
    concepts: ['concept.threeWayMatch'],
    note: 'Restated in 11 places today. Result lines keep their 4–6 words: "ההזמנה אושרה — החשבונית תיבדק מולה." / orders.wizard.markedBody.',
  },

  leakRule: {
    key: 'explain.leakRule',
    he: 'נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית. לא נספרים: "מחיר נמוך מהמצופה", "ממתינה לשיוך להזמנה" ו"שורת הזמנה לא חויבה".',
    use: 'fold',
    toggle: 'how',
    screens: [
      '/dashboard · leak hero, "איך חישבנו?" next to the ₪ (replaces the 24 px ⓘ popover) · owner, manager',
      '/dashboard/leaks/proof · "מה נספר ומה לא" block, rendered open (detail page) · owner, manager',
      '/dashboard/leaks/report · method footnote, "פרטים" · owner, manager',
    ],
    replaces: ['overview.hero.calc (Batch P sets this value)', 'leakProof.rules', 'leaks.report.method'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-08 hero · W2-09 proof + report',
    concepts: ['concept.leakRule'],
    note:
      'Fixes a contradiction the owner can see: the ⓘ said "invoices with no order" are not counted; the proof page (correctly) says "פריט בחשבונית ללא הזמנה" IS counted. ' +
      '"שורת הזמנה לא חויבה" (MISSING_ON_INVOICE) is listed because W1-08 takes it out of LEAK_FILTER in train B (owner, 31.10); drop it from the list if that PR misses train B. ' +
      'The proof page adds its local detail: leakProof.explain.rulesMore.',
  },

  pendingLink: {
    key: 'explain.pendingLink',
    he: 'לרוב חשבונית מרכזת שמחכה לשיוך. עד השיוך הסכום שלה לא נכנס להוצאה שנבדקה.',
    use: 'fold',
    toggle: 'why',
    screens: [
      '/dashboard · leak hero, the T4 hourglass line "N חשבוניות (₪X) ממתינות לשיוך להזמנה" · owner, manager',
      '/dashboard/leaks/breakdown · header of the "ממתינות לשיוך" section · owner, manager',
      '/dashboard/leaks/report · pending line · owner, manager',
      '/dashboard/leaks/proof · pending block (open; + local tail leakProof.explain.findingsCount) · owner, manager',
      '/dashboard/approvals · UNORDERED_ARRIVAL card, next to "לא נמצאה הזמנה תואמת." · owner, manager, bookkeeper',
      '/dashboard/invoices/[id] · מרכזת panel, proposal note · owner, manager, bookkeeper',
      '/dashboard/approvals/pay-run · "ממתינות לשיוך" KPI line (+ local tail payRun.explain.notPaidOrHeld) · owner, manager, bookkeeper',
    ],
    replaces: [
      'overview.hero.pending (tail; Batch P removes the false clause)', 'leaks.breakdown.pendingHint', 'leaks.report.pending (tail)',
      'leakProof.pending (tail)', 'approvals.types.UNORDERED_ARRIVAL.explain (tail)', 'consolidated.proposalNote', 'payRun.kpis.link (tail)',
    ],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-08, W2-09, W2-04, W2-02, W2-03 (screens)',
    concepts: ['concept.pendingLink', 'concept.consolidated'],
    note:
      'T4: calm and neutral, never a warning. Says nothing about the leak, because it renders where findings on the invoice DO count ' +
      '(leak-hero.ts). The approvals card keeps its own visible fact for its own finding: "לא נספר בדליפה עד השיוך" (UNORDERED_ARRIVAL is outside LEAK_FILTER).',
  },

  notInLeak: {
    key: 'explain.notInLeak',
    he: 'לא חלק מהדליפה',
    use: 'tag',
    screens: [
      '/dashboard · "מחירים שעלו" card, after its one-line subtitle · owner, manager',
      '/dashboard/leaks#prices · section line · owner',
      '/dashboard/leaks/report · price-creep line · owner, manager',
      '/dashboard#vat-at-risk · VAT card status line (flag off for ציקטי) · owner, manager, bookkeeper',
      '/dashboard/inventory · food-cost period card (flag off for ציקטי) · owner, manager',
    ],
    replaces: [
      'overview.leaks.subtitle (tail; Batch P)', 'leaks.detective.subtitle (tail)', 'leaks.detective.totalHint', 'leaks.report.creepHint (tail)',
      'vat.card.separate', 'inventory.period.separateNote', 'inventory.subtitle ("ובדיקה שמספר הדליפה אמין" contradicts it; cut)',
    ],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-08, W2-09, W2-07 (screens)',
    concepts: ['concept.notLeak', 'concept.creep'],
    note: 'Price creep, VAT at risk and food cost are each said to be "separate from the leak" in 5 wordings; "דליפה" = the monthly leak only.',
  },

  creepHow: {
    key: 'explain.creepHow',
    he: 'מסומן כשהמחיר האחרון בין 10% הגבוהים אצל הספק, ולפחות 5% מעל המחיר הרגיל. העודף = (מחיר − מחיר רגיל) × כמות ב-30 יום.',
    use: 'fold',
    toggle: 'how',
    screens: [
      '/dashboard/leaks#prices · next to the "מחירים שעלו" ₪ total · owner',
      '/dashboard · "מחירים שעלו" card header · owner, manager',
    ],
    replaces: ['leaks.detective.subtitle (method)', 'leaks.detective.totalHint', 'leaks.detective.hotspotsHint'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-09, W2-08 (screens)',
    concepts: ['concept.creep', 'concept.usualPrice', 'concept.p90'],
    note: '"המחיר הרגיל" = the supplier\'s median; "בין 10% הגבוהים" = above its 90th percentile. No statistics words on a working screen.',
  },

  capBadge: {
    key: 'explain.capBadge',
    he: 'מוגבל לסכום החשבונית',
    use: 'tag',
    screens: [
      '/dashboard/leaks/breakdown · badge on a capped invoice row · owner, manager',
      '/dashboard/leaks/proof · badge in the top-invoices list · owner, manager',
    ],
    replaces: ['leaks.breakdown.capped', 'leakProof.capped ("הוגבל…")'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-09',
    concepts: ['concept.cap'],
    note: 'The ₪ note "סכום השורות גבוה ב-{amount} מהדליפה…" carries a money placeholder, so it stays a visible line in `leaks` (leaks.report.capNoteShort), once per page.',
  },

  caught: {
    key: 'explain.caught',
    he: 'עוד אפשר לעצור לפני תשלום',
    use: 'tag',
    screens: [
      '/dashboard/leaks/proof · after "{amount} מהדליפה" · owner, manager',
      '/dashboard/leaks/report · chip after the ₪ · owner, manager',
      '/dashboard/chain · KPI hint (flag off) · owner',
    ],
    replaces: ['leakProof.caught (tail; Batch P)', 'leaks.report.caughtChip (tail)', 'chain.dashboard.kpis.caughtHint'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-09, W2-16b',
    concepts: ['concept.caught'],
    note: 'The ₪ stays in the local key: `{amount} מהדליפה {caught}`. The home hero split label "על חשבוניות שעוד לא שולמו" is a label and stays.',
  },

  inLetter: {
    key: 'explain.inLetter',
    he: 'במכתב רק פערים שאושרו לדרישה ועוד לא נשלחו.',
    use: 'line',
    screens: [
      '/dashboard/leaks/claims · footnote under the letters, and the empty-state body · owner, manager',
      '/dashboard/leaks/proof · "פרטים" next to the recovered line · owner, manager',
      '/dashboard/approvals/pay-run · "פרטים" next to the credit KPI (flag off) · owner, manager, bookkeeper',
    ],
    replaces: ['leaks.claims.note (Batch P)', 'leakProof.recovered (fold body)', 'payRun.kpis.creditHint', 'payRun.note (credit half)'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-09/W2-10, W2-03',
    concepts: ['concept.inLetter', 'concept.claimFromApproval'],
    note: 'leaks.claims.undecided.body keeps its own count line ("{count} פערים מחכים להחלטה — לא במכתב עד אישור."); leaks.report.resolvedNote = leakProof.resolvedNote (one value, Batch P).',
  },

  noSendWithoutTap: {
    key: 'explain.noSendWithoutTap',
    he: 'שום דבר לא נשלח לספק בלי לחיצה שלכם.',
    use: 'line',
    screens: [
      '/dashboard/recovery · under the T2 "ממתינות לתשובת ספק" card · owner, manager',
      '/dashboard/leaks/claims · next to the overdue-reminder button · owner, manager',
      '/dashboard/receiving/<poId> · dock slip, under the WhatsApp button · receiver, manager',
      '/dashboard#vat-at-risk · request panel (flag off) · owner, manager, bookkeeper',
    ],
    replaces: ['recovery.followUp.reminderNote (Batch P)', 'leaks.claims.reminder.note (Batch P)', 'receiving.dockSlip.noSend (Batch P)', 'vat.request.hint (tail)'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-10, W2-09, W2-05, W2-16b',
    receiverOverlay: true,
    concepts: ['concept.notSent', 'concept.noAutoSend'],
    note: 'Owner rule: an overdue-claim reminder is a draft that sends only on a click. Record-only orders keep their own result line ("לא נשלח דבר לספק…").',
  },

  amountAfterClose: {
    key: 'explain.amountAfterClose',
    he: 'הסכום ייקבע אחרי סגירת קבלת הסחורה.',
    use: 'line',
    screens: [
      '/dashboard/receiving/<poId> · dock slip note before the close · manager (receiver sees the slip without ₪)',
      '/dashboard/receiving/<poId> · confirmation, when the slip flag is off · manager',
    ],
    replaces: ['receiving.dockSlip.afterClose (Batch P)', 'receiving.dockSlip.quantitiesOnly (cut ×N)', 'receiving.steps.recon.potentialLossHint (dead)'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-05',
    receiverOverlay: true,
    concepts: ['concept.amountLater'],
    note: 'No ₪ character in the text, so the same string is safe on every receiver screen.',
  },

  reviewNotGap: {
    key: 'explain.reviewNotGap',
    he: 'שורה לבדיקה היא לא פער. סמנו אותה לפי מה שהגיע.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard/receiving/<poId> · review step, next to "{count} לבדיקה" · receiver, manager'],
    replaces: ['receiving.steps.recon.pendingBanner (tail)', 'receivingDelivery.delivery.review.pending (repeat)'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-05',
    receiverOverlay: true,
    concepts: ['concept.pendingReview'],
    note: 'T4. Said 3× on one screen today (summary + banner + badge). Batch P already shortens the banner; W2-05 decides whether the banner or the fold survives (prefer cut on field screens, MECHANISM §1).',
  },

  possibleDuplicate: {
    key: 'explain.possibleDuplicate',
    he: 'מספר החשבונית כבר קיים אצל הספק. היא תיבדק לפני תשלום.',
    use: 'fold',
    toggle: 'why',
    screens: [
      '/dashboard/receiving/<poId> · review + count, next to "ייתכן שחשבונית {number} כפולה" · receiver, manager',
      '/dashboard/invoices/[id] · duplicate notice · owner, manager, bookkeeper',
      '/dashboard/approvals/pay-run · "להשהות" badge on a duplicate (flag off) · owner, manager, bookkeeper',
    ],
    replaces: ['receiving.steps.recon.duplicateInvoice (tail)', 'invoices.correction.duplicateOf (tail)', 'approvals.tolerance.duplicate (cut)', 'payRun.status.holdDuplicate', 'ingest.documentStatus.duplicate'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-05, W2-02, W2-03',
    receiverOverlay: true,
    concepts: ['concept.duplicate', 'concept.duplicateInvoice'],
    note: 'T4 calm on the receiver screen ("המשיכו כרגיל" stays local). The approvals WhyLine keeps its own visible fact (approvals.types.DUPLICATE_INVOICE.explain).',
  },

  englishName: {
    key: 'explain.englishName',
    he: 'מוצג לצוות שעובד באנגלית. ההתאמות והייצוא נשארים על השם העברי.',
    use: 'fold',
    toggle: 'why',
    screens: [
      '/dashboard/suppliers (new/edit supplier form) · next to "שם באנגלית" · owner, manager',
      '/dashboard/products/<productId> · next to the English-name field · owner, manager',
      '/dashboard/products (English names grid) · header · owner, manager',
    ],
    replaces: ['suppliers.form.nameEnHint', 'suppliers.form.nameEn (label parenthesis; Batch P)', 'products.form.nameEnHint', 'products.names.subtitle (tail)', 'products.subtitle'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-11, W2-16b',
    concepts: ['concept.englishName'],
  },

  viewOnly: {
    key: 'explain.viewOnly',
    he: 'צפייה בלבד',
    use: 'tag',
    screens: [
      '/dashboard/contracts · next to the page title for non-editors · bookkeeper',
      '/dashboard/products, /products/<id> · next to the title for non-editors · bookkeeper',
      '/dashboard/settings · profile + matching sections for non-owners · manager, bookkeeper',
      '/dashboard/integrations · accounting mapping for non-editors · manager',
      '/dashboard/approvals · "ממתין לאחרים" lane · owner, manager, bookkeeper',
      '/dashboard/receiving?receipt= · closed receipt · receiver, manager',
      '/dashboard/invoices/[id] · מרכזת reference/proposal notes · owner, manager, bookkeeper',
    ],
    replaces: [
      'contracts.readOnly (Batch P)', 'products.names.readOnly', 'products.form.readOnly', 'settings.readOnly.profile', 'settings.readOnly.matching',
      'integrations.accounting.mapping.readOnly', 'approvals.others.readOnly (Batch P)', 'overview.board.receipt.readOnly (Batch P)',
      'consolidated.referenceNote / proposalNote ("לקריאה בלבד" prefix)',
    ],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-12, W2-16b, W2-14, W2-04, W2-05, W2-02',
    receiverOverlay: true,
    concepts: ['concept.readOnly'],
    note: 'One wording instead of "לקריאה בלבד" / "צפייה בלבד" / "צפייה בלבד — רק בעלים ומנהלים…". Who may edit is not repeated; team keeps its own line "הזמנות ותפקידים — לבעלים בלבד."',
  },

  leakAfterFirstMatch: {
    key: 'explain.leakAfterFirstMatch',
    he: 'הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה.',
    use: 'line',
    screens: [
      '/dashboard · leak hero, no-data state · owner, manager',
      '/dashboard/leaks (+ breakdown, report) · no-data state · owner, manager',
    ],
    replaces: ['overview.hero.noData.hint (Batch P)', 'leaks.states.noDataHint (Batch P)'],
    batch: 'P+W2',
    owner: 'W2-16 (key) · W2-08, W2-09',
    concepts: ['concept.noData'],
    note: '"קבלת הסחורה", never bare "קבלה" (that is a payment receipt).',
  },

  thinBase: {
    key: 'explain.thinBase',
    he: 'מעט מדי נתונים לאחוז.',
    use: 'line',
    screens: [
      '/dashboard/leaks (explorer deltas) · next to a missing % (dashViews, flag off) · owner',
      '/dashboard/chain · ranking row, visible instead of a title= tooltip (flag off) · owner',
    ],
    replaces: ['views.delta.thinBase', 'chain.dashboard.ranking.thinBase (title=)'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-09, W2-16b',
    concepts: ['concept.thinBase'],
    note: 'The home hero keeps its own count line "מוקדם לאחוז: נבדקו רק {count} חשבוניות" (Batch P).',
  },

  foodCostTwoCounts: {
    key: 'explain.foodCostTwoCounts',
    he: 'עלות המזון בפועל מחושבת בין שתי ספירות.',
    use: 'fold',
    toggle: 'why',
    screens: [
      '/dashboard/inventory · food-cost card, next to "תופיע אחרי הספירה הבאה" · owner, manager, chef (no ₪)',
      '/dashboard (chef home) · count tile, when no count is open · chef',
    ],
    replaces: ['inventory.period.needOpening (tail)', 'inventory.period.purchaseFoodCostHint (tail)', 'inventory.period.noCounts', 'inventory.home.historyEmpty (tail)', 'overview.chef.countNoneHint'],
    batch: 'W2',
    owner: 'W2-16 (key) · W2-07, W2-08',
    concepts: ['concept.twoCounts'],
    note: 'OWNER DECISION before wording the cadence: inventory.subtitle says the count "closes the month", the chef home says "weekly". This body avoids the cadence on purpose.',
  },

  // ═══════════════════════════════════════ Part 2 · <ns>.explain.* (one namespace) ═══════════════════════════════════════

  rulesMore: {
    key: 'leakProof.explain.rulesMore',
    he: 'פריט בחשבונית ללא הזמנה כן נספר. פערים בתוך הסבולת לא נספרים.',
    use: 'line',
    screens: ['/dashboard/leaks/proof · under explain.leakRule · owner, manager'],
    replaces: ['leakProof.rules (second half)'],
    batch: 'W2', owner: 'W2-09', concepts: ['concept.leakRule'],
  },
  findingsCount: {
    key: 'leakProof.explain.findingsCount',
    he: 'ממצאים על חשבוניות שממתינות לשיוך כן נספרים בדליפה.',
    use: 'line',
    screens: ['/dashboard/leaks/proof · pending block, after explain.pendingLink · owner, manager'],
    replaces: ['leakProof.pending (last clause)'],
    batch: 'W2', owner: 'W2-09', concepts: ['concept.pendingLink'],
    note: 'The proof page is the one place that must state this; every other pending line stays neutral.',
  },
  vatAllocation: {
    key: 'vat.explain.allocation',
    he: 'חשבונית מס מעל הסף חייבת מספר הקצאה. יש 6 חודשים לקבל חשבונית מתוקנת.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard#vat-at-risk · next to "בלי מספר הקצאה — אי אפשר לקזז את המע״מ." · owner, manager, bookkeeper', '/dashboard/invoices/[id] · VAT block · owner, manager, bookkeeper'],
    replaces: ['vat.card.subtitle', 'vat.card.clearHint (window half)', 'vat.invoice.closed (window half)'],
    batch: 'W2', owner: 'W2-16b (vat namespace) · W2-08 card', concepts: ['concept.allocation', 'concept.vatWindow'],
    note: 'No ₪: the threshold amount stays in the visible line. vatAtRisk is off for ציקטי.',
  },
  notPaidOrHeld: {
    key: 'payRun.explain.notPaidOrHeld',
    he: 'עד השיוך הן לא נספרות בתשלום ובהשהיה.',
    use: 'line',
    screens: ['/dashboard/approvals/pay-run · after explain.pendingLink in the "ממתינות לשיוך" fold · owner, manager, bookkeeper'],
    replaces: ['payRun.kpis.link (tail)'],
    batch: 'W2', owner: 'W2-03', concepts: ['concept.pendingLink'],
  },
  payRunStatus: {
    key: 'payRun.explain.status',
    he: 'הסטטוס הוא מה שסומן במערכת. סכומי הזיכוי זהים למכתבי דרישת הזיכוי.',
    use: 'fold',
    toggle: 'details',
    screens: ['/dashboard/approvals/pay-run · next to "RestoMatch לא מבצעת תשלומים." · owner, manager, bookkeeper'],
    replaces: ['payRun.note'],
    batch: 'W2', owner: 'W2-03', concepts: ['concept.inLetter'],
  },
  exportScope: {
    key: 'accounting.explain.scope',
    he: 'נכללות כל החשבוניות שנבדקו, גם עם פערים. לא נכללות חשבוניות בקריאה, מרכזות שממתינות ועותקים כפולים.',
    use: 'fold',
    toggle: 'details',
    screens: ['/dashboard/exports · next to "כל החשבוניות שנבדקו בטווח התאריכים." · owner, bookkeeper'],
    replaces: ['accounting.note', 'accounting.subtitle (contradicted the note: "שאושרו" vs "שנבדקו")', 'integrations.accounting.body (tail)'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.exportScope'],
  },
  rerunMatch: {
    key: 'invoices.correction.subtitle (canonical)',
    he: 'תקנו שורות שנקראו שגוי והריצו התאמה מחדש.',
    use: 'line',
    screens: ['/dashboard/invoices/[id] · top of the page, editors of a non-מרכזת invoice only · owner, manager'],
    replaces: ['invoices.correction.rerunHint (bottom of the same page; cut)'],
    batch: 'P+W2', owner: 'W2-02', concepts: ['concept.rerunMatch'],
    note: 'Batch P sets the value; W2-02 hides it for the bookkeeper (read-only) and on a מרכזת (no re-run button).',
  },
  linkOnce: {
    key: 'catalog.explain.linkOnce',
    he: 'חיבור אחד מעדכן את כל השורות, וההזמנות הבאות יזוהו לבד.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard/catalog/mapping · next to "{count} מק״טים ממתינים למיפוי" · owner, manager'],
    replaces: ['catalog.mapping.pending (tail)', 'catalog.mapping.subtitle (tail)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.skuLearning'],
  },
  noFakeGaps: {
    key: 'catalog.explain.noFakeGaps',
    he: 'השורות נשמרו בלי קישור למוצר, כדי שלא ייווצרו פערים מדומים.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard/catalog/import · review step, next to "קשרו כל שורה למוצר." · owner, manager'],
    replaces: ['catalog.import.review.intro (tail)', 'catalog.import.review.laterHint (first half)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.unlinkedRows'],
  },
  ruleOverrides: {
    key: 'contracts.explain.ruleOverrides',
    he: 'כלל לספק או לקטגוריה גובר על ברירת המחדל.',
    use: 'fold',
    toggle: 'details',
    screens: ['/dashboard/contracts?tab=thresholds · next to "ברירת מחדל: עלייה של {threshold} בתוך {days} ימים" · owner, manager'],
    replaces: ['contracts.thresholds.intro (tail)', 'contracts.thresholds.emptyBody (cut)'],
    batch: 'W2', owner: 'W2-12', concepts: ['concept.priceAlertRule'],
  },
  lateAlert: {
    key: 'suppliers.explain.lateAlert',
    he: 'אם עד השעה האחרונה לא נקלטה קבלת סחורה, תופיע התראת איחור.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard/suppliers (supplier form) · next to "לוח אספקה — ימים ושעה אחרונה" · owner, manager'],
    replaces: ['suppliers.form.deliveryHint (Batch P sets this value as a visible interim)'],
    batch: 'P+W2', owner: 'W2-11', concepts: ['concept.lateDelivery'],
    note: 'Removes "שעת היעד" (never "יעד") and "תעודת קבלה". The order schedule tab is a different idea ("ימי הזמנה", cutoff → delivery date).',
  },
  posLinkByName: {
    key: 'recipes.explain.posLinkByName',
    he: 'הקופה מקושרת למנה לפי השם, בעברית או באנגלית.',
    use: 'fold',
    toggle: 'why',
    screens: ['/dashboard/recipes (תיאורטי מול בפועל) · next to "{count} פריטים בקופה בלי מתכון" and the no-match empty state · owner, manager'],
    replaces: ['recipes.pos.unmatched (tail)', 'recipes.pos.emptyNoMatch (tail)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.posLinkByName'],
  },
  disparityMethod: {
    key: 'chain.explain.disparityMethod',
    he: 'השפעה = (המחיר − המחיר הטוב ברשת) × הכמות בתקופה. רק התאמות בטוחות, עם פער של 3% לפחות.',
    use: 'fold',
    toggle: 'how',
    screens: ['/dashboard/chain · next to "השפעה בתקופה" · owner'],
    replaces: ['chain.dashboard.disparity.subtitle (formula half)', 'chain.dashboard.disparity.note'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.disparityMethod'],
  },
  inviteRoles: {
    key: 'team.explain.inviteRoles',
    he: 'מנהל משמרת שמקבל סחורה: בחרו "מקבל סחורה". עובד שלא דובר עברית: בחרו English.',
    use: 'fold',
    toggle: 'details',
    screens: ['/dashboard/team · invite form, next to "נשלח קישור הצטרפות למייל." · owner'],
    replaces: ['team.invite.subtitle (tail)', 'team.subtitle (cut)'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.invite'],
  },
  recoveryCodes: {
    key: 'settings.explain.recoveryCodes',
    he: 'כל קוד עובד פעם אחת, כשאין לכם גישה לאפליקציה.',
    use: 'fold',
    toggle: 'details',
    screens: ['/dashboard/settings · 2FA recovery codes, next to "שמרו את הקודים במקום בטוח. הם מוצגים פעם אחת." · all roles'],
    replaces: ['settings.twoFactor.codesIntro (tail)'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.recoveryCodes'],
    note: 'Same phrase "כל קוד עובד פעם אחת" as auth.recovery.subtitle on /login/2fa.',
  },
  roundedShekels: {
    key: 'recovery.explain.rounding',
    he: 'השקלים מעוגלים כך שהחלקים מסתכמים בדיוק לסך שנדרש.',
    use: 'fold',
    toggle: 'how',
    screens: ['/dashboard/recovery · next to "מה קרה לכל שקל שנדרש" · owner, manager'],
    replaces: ['recovery.funnel.note ("…במעבר עכבר" is false on the phone)'],
    batch: 'W2', owner: 'W2-10', concepts: [],
  },

  // ═══════════════════════════════════════ Part 3 · canonical keys (one wording, existing key) ═══════════════════════════════════════

  clean: {
    key: 'leaks.states.clean',
    he: 'אין דליפה · {count} חשבוניות נבדקו ✓',
    use: 'status',
    screens: ['/dashboard · leak hero (T3) · owner, manager', '/dashboard/leaks, /breakdown, /report · clean state · owner, manager'],
    replaces: ['overview.hero.clean (Batch P)', 'leaks.report.empty', 'leaks.states.cleanHint (cut)', 'leaks.breakdown.emptyDescription (cut)'],
    batch: 'P+W2', owner: 'W2-09 · W2-08', concepts: ['concept.clean'],
  },
  noCompare: {
    key: 'views.delta.noBase',
    he: 'אין נתוני השוואה',
    use: 'status',
    screens: ['/dashboard · leak hero delta · owner, manager', '/dashboard/leaks · explorer deltas · owner'],
    replaces: ['overview.hero.delta.none (Batch P)', 'overview.hero.delta.noneYoy'],
    batch: 'P+W2', owner: 'W2-09 · W2-08', concepts: ['concept.noCompare'],
  },
  savedOnPhone: {
    key: 'receivingDelivery.pwa.offline',
    he: 'אין חיבור · נשמר בטלפון',
    use: 'status',
    screens: ['/dashboard/receiving/** · PWA chip on every receiving screen · receiver, manager'],
    replaces: [
      'receiving.steps.scan.bannerQueued (Batch P: "נשמרה בטלפון")', 'ingest.pwa.savedOffline (cut: the chip is on screen)', 'ingest.pwa.offlineBody (dead)',
      'receivingDelivery.delivery.count.offline (Batch P)', 'receivingDelivery.delivery.leave.body', 'receivingDelivery.logoutGuard.body', 'receivingDelivery.delivery.error.body (Batch P)',
    ],
    batch: 'P+W2', owner: 'W2-05', receiverOverlay: true, concepts: ['concept.savedOnPhone'],
    note: '12 wordings of one fact on 7 surfaces today. common.shell.offline.chip ("אין חיבור · נעדכן כשהרשת תחזור") stays for non-receiving routes.',
  },
  sessionExpired: {
    key: 'common.shell.session.body',
    he: 'התחברו שוב — העבודה שלכם נשמרה.',
    use: 'status',
    screens: ['any route · re-auth sheet · all roles'],
    replaces: ['common.shell.session.notSent (Batch P: "לא נשלח · התחברו ונסו שוב.")', 'receivingDelivery.delivery.count.sessionExpired (same idea, keeps "הספירה שמורה")'],
    batch: 'P', owner: 'W2-13 · W2-05', receiverOverlay: true, concepts: ['concept.sessionExpired'],
  },
  errorRetry: {
    key: 'common.shell.error.body',
    he: 'נסו שוב. אם זה חוזר, שלחו לנו את הקוד.',
    use: 'error',
    screens: ['any dashboard route · in-shell error boundary · all roles', 'any route · root error page · all roles', 'global-error.tsx (inline) · all roles'],
    replaces: ['common.errorPage.body (Batch P)', 'app/global-error.tsx:77 inline text (W2: import the plain he object)'],
    batch: 'P+W2', owner: 'W2-13 · G-11 (global-error)', receiverOverlay: true, concepts: ['concept.errorRetry'],
  },
  notFoundPage: {
    key: 'common.shell.notFound.body',
    he: 'הקישור שגוי, הדף נמחק, או שהוא בסניף אחר.',
    use: 'error',
    screens: ['in-shell 404 · all roles'],
    replaces: ['common.notFound.body (root 404 keeps "הקישור שגוי או שהדף הוסר." — no branch there)', 'common.shell.notFound.otherBranch (dead)'],
    batch: 'P', owner: 'W2-13', receiverOverlay: true, concepts: ['concept.notFound'],
  },
  notFoundItem: {
    key: 'components.errors.notFound',
    he: 'הפריט לא נמצא — ייתכן שנמחק.',
    use: 'error',
    screens: ['any toast / inline error for a missing item · all roles'],
    replaces: ['auth.serverErrors.notFound'],
    batch: 'W2', owner: 'W2-13 · W2-16b', concepts: ['concept.notFound'],
    note: 'auth.serverErrors values double as a Hebrew lookup table (lib/serverErrors.ts:53): change the server prose in the same PR or retire the fallback.',
  },
  genericFail: {
    key: 'components.errors.generic',
    he: 'הפעולה נכשלה. נסו שוב.',
    use: 'error',
    screens: ['any failed action · all roles'],
    replaces: ['auth.serverErrors.generic', 'growth.referral.errors.generic', 'settings.dsr.failed', 'admin.generic', 'auth.setPassword.errors.generic'],
    batch: 'W2', owner: 'W2-13 (+ each owner switches its key)', concepts: ['concept.genericFail'],
    note: 'Login keeps its own sign-in wording.',
  },
  network: {
    key: 'receiving.errors.network',
    he: 'אין חיבור לרשת. בדקו את החיבור ונסו שוב.',
    use: 'error',
    screens: ['/dashboard/receiving/<poId> · upload/scan errors · receiver, manager', 'any route · network toast · all roles'],
    replaces: ['receiving.steps.scan.network (byte-identical second key; delete)', 'components.errors.network ("…לשרת")'],
    batch: 'W2', owner: 'W2-05 · W2-13', receiverOverlay: true, concepts: ['concept.network', 'concept.offline'],
  },
  rateLimit: {
    key: 'components.errors.tooMany',
    he: 'יותר מדי ניסיונות. המתינו רגע ונסו שוב.',
    use: 'error',
    screens: ['any rate-limited action · all roles', '/login · all'],
    replaces: ['auth.login.errors.rate', 'auth.reset.rate'],
    batch: 'W2', owner: 'W2-13 · W2-16b', concepts: ['concept.rateLimit'],
    note: 'team.invite.rateLimited keeps its own noun ("יותר מדי הזמנות…").',
  },
  forbidden: {
    key: 'components.errors.forbidden',
    he: 'אין לכם הרשאה לפעולה הזו.',
    use: 'error',
    screens: ['any forbidden action · all roles'],
    replaces: ['auth.serverErrors.forbidden (identical text, second key)'],
    batch: 'W2', owner: 'W2-13', concepts: ['concept.forbidden'],
  },
  invalidInput: {
    key: 'components.errors.validation',
    he: 'חלק מהשדות אינם תקינים. בדקו ונסו שוב.',
    use: 'error',
    screens: ['any form · all roles'],
    replaces: ['auth.serverErrors.invalidInput (lookup-table trap, see notFoundItem)'],
    batch: 'W2', owner: 'W2-13 · W2-16b', concepts: ['concept.invalidInput'],
  },
  magicLinkSent: {
    key: 'auth.mail.sentTo',
    he: 'שלחנו קישור כניסה ל-{email}, תקף ל-24 שעות.',
    use: 'status',
    screens: ['/login?sent=1, /login/check-email · all', 'any route · re-auth sheet after "שלחו לי קישור כניסה למייל" · all roles'],
    replaces: ['auth.checkEmail.body (Batch P)', 'common.shell.session.magicSent (Batch P keeps "פתחו אותו וחזרו לכאן")', 'auth.login.sent'],
    batch: 'P+W2', owner: 'W2-16b · W2-13', receiverOverlay: true, concepts: ['concept.magicLink'],
    note: 'One name for the link: "קישור כניסה" (not "קישור התחברות", not "קישור-קסם"). settings.account.* and settings.sections.securitySubtitle follow in W2-14.',
  },
  linkExpired: {
    key: 'auth.reset.token',
    he: 'הקישור פג או כבר נוצל. בקשו קישור חדש.',
    use: 'error',
    screens: ['/reset?token=…&error=token · all', '/login?error=Verification · all'],
    replaces: ['auth.login.errors.verification (Batch P)'],
    batch: 'P', owner: 'W2-16b', receiverOverlay: true, concepts: ['concept.linkExpired'],
  },
  devicesSignOut: {
    key: 'auth.reset.chooseSubtitle',
    he: 'כל המכשירים יתנתקו אחרי האיפוס.',
    use: 'line',
    screens: ['/reset?token= · above the new-password field · all'],
    replaces: ['auth.login.resetDone (Batch P drops the after-the-fact repeat)', 'auth.setPassword.subtitleChange ("שאר המכשירים יתנתקו.")', 'settings.account.devicesHint (cut; the confirmation says it)'],
    batch: 'P+W2', owner: 'W2-16b · W2-14', concepts: ['concept.devicesSignOut'],
    note: 'Said once, before the action. The settings confirmation "…כולל המכשיר הזה?" stays (destructive confirmation).',
  },
  passwordPolicy: {
    key: 'auth.setPassword.errors.policy',
    he: 'הסיסמה חייבת להכיל לפחות {min} תווים.',
    use: 'error',
    screens: ['/set-password, /reset?token= · all'],
    replaces: ['auth.reset.policy (identical)', 'auth.reset.mismatch → auth.setPassword.errors.mismatch (identical pair)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.passwordPolicy'],
  },
  twoFactor: {
    key: 'settings.twoFactor.disabledBody',
    he: 'מומלץ: קוד מאפליקציית אימות בכל כניסה.',
    use: 'line',
    screens: ['/dashboard/settings · 2FA card · all roles'],
    replaces: ['settings.sections.securitySubtitle (cut)', 'auth.twoFactor.subtitle ("הזינו את הקוד מאפליקציית האימות." on /login/2fa)'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.twoFactor'],
  },
  lastOwner: {
    key: 'auth.serverErrors.lastOwner',
    he: 'אי־אפשר להוריד את הבעלים האחרון. קדמו קודם בעלים נוסף.',
    use: 'error',
    screens: ['/dashboard/team · role change · owner', '/admin/restaurants/[id] · roles · platform admin'],
    replaces: ['auth.serverErrors.adminLastOwner (identical)', 'admin.roles.lastOwner (identical)', 'settings.dsr.note (owner-transfer tail; said by soleOwner at the moment of deletion)'],
    batch: 'W2', owner: 'W2-14 · W2-16b', concepts: ['concept.lastOwner'],
    note: 'Lookup-table trap: change packages/api/src/routers/{team,admin,dsr}.ts prose in the same PR (serverErrors.test.ts :6 :16 :53).',
  },
  entitlement: {
    key: 'auth.serverErrors.entitlementRequired',
    he: 'לא כלול בתוכנית שלכם. שדרגו כדי להשתמש.',
    use: 'error',
    screens: ['any gated action · owner, manager'],
    replaces: ['auth.serverErrors.quotaExceeded (keeps its limit)', 'orders.wizard.guardrailGated (Batch P: plan line)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.entitlement'],
    note: 'components.entitlement.* (the upsell card) stays.',
  },
  fileTooLarge: {
    key: 'catalog.import.errors.TOO_LARGE',
    he: 'הקובץ גדול מדי. פצלו אותו או שמרו כ-CSV.',
    use: 'error',
    screens: ['/dashboard/catalog/import · owner, manager', '/dashboard/contracts/import · owner, manager'],
    replaces: ['contracts.import.errors.TOO_LARGE (Batch P, same value)', 'contracts.import.tooBig', 'catalog.import.tooBig'],
    batch: 'P+W2', owner: 'W2-16b (canonical) · W2-12 reads it', concepts: ['concept.fileLimits'],
    note: 'Same rule for LEGACY_XLS ("קובץ ‎.xls ישן. שמרו אותו כ-‎.xlsx או CSV."), UNREADABLE ("הקובץ לא נקרא. העלו ‎.xlsx או CSV תקין.") and EMPTY ("חסרה שורת כותרות בשורה הראשונה."): catalog is canonical, contracts reads it in W2 (identical values in Batch P).',
  },
  fileLimitsLine: {
    key: 'catalog.import.formats',
    he: 'Excel או CSV, גם בעברית · עד 9MB',
    use: 'line',
    screens: ['/dashboard/catalog/import · under the drop zone · owner, manager', '/dashboard/contracts/import · under the drop zone (+ "ו-5,000 שורות") · owner, manager'],
    replaces: ['contracts.import.formats', 'contracts.import.dropHint (one limits line per wizard)'],
    batch: 'P+W2', owner: 'W2-16b · W2-12', concepts: ['concept.fileLimits'],
  },
  rowsDetected: {
    key: 'catalog.import.rowsDetected',
    he: 'זוהו {count} שורות. בדקו את העמודות:',
    use: 'status',
    screens: ['/dashboard/catalog/import · mapping step · owner, manager', '/dashboard/contracts/import · mapping step · owner, manager'],
    replaces: ['contracts.import.rowsDetected', 'contracts.import.mapRequired = contracts.import.errors.MAPPING (identical pair)', 'catalog.import.mapNameRequired = catalog.import.errors.MAPPING_NAME (identical pair)'],
    batch: 'W2', owner: 'W2-16b · W2-12', concepts: ['concept.importMapping'],
  },
  noPriceList: {
    key: 'suppliers.catalogTab.emptyTitle',
    he: 'אין מחירון לספק הזה',
    use: 'status',
    screens: ['/dashboard/suppliers/<id>?tab=catalog · empty state · owner, manager', '/dashboard/orders/new · step 2 (+ "הוסיפו שורה חופשית.") · owner, manager, chef', '/dashboard/catalog · supplier picked, no rows · owner, manager'],
    replaces: ['orders.wizard.catalogEmpty (Batch P)', 'catalog.browser.emptyBody', 'catalog.history.empty'],
    batch: 'P+W2', owner: 'W2-11 · W2-06 · W2-16b', concepts: ['concept.noPriceList'],
  },
  noSuppliers: {
    key: 'orders.wizard.noSuppliers',
    he: 'עוד אין ספקים פעילים.',
    use: 'status',
    screens: ['/dashboard/orders/new · step 1 (+ "הוספת ספק" button) · owner, manager, chef', '/dashboard/orders/capture (+ "הוסיפו ספק קודם." — no button there) · owner, manager, chef', '/dashboard/catalog/import (+ inline field) · owner, manager'],
    replaces: ['ingest.orderCapture.noSuppliers (Batch P)', 'catalog.import.noSuppliers (Batch P)', 'suppliers.manager.emptyBody'],
    batch: 'P', owner: 'W2-06 · W2-02 · W2-16b · W2-11', concepts: ['concept.noSuppliers'],
  },
  recordOnly: {
    key: 'orders.detail.channels.none',
    he: 'ללא שליחה · רישום בלבד',
    use: 'label',
    screens: ['/dashboard/orders/new · send step · owner, manager, chef', '/dashboard/orders/<poId> · channel · owner, manager, chef'],
    replaces: ['orders.wizard.channelNone (identical; Batch P)', 'orders.send.cta.none → "סמנו כנשלחה · בלי הודעה לספק" (Batch P)', 'orders.detail.cancelSentWarning (dead)'],
    batch: 'P+W2', owner: 'W2-06', concepts: ['concept.recordOnly'],
    note: 'Week 1 for ציקטי is record-only: one vocabulary for "recorded, the supplier gets nothing".',
  },
  unpricedExcluded: {
    key: 'orders.detail.totalExcludes',
    he: 'לא כולל {count} שורות ללא מחיר',
    use: 'status',
    screens: ['/dashboard/orders/new · total · owner, manager, chef', '/dashboard/orders/<poId> · total · owner, manager, chef'],
    replaces: ['orders.wizard.totalExcludes (+One) (identical pair)'],
    batch: 'W2', owner: 'W2-06', concepts: ['concept.unpricedExcluded'],
    note: 'The supplier portal (/s/:token, separate bundle) keeps its own copy, allowlisted in the guard (G-10).',
  },
  outstanding: {
    key: 'recovery.report.outstanding',
    he: 'עדיין חייבים לכם (על חשבוניות החודש)',
    use: 'label',
    screens: ['/dashboard/reports/monthly · owner, manager', '/dashboard/reports/digest · owner'],
    replaces: ['recovery.digest.outstanding', 'packages/api/src/reports/monthly.ts he.outstanding (server copy, unowned → W3-08)'],
    batch: 'W2', owner: 'W2-10', concepts: ['concept.outstanding'],
    note: 'House style: "לכם", not "לך".',
  },
  receiptClosed: {
    key: 'receivingDelivery.delivery.summary.title',
    he: 'קבלת הסחורה כבר נסגרה',
    use: 'status',
    screens: ['/dashboard/receiving/<poId> · closed receipt · receiver, manager', 'server CONFLICT on a closed receipt → appCode receipt_closed → this key · receiver, manager'],
    replaces: ['server:receiving.startReceipt / markGrLine CONFLICT prose (never shown; "משהו השתבש" today)', 'overview.board.receipt.readOnly (Batch P → explain.viewOnly; the badge "התקבל ✓" says closed)'],
    batch: 'W2', owner: 'W2-05', receiverOverlay: true, concepts: ['concept.receiptClosed'],
  },
  bulkNotCounted: {
    key: 'receivingDelivery.delivery.count.bulkTag',
    he: 'לא נספר פריט-פריט',
    use: 'label',
    screens: ['/dashboard/receiving/<poId> · count rows, summary rows, confirmation · receiver, manager'],
    replaces: ['receivingDelivery.delivery.confirmed.bulkNote (Batch P keeps "לא נספרו פריט-פריט", pinned by W1-06.spec.ts:332)'],
    batch: 'P', owner: 'W2-05', receiverOverlay: true, concepts: ['concept.bulkNotCounted'],
  },
  othersWaiting: {
    key: 'approvals.empty.othersWaiting',
    he: 'אין פערים שמחכים לכם.',
    use: 'status',
    screens: ['/dashboard/approvals · empty "for you" state above the "ממתין לאחרים" lane · bookkeeper, manager'],
    replaces: ['approvals.empty.othersWaitingMany (identical value in Batch P)'],
    batch: 'P', owner: 'W2-04', concepts: ['concept.othersWaiting'],
  },
  missingPrice: {
    key: 'recipes.list.incomplete',
    he: 'חסר מחיר לחלק מהרכיבים',
    use: 'label',
    screens: ['/dashboard/recipes · dish level · owner, manager, chef'],
    replaces: ['recipes.summary.incomplete', 'recipes.pos.incomplete', 'inventory.period.theoryIncomplete (dish level)'],
    batch: 'W2', owner: 'W2-16b · W2-07', concepts: ['concept.missingPrice'],
    note: 'Three levels, three wordings, one each: dish "חסר מחיר לחלק מהרכיבים"; ingredient row "אין מחיר ששולם" (recipes.editor.status.missingPrice, recipes.editor.noPrice merges into it); count line "אין מחיר".',
  },
  notAfterLast: {
    key: 'inventory.count.notAfterLast',
    he: 'כבר נסגרה ספירה ב-{date}. בחרו תאריך מאוחר יותר.',
    use: 'error',
    screens: ['/dashboard/inventory/count · date picker · owner, manager, chef'],
    replaces: ['inventory.count.closedOnWarn'],
    batch: 'W2', owner: 'W2-07', concepts: ['concept.notAfterLast'],
  },
  billingOwner: {
    key: 'chain.branches.notPayer',
    he: 'רק בעלי חשבון החיוב פותחים סניפים חדשים.',
    use: 'error',
    screens: ['/dashboard/branches · add branch · owner'],
    replaces: ['chain.errors.notPayer (identical)', 'chain.branches.subtitle / chain.dashboard.scopeNote (billing phrase)'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.billingOwner'],
  },
  branchLimit: {
    key: 'chain.branches.limitReached',
    he: 'הגעתם למגבלת הסניפים במסלול. שדרגו כדי להוסיף סניף.',
    use: 'error',
    screens: ['/dashboard/branches · owner'],
    replaces: ['chain.errors.limit'],
    batch: 'W2', owner: 'W2-16b', concepts: ['concept.branchLimit', 'concept.chainUpsell'],
    note: 'Upsell body: chain.dashboard.upsellBody = "במסלול רשת: עוד סניפים, וכולם במסך אחד." (chain.branches.noBilling reuses it).',
  },
  askRateLimit: {
    key: 'ask.rateLimited',
    he: 'הרבה שאלות בזמן קצר — חכו רגע ושאלו שוב.',
    use: 'error',
    screens: ['/dashboard/ask · owner, manager'],
    replaces: ['packages/api/src/ask/index.ts:53 Hebrew prose (server returns a code only)'],
    batch: 'W2', owner: 'G-12', concepts: ['concept.askRateLimit'],
    note: 'The three ask.offlineNote.* keep only their reason; the badge "תשובה מהנתונים" says "from data" once.',
  },
  poUnchanged: {
    key: 'supplierConfirm.card.poUnchanged',
    he: 'ההזמנה לא שונתה — בדקו את ההבדלים.',
    use: 'line',
    screens: ['/dashboard/orders/<poId> · supplier-answer card · owner, manager'],
    replaces: ['supplierConfirm.portal.subtitle (tail)', 'supplierConfirm.card.subtitle (tail)'],
    batch: 'W2', owner: 'G-10', concepts: ['concept.poUnchanged'],
    note: 'Both dead-link pages of /s/:token end with the same action "בקשו מהמסעדה קישור חדש." (supplierConfirm.portal.errors.expired canonical).',
  },
  vatAffectsLeak: {
    key: 'settings.profile.cardSubtitle',
    he: 'מע״מ ואזור הזמן משפיעים על חישוב הדליפה. ודאו שהם נכונים.',
    use: 'line',
    screens: ['/dashboard/settings · restaurant details card · owner, manager, bookkeeper'],
    replaces: ['settings.sections.profileSubtitle (cut; the two lines sit 6 cm apart on one screen)'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.vatAffectsLeak'],
  },
  belowNotFlagged: {
    key: 'settings.matching.fields.belowNotFlagged',
    he: 'פער קטן מזה לא מסומן.',
    use: 'line',
    screens: ['/dashboard/settings · matching thresholds, under both price fields · owner'],
    replaces: ['settings.matching.fields.pricePercentHint ("חריגת מחיר…")', 'settings.matching.fields.priceAbsoluteHint'],
    batch: 'W2', owner: 'W2-14', concepts: ['concept.flagThreshold'],
    note: 'New key (W2-14 adds it). Removes "חריגה" twice.',
  },
} as const satisfies Record<string, SharedExplanation>;

export type SharedConcept = keyof typeof SHARED_EXPLANATIONS;
