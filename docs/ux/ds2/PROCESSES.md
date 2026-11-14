# PROCESSES · מתהליכי העבודה ליעדי עיצוב

**Operations → design targets for Design System 2 (DS2)**

- **Date:** 7.11.2026.
- **Base:** `origin/main` @ `4c887688` (wave 1 #167 + train A #228).
- **Track:** DS2, process input. Nothing here changes code. The three DS2 directions are judged against the numbers in §3 and §9.
- **Owner request (7.11):** "search for suitable fonts, raise the whole design system several levels, understand the operational processes, and from that design operations more efficiently." This file covers the second half of that request: processes → targets → principles → components.

**How to read the numbers**
- **Today** means what `main` does now. Counts come from reading the code (`apps/web/app/dashboard/**`, `app/s/[token]`) and the live screenshots of 7.11. A *tap* or *click* is one deliberate press. Typing is counted separately. Nobody was timed; these are counted paths, not measurements.
- **W2** means wave-2 work that is built as a draft PR but is not on `main`. Screenshots are in `site-tour/w2`.
- **Target** is what DS2 designs for. Every target is a number that an e2e test or AU-07 telemetry can check (§9).
- **₪ figures** use the typical ICP restaurant from the automation catalogue (`10-catalogue-and-impact.md` §0):
  - ₪200,000/month food spend before VAT, 1 branch, about 12 suppliers;
  - about 14 deliveries/week (about 60/month, average ₪3,333);
  - about 80 supplier documents/month, about 60 of them invoices to pay;
  - leak at 1.5% = ₪3,000/month, of which ₪1,800/month is claimable;
  - 3–5 consolidated invoices/month.

  These are ASSUMPTIONS until AU-07 measures them. Demo figures (כפר הזיתים) are marked "demo".
- **Screenshots:** `scratchpad/site-tour/{live,w2}/`. They are cited below as `live/05` or `w2/W2-04-01`.

---

## 0. בקצרה · The short version

1. **The engine is not the bottleneck. The trips are.** Most of today's taps go to five things:
   - walking to another screen to see the evidence;
   - switching to WhatsApp and back;
   - setting a status by hand;
   - hunting for the record (there is no invoice list and no shortcut key, and the supplier page opens on an edit form);
   - arithmetic the system could do, such as VAT on a credit note.
2. **Wave 1 already fixed the worst field flow.** A clean delivery takes 3 taps plus a blind count of 2 lines (`live/12`, `live/13`), so keep it. What is left in receiving is exceptions with evidence, walk-in suppliers and working with no signal.
3. **The big wins left are at the desk, and in the loop after the decision:**

   | Job | Today | Target |
   |---|---|---|
   | Approve a gap with its evidence | 6 clicks, 3 screens | 2 clicks, 1 screen |
   | Send claims to 6 suppliers | ≈25 taps, 12 app switches | 3 taps |
   | Pay run | ends in a dead end | 3 clicks per batch |
   | Month close | ≥6 screens | 1 checklist screen |
   | Routine order | 8–14 taps | 2 taps from a prepared draft |

4. **Ten principles (§5) and 22 component patterns (§6) follow from the 12 jobs.** Most patterns already have a primitive on `main`: `Money`, `Peek`, `SplitPane`, `Sheet`, `BatchBar`, `QtyKeypad`, `DeadlineChip`, `Toast`, `ViewTabs`. What is missing is composing them per job and wiring the notification deep links.
5. **What the jobs ask of the type and token work (§8):**
   - one numeric voice with tabular figures and a ₪ sign that reads in sunlight at 16 px;
   - three densities: field 56/48 px, owner 40 px, bookkeeper 32 px;
   - a strict budget for T2 red and orange, because five equal red tiles is the same as none.

---

## 1. מי, איפה ומתי · Roles, places and rhythm

### 1.1 The six roles

| Role | Persona | Where | Device | Hands, light, network | Time budget | ₪ shown |
|---|---|---|---|---|---|---|
| **Owner** (בעלים) | איתן: buys, signs, 1–3 branches | Office, home, between services, car | Phone first, laptop at the office | One hand on the phone, normal light, online | "Reads one number": minutes a day | Everything |
| **Manager** (מנהל) | Floor or kitchen manager | Pass, office | Phone and laptop | Two hands, online | 3–10 min per supplier order, near the cut-off. Decisions between covers | Everything. Decides gaps of ₪50–300 or 2–5% (§7.1 of the AU README) |
| **Chef** (שף) | Head chef | Line, walk-in at 2–4 °C, dry store | Phone | Cold or greasy fingers, sometimes gloves. Screen fogs. **No signal in the walk-in** | A count takes 20–60 min and is interrupted | Only on orders and recipes (owner, 31.10) |
| **Receiver** (מקבל סחורה) | רמי: whoever is on shift | Back door, beside the driver | Own Android (about 67% of IL phones) | One hand, the other holds a crate. Sometimes gloves. Sun or a dark corridor. Dead zones | **The driver is waiting:** under 2 min clean, under 4 min with exceptions | **None**, including notifications |
| **Bookkeeper** (מנהלת חשבונות) | מיכל: in-house, or external with 10–30 restaurants (the GTM channel) | Office | Laptop, often 2 screens | Two hands, online | Works in batches. Month close by the 15th, PCN874 by the 23rd | Everything. Edits account cards, with an audit log |
| **Supplier** (ספק / סוכן) | The supplier's agent | On the road, warehouse | Phone, link without an account | One hand, between drives, 3G | Seconds | Own order only |

Sources: `docs/ICP.md` §1; `docs/ux/research/restaurant.md` §1; `docs/ux/review/lens-mobile-field.md` §1; `docs/ux/wave2/README.md` §7 and §12.

### 1.2 The document chain they share

1. **Order.** WhatsApp, phone or app, often with no written price.
2. **Signed delivery note at the door.** It is the only evidence created in real time.
3. **Tax invoice.** One per delivery, or a monthly **חשבונית מרכזת**.
4. **חשבונית זיכוי** (credit note), when a gap is accepted.
5. **The bookkeeper's כרטסת reconciliation.**
6. **PCN874** detailed VAT report.
7. **Payment** on שוטף+N (end of month + N days).

The money leaves **1.5 to 4 months after the goods arrive**. That window is the product's biggest asset: a gap caught before payment is **offset**, not chased. If the receiver signs without counting, the leak is locked in before any software sees it. (Research report, chapter 1.)

### 1.3 The rhythm of a week (Asia/Jerusalem)

| When | What happens | Who | Design consequence |
|---|---|---|---|
| 06:30–11:00 daily | 2–3 trucks (peaks of 5–8) | Receiver | 06:30 truck brief with no ₪; field mode; works offline |
| 09:00–14:00 daily | Supplier cut-offs, each supplier its own | Manager, chef | Draft prepared 2 h before cut-off (AD9); countdown chip |
| 10:00–17:00 | Decisions between services | Owner, manager | Phone decision sheet from a push: 2 taps |
| 17:00–23:00 | Dinner service | Everyone on the floor | Only time-sensitive alerts get through. **Open question Q2:** hold the rest during service |
| Evening | End-of-day digest (`endOfDayReport`, exists) | Owner, manager | Each decision in the digest carries ₪ and a deep link |
| 23:00–06:00 and Shabbat | Quiet | — | No alerts; at most 6 per person per day (owner decision) |
| Sunday 08:00 | Weekly digest (AD9) | Owner, bookkeeper | "נתפס השבוע ₪X · נחסם לפני תשלום ₪Y" |
| Daily 16:00 (proposed) or weekly | Claims ready to send | Owner, manager | One send sheet (J4) |
| 1st–5th of the month | Consolidated invoices and statements arrive | Bookkeeper | Link them to delivery notes |
| By the 15th | Month close and export | Bookkeeper | One checklist (J8) |
| By the 23rd | PCN874 VAT report (with the CPA) | Bookkeeper | Allocation numbers fixed before this date |
| שוטף+N dates | Payment days cluster | Owner, bookkeeper | Pay run by due date (J11) |

---

## 2. העבודות החוזרות לפי תפקיד · Recurring jobs per role

Frequencies are for the typical ICP restaurant. "₪ at stake" is what is lost or put at risk when the job is skipped or done late. A J-number points to the full flow in §3.

### Owner (בעלים)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| **J1** Morning: what waits for me | Daily | Phone in bed or the car; desk later | Low; it sets the day | About ₪100–150/day of new gap decisions (₪3,000 ÷ 26 days). Demo: ₪296 waiting, ₪5,901 to pay |
| **J2** Decide gaps above ₪300 / 5%, and every blocking gap | 3–5 times a week. About 20–40 gaps a month across roles (35% of 60 invoices have one) | Phone between services, desk at the office | Before the due date. Deciding **before payment** keeps the offset channel | ₪38–105 per gap (demo). The whole ₪3,000/month leak passes through decisions |
| **J4** Send credit claims | Weekly | Desk | A claim is overdue after 7 days | ₪1,800/month claimable. About 35% is collected today (ASSUMPTION) |
| **J11** Release the pay run | 1–4 times a month, on שוטף+N dates | Desk | Due dates; the Payment Ethics law limit | ₪200k/month leaves. One duplicate ≈ ₪3,333 gross |
| **J9** Check one supplier before a call | 2–4 times a month | Desk or phone | The call itself | Price creep: ₪100–600/month of avoided cost (A18) |
| Read the leak and "מחירים שעלו" | Weekly (Sunday) | Desk | Low | The T1 number |
| Answer escalations | As they come | Phone | The escalator is waiting | The escalated ₪ |

### Manager (מנהל)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| **J6** Place regular orders | About 14 a week, 3–10 min each | Phone at the pass, laptop | Supplier cut-off | About ₪3,333 per order. The agreed price on the PO is the yardstick for every later gap |
| **J2** Decide gaps of ₪50–300 / 2–5% | Daily | Phone | Due date | Per gap |
| Accept a supplier's change (restaurant side of **J7**) | 2–5 a week | Phone | Before the truck | Prevents a false shortage and catches substitutions |
| Approve a walk-in supplier | 1–3 a week | Phone | The driver is at the door | Until it is approved, the walk-in's whole invoice is outside the 3-way match |
| Act on a receiving-exception alert | 2–4 a week | Phone | The driver is still on site | The short ₪ (for example ₪38.70) |
| **J12** Fix an OCR misread | About 1 a day at the start | Desk | Before decisions | Trust in the leak number |
| Chase a late truck | 1–3 a week | Phone | Service | None directly |

### Chef (שף)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| **J6** Order directly (no approval; sees ₪ on orders) | Several a week | Phone in the kitchen | Cut-off | Per order |
| Inventory count | Weekly or monthly | Phone in the walk-in, gloves, no signal | 20–60 min, interrupted | Closing stock. Example from W2-07: a "999 תבניות" typo adds ₪33,966 to closing stock |
| See what did not arrive for the kitchen | Per delivery | Phone | Prep | None shown (R3: no ₪) |
| Recipes and dish cost | Monthly | Desk or phone | Low | ₪ per plate (the chef may see it) |

### Receiver (מקבל סחורה)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| Morning: today's trucks | Daily, 06:30 | Phone | Before the first truck | None shown |
| **J3** Receive and count a delivery | 2–3 a day (peaks of 5–8) | Phone at the door: gloves, sun, the driver waiting | **Highest of all jobs** | About ₪3,333 of goods per delivery, about ₪50 expected leak each (at 1.5%). None of it is shown |
| Photograph the invoice or delivery note | Per delivery | Phone | Same | The evidence behind every later claim |
| Walk-in supplier with no order | 1–3 a week | Phone | The driver is waiting | Coverage of the whole invoice |
| Give the driver the exception slip | 2–4 a week | Phone → WhatsApp | The driver is leaving | Whether the claim can be won later |

### Bookkeeper (מנהלת חשבונות)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| Review incoming documents | Daily or weekly batches; about 80 a month | Desk | Before decisions | Coverage |
| Link consolidated invoices to their delivery notes | 3–5 a month | Desk | Month close | An unlinked one shows as false leak or waits forever |
| **J5** Record credit notes | 3–8 a month | Desk | The 6-month VAT window | ₪50–400 each |
| Chase allocation numbers | 1–3 a month | Desk | Before PCN874; 6 months at most | ₪1,080 of VAT lost per miss on a ₪6,000 invoice |
| **J10** Find an invoice | 2–5 a week | Desk, often with the supplier on the phone | The call | The outcome of the dispute |
| **J8** Close the month and export | Monthly | Desk | By the 15th; PCN874 by the 23rd | About ₪36k of input VAT a month; risk of posting the same month twice |
| **J11** Prepare the pay run | 1–4 a month | Desk | Due dates | ₪200k/month |
| Switch between client restaurants (external bookkeeper) | Daily | Desk | — | Not ₪ in itself, but she is the channel to 10–30 restaurants |

### Supplier (ספק)
| Job | Frequency | Device and context | Time pressure | ₪ at stake |
|---|---|---|---|---|
| **J7** Confirm or change an order | Per order (about 14 a week across one restaurant's suppliers) | Phone link with no account, on the road | Before the truck is loaded | The order total. A recorded change protects both sides |
| Answer a credit claim | Per letter | Phone or e-mail | The 7-day overdue rule | The claimed ₪ |
| Send a credit note | Per accepted claim | E-mail or WhatsApp | — | The credited ₪ |

---

## 3. 12 העבודות · The 12 jobs: today → wave 2 → target

### 3.0 Scorecard

| # | Job (role) | Frequency | Today on `main` | Target | Gain |
|---|---|---|---|---|---|
| J1 | Morning: what waits for me (owner) | Daily | Phone: open the app, then 2 scrolls to see 3 of the 5 money tiles. No morning push | 1 tap from the 07:30 brief. Top 3 tasks (₪ + verb) above the fold. First decision in ≤10 s | — |
| J2 | Approve a ₪38.70 gap (owner, manager) | Daily | Desk: **6 clicks, 3 screens** with a look at the document. Phone: 3 taps plus a scroll, 2 screens, no document | Desk: **2 clicks, 1 screen**, or 1 key after J/K. Phone: **2 taps, 1 screen** from a push. 10 decisions in ≤60 s | 3× |
| J3 | Receive an 11-line delivery (receiver) | 2–3 a day | Clean: **3 taps + 2 numbers** (keep). One short line: about 6–7 taps + 3 numbers, no line photo. Walk-in: impossible | Clean unchanged (≤90 s). Short line **≤4 taps including a photo**. Walk-in **≤6 taps, no waiting**. 0 entries lost offline | Exceptions 1.5×; walk-in unblocked |
| J4 | Send claims to 6 suppliers, ₪450.88 (owner) | Weekly | **≈25 taps, 12 app switches, 6 hand-set statuses** | **3 taps** + a 10 s undo; 0 hand-set statuses | 8× |
| J5 | Record a ₪84.96 credit note (bookkeeper) | 3–8 a month | About 7 clicks + 3 fields + VAT worked out by hand (÷1.18) | **1 click** to accept the suggested link. Manual: ≤4 clicks + 2 fields, no arithmetic | 7× |
| J6 | Regular 10-line order (manager, chef) | About 14 a week | **8–14 taps** from a past order; about 40 without one | **2 taps** from a prepared draft. Manual: ≤9 taps, ≤45 s, no keyboard | 4–20× |
| J7 | Supplier confirms or changes (supplier) | Per order | As-is in 2 taps (keep). **The answer never reaches the dock** | As-is in 2 taps, ≤10 s. The restaurant accepts a change in 1 tap. The dock's expected quantities update themselves | Loop closed |
| J8 | Close the month (bookkeeper) | Monthly | **≥6 screens, ≥25 clicks, 2 dead ends, no export log** | **1 checklist screen**, ≤10 clicks when the month is clean, every blocker ≤2 clicks | 2.5× |
| J9 | Check one supplier (owner) | 2–4 a month | Search, then up to 5 tabs. It opens on an edit form. About 7 clicks | 2 clicks + typing to one "what now" view. Call or WhatsApp in 1 tap | 3× |
| J10 | Find an invoice (bookkeeper) | 2–5 a week | With the number: 2 clicks + typing, and it lands on a correction form. Without the number: about 5–7 clicks, 3 screens | Ctrl/⌘K + typing + Enter, **≤5 s**, landing on the invoice with its gaps | 3× |
| J11 | Pay run, 6 suppliers (owner, bookkeeper) | 1–4 a month | 2 clicks to a month list + CSV. **"Paid" cannot be recorded** | **3 clicks per batch**, net of claims. Claims close themselves | Dead end → done |
| J12 | Fix an OCR misread (manager, bookkeeper) | About 1 a day at the start | 2 screens (form and scan apart), ≥5 clicks + typing + a manual re-match. Manager only | 1 split screen: Tab to the flagged cell, type, Enter. 0 clicks, automatic re-match, bookkeeper allowed | 5× |

Each job below has the same parts:
- who, when and why;
- the flow today on `main`;
- what the built wave-2 work changes;
- the target flow, with seven design levers: inline evidence, batch, default, desk keys, phone thumb, undo and offline, notification;
- the numeric target;
- the packages it needs.

---

### J1 · בוקר: מה מחכה לי · Morning check (owner)

**Why.** This is the owner's daily habit. If the first screen does not answer "what needs me, and how much ₪", he stops opening the app, and the leak number stops being believed.

**Today on `main`** (`live/01`, `live/11`)
- **Desk.** Home opens on "מה מחכה לך היום" with 5 money tiles: ממתין להחלטה ₪296 → "להחלטה"; ממתינות לתשובת ספק ₪859.15 → "לתזכורות"; דרישות שעוד לא נשלחו ₪450.88 → "לשליחה"; ללא מספר הקצאה ₪1,123 → "לבקשה מהספק"; ריצת התשלומים ₪5,901 → "לריצה". That is 0 clicks to see the work, which is good. The weaknesses:
  - the labels are cut off at 1440 px ("ממתין להחלטה ...");
  - all five tiles carry the same T2 weight, and none of them says which is due first.
- **Phone.** The leak hero fills most of the first screen. The first task card starts at about 75% of the screen height, and 3 of the 5 tasks need 2 scrolls.
- **No morning push.** The evening digest is the only thing that reaches out. The owner has to remember to open the app.

**Wave 2.** W2-08 (not started) adds "לטיפולי", ₪ badges in the sidebar and the bell (`design/d01`).

**Target flow**
1. At 07:30, a brief arrives by push, or as a WhatsApp digest after H-05: "בוקר טוב · 3 החלטות ₪296 · 6 דרישות לשליחה ₪451 · לתשלום השבוע ₪5,901".
2. One tap opens **לטיפולי**: one list sorted by ₪ × days to due. Each row has ₪, what it is, one verb and a due chip.
3. One tap on the first row opens its decision sheet (J2).

The seven levers:
- **Inline:** each row shows why it is due ("לתשלום עד 14.11").
- **Batch:** rows of the same kind collapse into one row ("6 דרישות · ₪450.88").
- **Default:** focus starts on the first row.
- **Desk keys:** J/K through the rows, Enter opens.
- **Phone thumb:** a compact hero (40 px, one context line), with the top 3 tasks right under it. Both sit above the fold on a 390×844 screen. **T1 stays first.**
- **Undo and offline:** not needed (read-only).
- **Notification:** the brief is passive and is not sent when nothing waits for the owner (P22).

**Target:** from the brief to the first decision in **≤2 taps and ≤10 s**. The top 3 tasks are visible with **0 scrolls** on the phone. Desk tiles are ordered by urgency and are never cut off (2 lines are allowed).

**Needs:** W2-08 (`tasks.mine`, badges), AU-04 (brief builders), H-05 (schedules and WhatsApp templates).

---

### J2 · אישור פער לפני תשלום · Approve a gap before paying (owner, manager)

**Why.** This is where the leak becomes money. A gap decided before payment is offset. A gap decided after payment has to be chased.

**Today on `main`** (`live/05`; demo SH-24121: cherry tomatoes billed 9.5 kg, 6.5 received, ₪38.70)
1. Home → "להחלטה" (1 click).
2. The queue cards are good already. Each has a type badge (חוסם / אזהרה), the ₪, a math line ("חויבו 9.5 ק״ג, התקבלו 6.5 = ₪38.70"), the due date and the age, plus two verbs: "דרוש ₪38.70 מהספק" and "שלם כפי שחויב".
3. To see the document or the receipt: open the invoice (2) → correction form → "צפייה בסריקה" (3) → back (4) → back (5).
4. "דרוש ₪38.70 מהספק" (6) → a 10 s undo toast.

That is **6 clicks and 3 screens** with a look at the evidence, or 2 clicks without it.
- **Phone, from an e-mail link:** the general queue opens, you scroll to the card and tap. That is 3 taps plus a scroll, and you never see the document.
- "שלם כפי שחויב" asks for a reason, which is right.
- There is no bulk, there are no keys, and only about 3 cards fit on a 1440×900 screen.

**Wave 2.** W2-04, PR #209, is built (`w2/W2-04-01`, `-02`, `-03`):
- gaps grouped by invoice;
- an evidence pane beside the queue (הזמנה / קבלת סחורה / חשבונית, plus the photo);
- select and bulk ("2 נבחרו · ₪152.50"), with server caps: ₪200 per invoice, and a blocking gap is never bulk-approved;
- keys, with a `?` sheet;
- a message deep link that opens "החלטה על חשבונית", with two thumb-size buttons.

**Target flow**
- **Desk.** J/K moves the focus, and the evidence peek **follows the focus**, so there is nothing to open or close. `1` = "דרשו ₪38.70" · `2` = "שלמו כפי שחויב" (opens the reason chips) · `3` = pass to the owner or later · `Z` = undo. With a mouse: row, then verb = 2 clicks.
- **Phone.** A push reads "₪38.70 · ירקות השרון · חויבו 9.5, התקבלו 6.5". It opens a decision sheet with the 3 numbers, the receiver's photo and the driver's name if there are any, the price source with its date, and the due date. Then "דרשו ₪38.70" = **2 taps**.
- **Batch.** Small `warn` gaps of the same supplier: `X` on each row, then the bulk bar "N נבחרו · ₪Σ".
- **Default.** The recommended verb is the primary one. Later, an AI recommendation chip suggests and never decides (functional-flows §4.5).
- **Undo.** The 10 s toast already on `main`. No confirm dialog, except for a waive above ₪500, which names the ₪ and the supplier.

**Target:** **6 clicks / 3 screens → 2 clicks / 1 screen** (desk). **2 taps / 1 screen from a push** (phone). **≥10 decisions** visible on one 1440×900 desk screen, against about 3 today. **10 decisions in ≤60 s.**

**Needs:** W2-04 (built), G-06 (`notify()` to a person rather than a role), H-05 (push and WhatsApp templates), AD4 SLA nudges (AU-12).

---

### J3 · קבלת סחורה וספירה · Receive and count a delivery (receiver)

**Why.** The signed delivery note is the only evidence created in real time. If the dock does not count, nothing can be claimed later.

**Today on `main`** (`live/12`, `live/13`; W1-06 Delivery Check)
- **Clean delivery:**
  1. The receiver lands on today's trucks ("היום: 3 משלוחים · 0 התקבלו · 1 באיחור").
  2. "התחלת קבלה" (1).
  3. "הכל הגיע כמו בהזמנה (11)" (2).
  4. A **blind spot check**: count 2 random lines (2 numbers), then confirm (3).
  5. The receipt closes and the summary shows.

  That is **3 taps + 2 numbers**, 2 screens and a sheet. It is good: keep it. "צלמו חשבונית" is optional and sits **top-left**, the hardest place for a right thumb to reach. It takes one page through the file picker.
- **One short line:**
  1. "עריכה" on the line (1).
  2. A stepper or decimal field (type 6.5), plus the chip "חסר" or "פגום" (2).
  3. "סמנו את השאר (10)" (3).
  4. The spot check: 2 numbers, then confirm (4).
  5. Close (5).
  6. Share the exception slip to the driver through a WhatsApp prefill (6–7).

  That is **about 6–7 taps + 3 numbers**. There is no photo per line, no reason beyond the two chips, and no driver name or signature.
- **Walk-in supplier:** blocked. The screen says "ספק הגיע בלי הזמנה? בקשו ממנהל/ת המשמרת לפתוח הזמנה". The manager builds an order (10 taps or more) while the driver waits.
- **Offline:** each line saves to a local outbox (wave 1), but the outbox is not visible.

**Wave 2.** W2-05, #189 and #202, built (`w2/W2-05-01..03`): "⟳ 4 ממתינים", an outbox sheet with "שלחו עכשיו", and closing a receipt with no signal ("נסגר בטלפון · יישלח לבד כשיחזור החיבור").

**Target flow**
- **Clean delivery:** unchanged. ≤3 taps + 2 numbers, ≤90 s, never waiting for OCR or the network.
- **Exception:** ✗ on the row → reason chips (חסר · חלקי · פגום · תחליף · מחיר על התעודה) → `QtyKeypad` (big digits, decimal, the unit shown) → photo → "שמרו". **≤4 taps per line.**
- **Photo:** the rear camera opens directly. A multi-page loop ("+ עמוד" / "סיימתי · 3 עמ׳"). The document type is picked before the shot.
- **Walk-in:** "ספק בלי הזמנה" → choose the supplier (recent ones first) → photograph the delivery note → count → close. The manager approves later from a push (owner decision 21). The receiver needs **≤6 taps and waits for no one**.
- **Driver slip:** 1 tap to share, with the driver's name.
- **Thumb:** "הגיע" sits on the **start edge** (right in RTL), under the right thumb. The primary button is full-width at 56 px at the bottom. The camera moves to the bottom bar as the secondary action.
- **Offline:** every line is saved on tap, the outbox chip is always visible, and close works offline.
- **No ₪** anywhere on these screens or in the receiver's notifications.
- **Notifications:**
  - to the receiver at 06:30: "3 משלוחים היום · ראשון: ירקות השרון 10:00";
  - to the receiver and the manager when a truck is 60 minutes late;
  - **to the manager only**, when a receipt closes with exceptions: "חסרים 3 ק״ג עגבניות שרי · ₪38.70 · הנהג חתם".

**Target:** clean delivery **≤3 taps + 2 numbers, ≤90 s** (keep). Exception **≤4 taps per line, including a photo**. Walk-in **≤6 taps, 0 waiting**. **0 entries lost** in an airplane-mode test.

**Needs:** W2-05 (built), G-04 (match-input truth), H-11 (server strips ₪ for the receiver), AU-04 (A3 truck brief).

---

### J4 · שליחת דרישות זיכוי · Send credit claims (owner, manager)

**Why.** A claim that is decided but never sent is worth ₪0. The 7-day overdue rule starts from the letter.

**Today on `main`** (W1-08 letters; `w2/W2-10-03` shows the letter layout)
1. Home tile "דרישות שעוד לא נשלחו ₪450.88" → "לשליחה" (1).
2. `/leaks/claims` shows one letter per supplier, with decided gaps only. Each letter has print, WhatsApp, e-mail and "סמנו שנשלח".
3. For each supplier: WhatsApp (1) → switch app; the chat opens with the text prefilled → send (1) → back to the browser (1) → "סמנו שנשלח" (1).

For 6 suppliers that is **≈25 taps, 12 app switches and 6 statuses set by hand**. Forget one mark and the claim stays "not sent", so the overdue count is wrong.

Already right on `main`: undecided gaps never reach a letter (decision 18), and the page shows a "החליטו" prompt for the ₪296 still undecided.

**Wave 2.** W2-10, #193, #194 and #197, built (`w2/W2-10-01`, `-03`):
- a recovery desk with "תזכורות לספקים": a ready reminder draft for each supplier silent for more than 7 days, opened in WhatsApp or e-mail with one click;
- clearer letters: each line says what was billed and what it should have been.

**Target flow**
1. Open the **"שליחת דרישות זיכוי"** sheet. It has one row per supplier, with the ₪, the number of lines, the channel and the contact. A row expands to show the **literal message** that will go out. Each row has an exclude toggle.
2. One primary button: "שלחו 6 דרישות · ₪450.88".
3. A deferred send with a **10 s "בטל שליחה"**.
4. Each claim's status moves to "נשלח" **from the outbox**, never by hand.

The levers and the plan before the server send:
- **Interim, before H-06 server send:** a row's "שלחו בוואטסאפ" opens wa.me. When the user comes back, the row is marked sent automatically and an undo toast offers to reverse it. That is 2 taps per supplier, and there is no separate status step.
- **Default:** the channel comes from the supplier's preference, and the letterhead from #213.
- **Notifications:**
  - the daily 16:00 batch: "3 דרישות זיכוי מוכנות · ₪257", which opens the send sheet;
  - on day 7: "₪859 ממתינים מעל 7 ימים · 5 ספקים · תזכורות מוכנות", which opens the reminder sheet.

**Target:** **≈25 taps / 12 switches / 6 manual marks → 3 taps / 0 switches / 0 marks.** Interim: 2 taps per supplier and 0 marks. Letters sent within 48 h of the decision: **≥80%** (AU KPI, phase B).

**Needs:** W2-10 (built), H-06 (server send and claim portal), AU-03 (chase loop), AU-17 (supplier loop). **Open question Q1:** AD10 requires one owner tap per send. Does a batch tap count as one?

---

### J5 · רישום חשבונית זיכוי · Record a credit note (bookkeeper)

**Why.** Recording the credit note is the moment a claim becomes money back. A VAT mistake here misstates the recovered ₪ by 18%.

**Today on `main`**
1. Sidebar "מעקב זיכויים" (1).
2. Scroll to the supplier row → "רשמו זיכוי שהתקבל" (2).
3. Tick the claims the note covers (1–5 clicks).
4. Type the note number, the amount and the date. **The amount is before VAT on `main`**, so the ₪84.96 printed on the note must be typed as ₪72.00 after dividing by 1.18 in her head.
5. "שמירה" (1).

That is **about 5–9 clicks, 3 fields and some arithmetic**. A credit note that arrives by WhatsApp or e-mail is taken in **as an invoice**, because nothing records the document type. That can create a false invoice.

**Wave 2.** W2-10, built (`w2/W2-10-02`): the amount is typed "as printed", with a "כולל מע״מ / לפני מע״מ" toggle and a ✓ "נכבר ₪72.00 מתוך ₪72.00 לפני מע״מ".

**Target flow**
1. The credit note is photographed or forwarded.
2. It is recognised as a **חשבונית זיכוי** (G-09 or AU-02).
3. `creditLineSuggestions` (exists) proposes which open claims it covers.
4. A task appears: "זיכוי ₪84.96 ממאפיית ברנר · מכסה BR-24099 · אשרו שיוך". Enter or one click accepts it.

- **Manual path:** ≤4 clicks + 2 fields (the note number, and the amount as printed). The date defaults to today, and the VAT basis defaults to whatever the document says.
- **Status:** the claims move to "זוכה" by themselves, and to "הוחזר" once they are netted in a payment (J11).

**Target:** **about 7 clicks + 3 fields + arithmetic → 1 click.** Manual ≤4 clicks + 2 fields, **0 arithmetic**.

**Needs:** W2-10 (built), G-09 (document type at intake), AU-02, AU-10.

---

### J6 · הזמנה שגרתית · Place a regular order (manager, chef)

**Why.** The order sets the expected quantity and the agreed price. Every later gap is measured against it. A missed cut-off means an emergency buy at retail.

**Today on `main`** (`live/14`; since W1-11 the chef orders directly)
1. Orders (1).
2. Find the last order to this supplier: scroll or filter (0–2).
3. "הזמן שוב" (1). If a draft already exists, choose attach, replace or keep (0–1).
4. The build step opens with the lines prefilled. Adjust about 3 of the 10 lines with ±; each tap is one unit, so 2–6 taps.
5. "המשך לסקירה" (1).
6. Review: a preview of the document and the channel → "שלחו" (1).
7. For "מהוואטסאפ שלי": send in WhatsApp (1) and come back (1).

That is **8–14 taps**. The cut-off is not shown until it has been missed. With no past order, every item is a catalog search and each quantity starts at 1: **about 40 taps plus typing** (orders-01).

**Wave 2.** W2-06, #184, built (`w2/W2-06-01..03`):
- an order guide "מה שאתם מזמינים בד״כ", built from the last 8 orders;
- "כמו בפעם הקודמת" fills 4 items (₪1,627.26), with undo;
- 3 steps instead of 4;
- the order list becomes a work queue with counts and a "תשובת הספק" column;
- the order page shows הוזמן · התקבל · חויב.

**Target flow**
- **Prepared draft** (AU-11): 2 h before the cut-off, a push reads "הזמנה לדגי הים מוכנה · 4 פריטים · ₪1,627 · נסגר ב-14:00".
  1. It opens a review sheet. Each line shows its reason ("ממוצע 4 הזמנות"), the agreed price inline (AU-24), and the literal outgoing text.
  2. "שלחו", with a 10 s "בטל שליחה".

  That is **2 taps**.
- **Manual path:** start from the guide, never from search. Tapping a quantity opens `QtyKeypad` instead of ± per unit. A sticky bar shows "N פריטים · ₪ · אספקה יום ב׳ · נסגר ב-14:00". **≤9 taps, ≤45 s, no keyboard.**
- **Drafts are never lost.** Switching supplier keeps the lines for each supplier.
- **₪:** the chef sees ₪ here (owner decision). The receiver never reaches this screen.

**Target:** **8–14 taps → 2 taps from a draft. Manual ≤9 taps, ≤45 s** (W2-06 e2e timer). A routine order with no past order drops from about 40 taps to ≤9.

**Needs:** W2-06 (built), AU-11, AU-24, H-05 (cut-off push schedule).

---

### J7 · אישור הזמנה אצל הספק · Supplier confirms or changes (supplier → manager)

**Why.** The supplier's answer is the cheapest evidence of all. If "only 6 of 10" is recorded before the truck leaves, the dock expects 6, and there is no false shortage and no dispute.

**Today on `main`** (`live/15`, `ext/g10-*`)
- **Supplier side:** tap the link (1). The page shows who ordered, the delivery date, when the link expires, the total and a card per line with "אין במלאי". The sticky button is "אישור ההזמנה כפי שהיא" (2). **That is done in 2 taps; keep it.**
  - A change: per line, "אין במלאי" or a new quantity or price (1–3 taps plus digits), then send (1).
  - Once answered, the link is read-only.
- **Restaurant side:** the answer **does not change what the dock expects**, and **nobody is told** (functional-flows ff-01, ff-08). The manager only sees it if he opens the order. W2-06 adds a "תשובת הספק" column.

**Target flow**
- **Supplier:**
  - as-is in **2 taps, ≤10 s**;
  - a change: tap the line → keypad or the "אין" chip → "שלחו שינויים (2)". **≤2 taps per changed line, plus 1**;
  - the ₪ sits on the correct side, the page works on 3G, and the supplier gets a receipt for the answer.
- **Restaurant:**
  1. A push to whoever sent the order: "ירקות השרון שינו 2 שורות · עגבניות 6 במקום 10".
  2. A diff sheet.
  3. "קבלו שינוי" (**1 tap**). The receiver's expected quantity updates (G-10, H-08). "דחו" opens a call or WhatsApp to the agent instead.

**Target:** the answer reaches the dock **automatically** (today it never does). The restaurant accepts in **1 tap from the push**. The supplier stays at 2 taps.

**Needs:** G-10, H-08 (revised expectation), W2-06.

---

### J8 · סגירת חודש · Close the month (bookkeeper)

**Why.** This is the bookkeeper's whole relationship with the product, and she is the channel to 10–30 restaurants. If the month close needs six screens and two calls to the manager, she will not recommend RestoMatch.

**Today on `main`.** There is no close screen. She visits:
- **חשבוניות נכנסות:** she can read but **cannot approve** a document (manager only);
- **each consolidated invoice:** the proposal is read-only, so it waits forever;
- **מעקב זיכויים;**
- **the "VAT at risk" card** on home;
- **כרטסת ספקים;**
- **ריצת תשלומים:** a CSV;
- **סגירת חודש וייצוא:** a date range and a file, with no preview and no log.

That is **≥6 screens, ≥25 clicks, no "done" signal and 2 dead ends**: approving a document and correcting an invoice need the manager. The same month can be exported twice.

**Wave 2.** W2-02 is built (`w2/W2-02-01`): an invoice register with status tabs and counts ("לבדיקה 4 · הותאמו 8 · שולמו 23"), the ₪ gap, the days to payment and a totals row. It is the backbone. The month close itself is wave 3. The export preview and log are W2-14.

**Target flow.** One page, **"סגירת חודש · אוקטובר"**, with 6 steps that check themselves:
1. All documents are in and reviewed, with a missing-documents list per supplier (A23).
2. Consolidated invoices are linked: "אשרו את כל ההתאמות הוודאיות (N)".
3. Credit notes are matched.
4. Allocation numbers are in order: the VAT ₪ at risk and the request drafts (AU-08).
5. Payments are recorded (J11).
6. The export is previewed. "ייצוא לחשבשבת / פריוריטי" writes a log entry and **locks** the month.

- Each row shows a count, the ₪, one verb and who holds it. The verb opens a **sheet in place**.
- A blocker that belongs to someone else offers "הזכירו ל‹מנהל›".
- The bookkeeper may approve documents and correct invoices, with an audit log (**open question Q5**).

**Target:** **≥6 screens / ≥25 clicks → 1 screen. ≤10 clicks when the month is clean. Every blocker ≤2 clicks.** The export cannot run twice for one month without a visible warning.

**Needs:** W2-02 (built), W2-14 (export preview and log), W3 month close, AU-08, AU-09, AU-18, H-07 (closed months).

---

### J9 · בדיקת ספק אחד · Check one supplier (owner)

**Why.** Before a call with the rep, the owner needs four answers on one screen: what they owe me, what is waiting, what got more expensive, and when the next delivery is.

**Today on `main`**
1. Search (1), type the name, Enter (2).
2. The supplier page opens on the **details tab, which is an edit form**.
3. Then tabs: leak (3), ledger (4), contract (5), orders (6), schedule.

There is no "what do I do now" summary and no call or WhatsApp button. The leak card exists.

**Wave 2.** W2-11, not started: an overview sheet (85 vh on the phone) with tel, wa.me and mailto tokens.

**Target flow.** Search, and the supplier opens as a **snapshot**:
1. A header: name, ח״פ, the rep, call and WhatsApp.
2. A **"מה עכשיו"** row:
   - open claims ₪ → "שלחו תזכורת";
   - waiting for a decision ₪ → "להחלטה";
   - prices that rose, in ₪/month → "ראו";
   - the next delivery and its cut-off → "הזמינו".
3. Six months of billed against agreed prices.
4. The tabs follow, for depth. AU-22's negotiation pack is 1 more click.

**Target:** **about 7 clicks → 2 clicks + typing.** **0 tab hunting** for the four answers. A call or WhatsApp in 1 tap.

**Needs:** W2-11, AU-13 (₪/month), AU-22.

---

### J10 · מציאת חשבונית · Find an invoice (bookkeeper)

**Why.** The supplier is on the phone saying "we never got paid for 24108". The answer has to come before the call goes cold.

**Today on `main`**
- **With the number:** click the search box (1), type at least 2 characters, choose the invoice (2). It lands on the **correction form**; the gaps live on the approvals and leak screens (+2).
- **Without the number** ("the meat invoice from last Tuesday, about ₪3,000"): there is no invoice list. Supplier → ledger tab → month → … is **about 5–7 clicks across 3 screens**.
- Search has no shortcut key on `main`. Ctrl+B, which collapses the sidebar, is the only global key.

**Wave 2.** W2-02, built (`w2/W2-02-01..03`):
- the register;
- an invoice cockpit with הוזמן · התקבל · חויב per line, the price that should have been charged and its source, and a decide button;
- `[` and `]` to step through the queue.

**Target flow**
1. **Ctrl/⌘K** anywhere (bound by `code`, so it works on a Hebrew layout).
2. Type "שטיינברג 104": a supplier plus a fragment of the amount or the number, in Hebrew or digits.
3. The result rows show number · date · ₪ · status.
4. Enter opens the **invoice cockpit**: the document beside its lines, the gaps, the decision and the document chain.
5. To browse instead: the register's filters for status, supplier, ₪ range and date, in ≤3 clicks.

**Target:** **about 5–7 clicks / 3 screens → 1 shortcut + typing + Enter, ≤5 s, 1 screen.**

**Needs:** W2-02 (built), a palette that binds the existing `search.global` (W3 ⌘K), G-12/AU-06 for "what needs me" answers.

---

### J11 · ריצת תשלומים · Pay run (owner, bookkeeper)

**Why.** This is the last gate before ₪200k a month leaves. Offsetting before payment is the cheapest recovery there is, and a duplicate or a changed bank account costs a whole invoice.

**Today on `main`**
1. Home tile "ריצת התשלומים ₪5,901" → "לריצה" (1).
2. A list for the month, per supplier: can pay / hold / ask for credit. It holds duplicates, missing counts and missing links. There is a CSV export (2).
3. The payment is made in the bank, outside the app. **Nothing records "paid":** nothing in the code writes `approved` or `paid`. Due dates are not used, so the invoice due in 3 days is not first.

That is a **dead end**.

**Wave 2.** W2-03 has not started. It needs H-03 for `paid_at` and deductions.

**Target flow**
1. **"לתשלום השבוע"**, sorted by due date. For each supplier: net = invoices − accepted claims (offset before payment, never also on a letter; decision 19) − holds.
2. Holds show inline, each with its reason and verb:
   - חסר מספר הקצאה → "בקשו מהספק";
   - כפילות → "פתחו";
   - פרטי בנק השתנו → a **hard hold that only the owner can release**.
3. Select with `X` or the checkboxes → "אשרו לתשלום ₪12,400 · 6 ספקים".
4. The bank file or transfer happens outside the app (Masav later, AU-19).
5. "סמנו כשולם", with the date defaulting to today. The netted claims become "הוחזר" **by themselves**.

A confirm dialog appears only when a release is above an owner limit. It names the ₪ and the suppliers.

**Target:** **dead end → 3 clicks per batch.** **0 hand updates** to claims.

**Needs:** W2-03, H-03, AU-14 (pre-flight), AU-19.

---

### J12 · תיקון קריאה שגויה · Fix an OCR misread (manager, bookkeeper)

**Why.** One wrong digit makes a phantom gap or hides a real one. The size of the risk shows in a neighbouring case from W2-12 (`ext/w2-12-contracts-import-diff`): a price-list typo that turned an entrecôte price of ₪139 into ₪1,250 would have cost ₪39,625 a month. An OCR misread does the same damage on one invoice. The owner believes the leak only if misreads are rare and quick to fix.

**Today on `main`.** The invoice page is a **"תיקון חשבונית"** form:
- header fields (number, date, before VAT, VAT, total), saved with "שמירת פרטים";
- a lines table where each line has its own save;
- "צפייה בסריקה" opens the scan **separately**;
- "הרצה מחדש" re-runs the match **by hand**.

That is **2 screens and ≥5 clicks plus typing** per fix. **Manager only**: the bookkeeper cannot correct.

**Wave 2.** W2-02, built (`w2/W2-02-02`, `-03`): a cockpit with the document view ("מסמך" / "שורות" on the phone) and the 3-way comparison per line.

**Target flow**
- **Split view:** the document on one side with the selected line highlighted, the lines on the other.
- **Markers:** only fields below the OCR threshold carry one (R-11: at most 1 per card).
- **Keys:** **Tab** and **Shift+Tab** jump between flagged cells only. Type the value, then Enter.
- **Totals check:** "Σ שורות + מע״מ = סה״כ" must turn ✓ before saving is offered (the xtraCHEF rule).
- **Save** re-matches automatically and shows the ₪ effect ("הפער ירד מ-₪104.80 ל-₪0").
- **Bookkeeper allowed**, with an audit log.

**Target:** **2 screens / ≥5 clicks → 1 screen / 0 clicks (keyboard only). ≤60 s** for a typical misread. **Zero-touch invoices ≥50%** by the end of December (AU-07 KPI).

**Needs:** W2-02 (built), G-07 (bookkeeper capability), G-08 (link provenance), AU-02.

---

## 4. מה הספירה מגלה · What the counts reveal

### 4.1 Where today's taps go

| Where the taps go | Jobs | Taps lost per job | Fix |
|---|---|---|---|
| **Walking to the evidence** (open the invoice → open the scan → back → back) | J2, J10, J12 | 3–4 | The peek follows the focus (P2) |
| **App switches** to WhatsApp and back | J4, J6 | 2 per message | A send sheet with deferred send; statuses from the outbox (P5, P8) |
| **Statuses set by hand** ("סמנו שנשלח", entering the credit, "paid" impossible) | J4, J5, J11 | 1 per item, and errors when forgotten | Statuses move themselves (P8) |
| **Hunting** (no invoice list, no shortcut, supplier opens on a form) | J8, J9, J10 | 3–5 | Palette, register, snapshot (P2, P7) |
| **Arithmetic** (VAT on a credit note, net pay) | J5, J11 | Mental work and a risk of error | Defaults from the document (P4) |
| **Silent hand-offs** (supplier answer, escalation, walk-in) | J2, J3, J7 | A whole extra trip to look | Every hand-off is a task with an owner (P3) |
| **Equal weight** (five T2 tiles, a red card for every gap) | J1, J2 | Attention | A T2 colour budget and urgency order (P1, §8) |

### 4.2 Already right on `main`: keep it

- Verbs with ₪ ("דרוש ₪38.70 מהספק").
- The 10 s undo toast.
- The blind 2-line spot check.
- Count first, photograph second.
- A waive needs a reason.
- Letters carry decided gaps only.
- No ₪ for the receiver.
- The supplier link needs no account, and once answered it is read-only.

---

## 5. עקרונות עיצוב לתפעול · Design principles for operations (10)

Each principle has a rule, a test that a reviewer or an e2e spec can run, and the jobs it serves.

**P1 · כל משימה היא משפט: ₪ + פועל + מועד · Every task is a sentence**
- **Rule:** an item that needs action reads as one sentence: the money, one verb that says what happens to the money, and when ("דרשו ₪38.70 מירקות השרון · לתשלום עד 14.11"). Only act-now items get T2. Waiting on someone else is T4.
- **Test:** every actionable row has exactly one primary verb, its ₪ (role permitting) and a due or age chip. T2 badges are fewer than or equal to the items due within 7 days.
- **Jobs:** J1, J2, J4, J8, J11.

**P2 · הראיה באה אל ההחלטה · The evidence comes to the decision**
- **Rule:** הוזמן · התקבל · חויב, the price source and its date, the photo, the driver's name and the supplier's reply are shown inline or in a peek that follows the focus. **Deciding never needs a page change.**
- **Test:** 0 navigations to decide any gap; the peek renders in ≤150 ms from cache.
- **Jobs:** J2, J5, J9, J10, J12.

**P3 · ההתראה נוחתת על ההחלטה · A notification lands on the decision**
- **Rule:** every message carries one ₪ (if the role may see it), one verb, and a deep link to the exact card, never to the list. A message is time-sensitive only when someone is waiting: a driver, a cut-off, a due date within 48 h. Passive events never push.
- **Test:** from a push to done in ≤2 taps; quiet hours, Shabbat and a cap of 6 per person per day are enforced; every hand-off mutation creates a task or proves none is needed.
- **Jobs:** J1, J2, J3, J6, J7.

**P4 · ברירת מחדל לשגרה, בדיקה עיוורת, חריגה זולה · Default the usual, spot-check it, make exceptions cheap**
- **Rule:** the common case is one tap ("הכל הגיע כמו בהזמנה", "כמו בפעם הקודמת", "אשרו את כל ההתאמות הוודאיות (N)"), and a blind check keeps it honest. An exception takes ≤4 taps. The system does the arithmetic: VAT basis, net pay, dates.
- **Test:** the tap budgets in §3 are pinned in e2e; no field asks the user to compute a value that the system already knows.
- **Jobs:** J3, J5, J6, J8, J11.

**P5 · ביטול במקום שאלה · Undo, don't ask**
- **Rule:** follow R-6, R-7 and R-8.
  - A reversible action is optimistic, with a **10 s undo**.
  - Anything going out to a supplier gets a **literal preview and a deferred send with "בטל שליחה"**.
  - Only a write-off, a deletion, or a release above an owner limit gets a confirm dialog, and it names the ₪ and the party.
- **Test:** zero `window.confirm()`. A confirm dialog appears only for those three action types. An error toast never closes by itself.
- **Jobs:** J2, J4, J6, J11.

**P6 · שום דבר שהוקלד לא הולך לאיבוד · Nothing typed is ever lost**
- **Rule:** field work saves per line, the outbox is visible, a reopened screen resumes at the same line, a receipt closes offline, and signing out never deletes a queued photo.
- **Test:** an airplane-mode e2e test (20 lines, reload, reconnect) syncs once with 0 loss; a reload in the middle of a count resumes there.
- **Jobs:** J3, J6, inventory count.

**P7 · בשולחן במנות, בטלפון אחד-אחד · Batch at the desk, one at a time on the phone**
- **Rule:**
  - **Desk:** select rows and use the bulk bar, which shows Σ₪ and the server caps (₪200 per invoice in bulk; a blocking gap never in bulk). Group by supplier, invoice or due date.
  - **Phone:** one card and one thumb verb at a time.
- **Test:** ≥10 decision rows on a 1440×900 screen; the bulk bar always shows Σ₪ and says why a row cannot join the batch.
- **Jobs:** J2, J4, J8, J11.

**P8 · מצבים זזים לבד, אנשים רק מחליטים · Statuses move themselves; people only decide**
- **Rule:** once an event can be observed (sent, answered, credited, paid), nobody sets that status by hand. Checklists check themselves. Every object shows its **document chain** (order → supplier answer → receipt → invoice → claim → credit → paid).
- **Test:** the number of hand-set status controls in the product falls to 0 by wave 3. Every transition writes one `activity_events` row.
- **Jobs:** J4, J5, J7, J8, J11.

**P9 · שני מכשירים, שפה אחת · Two instruments, one language**
- **Rule:**
  - **Field mode** (dock, walk-in, supplier link): one 56 px primary at the bottom, 48 px rows, text of 16 px and up, opaque surfaces, high contrast, no hover-only or gesture-only actions.
  - **Desk mode:** density, tables, split view and keys.
  - Both use the same tokens, tiers and `<Money>`.
- **Test:** field routes pass the glove-and-sun spec (mobile-field-14); desk routes pass a keyboard-only run of J2, J8, J10 and J12.
- **Jobs:** all.

**P10 · כסף לפי הרשאה, לא לפי CSS · Money by capability, not hidden by CSS**
- **Rule:**
  - The receiver sees no ₪ anywhere, including notifications.
  - The chef sees ₪ only on orders and recipes.
  - One `<Money>` path decides, from the capability.
  - Numbers are always tabular and aligned right (R-1, R-2), in one format.
- **Test:** a role-matrix e2e checks the rendered DOM and the tRPC JSON (H-11).
- **Jobs:** J3, J6, and every notification.

---

## 6. דפוסי רכיבים · Component patterns

"Builds on" names the primitive that already exists on `main` (`apps/web/lib/components/**`). Status: **main** = exists, **W2** = built in a draft PR, **planned** = in a brief, **new** = proposed here.

| # | Pattern | What it does | Phone / desk | Principles | Jobs | Builds on | Status |
|---|---|---|---|---|---|---|---|
| 1 | **TaskRow** · שורת משימה | ₪ · what · one verb · due chip. T2 only when act-now; T4 for "waiting on someone else" | Row on both; a stack under the hero on the phone | P1, P3 | J1, J8 | `MetricTile`, `DeadlineChip`, `Money` | main (home tiles) → W2-08 list |
| 2 | **DecisionCard** · כרטיס החלטה | Type badge, ₪ at card level, a one-line math (`WhyLine`), due and age, a primary verb with ₪, a secondary verb, overflow (escalate, waive with a reason), history | Card on the phone; dense row on the desk | P1, P2, P5 | J2, plus J7 (supplier change), J11 holds, J8 consolidated | `Badge`, `WhyLine`, `Button` | main → W2-04 grouped per invoice |
| 3 | **EvidencePeek** · חלונית ראיות | Follows the focus. Holds the 3-way numbers, a crop of the document with the line highlighted, the receiver's photo and the driver, the price source and date, the supplier's reply | Bottom sheet on the phone; side pane on the desk | P2 | J2, J5, J10, J12 | `desk/Peek`, `desk/SplitPane`, `overlay/Sheet` | W2-04 |
| 4 | **ThreeWayRow** · הוזמן · התקבל · חויב | One per-line comparison with the ₪ gap, unit-aware. **It reads the same** in the order, the invoice, the approval and the claim letter | Card on the phone; table row on the desk | P2 | J2, J6, J10, J12 | `table/cells`, `UnitText` | W2-02, W2-06 |
| 5 | **Money / MoneyCell** | Tabular, aligned right, coloured by tier, and a drill link to the rows that sum to it to the agora. Renders nothing for a role with no ₪ | Both | P10, P1 | All | `money/Money`, `Delta`, `PriceMove` | main |
| 6 | **BulkBar** · סרגל בחירה | "N נבחרו · ₪Σ" + the primary verb + the reason a row cannot join ("פער חוסם לא מאושר במרוכז") | Desk (sticky) | P7 | J2, J4, J8, J11 | `table/BatchBar`, `selection` | main → W2-04 |
| 7 | **UndoToast** · הודעה עם ביטול | 10 s, pauses on hover or focus, announced, at most 3 stacked (R-6, R-7) | Bottom-start, above the bottom bar | P5 | J2, J3, J5, J6, J11 | `Toast`, `orders/undo-bar` | main |
| 8 | **SendSheet** · גיליון שליחה | One row per recipient with the literal text or PDF, the channel and an exclude toggle; one primary; a deferred send with "בטל שליחה" for 10 s; status from the outbox | Full sheet on the phone; dialog on the desk | P5, P8 | J4, J6, J7 (restaurant reply) | `Sheet`, `order-document-preview` | new (H-06) |
| 9 | **FieldCountRow** · שורת ספירה | The product, the ordered quantity in large type, the unit, "הגיע" on the start edge at 56 px, ✗ / עריכה, a saved dot and an offline state | Phone (field mode) | P4, P6, P9 | J3, inventory count | `AdjustQuantities` row | main (W1-06) |
| 10 | **ExceptionSheet** · גיליון חריגה | Reason chips → keypad → photo → save, in ≤4 taps | Phone | P4 | J3 | `overlay/QtyKeypad`, `form/FilterChip` | W2-05 (photo per line) |
| 11 | **SpotCheck** · בדיקה עיוורת | 2 random lines, numbers only, an alert on a mismatch | Phone | P4 | J3 | `SpotCheck` in `AdjustQuantities` | main |
| 12 | **OutboxChip + OutboxSheet** · ממתינים לשליחה | "⟳ 3 ממתינים" → a list with times → "שלחו עכשיו" | Phone | P6 | J3, J6, inventory count | `lib/pwa/lineOutbox` | W2-05 |
| 13 | **PrefillBanner** · מילוי מראש | "מילאנו 4 פריטים כמו בפעם הקודמת · ביטול". The same shape for "הצענו שיוך" and "N התאמות ודאיות" | Both | P4, P5 | J5, J6, J8 | `feedback/Banner` | W2-06 |
| 14 | **DueChip / CutoffChip** · ספירה לאחור | "נסגר ב-14:00 · עוד 47 דק׳" or "נותרו 20 ימים · עד 14.11". It changes from T4 to T2 only inside its window | Both | P1, P3 | J2, J6, J8, J11 | `money/DeadlineChip` | main |
| 15 | **DocumentFlow** · שרשרת מסמכים | Order → supplier answer → receipt → invoice → claim → credit → paid. Each node is a link with a status chip; a missing node is T4 ("לא נקלטה קבלה") | Vertical stepper on the phone; horizontal strip on the desk | P8 | J7, J10, J11, J4 | `feedback/StatusChip`, `form/Steps` | new (functional-flows §4.6) |
| 16 | **SupplierSnapshot** · תמונת ספק | A "מה עכשיו" row (4 answers, each with a verb) and contact tokens | 85 vh sheet on the phone; panel on the desk | P1, P2 | J9 | `money/Token`, `MetricTile` | planned (W2-11) |
| 17 | **DocReviewSplit** · מסמך ליד שורות | The document and its lines, R-11 markers, a totals check, Tab between flagged cells | Desk (on the phone: "מסמך / שורות" toggle) | P2, P9 | J12, J10 | `desk/SplitPane` | W2-02 (partial) |
| 18 | **ChecklistStep** · שלב סגירה | A row that checks itself: state icon, count, ₪, one verb, who holds it | Desk | P8, P7 | J8 | `StatusChip`, `RowActions` | new (W3) |
| 19 | **CommandPalette** · חיפוש ופעולות | Ctrl/⌘K: screens · records · actions · "שאלו את RestoMatch" · recent items | Desk; "חיפוש" in "עוד" on the phone | P2, P9 | J9, J10 | `dashboard/search.tsx` (`search.global`) | main (no key, no actions) → W3 |
| 20 | **StickyActionBar (field)** · סרגל פעולה תחתון | One 56 px primary and at most one 48 px secondary, in the thumb zone, above the safe area | Phone | P9 | J3, J6, J7 | `receiver/_steps/ActionBar` | main |
| 21 | **WorkQueueTabs** · לשוניות עם מונים | Tabs that count the work: "דורש טיפול · מגיע היום 3 · באיחור · טיוטות" | Both | P1, P7 | J6, J8, J10 | `table/ViewTabs` | main → W2-02, W2-06 |
| 22 | **KeyHints** · מפת קיצורים | A `?` sheet listing the keys; the single-key on/off switch is saved (sidebar SPEC) | Desk | P7, P9 | J2, J8, J10, J11, J12 | `desk/keys` | W2-04 |

### 6.1 Anatomy of the four patterns that carry the most jobs

**DecisionCard: desk row (1440, about 64 px tall) and phone card**
```
desk (RTL; start = right)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ☐ [חוסם] חיוב על יותר ממה שהתקבל · עגבניות שרי · ירקות השרון · SH-24121      │
│     חויבו 9.5 ק״ג · התקבלו 6.5 · = ₪38.70        ממתין 10 ימים · עד 14.11      │
│                                    ₪38.70   [ דרשו ₪38.70 (1) ] [ שלמו (2) ] … │
└──────────────────────────────────────────────────────────────────────────────┘
phone: badge + title / ₪38.70 (card-level number, 28 px) / math line / due chip /
       [ דרשו ₪38.70 מהספק ] 56 px full width / [ שלמו כפי שחויב ] 48 px / הצג ראיות
```

**EvidencePeek** (it follows the focus; it never opens a page)
1. Three numbers in a row: הוזמן 9.5 · התקבל 6.5 · חויב 9.5.
2. A crop of the document with the line highlighted (or "אין צילום לחשבונית הזו", T4).
3. The receiver's line photo and the driver's name ("הנהג חתם 10:12").
4. The price source and its date ("מחיר מההזמנה 19.10" / "חוזה").
5. The supplier's reply, if any.
6. History: who decided what, and when.

**FieldCountRow + ExceptionSheet** (field mode)
```
┌──────────────────────────────────────────┐
│ פלפל אדום                    הוזמן 9 ק״ג │  ← name 18 px, ordered qty 20 px bold
│ [ ✓ הגיע ]  56 px, start edge   [ ✗ ]    │  ← right thumb rests on "הגיע"
└──────────────────────────────────────────┘
✗ → sheet: [חסר] [חלקי] [פגום] [תחליף] [מחיר על התעודה]
           keypad 6 . 5  ק״ג   → [ צלמו ] → [ שמרו ]   (≤4 taps)
```

**SendSheet**
1. Title: "שליחת דרישות זיכוי · 6 ספקים · ₪450.88".
2. A row for each supplier: name · ₪ · lines · channel icon · ▾ preview of the literal text · exclude toggle.
3. Primary: "שלחו 6 דרישות" → a toast "נשלח · בטל שליחה (10)" → statuses update from the outbox.

---

## 7. מקלדת, אגודל, התראות · Interaction specs

### 7.1 Desk keyboard map

The rules:
- Keys are bound on `KeyboardEvent.code`, so they work on a Hebrew layout.
- Queue keys work only while the list has focus, never inside an input (WCAG 2.1.4).
- Single-key shortcuts can be switched off, and the choice is saved.

| Where | Keys | Action |
|---|---|---|
| Anywhere | Ctrl/⌘K | Palette: screens · records · actions · Ask (new; search exists) |
| Anywhere | Ctrl/⌘B | Collapse the sidebar (exists) |
| Anywhere | `?` | Key map sheet |
| Any queue (approvals, register, pay run, inbox, claims, לטיפולי) | J / K | Next or previous row; the peek follows |
| Any queue | X · Shift+X | Select the row · select a range |
| Any queue | `1` / `2` / `3` | Primary verb / alternative verb / pass on or later (R-9). Approvals: דרשו / שלמו כפי שחויב / העבירו לבעלים. Pay run: אשרו לתשלום / החזיקו / אחר כך |
| Any queue | Enter · O · Esc | Pin the peek open · open the full page · close |
| Any queue | Z | Undo the last action (inside the 10 s window) |
| Document review (J12) | Tab / Shift+Tab | Next or previous **flagged** cell |
| Document review (J12) | Enter · Ctrl/⌘+Enter | Accept the cell · save and re-match |
| Document review (J12) | `[` / `]` | Previous or next document in the queue (W2-02) |
| Month close (J8) | J / K · Enter | Move between steps · open the step's sheet |

### 7.2 Phone thumb zones (RTL, 390×844, one hand)

```
┌──────────────────────────────┐
│ title · status · "× יציאה"   │  hard to reach: read-only and exit only
│                              │
│ content (scrolls)            │  medium: each row's main action on the START edge
│   פלפל אדום  [✓ הגיע] [✗]    │  (right in RTL), where the right thumb rests
│                              │
├──────────────────────────────┤
│ [ secondary 48 ]             │  easy
│ [ PRIMARY 56, full width ]   │  easiest: exactly one primary
│ role bottom bar (hidden in   │
│ field mode)                  │
└──────────────────────────────┘
```

- **One primary per view.** It is full width, so it works for left-handed users too.
- **Destructive actions are never next to the primary.** They go in the overflow or in a sheet.
- **Today's camera button sits top-left** on the count screen (`live/13`). Move it to the bottom bar as the secondary action.
- **No gesture-only actions.** A swipe never saves or decides (the Restaurant365 trap).
- **Field mode** (receiving, count, supplier link, capture):
  - the bottom bar, the cookie banner and any glass effects are hidden;
  - surfaces are opaque;
  - text is at least 16 px; quantities are 20 px bold.

### 7.3 Notifications that land on the decision

Rules that apply to every message:
- one ₪ (only if the role may see it) and one verb;
- a deep link to the exact card;
- quiet 23:00–06:00 and on Shabbat; at most 6 per person per day;
- **Android:** the verbs appear inline in the notification. **iOS home-screen web push** has no action buttons, so it opens the sheet.

| Job | Trigger | To | Level | Message (he) | Opens → action |
|---|---|---|---|---|---|
| J1 | 07:30 daily brief | Owner | Passive digest | "בוקר טוב · 3 החלטות ₪296 · 6 דרישות לשליחה ₪451 · לתשלום השבוע ₪5,901" | לטיפולי |
| J2 | A gap is found (match run) | `requires_role` | Active; time-sensitive if a block ≥ ₪500 comes before payment | "₪38.70 · ירקות השרון · חויבו 9.5, התקבלו 6.5" | Decision sheet → **דרשו ₪38.70** |
| J2 | Day 2 of waiting (AD4: 24 h / 48 h) | The decider, then the owner | Active | "2 החלטות מחכות יומיים · ₪296" | Queue, filtered |
| J3 | 06:30 | Receiver | Active, **no ₪** | "3 משלוחים היום · ראשון: ירקות השרון 10:00" | Receiving |
| J3 | Expected time + 60 min, no receipt | Receiver + manager | Time-sensitive | "ירקות השרון באיחור של שעה" | Board → **התקשרו / וואטסאפ / לא הגיע** |
| J3 | A receipt closes with exceptions | Manager | Time-sensitive (the driver is on site) | "חסרים 3 ק״ג עגבניות שרי · ₪38.70 · הנהג חתם" | Exception slip |
| J3 | A walk-in is waiting | Manager | Time-sensitive | "ספק בלי הזמנה בדלת: מאפיית ברנר · 6 שורות" | **אשרו קבלה** |
| J4 | 16:00 batch | Owner, manager | Active | "3 דרישות זיכוי מוכנות · ₪257" | Send sheet → **שלחו הכל** |
| J4 | Day 7, overdue | Owner, manager (bookkeeper, opt-in) | Active | "₪859 ממתינים מעל 7 ימים · 5 ספקים · תזכורות מוכנות" | Reminder sheet |
| J5 | A credit note arrives and is matched | Bookkeeper | Passive | "חשבונית זיכוי ₪84.96 ממאפיית ברנר · מכסה דרישה אחת" | **אשרו שיוך** |
| J6 | Cut-off − 2 h, draft ready (AD9) | Manager or chef | Active | "הזמנה לדגי הים מוכנה · 4 פריטים · ₪1,627 · נסגר ב-14:00" | Review → **שלחו** |
| J7 | The supplier changed lines | Whoever sent the order | Active | "ירקות השרון שינו 2 שורות · עגבניות 6 במקום 10" | Diff → **קבלו שינוי** |
| J8 | The 5th of the month, close steps still open | Bookkeeper | Active | "סגירת אוקטובר: 3 שלבים פתוחים · מע״מ ₪1,123 בסיכון" | Month close |
| J11 | Weekly, payments due | Bookkeeper, owner | Passive digest | "לתשלום השבוע ₪12,400 ל-6 ספקים · ₪257 מקוזזים" | Pay run |
| J12 | OCR failed or could not read | The uploader + the bookkeeper | Active | "החשבונית מקצביית הכרם לא נקראה · צלמו שוב" | Retake or open the review |

### 7.4 Undo, confirm and offline (one table for every action)

| Kind of action | Treatment | Examples |
|---|---|---|
| Reversible inside the app | Optimistic, plus a 10 s undo | Decide a gap, accept a link, mark paid, "כמו בפעם הקודמת" |
| Outbound to a supplier | Literal preview, then a deferred send with "בטל שליחה" for 10 s | Claims, orders, reminders, allocation-number requests |
| Write-off, deletion, release above an owner limit | A confirm dialog that names the ₪ and the party | "ויתור על ₪100 מקצביית הכרם", a hard hold on bank details |
| Field entry | Saved per line on the device; outbox chip; resume; works offline | Receiving, count, order draft, photos |
| Error | Never closes by itself; says what failed, what was kept, and what to do next | Failed send, failed upload |

---

## 8. מה זה דורש ממערכת העיצוב · What the jobs ask of DS2 (input to the fonts and tokens tracks)

1. **One numeric voice.**
   - Every ₪, quantity and % is set with tabular, lining figures (R-2).
   - The Hebrew face must carry a ₪ glyph that matches its digits.
   - The digits must stay distinct at 16 px in sunlight: 1 and 7, 3 and 8, 6 and 9, with open apertures.
   - Test any font candidate on four real strings: "₪38.70", "9.5 ק״ג", "−₪1,123", "1.8%", inside Hebrew sentences (bidi isolation via `<bdi>`, never hand-typed direction marks).
2. **Four ₪ sizes and no more.** The jobs only ever need four:
   - hero: 56–60 px on the desk, 40–44 px on the phone (R-15);
   - card ₪: 24–28 px;
   - row ₪: 15–16 px;
   - dense table: 13–14 px, tabular.
3. **Three densities.**
   - **Field:** 56 px primary, 48 px rows, 16 px+ text.
   - **Owner desk:** 40 px rows.
   - **Bookkeeper desk:** 32 px rows (the 12 px desk floor, R-13).

   They are switched by mode (`data-mode="field"`) or by role, never per page.
4. **A colour budget for T2.**
   - Solid danger or warn is for act-now items only.
   - A screen should rarely show more than 3 T2 elements; today's home shows 5 equal ones.
   - T3 gold and green are calm. T4 neutral covers everything that is waiting on others or on a consolidated invoice.
5. **Row states, at the desk.** Focused, selected, peeked, decided (with the row leaving in 150 ms, R-10) and undone. Each needs its own token and must be told apart without colour alone.
6. **Field mode tokens.** Opaque surfaces; primary text contrast ≥7:1 on field routes (sun); the focus ring at ≥3:1 (R-5); no blur.
7. **Motion.** 100/150/240/400 ms (R-10). The undo countdown and the outbox spinner are the only motion that loops.
8. **Hebrew-first keys and labels.** The hints in the `?` sheet show the Hebrew keycap next to the Latin one ("J / ח").

---

## 9. איך מודדים · How we will measure

| Measure | How | Target |
|---|---|---|
| Taps and clicks per job (J1–J12) | One e2e spec per job counts deliberate presses and navigations (`ops-J2-desk`, `ops-J3-clean` and so on), with a timer like the one in W2-06 | The §3 targets. A regression fails CI once wave 4 makes them blocking |
| Time from push to done | Notification id → decision `activity_events` row | Median ≤30 s (J2), ≤2 min (J6) |
| Receiving session length | GR opened → closed (AU-07) | Median ≤2 min clean, ≤4 min with exceptions |
| Approvals median age | AU-07 | < 24 h |
| Zero-touch invoices | AU-07 | ≥50% by the end of December at ציקטי |
| Letters sent within 48 h of the decision | AU-07 | ≥80% |
| Manual status edits | Count of hand-set status mutations | → 0 by wave 3 |
| Bookkeeper minutes per month | AU-07 telemetry plus her own report | Baseline, then falling. Never shown as ₪ above her fee |
| Five-owner check | 5 owners or managers each do J1, J2 and J6 on their own phone, watched | ≥4 of 5 finish with no help |

---

## 10. שאלות לבעלים · Open questions for the owner

Each question has a recommended default. Until the owner answers, the design follows the default.

| # | Question | Recommended default |
|---|---|---|
| Q1 | AD10 says "one owner tap per send". Does one tap on "שלחו 6 דרישות", after a per-row preview and with a 10 s undo, count? | **Yes**, with the preview and the per-row exclude |
| Q2 | Hold non-urgent alerts during dinner service (for example 18:00–22:30)? | **Yes** for passive and active alerts; time-sensitive ones still go |
| Q3 | On the phone home, may the leak hero shrink to a compact card (40 px, one context line) on mornings with tasks, so the top 3 tasks sit above the fold? | **Yes**. T1 stays first |
| Q4 | May the receiver start a walk-in receipt (supplier, photo, count) before the manager approves it? | **Yes**. The manager approves from a push (decision 21) |
| Q5 | May the bookkeeper approve inbox documents and correct OCR, with an audit log? | **Yes**. Today both are manager only, and they block the month close |
| Q6 | Should single-key shortcuts be on by default for the bookkeeper role? | **Yes**, for queues only, with the saved off switch |

---

## Sources

**In the repo**
- `origin/main`:
  - `STATE.md`, `AGENTS.md`, `docs/ICP.md`;
  - `docs/ux/REVIEW-REPORT.he.md`, `docs/ux/RUBRIC.md` (R-1 to R-15), `docs/ux/research/restaurant.md`;
  - `docs/ux/review/lens-functional-flows.md` (§1 loop, §4.2–4.6), `docs/ux/review/lens-mobile-field.md`;
  - `docs/ux/sidebar/SPEC.md`;
  - `docs/ux/wave2/README.md` §7 and §12, and the briefs W2-02/03/04/05/06/07/10/11;
  - `docs/research/ניהול חשבוניות ספקים במסעדות/report.md` and `notes/israel_restaurant_operations.md`.
- `origin/claude/research-in-app-automation` (PR #235):
  - `docs/ux/automation/README.md` (§7 AD1–AD14, §10b wave-2 status, §11 AU index, §12 KPIs);
  - `docs/research/אוטומציות במוצר/notes/10-catalogue-and-impact.md` (§0 typical restaurant, A1–A26);
  - the same folder: `notes/ext-05-ops-automation-benchmarks.md` and `notes/21-owner-chef-value-and-new-automations.md`.
- Code on `main` used for the counts:
  - `dashboard/receiving/[poId]/wizard.tsx` and `showcase/receiver/_steps/AdjustQuantities.tsx` (count, spot check, close);
  - `dashboard/orders/new/wizard.tsx` (SUPPLIER/BUILD/REVIEW/SENT, reorder);
  - `dashboard/approvals/list.tsx` (verbs, undo, waive reasons, no bulk or keys);
  - `dashboard/approvals/pay-run/page.tsx` (CSV, no paid writer);
  - `dashboard/leaks/claims/letter-actions.tsx` (print, WhatsApp, e-mail, manual mark);
  - `dashboard/recovery/tracker-client.tsx` (`recordCreditNote`);
  - `dashboard/invoices/[invoiceId]/correction-client.tsx` and `packages/api/src/routers/receiving.ts` (`updateInvoiceHeader` and `updateInvoiceLine` are manager-only);
  - `packages/api/src/routers/ingest.ts` (`approveDocument` is manager-only);
  - `dashboard/search.tsx` (`search.global`, no key binding);
  - `dashboard/nav.tsx` (Ctrl+B);
  - `app/s/[token]/*` (supplier link);
  - `apps/web/lib/components/**` (the primitives in §6).

**In the scratchpad**
- `site-tour/live/01–18`, `site-tour/w2/W2-*`, `site-tour/ext/*`.
- `tour-page/caps.json` (the captions).
