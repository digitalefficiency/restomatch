/**
 * 'overview' namespace (Hebrew — source of truth).
 * Owner: W1-05 — the role homes on /dashboard ("Today"), the leak hero and the
 * receiving board. Voice: plural imperative or a noun on buttons, never
 * masculine singular.
 */
export const he = {
  title: 'חדר הבקרה',
  subtitle: 'איפה כסף בורח, ומה מחכה להחלטה שלכם.',
  loading: 'טוען',
  /** The h1 of each role's home: the role's job, not the owner's control room. */
  homeTitle: {
    owner: 'מה מחכה לך היום',
    manager: 'המשמרת היום',
    bookkeeper: 'שולחן החשב',
    chef: 'המטבח היום',
    receiver: 'המשלוחים של היום',
  },
  homeSubtitle: {
    owner: 'קודם מה דורש החלטה, אחר כך הדליפה של החודש.',
    manager: 'אישורים, הזמנות ומשלוחים — לפי מה שדחוף.',
    bookkeeper: 'מה פתוח לפני סגירת החודש.',
    chef: 'ספירה ועלות מנות.',
    receiver: 'המשאית הבאה למעלה, אחריה כל השאר.',
  },
  /** The owner home's context line under the title (DS3 §10.1): "יום שבת, 21.11.2026" (Israel time). */
  homeDate: '{weekday}, {date}',
  section: {
    failed: 'לא נטען',
    retry: 'נסו שוב',
  },
  view: {
    open: 'תצוגה',
    close: 'סגירת התצוגה',
  },
  hero: {
    eyebrow: 'דליפה שזוהתה · {month}',
    leakedLabel: 'דליפה החודש',
    /** Beside the label, outside the h2: the hero counts from the 1st of the month. */
    period: 'מתחילת {month}',
    /** The scale sentence (glossary `leakBase`): "1.9% מהרכש שנבדק, מתוך ₪41,526 לפני מע״מ". */
    pctOfChecked: 'מהרכש שנבדק',
    /** The base after the %: it brings its own comma. */
    pctBase: ', מתוך {spend} לפני מע״מ',
    /** The base alone, on a thin base (no %). */
    spendBase: 'מתוך {spend} לפני מע״מ',
    noSpend: 'עדיין אין חשבוניות החודש',
    /** Split of the leak by payment status (the two parts add up to it, to the agora). */
    unpaid: 'על חשבוניות שעוד לא שולמו',
    paid: 'על חשבוניות ששולמו',
    split: 'מתוכם',
    splitAria: 'הדליפה מתחלקת לשניים',
    unpaidLink: 'לחשבוניות שלא שולמו',
    paidLink: 'לבקשות הזיכוי',
    /** One line when (almost) all of the leak sits on one side. Nothing marks payments yet: "not marked as paid". */
    allUnpaid: 'כל הסכום על חשבוניות שלא סומנו כשולמו',
    allUnpaidLink: 'לחשבוניות שלא סומנו כשולמו',
    allPaid: 'כל הסכום על חשבוניות ששולמו',
    invoices: 'חשבוניות עם פער',
    invoicesValue: '{withLeak} מתוך {total}',
    /** The foot line: "34 חשבוניות נבדקו, ב־13 מהן נמצא פער" (numbers, never formatted strings). */
    checkedLine:
      '{total, plural, one {חשבונית אחת נבדקה ונמצא בה פער} other {# חשבוניות נבדקו, {withLeak, plural, =0 {ולא נמצא פער} one {באחת מהן נמצא פער} other {ב־# מהן נמצא פער}}}}',
    drill: 'לחשבוניות שמאחורי {amount}',
    drillPending: 'לחשבוניות שממתינות לשיוך',
    howCalc: 'איך חישבנו?',
    more: 'עוד פעולות',
    /** T4 lines (grey, a clock): what waits and is in neither the leak nor the spend. One sentence, the basis inside. */
    pending: '{count, plural, one {חשבונית אחת ממתינה} other {# חשבוניות ממתינות}} לשיוך להזמנה: {amount} כולל מע״מ',
    awaitingQuestion: '{count, plural, one {חשבונית אחת מחכה} other {# חשבוניות מחכות}} לתשובה אם זה אותו מוצר: {amount} כולל מע״מ',
    awaitingQuestionCta: 'לשאלות',
    awaitingCount: '{count, plural, one {חשבונית אחת ממתינה} other {# חשבוניות ממתינות}} לסגירת קבלת הסחורה: {amount} כולל מע״מ',
    clean: 'אין דליפה · {count, plural, one {חשבונית אחת נבדקה} other {# חשבוניות נבדקו}}',
    thinBase: '{count, plural, one {מוקדם לאחוז: נבדקה רק חשבונית אחת} other {מוקדם לאחוז: נבדקו רק # חשבוניות}}',
    noData: {
      title: 'עוד לא נבדקו חשבוניות ב{month}',
      hint: 'הדליפה תחושב אחרי שחשבונית תותאם להזמנה ולקבלת הסחורה.',
      cta: 'צלמו חשבונית',
    },
    /** The change against the same days last month, in words; the % (unsigned) follows in parentheses. */
    delta: {
      downBy: 'ירידה של {amount}',
      upBy: 'עלייה של {amount}',
      same: 'ללא שינוי',
      vsSameDays: 'לעומת אותם ימים ב{month}',
      none: 'אין נתוני השוואה',
      noneYoy: 'אין חשבוניות באותם ימים בשנה שעברה להשוואה',
    },
    /** The pace line: legends, and the figure's name in words (never a total). */
    pace: {
      aria: 'הדליפה המצטברת מתחילת {month}, מול אותם ימים ב{prevMonth}. {trend}.',
      ariaCurOnly: 'הדליפה המצטברת מתחילת {month}',
      prev: '{month}, אותם ימים',
      trend: {
        up: 'החודש מעל {prevMonth}',
        down: 'החודש מתחת ל{prevMonth}',
        same: 'החודש כמו {prevMonth}',
      },
    },
    /** "איך הגענו לסכום?" — the calculation, opened in place. */
    calcAria: 'החישוב של הדליפה, שורה אחרי שורה',
    calcTitle:
      'הסכום, שורה אחרי שורה: {gaps, plural, one {פער אחד} other {# פערים}} {invoices, plural, one {בחשבונית אחת} other {ב־# חשבוניות}}',
    calcGaps: '{count, plural, one {פער אחד} other {# פערים}}',
    calcCap: 'בניכוי מה שמעל סכום החשבונית',
    calcTotal: 'סך הכול, לפני עיגול לשקל',
    calcCounted: 'נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית.',
    calcNotCounted: 'לא נספרים:',
    calcNotDuplicate: 'חשבונית שסומנה "לא כפולה"',
    calcLink: 'לפירוט המלא לפי חשבונית',
    calcChanged: 'הסכום התעדכן מאז שהדף נטען',
    calcRefreshCta: 'רענון',
    returned: 'הוחזר החודש',
    returnedHint: 'זיכויים שהתקבלו החודש, גם על חודשים קודמים',
    trendShow: 'הצג מגמה',
  },
  needs: {
    title: 'מחכה לך',
    // No ✓ in the words: the card draws the round green tick beside them (T3).
    zero: 'הכול מטופל',
    zeroCaught: 'הכול מטופל · אין החלטות פתוחות',
    more: 'עוד {count}',
    /** "עוד" at the foot of the card: how many rows wait behind it (a number). */
    moreTasks: '{count, plural, one {עוד משימה אחת} two {עוד שתי משימות} other {עוד # משימות}}',
    /** The solid pill on the decision row (T2): how many of its gaps block a payment (a number). */
    blocking: '{count, plural, one {# חוסם תשלום} other {# חוסמים תשלום}}',
    /** The decision row's count of gaps on the home card (a number; the bell keeps decide.sub). */
    decideGaps: '{count, plural, one {פער אחד} other {# פערים}}',
    /** Under a credit-request amount: the requests are claimed on different VAT bases. */
    basisMixed: 'לפי בסיס המע״מ של כל בקשה',
    decide: {
      label: 'ממתין להחלטה שלך',
      sub: '{count} פערים',
      subBlocking: '{count} פערים · {blocking} חוסמים תשלום',
      verb: 'להחלטה',
      review: '{count} לבדיקה (ללא ₪)',
      duplicates: '+ {amount} בחשבוניות כפולות (כולל מע״מ)',
      vat: '+ {amount} בהפרשי מע״מ',
    },
    // The recovery page's two follow-up queues, in its own words.
    claimsWaiting: { label: 'ממתינות לתשובת ספק מעל {days} ימים', sub: '{count} בקשות', verb: 'לתזכורות' },
    claimsUnsent: { label: 'בקשות זיכוי לשליחה', sub: '{count} בקשות', verb: 'לשליחה' },
    vat: { label: 'ללא מספר הקצאה', sub: '{count} חשבוניות · נותרו {days} ימים', verb: 'לבקשה מהספק' },
    payRun: { label: 'ריצת התשלומים של החודש', sub: '{count} חשבוניות לתשלום', verb: 'לריצה' },
    deliveries: { label: 'משלוחים היום', sub: '{received} התקבלו · {late} באיחור', verb: 'לקבלה' },
    deliveriesValue: '{count} משלוחים',
    count: { label: 'ספירת מלאי פתוחה', sub: '{counted} מתוך {lines} פריטים נספרו', verb: 'להמשך הספירה' },
    countValue: '{counted}/{lines}',
    cutoffs: { label: 'הזמנות שנסגרות היום', sub: 'הבא: {supplier} ב־{time}', verb: 'להזמנה' },
    cutoffsValue: '{count} ספקים',
    invoiceLines: { label: 'חשבוניות שממתינות לכם', verb: 'לבדיקה' },
    invoiceLinesValue: '{count, plural, one {חשבונית אחת} other {# חשבוניות}}',
    exportLast: { label: 'ייצוא אחרון להנהלת החשבונות', value: 'עדיין לא נרשם', verb: 'לייצוא' },
    // W2-08 task spine.
    leakLink: 'דליפה החודש',
    why: 'איך הגענו לסכום?',
    whyBase: 'מתוך קניות של {spend} לפני מע״מ שנבדקו.',
    whySplit: 'בחשבוניות שעוד לא שולמו: {unpaid} · בחשבוניות ששולמו: {paid}.',
    age: { today: 'מהיום', days: 'לפני {days} ימים' },
    othersLine: 'אצלך הכול מטופל · {count} ממתינים אצל {who} · {amount}',
    othersLineCount: 'אצלך הכול מטופל · {count} ממתינים אצל {who}',
    who: { owner: 'הבעלים', manager: 'המנהלים', bookkeeper: 'הנהלת החשבונות', receiver: 'הקבלה', chef: 'המטבח' },
    staffZero: 'אצלך הכול מטופל',
    failed: 'חלק מהמשימות לא נטענו · נסו שוב',
    lateValue: '{count} באיחור',
  },
  rail: {
    title: 'עוד החודש',
    recovery: 'הוחזר החודש',
  },
  chef: {
    countTitle: 'ספירת מלאי',
    countOpen: 'ספירה פתוחה · {counted} מתוך {lines}',
    countOpenHint: 'נשארו {left} פריטים לספירה',
    countContinue: 'המשך הספירה',
    countNone: 'אין ספירה פתוחה',
    countNoneHint: 'ספירה שבועית מראה את עלות המזון בפועל.',
    countStart: 'התחלת ספירה',
    countOff: 'ספירת מלאי לא הופעלה במסעדה',
    dishesTitle: 'מנות שעלות המזון שלהן עלתה',
    dishesSubtitle: 'עלות המזון עלתה מעל {target} בגלל מחיר רכיב.',
    dishCause: '{ingredient} · {supplier}',
    dishCost: '{before} ← {after}',
    dishesNone: 'אין מנות כאלה החודש ✓',
    dishesAll: 'לכל המנות',
    dishesOff: 'עלות מנה לא הופעלה במסעדה',
  },
  board: {
    summary: 'היום: {total} משלוחים · {received} התקבלו · {late} באיחור',
    next: 'המשאית הבאה',
    groups: {
      late: 'באיחור',
      now: 'עכשיו / הבא',
      later: 'בהמשך היום',
      undated: 'ללא תאריך',
      received: 'התקבלו',
    },
    cta: {
      start: 'התחלת קבלה',
      continue: 'המשך קבלה',
      received: 'התקבל ✓',
      partial: 'התקבל חלקית ✓',
    },
    state: {
      inProgress: 'בקבלה',
      late: 'באיחור',
      lateSince: 'היה צפוי {date}',
    },
    items: '{count} פריטים',
    noDate: 'ללא תאריך משלוח',
    closedAt: 'נסגר {time}',
    noPo: {
      title: 'חשבונית בלי הזמנה',
      hint: 'בקשו מהמנהל לפתוח הזמנה.',
    },
    empty: {
      title: 'אין משלוחים צפויים היום',
      hint: 'משלוחים מהזמנות עם תאריך אספקה יופיעו כאן.',
    },
    receipt: {
      title: 'הקבלה של {supplier}',
      readOnly: 'צפייה בלבד',
      back: 'חזרה ללוח המשלוחים',
      product: 'פריט',
      ordered: 'הוזמן',
      received: 'התקבל',
      rejected: 'נדחה',
      notFound: 'הקבלה לא נמצאה',
      followUp: {
        cta: 'הגיע משלוח המשך — להשלים את הקבלה',
        hint: 'קבלת הסחורה תיפתח שוב לספירת המשלוח · נרשם ביומן',
        failed: 'לא הצלחנו לפתוח את הקבלה. נסו שוב.',
      },
    },
  },
  kpis: {
    clean: 'התאמות נקיות השבוע',
    cleanHint: 'ממוצע שבעת הימים האחרונים',
    cleanNone: 'אין התאמות עדיין השבוע',
  },
  leaks: {
    title: 'מחירים שעלו · 30 יום אחרונים',
    subtitle: 'מעל המחיר הרגיל אצל אותו ספק · לא חלק מהדליפה',
    all: 'לכל עליות המחיר',
    upsell: 'שדרגו כדי לראות את כל המחירים שעלו',
  },
  activity: {
    title: 'פעילות אחרונה',
    subtitle: 'מה קרה במערכת לאחרונה.',
    emptyTitle: 'עדיין אין פעילות',
    emptyDescription: 'היומן יתמלא כשחשבוניות ייקלטו.',
  },
};
