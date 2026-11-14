# ROLE-NEEDS · מה כל תפקיד בא לשאול, ומה המינימום שעונה

**IA review, input for the data-order proposal.** 7.11.2026. Base: `origin/main` @ `4c887688` (wave 1 #167 + train A #228). Nothing here changes code.

**The owner's request (7.11):** "the data is scattered and dense across the whole system; we need a more efficient, healthier order; some things don't need to be shown everywhere; understand what is right for each role in terms of showing data / the reason / what happened".

**What this file does.** For each role it lists:
- the questions the role opens the product to answer, in priority order, with how often and on which device;
- for each question, the smallest set of data that answers it, in four layers (§0.1);
- the role's **home**: at most 5 items on the first screen;
- what the role must **never** see.

§4 is the cross-role contract: one name and one home screen per number, a ₪ visibility matrix, and where each layer may appear. §5 lists the open questions for the owner, each with a default.

**Sources.**
- `STATE.md`, `docs/ICP.md`.
- `docs/ux/wave2/README.md` §7 and §12 (binding owner decisions).
- `docs/ux/automation/README.md` §7 (AD1–AD14, PR #235), `docs/ux/sidebar/SPEC.md` §4 and §11.
- Wave-2 briefs on `origin/claude/wave2-kit-addendum-0711`: G-12, W2-02, W2-08, W2-09, W2-11, W2-13. W2-16 is read from `dc4504c2`.
- `scratchpad/ds2/PROCESSES.md`: the 12 jobs J1–J12 and their frequencies. This file reuses its frequencies and does not repeat its tap counts.
- The sibling inventories in this folder: `inventory-money.md` (figure map F1–F18, density), `inventory-operations.md`, `inventory-documents.md`, `inventory-suppliers-admin.md`.
- Code on `main`: `app/dashboard/page.tsx`, `home/finance.tsx`, `home/staff.tsx`, `lib/roles.ts`, `lib/nav/routes/*.ts`, `packages/api/src/approvals/engine.ts`, `packages/api/src/lib/roles.ts`.
- Screenshots:
  - `site-tour/live/01, 05, 11, 12, 14` (live, 7.11);
  - `ia/folds/home-manager-phone` (31.10);
  - `ux/shots/dashboard__*` (25.10).

---

## 0. בקצרה · The short version

1. **The density comes from one habit: every screen answers every role's every layer at once.** Two examples:
   - **The owner's desktop home.** Its first screen holds about 12 blocks, 169 words, 45 numbers, 12 red or orange marks and 5 open explanation paragraphs (`live/01`, `inventory-money.md` §2). Those blocks are:
     - 5 money tiles;
     - the VAT card;
     - the leak hero with 2 split tiles;
     - the pending-link sentence;
     - the trend;
     - "מחירים שעלו";
     - the activity feed;
     - "הוחזר";
     - price alerts;
     - "dishes over target".

     The owner needs **one number and three tasks**.
   - **The manager's phone home** is titled "המשמרת היום" but opens on the month's leak hero ₪854. It shows two "awaiting" figures for one idea: ₪390 "על חשבוניות שעוד לא שולמו" and ₪153 "ממתין להחלטה שלך" (`ia/folds/home-manager-phone`).
2. **The fix is a layer rule, not a redesign.** Every question has four layers. Only two of them (**WHAT** and **WHAT TO DO**) belong on a working screen by default. **WHY** opens in place, on demand. **WHAT HAPPENED** lives on the record or the audit screen, never on a home (§0.1, §4.3).
3. **One number, one name, one home screen.** Today the same idea is printed under up to 7 names, and one name carries up to 3 different numbers (F6/F7, F10, F12, F13 in `inventory-money.md` §1). §4.1 gives each of the 15 numbers the product shows a single definition, a single place where it is acted on, and the roles that see it. Everywhere else it appears only as a link.
4. **Homes per role (≤5 items each), in short:**

   | Role | Home = the answer to | First item |
   |---|---|---|
   | Owner | "What leaked, and what needs me?" | Compact leak hero, then the top 3 tasks by ₪ × due date |
   | Manager | "What does today's shift need from me?" | Decisions in my band, then trucks, cut-offs and supplier changes. The leak is a link, not the hero (Q-A) |
   | Bookkeeper | "Is the month ready, and what is at risk?" | Month close x/6 or documents to review, then VAT at risk, then credit notes to link. No leak hero (Q-B) |
   | Chef | "What do I order before the cut-off, and what is left to count?" | Orders closing today, then what did not arrive (quantities only), then the count, then dishes over the desired food cost |
   | Receiver | "Which truck is next, and what should be on it?" | The next truck with one big button. No ₪ anywhere |
   | Supplier (link) | "What was ordered, and what is claimed from me?" | The order with its total, and 2 taps to confirm |

5. **Access today is not wired to the owner's decisions:**
   - The owner said the bookkeeper "reads everything", but the route registry denies her 10 screens: orders, receiving, the suppliers list, catalog, products, recipes, inventory, team, the monthly report and the digest.
   - Receiver and chef ₪ still travel in the tRPC JSON (H-11).
   - Visibility is decided in three places: 47 inline `role === …` checks in 25 files, the route registry, and server procedures.

   A role matrix is only real when one capability table (G-07 `can()`) drives all three (§4.2).

### 0.1 The four layers (one vocabulary for the whole review)

| Layer | Hebrew | What it holds | Default placement |
|---|---|---|---|
| **WHAT** | מה המצב | The state and **one number** (₪ if the role may see it, otherwise a count or a quantity), plus its due date or age | Always visible |
| **WHY** | למה / איך חישבנו | The reason or the calculation: billed vs received vs ordered, the price source and its date, the threshold, what counts in the leak, the formula | **On demand**, with one exception: on a decision card, the one-line math needed to decide stays open (`WhyLine`, e.g. "חויבו 9.5 ק״ג · התקבלו 6.5 = ₪38.70"). Everything longer opens in place behind `<Explain>` (W2-16) or in the evidence peek (W2-04) |
| **WHAT HAPPENED** | מה קרה | History: who decided what and when, sent and answered, past months, the activity feed, funnels and ageing, closed items | **On demand** on working screens: a tab, a "היסטוריה" fold or the record's document chain. **Open by default only on audit screens**: leak proof, report, supplier ledger, export log |
| **WHAT TO DO** | מה עושים | **One primary verb** that names the ₪ (when allowed) and a due chip; at most one secondary | Always visible, one per row or card, one per screen in field mode |

**The rule in one line:** on a home, show WHAT + WHAT TO DO. On a queue, add the one-line WHY. On a record, add a one-line WHAT HAPPENED (the document chain). Only on an audit screen are WHY and WHAT HAPPENED the content itself.

---

## 1. התפקידים במבט אחד · Roles at a glance

| Role | Persona | Main device · when | Opens the app | Decides | ₪ shown (owner decisions) |
|---|---|---|---|---|---|
| **Owner** (בעלים) | איתן: buys and signs, 1–3 branches | Phone in the morning and between services; laptop at the office | Daily, for minutes | Gaps **above ₪300 / 5%** and **every blocking gap**; pay-run release; bank-detail holds (AD12); supplier sends (one tap each, AD10) | Everything |
| **Manager** (מנהל/ת) | Floor or kitchen manager | Phone at the pass; laptop near cut-offs | Several times a day | Gaps of **₪50–300 / 2–5%** (engine `cumulative-medium`, fallback queue); walk-in approval (decision 21); supplier changes | Everything except the pay run and the VAT tasks (§2.2 Never) |
| **Bookkeeper** (מנהלת חשבונות) | מיכל: in-house, or external with 10–30 restaurants | Laptop, often two screens, in batches | Daily or weekly batches; the month close by the 15th | Items routed to her (`DUPLICATE_INVOICE` → bookkeeper, `engine.ts`); intake and OCR fixes (Q5 in PROCESSES, default yes); credit-note links | Everything, read. She edits account cards (audit log) |
| **Chef** (שף) | Head chef | Phone in the kitchen and the walk-in (cold, gloves, no signal) | Several times a week; the count monthly (W2-16 owner decision) | Sends orders directly, with no approval | **Only** on the orders screens and in recipes (plate cost, menu price, margin) |
| **Receiver** (מקבל סחורה) | רמי: whoever is on shift | Own Android at the back door; the driver is waiting | 2–3 trucks a day (peaks of 5–8), from 06:30 | Nothing with money. Counts and records | **None**, notifications included |
| **Supplier** (ספק, link) | The supplier's agent | Phone on the road, 3G, no account | Per order and per claim | Confirm or change an order; answer a claim | Their own order and their own claim lines only |
| **Platform admin** | RestoMatch ops (Rom) | Laptop | Daily during the pilot | Plans, trials, pilot health | Operational counts. Tenant ₪ only when opening a tenant on purpose |

---

## 2. Per-role needs

Each table lists the questions in priority order. **Freq** uses the typical ICP restaurant from PROCESSES §0: ₪200k/month, about 14 deliveries/week, about 60 invoices/month. The **Lives on** column names the one screen where the question is answered and acted on. Every other screen links there.

### 2.1 בעלים · Owner

**Context:** he reads one number and decides between services. If the first screen does not say "what needs me, and how much ₪", he stops opening the app, and the leak stops being believed (PROCESSES J1).

| # | Question (his words) | Freq · device | WHAT (default) | WHY (on demand) | WHAT HAPPENED (on demand) | WHAT TO DO (one primary) | Lives on |
|---|---|---|---|---|---|---|---|
| O1 | "מה מחכה לי היום, וכמה ₪?" | Daily · phone, 07:30 | Top 3 tasks, each one sentence: ₪ · what · due ("₪296 · 4 פערים · 2 חוסמים · עד 14.11"), ranked by ₪ × days to due | Why it is due: the due chip itself; the rest opens on tap | — | The row's verb ("החליטו" / "שלחו" / "תזכורת") | Home → **לטיפולי** (W2-08 `tasks.mine`) |
| O2 | "כמה ברח לי החודש? עולה או יורד?" | Daily glance; weekly read (Sunday) · both | **N1** "דליפה החודש ₪760" · "1.8% מהקניות שנבדקו" · one delta line "▼ ₪14 מול 1–25 בספטמבר" | Behind "איך הגענו ל-₪760?": what counts and what does not (pending PO link, consolidated, MISSING_ON_INVOICE out); paid / unpaid split; by type; the ₪42,263 base | Trend and past months: the leak hub "מגמה" tab | Tertiary: "לחשבוניות שמאחורי ₪760" (drill, W2-09) | Leak hub `/dashboard/leaks` |
| O3 | "את הפער הזה: לדרוש או לשלם?" | 3–5 times a week · phone from a push, desk | Card: ₪38.70 · supplier · item · **one-line math** "חויבו 9.5 ק״ג · התקבלו 6.5" · due date · חוסם / אזהרה | Evidence peek (W2-04): document crop, the receiver's photo and the driver's name, the price source and its date, the threshold ("סף ±2% או ₪5") | Inside the peek: who flagged it, escalations, earlier decisions with this supplier | **"דרשו ₪38.70"**. Secondary "שלמו כפי שחויב" (asks for a reason). Overflow: waive, pass on | Approvals |
| O4 | "מה לשלוח לספקים, ומי לא ענה?" | Weekly · desk | **N3** "דרישות לשליחה ₪450.88 · 6 ספקים". **N4** "ממתינות לתשובה מעל 7 ימים ₪859.15 · 15" | Per row: expand to the literal message or letter | Sent date, reminders, replies, credits: the "מעקב" tab | "שלחו 6 דרישות · ₪450.88" (send sheet, 10 s undo) / "תזכורות" | Claims (tabs לשליחה · מעקב) |
| O5 | "מה משלמים השבוע, ומה עוצרים?" | 1–4 times a month · desk | **N6** "לתשלום השבוע ₪12,400 · 6 ספקים", net of accepted claims; holds inline with one reason each | The net: invoices − offsets − holds (fold) | Paid history: the supplier ledger | "אשרו לתשלום ₪X" → "סמנו כשולם". Only the owner releases a bank-detail hold | Pay run (W2-03; flag off in the pilot) |
| O6 | "עם איזה ספק לדבר, ומה להגיד לו?" | 2–4 times a month · desk or phone before a call | Supplier snapshot: **90-day leak ₪** (one figure, W2-11), open claims ₪, prices that rose ₪/month, next delivery and cut-off | Per line: billed vs agreed with its source | 6 months billed vs agreed; the ledger | Call / WhatsApp; print the leak card | Supplier page "מה עכשיו" (W2-11) |
| O7 | "מה התייקר?" | Weekly · desk | **N8** top 3 items: +% and **₪/month effect**, the baseline named ("מול החוזה" / "חציון 90 יום") | The baseline and its dates | Price history per product | "ראו" → contract or supplier | Leak hub `#prices` ("מחירים שעלו", never "דליפה") |
| O8 | "אפשר לסמוך על המספר?" | Occasionally · desk | One T4 completeness line: "35 חשבוניות נבדקו · 13 עם פער · 2 ממתינות לשיוך" | The proof page is the WHY | Processing log | "צלמו חשבונית" (only when there is no data) | Hero line; proof page |
| O9 | "אילו מנות מאבדות רווח?" | Monthly · desk | **N12** "4 מנות מעל עלות המזון הרצויה", top 2 with +₪ per plate | Which ingredient, which supplier price | The changes tab | "פתחו מנה" | Recipes |
| O10 | (chain only) "איזה סניף דולף?" | Monthly · desk | Branches ranked by leak ₪ and % | Thin-base note | Monthly heatmap | "פתחו סניף" | Chain overview |

**Owner HOME (5 items, in this order):**
1. **The leak hero (T1), compact:** "דליפה החודש ₪760 · 1.8% מהקניות שנבדקו · ▼ ₪14 מול 1–25 בספטמבר". One completeness line "35 נבדקו · 13 עם פער". One tertiary link "איך הגענו ל-₪760?". No split tiles, no ⓘ popover, no red CTA competing with the tasks. On the phone on mornings with tasks: 40 px, one context line (PROCESSES Q3).
2. **Task 1 (T2 only if due within 7 days or blocking):** for example "ממתין להחלטה ₪296 · 4 פערים · 2 חוסמים · עד 14.11 → החליטו".
3. **Task 2:** for example "דרישות לשליחה ₪450.88 · 6 ספקים → שלחו".
4. **Task 3, plus "עוד N משימות"** (VAT when ≤30 days, the pay run, overdue claims) → לטיפולי.
5. **One calm T3 line:** "הוחזר החודש ₪1,267 · נחסם לפני תשלום ₪Y".

**Moves off the owner home** (it stays where it already lives; home gets a link only when it is a task):

| Block today (`live/01`) | Goes to |
|---|---|
| VAT card (₪1,123 printed 3× on one home) | One task row when ≤30 days to deadline; else the bookkeeper's month close |
| "מחירים שעלו · 30 יום" heat tiles | Leak hub `#prices`; the Sunday digest |
| Activity feed ("פעילות אחרונה") | The bell (W2-08) and each record's history |
| Price-alert teaser | Contracts nav badge |
| Dishes over target card | Recipes; the monthly digest |
| Pending-link sentence (2 invoices ₪3,603) | Inside the hero's "איך הגענו?" fold |
| Hero split "על חשבוניות שעוד לא שולמו ₪296 / ששולמו ₪464" | Inside the fold. It reads as a second "awaiting" figure (F7 vs F6) |
| "הצג מגמה", the view toolbar | Leak hub ("מגמה" tab); the toolbar is behind the unused `dashViews` flag |

**Owner never sees:**
- a 1.5% target or "יעד";
- "הפסד" or "חיסכון" for an undecided ₪;
- unknown shown as ₪0;
- two numbers with one name;
- internal ids such as `PO-9D8D2FA0` or `#C6B09558` (show the supplier and the date instead);
- OCR and engine words ("הרצה מחדש", match run, confidence) outside the correction view;
- setup cards on working screens (the inbox setup);
- T2 red on pending or consolidated items (T4);
- more than 3 T2 elements on one screen.

### 2.2 מנהל/ת · Manager

**Context:** the manager runs today's shift. Decisions are made on the phone between covers, orders are sent near each supplier's cut-off, and a truck exception matters while the driver is still on site.

| # | Question | Freq · device | WHAT | WHY (on demand) | WHAT HAPPENED | WHAT TO DO | Lives on |
|---|---|---|---|---|---|---|---|
| M1 | "אילו פערים מחכים להחלטה שלי?" | Daily · phone | **N2** for the manager band (₪50–300 / 2–5%): "₪153 · 2 פערים · עד …". Others' items as one T4 count: "ממתין לבעלים: 2 · ₪296" | The evidence peek, as for the owner | The peek's history | "דרשו ₪X". Secondary "שלמו". Overflow "העבירו לבעלים" | Approvals |
| M2 | "מה מגיע היום, מה מאחר ומה חסר?" | Daily · phone | **N9** "8 משלוחים · 3 התקבלו · 1 באיחור · הבא: ירקות השרון 10:00". Exceptions with ₪: "חסרים 3 ק״ג עגבניות שרי · ₪38.70" | The exception slip lines | Closed receipts today, one line each with who received | Late: "התקשרו / וואטסאפ / לא הגיע". Walk-in: "אשרו קבלה" | Receiving board |
| M3 | "מה צריך להזמין היום, ועד מתי?" | About 14 a week · phone | **N10** "2 הזמנות נסגרות היום · ראשונה: דגי הים 14:00 · טיוטה מוכנה ₪1,627" | Per line: "ממוצע 4 הזמנות" | The last order to this supplier | "שלחו" (prepared draft, AU-11) / "הזמינו" | Orders |
| M4 | "הספק שינה משהו בהזמנה?" | 2–5 a week · phone | "ירקות השרון שינו 2 שורות · עגבניות 6 במקום 10" | The diff sheet | The supplier's answer and when it came | **"קבלו שינוי"** (the dock's expected quantity updates). "דחו" calls the agent | Order page (G-10) |
| M5 | "החשבונית נקראה נכון?" | About 1 a day at the start · desk | Count of flagged documents and flagged cells only | Document crop beside the line | Who edited what (audit) | Fix → save (automatic re-match, shows the ₪ effect) | Invoice cockpit (W2-02) |
| M6 | "דרישות לשליחה / באיחור?" (when delegated) | Weekly · phone or desk | N3 / N4, as for the owner | As for the owner | As for the owner | "שלחו" | Claims |
| M7 | "ספירה פתוחה?" | Monthly · phone | **N11** "45 מתוך 51" (one format, once) | — | Past counts | "המשיכו ספירה" | Inventory count |

**Manager HOME (≤5; only the rows with something in them):**
1. "ממתין להחלטה שלך ₪153 · 2 פערים · עד …" → "החליטו".
2. "משלוחים היום 8 · 1 באיחור · הבא 10:00" (+ "חריגה ₪38.70" when there is one) → "לקבלת סחורה".
3. "הזמנות שנסגרות היום 2 · דגי הים 14:00" → "הזמינו".
4. Supplier changes or a walk-in at the door (only when they exist) → "קבלו שינוי" / "אשרו קבלה".
5. Claims to send or overdue (₪), **or** the open count, whichever is due first.

The month's leak is **not** the hero here. It becomes one link line at the bottom, "דליפה החודש ₪854 →" (Q-A). Today the hero sits above the tasks under the title "המשמרת היום".

**Manager never sees:**
- the pay run (already `navHiddenFor` the manager);
- the VAT-at-risk card and allocation-number tasks: today the manager sees the VAT card but has no VAT task (`inventory-money.md` §4.1);
- bank details;
- billing or the plan;
- other people's decision ₪ presented as "שלך" (only the T4 "ממתין לבעלים" count);
- the false worker banner "הבעלים קיבל התראה" (W2-16);
- the "חשבונית בלי הזמנה" explainer on every visit.

### 2.3 מנהלת חשבונות · Bookkeeper

**Context:** she is the channel to 10–30 restaurants (GTM). She works in batches at a desk, closes the month by the 15th and files PCN874 by the 23rd. If the month close takes six screens and two calls to the manager, she will not recommend the product (PROCESSES J8).

| # | Question | Freq · device | WHAT | WHY (on demand) | WHAT HAPPENED | WHAT TO DO | Lives on |
|---|---|---|---|---|---|---|---|
| B1 | "מה נכנס ומחכה לבדיקה?" | Daily or weekly batch · desk | **N13** "6 מסמכים לבדיקה · 2 חשבוניות מרכזות לשיוך" | Flagged fields only (R-11: ≤1 marker per card) | Accepted / rejected / duplicates behind "הכל" | "אשרו" / "צרפו כעמוד 2" / "פצלו" (G-09) | Inbox → register (W2-02) |
| B2 | "החודש מוכן לסגירה?" | Monthly, from the 1st to the 15th · desk | **N14** "סגירת אוקטובר: 3 מתוך 6 שלבים פתוחים", each step with count · ₪ · who holds it | Per step, why it is open | **Export log**: "יוצא 3.11 · מיכל · 58 חשבוניות" (audit, open by default) | The step's verb; "ייצוא" (locks the month) | Month close (W3; exports today) |
| B3 | "מה בסיכון מע״מ?" | 1–3 a month · desk | **N7** "מע״מ בסיכון ₪1,123 · חשבונית אחת · עוד 154 ימים" | The rule (above ₪5,000 before VAT, 6 months) | Requests sent | "בקשו מהספק מספר הקצאה" | Month close step 4; register filter |
| B4 | "הזיכוי הזה שייך לאיזו דרישה?" | 3–8 a month · desk | "זיכוי ₪84.96 ממאפיית ברנר · מכסה BR-24099" | Before / after VAT (no arithmetic by hand) | Claim → credited → netted | **"אשרו שיוך"** | Claims "מעקב" (W2-10) |
| B5 | "תמצאי לי חשבונית 24108" | 2–5 a week, often with the supplier on the phone · desk | Result row: number · date · supplier · ₪ incl. VAT · **one status** (approved / paid / exported) · gap ₪ | Lines: ordered / received / billed | **The document chain** (order → receipt → invoice → claim → credit → paid) | Open the cockpit | ⌘K → invoice cockpit |
| B6 | "מה פתוח מול ספק X?" | Weekly · desk | Open balance by month: invoiced / paid / credits / open, one labelled VAT basis | Per invoice | Months collapsed | Edit the account card (audit log) | Supplier ledger |
| B7 | "מה משלמים השבוע?" (preparing) | 1–4 a month · desk | N6, as for the owner | As for the owner | As for the owner | Prepare. **The owner releases** | Pay run |
| B8 | "מה הופנה אליי?" | As routed · desk | Items routed to her (a duplicate invoice → block payment). Others' items as one T4 line: "ממתין לבעלים ₪296" | Evidence peek | Peek history | "סמנו ככפולה וחסמו תשלום" | Approvals |

**Bookkeeper HOME (≤5):**
1. **Month close** "x/6 שלבים פתוחים". From the 1st to the 5th it shows **N13** documents to review first, because those arrive then.
2. "מסמכים לבדיקה 6 · מרכזות לשיוך 2" → "לבדיקה".
3. "מע״מ בסיכון ₪1,123 · עוד 154 ימים" → "בקשו מספר הקצאה" (warn inside 30 days, danger inside 7: H8, already on `main`).
4. "זיכויים לשיוך 2 · ₪…" or "הופנו אלייך 1" (duplicates), whichever exists.
5. "לתשלום השבוע ₪…" when the pay run is on. **Never** the placeholder "ייצוא אחרון" row that `main` shows today without an export log (`finance.tsx:332`).

There is **no leak hero** on her home (Q-B). The leak is the owner's question; she reads it in the reports.

**Bookkeeper never sees:**
- dock or field-mode screens with action buttons;
- decision buttons for gaps not routed to her (read-only plus "ממתין לבעלים");
- the "מחירים שעלו" heat tiles;
- onboarding nudges;
- an "inbox zero" message while ₪296 waits on the owner (exec-desktop-03);
- a lock card when she follows a link from the breakdown to the leak report, a page the registry denies her (`inventory-money.md` §4.1).

**Gap against the owner's "she reads everything":** these routes are denied to her on `main`:
- orders, receiving, the suppliers list, catalog, products, recipes, inventory and team;
- `/reports/monthly` and `/reports/digest`.

SPEC §4.1 shows them as 👁 read-only (Q-C).

### 2.4 שף · Chef

**Context:** the chef works in the kitchen and the walk-in, with cold or greasy fingers and often no signal. He orders directly, with no approval, and **sees ₪ only on the orders screens and in recipes** (31.10).

| # | Question | Freq · device | WHAT | WHY (on demand) | WHAT HAPPENED | WHAT TO DO | Lives on |
|---|---|---|---|---|---|---|---|
| C1 | "מה להזמין עכשיו, לפני שהספק סוגר?" | Several a week · phone | **N10** "דגי הים נסגר ב-14:00 · עוד 47 דק׳ · טיוטה 4 פריטים ₪1,627" (₪ allowed here) | Per line "ממוצע 4 הזמנות" | The last order to the supplier | **"שלחו"** (10 s undo) | Orders |
| C2 | "מה לא הגיע למטבח היום?" | Per delivery · phone | Quantities only: "חסרים 3 ק״ג עגבניות שרי · ירקות השרון" | — | — | Optional "הזמינו את החסר" | Chef home row (new) |
| C3 | "מה נשאר לספור?" | Monthly (W2-16 owner decision) · phone in the walk-in, offline | **N11** "45 מתוך 51 · נשארו 6 · אזור: מקרר" (**no ₪**) | — | Past counts as dates only | "המשיכו ספירה" | Inventory count |
| C4 | "אילו מנות עברו את עלות המזון הרצויה?" | Monthly · phone or desk | **N12** "4 מנות" · top 2: "סטייק אנטריקוט 29.3% → 31.4% · +₪3.41 למנה" (₪ allowed in recipes) | The driver: "אנטריקוט +7.2% אצל קצביית הכרם" | The changes tab | "פתחו מנה" | Recipes |
| C5 | "הספק שינה את ההזמנה שלי?" | When it happens · phone | "עגבניות 6 במקום 10" (push to whoever sent the order) | Diff | — | "קבלו שינוי" | Order page |

**Chef HOME (≤5):**
1. "הזמנות שנסגרות היום" with cut-off chips and drafts → "שלחו". This is missing today: the chef home has the count and dishes only, although הזמנות is in his bottom bar.
2. "לא הגיע היום", quantities only (only when there is something).
3. "ספירה פתוחה 45/51" or the next count date.
4. "מנות מעל עלות המזון הרצויה 4", top 2 with +₪ per plate.
5. Supplier changes to my orders (only when they exist).

**Chef never sees:**
- purchase or leak ₪;
- invoice totals;
- the supplier ledger;
- approvals, claims or the pay run;
- **inventory ₪** (stock value, closing stock);
- the actual-food-cost **PeriodCard**: on `main` the recipes page renders it for the chef and he gets an error card, because `inventory.period` is FORBIDDEN for the chef (`inventory-operations.md` §0.1). This is a bug;
- the activity feed;
- a "food cost" % under a label that means two different calculations (5 %s today, two named "עלות מזון בפועל");
- raw order ids ("#C6B09558", `live/14`).

### 2.5 מקבל סחורה · Receiver

**Context:** the receiver works at the back door with one hand, the other holding a crate, often in gloves, in sun or a dark corridor, with dead zones. The driver is waiting. A clean delivery takes under 2 minutes, a delivery with exceptions under 4. **No ₪ anywhere, notifications included.** Prefer **cut over fold**: every fold on a field screen costs 4 overlay strings (W2-16).

| # | Question | Freq · device | WHAT | WHY | WHAT HAPPENED | WHAT TO DO | Lives on |
|---|---|---|---|---|---|---|---|
| R1 | "איזו משאית הבאה, ומה עוד היום?" | Daily, 06:30, then per truck · phone | "המשאית הבאה: ירקות השרון · 10:00 · 11 פריטים · באיחור". Then the others: time · supplier · line count | — (cut) | — | **"התחלת קבלה"** (56 px) | Receiving board (= home) |
| R2 | "מה צריך להיות במשלוח הזה?" | 2–3 a day · phone | Per line: product · **ordered quantity** · unit. When the supplier answered: "הספק הודיע: 6 במקום 10" | — | — | "הכל הגיע כמו בהזמנה" → spot check of 2 lines; per line ✓ / ✗ | Dock |
| R3 | "משהו חסר או פגום, מה עושים?" | 2–4 a week · phone | The line, the ordered quantity | — | — | ✗ → reason chip → keypad → photo → save (≤4 taps). Slip to the driver, quantities only | Dock, exception sheet |
| R4 | "ספק הגיע בלי הזמנה" | 1–3 a week · phone | One button "ספק בלי הזמנה" | — | — | Choose supplier → photograph → count. The manager approves later (Q4 / decision 21) | Board |
| R5 | "נשמר? נשלח?" | Always, offline · phone | "⟳ 3 ממתינים" | — | The outbox list with times | "שלחו עכשיו" | Outbox chip (W2-05) |
| R6 | "מה כבר התקבל היום?" | Per shift · phone | One line each: "ירקות השרון · 10:12 · חריגה אחת" | — | Today only | Open, read-only | Board |

**Receiver HOME (≤5):**
1. **The next truck**: supplier · time · line count · late chip, plus **"התחלת קבלה"**.
2. The rest of today's trucks.
3. "⟳ N ממתינים" (only when N > 0).
4. One button "ספק בלי הזמנה". It replaces today's dashed explainer card, which tells the receiver to "ask the shift manager" on every visit (`live/12`).
5. "התקבלו היום", one line each.

**Fix today:** the "היום" home tab and the "קבלות" tab render the **identical board** (2 of the receiver's 3 tabs, `inventory-operations.md` §0.1). The second tab should be **"צלם"** (SPEC §11: היום · צלם · קבלות · עוד), and "קבלות" should be today's closed receipts.

**Receiver never sees:**
- any ₪: prices, totals, line amounts, the leak, invoices;
- ₪ in notifications or in the tRPC payload: today `owner.leakHero`, `owner.leakSummary`, `owner.kpis`, `activity.feed`, `orders.get/list`, `getPo` and `priceContext` are readable by a receiver session (H-11, G-07; open pilot PR #219 strips part of it, AD1);
- solid "מחיר שונה" badges and the duplicate-invoice notice, which reach the dock today and which the receiver cannot act on;
- the supplier ledger (owner decision) and invoice pages;
- SKU codes on every line;
- engine words (OCR, התאמה);
- the camera at the top-left (move it to the bottom bar);
- the WorkerStatusBanner.

### 2.6 ספק · Supplier (link, no account)

| # | Question | Freq · device | WHAT | WHY | WHAT HAPPENED | WHAT TO DO |
|---|---|---|---|---|---|---|
| S1 | "מה הזמינו ממני, ולמתי?" | Per order · phone, 3G | Who ordered · delivery date · lines · **their own order total** · link expiry | — | Once answered, the page is read-only with "ענית ב-…" | **"אישור ההזמנה כפי שהיא"** (2 taps); per line "אין במלאי" or a new quantity |
| S2 | "מה דורשים ממני, ולמה?" | Per claim · phone or e-mail | Claim ₪ · lines · answer deadline (7 days) | **Open by default here.** The supplier must be able to verify each line: "חויב ₪149 × 10 ק״ג · בהזמנה ₪139 · הפרש ₪100" (W2-09, SUP-02) | Earlier letters | Reply / send a credit note (H-06 claim portal) |

**Supplier never sees:**
- the restaurant's leak total, its margins or recipes;
- other suppliers' prices or orders;
- internal notes and approval routing;
- the word "דליפה";
- any undecided gap (decision 18).

### 2.7 מנהל פלטפורמה · Platform admin

| # | Question | WHAT | WHAT TO DO |
|---|---|---|---|
| A1 | "איזו מסעדה תקועה?" | Per tenant: last invoice processed, OCR failures, stalled jobs, last heartbeat, last login | "פתחו מסעדה" |
| A2 | "איזה ניסיון מסתיים?" | Plan · trial days left | `assignPlan` |
| A3 | "לידים חדשים?" | Lead · fit score with `reasons[]` | Contact |

**Home:** these three lists. **Never by default:** tenant invoice lines and tenant ₪ beyond operational counts. Open a tenant on purpose, and log it. The admin shell stays separate from the tenant dashboard.

---

## 3. מה כל תפקיד שואל, מסודר לפי תדירות · The questions on one page

| Daily | Weekly | Monthly | Per event |
|---|---|---|---|
| **O1** what needs me · **O2** leak (glance) · **M1** my decisions · **M2** today's trucks · **M3** cut-offs · **R1** next truck · **R2** what should arrive · **B1** documents (batch) · **C1** orders before cut-off | **O3** decide gaps (3–5×) · **O4** claims to send · **O7** prices that rose · **B5** find an invoice · **B6** supplier balance · **M4** supplier changes · **C2** what did not arrive | **O9** dishes · **O10** branches · **B2** month close · **B3** VAT · **B7** pay run · **C3** count · **C4** dishes over cost · **O5** pay run (1–4×) · **O6** one supplier (2–4×) | **R3** exception · **R4** walk-in · **M6** claims (delegated) · **B4** credit note · **B8** routed item · **S1/S2** supplier |

**Reading it:** the daily column is what each role's home must answer with 0 scrolls. The weekly column is one tap from home (a task row or the nav). The monthly column lives in the nav and in the digest. The event column arrives as a push that lands on the decision (PROCESSES P3), never on a list.

---

## 4. החוזה בין התפקידים · The cross-role contract

### 4.1 One number, one name, one home screen

Each number below has **one definition** and **one screen where it is acted on** (its "home"). On any other screen it appears only as a link that opens that screen, with the same ₪ to the agora (W2-09 drill parity). The F-ids point to `inventory-money.md` §1.

| # | Name (the only one) | Definition owner | Acted on at | Roles | Collisions to remove |
|---|---|---|---|---|---|
| **N1** | דליפה החודש (₪, % of checked purchases) | `owner.leakHero` (one leak rule) | Leak hub | O (hero) · M · B (read) | F1 printed on 9 surfaces. Proof prints it 4× in the fold, monthly 4×. Keep **one** per screen |
| **N2** | ממתין להחלטה (per viewer: "שלך" / "של הבעלים") | G-12 `awaitingDecision()` | Approvals | O (all) · M (own band) · B (routed) | **F6 ₪296 vs F7 ₪390.20**, which has 7 names: "על חשבוניות שעוד לא שולמו", "עוד אפשר לעצור לפני תשלום", "נתפס לפני תשלום" and others. F7 is not a separate number on working screens; it lives only inside N1's WHY as "מתוך הדליפה: עוד לא הוחלט ₪X" |
| **N3** | דרישות לשליחה | `followUps().unsent` | Claims · לשליחה | O · M (B read) | "To claim" is ₪450.88 on 4 screens but ₪463.54 on proof and report |
| **N4** | ממתינות לתשובת ספק מעל 7 ימים | `followUps().waiting`, `OVERDUE_DAYS = 7` | Claims · מעקב | O · M (B opt-in, AD6) | F10 has two rules: 15 · ₪859 vs `recovery.overdueCount` 36 · ₪1,746. No wave-2 owner |
| **N5** | הוחזר החודש (T3) | `recovery.returnedThisMonth` | Claims · מעקב | O · M · B | Printed 3× in the recovery fold |
| **N6** | לתשלום השבוע (net) | Pay run (W2-03) | Pay run | O (release) · B (prepare) | Today it is a month figure, "ניתן לשלם ₪5,901" |
| **N7** | מע״מ בסיכון | `owner.vatAtRisk` | Month close step / register | O · B | 3× on the owner home. Shown to the manager as a card with no task |
| **N8** | מחירים שעלו (₪/month effect) | AU-13; one baseline contract | Leak hub `#prices` | O · M · B read | 8 representations with 6 unnamed baselines (`inventory-operations.md` §0.1). **Never** called "דליפה" |
| **N9** | משלוחים היום (count, late) | `receiving.todayExpectations` | Receiving board | M · R (O link) | The board is rendered 3× (receiver home, receiver tab, manager row) |
| **N10** | הזמנות שנסגרות היום | `todayCutoffs` | Orders | M · C | — |
| **N11** | ספירה פתוחה (counted / lines) | `inventory.current` | Count | M · C | One home row prints "45/51" and "45 מתוך 51" |
| **N12** | מנות מעל עלות המזון הרצויה | `recipes.priceAlerts` | Recipes | O · M · C | The same alert on 5 surfaces |
| **N13** | מסמכים לבדיקה | `ingest.overview().needsReview` (a pending חשבונית מרכזת never counts) | Inbox / register | O · M · B | Missing from home and the nav today |
| **N14** | סגירת חודש x/6 | W3 month close | Month close | B (O link) | Placeholder row today |
| **N15** | ספקים עדיין חייבים לך | Recovery | Claims · מעקב | O · M · B | F12/F13: one label, two scopes (₪1,759 all time vs ₪464 this month). Give the month scope its own name or drop it |

**Rule:** a figure that answers no role's question in §2 is not shown on a working screen at all. It may stay on an audit screen (proof, report, ledger) where it is the content.

### 4.2 ₪ by role (what the server returns, not what CSS hides)

| Kind of ₪ | Owner | Manager | Bookkeeper | Chef | Receiver | Supplier |
|---|---|---|---|---|---|---|
| Leak ₪ and per-gap ₪ (N1, N2, gap amounts) | ✓ | ✓ | ✓ read (+ routed items) | ✗ | ✗ | Own claim lines only |
| Claims and recovery (N3–N5, N15) | ✓ | ✓ | ✓ read; records credit notes | ✗ | ✗ | Own claims |
| Invoice ₪ (totals, lines, VAT) | ✓ | ✓ | ✓ (fixes OCR, Q5) | ✗ | ✗ (photographs without seeing totals) | — |
| Pay run, bank details (N6) | ✓ release; hard hold owner-only | ✗ | ✓ prepare | ✗ | ✗ | — |
| VAT at risk (N7) | ✓ | ✗ | ✓ | ✗ | ✗ | — |
| Order prices and totals | ✓ | ✓ | ✓ read | ✓ **orders screens only** | ✗ (expected quantities only) | Own order |
| Recipe ₪ (plate cost, menu price, margin) | ✓ | ✓ | ✓ read | ✓ **recipes only** | ✗ | — |
| Inventory ₪ (stock value, actual food cost ₪) | ✓ | ✓ | ✓ read | ✗ (quantities; % on recipes) | ✗ | — |
| Purchase spend (the ₪42,263 base) | ✓ | ✓ | ✓ | ✗ | ✗ | — |
| Prices that rose (N8) | ✓ | ✓ | ✓ read | Inside recipes only | ✗ | — |
| Supplier ledger | ✓ | ✓ | ✓ edits account cards (audit) | ✗ | ✗ (owner decision) | — |
| Plan and billing | ✓ | ✗ | ✗ | ✗ | ✗ | — |

**Enforcement today vs this table:**
- Role decisions live in three places that can drift: **47 inline `role === …` checks in 25 files** under `apps/web/app` and `apps/web/lib`, the route registry (`lib/nav/routes/*.ts`), and the server procedures.
- `memberProcedure` money reads (`owner.leakHero`, `owner.kpis`, `recovery.returnedThisMonth`, `activity.feed`) serve every member.
- The table is enforceable only when G-07 `can()` capabilities drive the nav, the page guards and the server strip (H-11) from one source, and the role-matrix e2e checks both the DOM and the JSON (PROCESSES P10).

### 4.3 Where each layer may appear, by screen type

| Screen type | Examples | WHAT | WHY | WHAT HAPPENED | WHAT TO DO | Budget (W2-16 §5.4 + this review) |
|---|---|---|---|---|---|---|
| **Home** | `/dashboard` per role | ≤5 items, one number each | **None open.** At most one "איך הגענו?" link on the hero | **None.** No feed, trend, funnel or ageing | One verb per row | ≤5 blocks. Words: phone first screen ≤60, desk ≤150. ≤3 T2 |
| **Queue** | Approvals, claims, pay run, inbox, receiving board, לטיפולי | Per row: ₪ · what · due | **The one-line math stays open** (needed to decide). Everything else in the peek or `<Explain>` | In the peek; closed items in a "נסגרו" tab | One primary, one secondary, the rest in ⋯ | ≥10 rows per 1440×900 desk screen (PROCESSES P7) |
| **Record** | Invoice, order, supplier, receipt | Header: **one status chip + one ₪** | Per line, behind a fold or in the comparison row (ThreeWayRow) | **One line: the document chain** (order → answer → receipt → invoice → claim → credit → paid). Full history folded | The next step only | Detail ≤110 words in the first screen |
| **Audit** | Leak proof, monthly report, supplier ledger, export log, leak card | The figure, once | **Open by default.** This is where the explanations live; other screens link here | **Open by default** | Print / export / share | One copy of the month, not four (F18: proof, report, monthly and digest overlap; owned by W3-08) |
| **Field** | Dock, count, supplier link, capture | Quantities, next item | **Cut, don't fold** | Today only, one line each | One 56 px primary at the bottom | Phone task ≤45 words in the first screen, ≤100 per page |

### 4.4 Never anywhere, for any role

- A 1.5% target, or "יעד" (the term is "עלות מזון רצויה").
- "הפסד" or "חיסכון" for an undecided ₪.
- "דליפה" for anything but the monthly leak (price creep is "מחירים שעלו").
- Unknown shown as ₪0.
- One name with two numbers, or one number with two names (§4.1).
- A ₪ without its basis on a decision. On a home, the basis is one tap away.
- MISSING_ON_INVOICE with ₪, a claim action or a place in the leak (owner, 31.10). It stays a review item with no ₪.
- T2 red or orange on pending, consolidated or "waiting on someone else" items. Those are T4.
- Internal ids: `PO-9D8D2FA0`, `#C6B09558`, `SA5B5F116`.
- Engine words outside the correction view (OCR, match run, "הרצה מחדש").
- English jargon in the Hebrew UI.
- Explanations inside `title=` tooltips, which are invisible on touch (W2-16 lists 7).
- False statements, such as "הבעלים קיבל התראה" on every page.
- A silent bounce on a forbidden route. Land on בית with a toast that says why (SPEC §9).

---

## 5. שאלות לבעלים · Open questions (each with the default we build to)

| # | Question | Default until answered |
|---|---|---|
| **Q-A** | The manager's home is "המשמרת היום". Should the month's leak stay as its hero (₪854 above the tasks), or become one link line under the tasks? | **One link line under the tasks.** The hero stays on the owner's home and in the leak hub |
| **Q-B** | Does the bookkeeper's home need the leak hero? | **No.** Month close, documents, VAT and credit notes come first. The leak is in her reports |
| **Q-C** | "The bookkeeper reads everything" (31.10). Today 10 routes deny her (orders, receiving, the suppliers list, catalog, products, recipes, inventory, team, the monthly report and the digest). Open them read-only, with ₪, as SPEC §4.1 shows? | **Yes, read-only (👁).** No write controls, except her account cards (audit log) |
| **Q-D** | May the chef see what did not arrive today, as quantities only with no ₪? | **Yes.** It is kitchen information, not money |
| **Q-E** | Move the activity feed off the home, to the bell and to each record's history? | **Yes** |
| **Q-F** | Should the VAT-at-risk item reach the owner's home only inside 30 days of the deadline, and otherwise live in the bookkeeper's month close? | **Yes**, consistent with the H8 tone rule already on `main` |
| **Q-G** | Is sending claims a job for both owner and manager (today both get the row), or the owner only? | **Both.** Whoever sends; the status comes from the outbox |
| **Q-H** | Should the receiver's second tab be "צלם" (capture) instead of a second copy of the board? | **Yes**, as SPEC §11 |

---

## 6. Where this lands in the plan (who already owns what)

| Need from this file | Already planned by | Left without an owner |
|---|---|---|
| One "awaiting decision" (N2) everywhere | G-12 | F7's six other names on report, claims, pay run, monthly and chain |
| Homes built from the role's own work; `tasks.mine`; badges; the bell | W2-08 | The owner-home "moves off" list in §2.1 (VAT 3×, feed, price tiles, dishes); the receiver's duplicate tab; the manager hero (Q-A); the bookkeeper hero and placeholder (Q-B) |
| WHY on demand (`<Explain>`), one string per idea | W2-16 | W2-16 shortens text; it does not move blocks behind "למה?" or remove duplicate figures |
| Every ₪ explains itself and drills to its rows (N1) | W2-09 | Merging proof, report, monthly and digest into one copy of the month (W3-08) |
| Register, cockpit, document chain for the bookkeeper (B1, B5) | W2-02 | Month close (W3), export log (W2-14) |
| Supplier snapshot (O6) | W2-11 | — |
| One vocabulary | W2-13 | F10 (two overdue rules), F12/F13 (two scopes, one label) |
| Capabilities and the server ₪ strip | G-07, H-11 (human PR) | The 47 inline role checks in pages (they should read `can()`) |
| Chef orders on the chef home; the chef PeriodCard bug; the food-cost vocabulary (5 %s) | — | **No brief owns these** (`inventory-operations.md` §18) |
