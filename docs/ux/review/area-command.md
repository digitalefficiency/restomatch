# Area review: Owner command center: home for every role, Ask, reports (`command`)

**Reviewer:** UX review team, area `command` · **Date:** 2026-10-25 (DEMO_TODAY) · **Tree:** `main` @ 8fef118c (worktree `scratchpad/ux/wt`)
**Routes:** `/dashboard` (5 roles) · `/dashboard/ask` · `/dashboard/reports/monthly` (+ `/pdf`) · `/dashboard/reports/digest`
**Archetypes:**
- `/dashboard`: Overview.
- `/reports/*`: Report.
- `/ask`: Form plus answer feed.

**Rubric groups applied:** A, D, H in full; B, C (C8, C9, C12, C14), E, F, G (G2, G10), I (I1, I4) and J (J1, J4) where the pattern appears.
**Benchmarks used:**
- Home and task feed: Ramp Homepage task feed, Linear Inbox and Pulse, Restaurant365 "My List", Shopify POS smart grid.
- Finance overviews: Stripe Home, Mercury Insights and Command, Rillet close checklist.
- Restaurant supplier apps: US Foods MOXē Delivery Tracker, Apicbase mobile home.
- Q&A with sources: Notion AI.

## Scores (0–10, against world-class)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **2.5** | No role has a home of its own: the receiver, chef and manager all open the owner's "חדר הבקרה". On the owner's phone, a 15-control filter wall pushes the ₪ hero under the bottom nav (y=756 vs nav top 791 at 390×844; fully off-screen at 375×667). The only "needs you" item is a count of 4, about 3,100 CSS px down. |
| Desktop | **4.0** | The light visual is clean. The hero is honest about pending consolidated invoices (T4), and the drill keeps the period and filters. But the decisions sit at y≈2,200 with no ₪, and the page is 3,745 px (4.2 screens) in a 1,104 px column. The bookkeeper gets a copy of the owner's page, and a chain owner has no "all branches" scope. |
| Functionality | **3.5** | The data for a world-class home already exists but is not used here: `approvals.myQueue`, `receiving.todayExpectations`, `payRun.month`, `recovery.summary` (32 overdue claims, ₪1,522) and `inventory.current`. Three of the four hero numbers lead nowhere, and the report's "הצעדים הבאים" items are not links. Ask files "כמה שילמתי לירקות השרון?" under the leak total and answers that. Both the hero and Ask compare 25 days of October with all of September. |

**Pilot bar:** fails. 3 P0s:
- Staff land on the owner screen.
- "What needs me" is not in ₪ and not on screen.
- Hero and Ask present a misleading month comparison as fact.

**World-class bar:** far off. Ramp, Linear and Stripe-grade homes show the act-now ₪ in the first 330 px. They give every role its own first viewport and make every number a link.

### Capture and probe notes (read before the screenshots)
- **Lab caveats (not product bugs):**
  - The red "מנוע העיבוד לא זמין" banner (≈100 CSS px) and the cookie bar show on every capture.
  - In full-page phone shots, the fixed bottom nav and the consent bar appear mid-page.
  - The monthly report's email `<iframe>` looks **blank** in `dashboard_reports_monthly__owner__desktop-he.png`, but that is a full-page-screenshot artifact. The Playwright probe read the frame and found real content (`review/crops/command/probe_monthly_iframe.png`).
- **Probes I ran:**
  - Scripts: `review/scripts/command-probe.cjs`, `command-probe2.cjs`, `command-probe3.cjs`.
  - Setup: cookie consent pre-set (so no consent bar), worker banner still present.
  - Hero ₪ figure: y=756 at 390×844 (bottom nav top = 791), so the number is cut by the bar. y=808 at 375×667 (nav top 614), so it is fully below the fold.
  - Hero drill CTA: y=1,609 on the phone.
  - Desktop 1440×900: hero ₪ at y=643, drill CTA at y=847, VAT card at y=942.
  - Tab stops before the hero: 78 on desktop, 58 on the phone. A skip link exists.
  - Hero sub-tiles: only "חזר החודש" is a link. Activity rows: 0 of 8 are links.
  - `Ctrl+K` does nothing.
  - Ask: `?q=` is ignored, and history is lost after navigating away and back.
  - Ask offline classifier: "כמה שילמתי לירקות השרון החודש?" returns the **leak total**.
  - Warm TTFB is 193 ms. In the crawl, loadMs (to network idle) is 1.5–2.0 s for `/dashboard` vs 1.3–1.5 s for other pages.
- **Crawl metrics:**
  - axe-core: 0 violations on all 20 captures in this area.
  - overflowX: 0 everywhere.
  - Small targets: dashboard 42–49 (40 are 16 px checkboxes inside the filter menus, plus the 84×26 "חזר החודש" link); ask, report and digest have 2–3.
  - `<title>` is "RestoMatch" on every page.
- **Crops used below:** `review/crops/command/` (`own_desk_he_00..03`, `own_phone_he_00..06`, `rcv_phone_*`, `chef_phone_*`, `mgr_phone_*`, `bk_phone_*`, `*_desk_*`, `zoom_*`, `probe_*`).

---

## 1. What each page really does (code walk)

| Route | Gate | Data it loads | States in code | Notes |
|---|---|---|---|---|
| `/dashboard` (`app/dashboard/page.tsx`, 559 lines) | Every role (`lib/roles.ts:44`). The comment at L59 says "the hero is for every role". | **Layout:** memberships, flags, features, receiverLangs, recipes and inventory flags, ask status, wave-1 access, chain. **Page:** memberships (again), features, `owner.vatAtRisk` (awaited on its own), `owner.kpis`, `owner.leakHero` ×2 (this month and the full last month), `activity.feed`, `owner.leakTrend` and `viewOptions` (finance roles only), `recovery.flags` (again). **Then awaited one after another:** `getT(leakProof)`, `recovery.returnedThisMonth`, `owner.leaks` (owner only). **Inline async cards:** `PriceAlertsTeaser` (wave-1 access) and `RecipesOverviewCard` (3 more calls). | Default view vs a custom view (`leakSummary`). Hero `hasLeak` vs clean. Pending-link (T4) and awaiting-count notices. VAT card at-risk vs clear. Trend empty. Heatmap upsell vs list. Activity empty. **No `loading.tsx` and no `error.tsx`** under `/dashboard`. | No role branching except a few `canDrill`/`canDecide` guards. The same h1 "חדר הבקרה" for every role. ViewToolbar with 15 controls (period, compare, 5 filters, chart type, CSV, saved views (stored in `localStorage`), TV mode, reset). |
| `/dashboard/ask` (`ask/page.tsx`, `ask-client.tsx`) | Owner and manager (`roles.ts:60`), flag `aiAssistant`, otherwise 404 | `ask.status` | Empty ("עוד לא שאלתם"), thinking (spinner), answer (mode badge `מהנתונים`/`Claude`), ungrounded note, error and rate-limited | Five fixed suggestion chips. The answer list lives in `useState` only. Offline mode classifies with the regex rules in `packages/api/src/ask/offline.ts:16-23`. |
| `/dashboard/reports/monthly` | Owner and manager, flag `monthlyReport` | `monthlyReport.preview({month, locale})`, giving data, email HTML and WhatsApp text | This month vs last month (`?month=` accepts any month, but the UI offers only 2). Email or WhatsApp tab. | Five equal StatCards in the hero. Top suppliers, top issues and next actions are **plain text**. PDF he/en downloads. 640 px email iframe. |
| `/dashboard/reports/digest` | Owner and manager, flag `monthlyDigestPreview` | `monthlyReport.digest` (data, `frozen`, subject, recipients, send date) | Frozen vs "יישלח ב-…" | A **second** preview of the monthly email, re-drawn in React, with one CTA to the full report. |

**Available but unused on the home (the main functional finding):**
- `approvals.myQueue`: per-viewer, ₪ deltas, severity (`packages/api/src/routers/approvals.ts:66`).
- `receiving.todayExpectations`: today's POs and receipt status (`receiving.ts:80`).
- `receiving.pendingInvoices` (`receiving.ts:1024`).
- `payRun.month` (`payRun.ts:160`).
- `recovery.summary`: ageing and overdue (`recovery.ts:48`).
- `inventory.current` (`inventory.ts:283`).
- `recipes.changes` and `recipes.priceAlerts`.
- `priceAlerts.openCount`.
- `consolidated.coverage`.

The home reads only `owner.kpis.pendingApprovalsCount`, a bare count that is the same for every role (`packages/charts/src/owner-kpis.ts:17-23`).

---

## 2. First viewport per role (what each person sees vs what they need)

| Role · device | Above the fold today (lab, consent pre-set) | The 5-second question for this role | Verdict |
|---|---|---|---|
| **Owner · desktop 1440** | 2-row wrapping nav (18 tabs) → banner → h1 → 2-row toolbar → hero ₪760 with 4 sub-tiles. The CTA at y=847. **No decision item.** (`own_desk_he_00.png`) | "How much ₪ needs my decision now, and is the leak better or worse?" | ✗. The leak is visible, but the decisions are at y≈2,200 (`own_desk_he_02.png`) and shown as a count ("4"), with no ₪. |
| **Owner · phone 390** | Header → banner → h1 → **9 rows of filter, chart, CSV, TV and saved-view controls** → the hero eyebrow; the ₪ figure is cut by the bottom nav (`probe_owner_phone390_fold.png`) | Same | ✗✗. The first screen is a filter form. |
| **Manager · phone** | Same as the owner (`mgr_phone_00.png`) | "What do I order before the cutoff, what arrives today, what's waiting for my approval in ₪?" | ✗✗. Nothing on ordering, deliveries or cutoffs. Orders sits in the drawer. |
| **Bookkeeper · desktop** | Owner clone; the toolbar and hero are identical (`bookkeeper_desk_00.png`) | "What's left before I can close October and export?" | ✗. No pay run, close checklist, allocation-number queue or last export. Cannot open the monthly report. |
| **Receiver · phone** | h1 "חדר הבקרה" → toolbar → **"דלף החודש ₪760 · 1.8% מההוצאה על סחורה מתוך ₪42,263"**, then caught, claimed and recovered ₪ (`rcv_phone_00/01.png`) | "Which truck is next, and how do I start receiving it?" | ✗✗. No deliveries at all. The restaurant's monthly food spend is shown to back-door staff. |
| **Chef · phone** | Same hero and food spend; the recipes card sits ≈1.5 screens down (`chef_phone_00/02.png`) | "Is a count open or due, which dishes crossed food-cost target, what do I need to order?" | ✗✗. No count entry point, and the dish alerts are buried. |

---

## 3. Primary tasks walked end to end

### J-1 · Owner, desktop, 07:30: "What needs me and how much?"
1. The page opens at `/dashboard`. The eye goes to ₪760 (good T1). But beside it, "נתפס לפני תשלום ₪296" is gold, the T3 "good news" colour.
2. To learn what needs a decision, the owner scrolls about 2,200 px, past the VAT card (₪1,123 in large warn orange) and the 914 px daily bar list, and reaches "ממתינות לאישור 4". No ₪, no age, no split between blocking and warn.
3. Click → `/dashboard/approvals` → the ₪296 at stake appears there. **That is the same ₪296 the hero called "caught".**
4. The 32 overdue credit claims (₪1,522) and 10 claim letters to send (₪451) are **not on the home at all**. They exist only as plain bullets on `/reports/monthly`.

**Total:** 1 click and ≈2,200 px of scroll for 1 of 3 act-now items. The other 2 are invisible. Ramp, Linear and R365 need 0 clicks and 0 scroll, from a "needs you" band in the first 330 px.

### J-2 · Owner, phone, between services: same question
1. Open the app. The first screen is filters (`own_phone_he_00.png`).
2. Scroll 1 screen to read ₪760, then 1 more to the 4 tiles, then the 4 stacked buttons (report, digest, proof, drill).
3. Then the VAT card (screen 3) and 20 day-bars (screens 3–4). "ממתינות לאישור 4" arrives at ≈3,100 CSS px (screen 4).
4. The bottom-bar "תור אישורים" has **no badge**, so nothing tells the owner to go there.

**Total:** ≈4 screens of scrolling to find a count. Brex and BILL mobile open on the task inbox with the ₪ on each card.

### J-3 · Receiver, 06:45 at the back door
1. Open the PWA → `/dashboard` → an owner money dashboard. The receiver cannot act on anything on it, and it shows the restaurant's spend.
2. Tap "קליטת סחורה" in the bottom bar (tap 1) → the receiving list → tap the PO (tap 2) → the flow begins.

**Total:** 2 taps plus one irrelevant screen. The receiving data is already loaded by `receiving.todayExpectations`, so the home could open on "המשלוח הבא: ירקות השרון 07:30 · [התחל קבלה]". That is 1 tap, as in the MOXē Delivery Tracker or DoorDash "Needs Action".

### J-4 · Chef, start of the weekly count
1. `/dashboard` (an owner screen) → the bottom bar "ספירת מלאי" (tap 1) → the inventory page → start or continue the count (tap 2+).
2. The home never says "ספירה פתוחה 34/80" or "הספירה השבועית — היום". The "סטייק אנטריקוט crossed 30%" alert is about 1.5 screens down.

### J-5 · Bookkeeper, month close (1–10 of the month)
1. `/dashboard`: the same owner view.
2. Pay run: approvals → the "ריצת תשלומים" button (2 clicks, flag-gated).
3. Allocation numbers: the VAT card on the home, but its only action is copy-to-clipboard.
4. Export: a separate tab.
5. The monthly report gives **403-style no access**: `/dashboard/reports` is owner/manager only (`roles.ts:56-61`).

There is no "October close 4/6" anywhere. Rillet and BILL put a close checklist with owners and due dates on the accountant's home.

### J-6 · Owner asks "למה הדליפה עלתה החודש?"
1. Tap the chip and get an answer in 670 ms (offline mode): **"הדליפה ירדה ב-300 ₪: 760 ₪ החודש לעומת 1,059 ₪ בחודש שעבר."** (`probe_ask_phone_after.png`).
2. That compares **25 days of October with all 30 days of September**. The answer is badged "תשובה מהנתונים", so it reads as fact.
3. The answer also names "the biggest increase, תבליני פרשמן +₪77" inside a month it says went down.
4. On the phone, the composer is now at y=922 (below the fold), so a follow-up needs a scroll.
5. Navigate away and back: the conversation is gone.

### J-7 · Owner forwards the monthly report to a partner
1. Hero → "תצוגה מקדימה של הדוח החודשי" → report → "הורדת PDF (עברית)". This works (3 clicks).
2. But the preview is labelled "החודש (עד היום)" while the email subject says "₪760 דלפו **בחודש שעבר**".
3. The report never says whether the month is open or closed.
4. Its "הצעדים הבאים" are dead text, for example "לתזכר 32 דרישות זיכוי באיחור (₪1,522)".

---

## 4. Findings

Severity: P0 = blocks or misleads a core task, or loses money or trust · P1 = major friction or below par vs the benchmark · P2 = polish of a primary surface or friction in a secondary one · P3 = nit.
Every finding lists screenshot and code evidence. "humanPR" means the fix needs an immutable file (AGENTS.md).

### P0

#### command-01 · P0 · flow · `/dashboard` · receiver, chef · mobile (and desktop)
- **Problem:** Back-door and kitchen staff land on the owner's "חדר הבקרה": leak ₪760, % of food spend, caught/claimed/recovered ₪, a non-actionable "ממתינות לאישור 4" and an activity log. There are no deliveries, no count and no next action.
  - The page never branches by role. The comment at `app/dashboard/page.tsx:59` says "the hero is for every role".
  - `receiving.todayExpectations` already returns today's POs (`packages/api/src/routers/receiving.ts:80`), but the home doesn't call it.
- **Evidence:**
  - Screenshots: `dashboard__receiver__phone-he.png` (`rcv_phone_00/01.png`), `dashboard__chef__phone-he.png` (`chef_phone_00/02.png`), `dashboard__receiver__desktop-he.png`.
  - Code: `page.tsx:59-61, 78-90, 194-228`.
- **Rubric:** D1 (S1 + owner-home escalator → S0), A1, G1.
- **Recommendation:** in `page.tsx`, branch on `role` before any money fetch and render the role's home:
  - **`ReceiverHome`** (new component, `app/dashboard/home/receiver.tsx`):
    - A summary line "היום: 5 משלוחים · 2 התקבלו · 1 באיחור".
    - A **next-truck card**, enlarged: supplier, time window, item count, one 56 px CTA that names the next state ("התחל קבלה" / "המשך קבלה (3/12)"), deep-linking to `/dashboard/receiving/[poId]`.
    - Then the remaining trucks in time order.
    - A tile "📷 חשבונית בלי הזמנה".
    - The offline-queue chip "↑ 2 ממתינים לשליחה".
    - **No ₪ and no toolbar.**
  - **`ChefHome`**:
    - The count tile, from `inventory.current`: "ספירה פתוחה 34/80 · המשך" or "התחל ספירה".
    - "מנות שחצו יעד" from `recipes.priceAlerts`, with the food-cost % and the cause ingredient.
    - "להזמין היום" by supplier cutoff.
  - The h1 becomes the role's job ("המשלוחים של היום", "המטבח היום").
  - Keep `/dashboard` as the single URL so PWA start_url and deep links still work.
- **Exemplar:**
  - Shopify POS smart grid: tiles that show status, a quick action, or start a workflow.
  - Apicbase mobile home: Count · Waste · Receive Order as the 3 primary tiles.
  - US Foods MOXē: a Delivery Tracker tile on the home screen.
- **Effort:** M · **humanPR:** no.

#### command-02 · P0 · ia · `/dashboard` · owner, manager, bookkeeper · both
- **Problem:** "What needs me now and how much ₪" is not answered on the home.
  - The only act-now element is `KpiCard "ממתינות לאישור 4"`. It has a warning tone, **no ₪**, no blocking/warn split and no age.
  - It sits at y≈2,206 on desktop (after the VAT card and the 914 px trend) and ≈3,100 CSS px on the phone.
  - The two biggest act-now money items in the tenant's own data are absent from the home. The report lists them as "לתזכר 32 דרישות זיכוי באיחור (₪1,522)" and "לשלוח מכתבי דרישה על 10 פערים (₪451)".
  - The bottom-bar and desktop "תור אישורים" have no count badge; only contracts can get one (`nav.tsx:155`).
  - The count is the same for every role (`owner-kpis.ts:17-23`), so the bookkeeper's "4" is not the items routed to them.
- **Evidence:**
  - Screenshots: `own_desk_he_02.png` (y≈200 of the crop = 2,200 abs), `own_phone_he_03.png`, `rep_phone_01.png` (next actions).
  - Code: `page.tsx:144-162, 259-277`; `nav.tsx:155-163`.
- **Rubric:** A5 (S1 → S0 on the owner home), D2, D9.
- **Recommendation:** add a **"מחכה לך" stack** (`app/dashboard/home/needs-you.tsx`) directly under the hero on the phone, and as a strip **above** it on desktop, with its bottom edge at y≤330 at 1440×900.
  - One row per act-now family, ranked by ₪ × urgency, at most 3 on the phone plus "עוד N ←":
    1. "חוסם תשלום · ₪143.50 · 2" from `approvals.myQueue` with severity `block`.
    2. "ממתין להחלטה · ₪152.50 · 2" (warn).
    3. "דרישות זיכוי באיחור · ₪1,522 · 32" from `recovery.summary`.
    4. "מכתבי דרישה לשליחה · ₪451 · 10".
    5. "ריצת תשלומים · יום ו׳ · ₪X" from `payRun.month`.
    6. "ללא מספר הקצאה · ₪1,123" from `vatAtRisk`.
  - **Row anatomy:** solid badge word + ₪ (`metric-md`) + count + age ("הוותיק: 4 ימים") + **one** verb that names the money effect, deep-linking to the filtered queue.
  - **Scope:** per viewer via `myQueue`, with a "שלי / הכול" toggle for the owner.
  - **Inbox zero** is one T3 line: "הכול מטופל ✓ · נתפס אוטומטית ₪X".
  - Add the same counts as badges on "תור אישורים" (danger only when a `block` exists) and as the PWA app badge.
  - Remove the `pendingCard` KPI.
- **Exemplar:**
  - Ramp Homepage: replaced the Inbox with a prioritised task feed, with All / Mine.
  - Restaurant365 "Awaiting Approval › My List".
  - Linear Inbox counts.
- **Effort:** M · **humanPR:** no. The data procedures exist; the app badge needs no outbox change.

#### command-03 · P0 · trust · `/dashboard`, `/dashboard/ask` · owner, manager, bookkeeper · both
- **Problem:** The month-over-month comparison runs in a misleading direction, and two surfaces present it as fact.
  - The hero shows "חודש קודם: ₪1,059" beside ₪760. `lastMonth` is `owner.leakHero({monthOffset:-1})`, a **full calendar month** (`packages/charts/src/leak-hero.ts:63-71`), while ₪760 covers Oct 1–25.
  - Ask's `leakChange` answer states "הדליפה ירדה ב-300 ₪: 760 ₪ החודש לעומת 1,059 ₪ בחודש שעבר", badged "תשובה מהנתונים" (`packages/api/src/ask/offline.ts:67-71` compares full `prevMonth`).
  - Early in a month, every owner will be told the leak is "down".
  - The aligned comparison already exists: `leakSummary` with `compare:'prev'` compares "the same to-date stretch" (`leak-views.ts:99`). It is off by default (`lib/components/views/state.ts:70`).
  - The hero also prints "יעד: 1.5% מההוצאה" by default. Rubric R-14 sets the default to no target, because it reads as "leak is the goal".
- **Evidence:**
  - Screenshots: `zoom_hero_lines.png`, `probe_ask_phone_after.png`.
  - Code: `page.tsx:83, 202, 422-425`; `overview/he.ts:24-25`.
- **Rubric:** A2 (S0: MTD vs a full month), H3, H4.
- **Recommendation:**
  - (1) Set `DEFAULT_VIEW.compare = 'prev'` for the overview, or always fetch `leakSummary({compare:'prev'})` for the hero. Render the `DeltaBadge` by default as "▼ ₪182 (−19%) לעומת 1–25 בספטמבר", with the word plus the arrow and the leak-up = danger semantics.
  - (2) Delete the "חודש קודם" full-month caption, or label it "כל ספטמבר: ₪1,059".
  - (3) In `ask/offline.ts`, compute `prevLeakIls` over the same day-span (reuse the `leakSummary` bounds), and name the span in the sentence ("1–25 באוקטובר לעומת 1–25 בספטמבר").
  - (4) Remove `hero.target` until the owner decides R-14.
- **Exemplar:**
  - Stripe Dashboard: period comparisons are like-for-like ("vs previous period"), and charts are labelled "estimated".
  - Mercury Insights: defaults to complete periods.
- **Effort:** S · **humanPR:** no. `packages/charts` is owned by matching-engine-guardian but is not immutable, and the fix only reuses existing bounds.

### P1

#### command-04 · P1 · trust · `/dashboard` · owner, manager, bookkeeper · both
- **Problem:** The hero's gold tile "נתפס לפני תשלום ₪296" ("על חשבוניות שעוד לא שולמו — אפשר לעצור או לדרוש זיכוי") is **the same money** that awaits a decision.
  - The report calls it "להחליט על 4 פערים פתוחים (₪296)" and approvals calls it "סכום בסיכון ₪296".
  - On the home it is styled T3 calm gold, as if it were already handled. On the next screen it is T2 act-now.
  - The owner reads "caught" and moves on.
- **Evidence:**
  - Screenshots: `own_desk_he_00.png` (hero tiles), `rep_phone_01.png`.
  - Code: `page.tsx:440`; `overview/he.ts` `hero.caught` and `caughtHint`.
- **Rubric:** A6/A5 (a T2 shown as T3), A9 (one number, one meaning).
- **Recommendation:**
  - Split the tile by state, or rename it.
  - Undecided money becomes a T2 line in the Needs-you stack: "₪296 ממתינים להחלטה שלך (4) · החלט".
  - The hero keeps a calm T3 tile only for money **already stopped or credited**: "נעצר לפני תשלום" = `rejected`/`held` decisions.
  - Show the decomposition once, as a sentence under the ₪: "₪760 = ₪296 ממתין להחלטה + ₪464 נדרש מהספקים".
- **Exemplar:** Stripe balance states: Available, Pending and Reserved, each defined once, and never a pending amount shown as settled.
- **Effort:** S · **humanPR:** no.

#### command-05 · P1 · trust · `/dashboard` · receiver, chef · both
- **Problem:** `owner.kpis`, `owner.leakHero` and `owner.leakSummary` are `memberProcedure` (`packages/api/src/routers/owner.ts:115-150`).
  - So the receiver and the chef see the restaurant's monthly food spend (₪42,263), the leak, the recovered ₪ and the invoice counts.
  - That contradicts the least-privilege intent written in `lib/roles.ts:39-41` ("A receiver… sees only the overview + receiving inbox — least privilege").
  - Owners of independent restaurants rarely share food-cost totals with dock staff.
- **Evidence:**
  - Screenshots: `rcv_phone_00.png`, `chef_phone_00.png`.
  - Code: `owner.ts:115-125, 150`.
- **Rubric:** D1, D7 (explicit permissions).
- **Recommendation:**
  - Move `leakHero` and `leakSummary` to `financeProcedure` (owner, manager, bookkeeper), like `leakBreakdown`. Let role homes (command-01) never request them.
  - Add a coverage entry to the cross-tenant/role attack suite for the tightened procedures. Agents may **add** entries; `test-sentinel` owns this.
  - If the owner wants staff motivation, add an opt-in, ₪-free "קבלות נקיות השבוע: 12/14" tile for the receiver.
- **Exemplar:** Toast and R365 role permissions: kitchen and dock roles see operational screens, never P&L.
- **Effort:** S · **humanPR:** no. The router is not immutable; the attack-suite addition is allowed.

#### command-06 · P1 · visual · `/dashboard` · owner, manager, bookkeeper (and every role on phone) · mobile
- **Problem:** The `ViewToolbar` (15 controls: period, compare, supplier, category, type, severity, status, bars/line/table, CSV export, saved views, full-screen TV mode, reset) sits **above** the hero.
  - At 390×844 it takes 9 rows (≈330 CSS px) and pushes the ₪ figure to y=756, under the bottom nav (top 791).
  - At 375×667 the ₪ is at y=808 with the nav top at 614, so it is fully off-screen even without the lab banner.
  - "Full-screen TV mode" and "CSV" are offered on a phone.
  - 58 tab stops precede the hero.
- **Evidence:**
  - Screenshots: `probe_owner_phone390_fold.png`, `own_phone_he_00.png`, `rcv_phone_00.png` (6 controls even for the receiver).
  - Code: `page.tsx:168-190`; `lib/components/views/ViewToolbar.tsx:83+`.
- **Rubric:** A8 (S1 → escalated), G10, I1.
- **Recommendation:**
  - Below `lg`, collapse the toolbar into **one** "תצוגה ▾" button (a 44 px chip at the end of the h1 row) that opens a bottom sheet with period, compare and filters.
  - Show only an active-filter chip row with "נקה" when filters are set.
  - Hide TV mode, CSV and chart type on coarse pointers.
  - On desktop, move the toolbar into the hero header as a compact "אוק׳ 1–25 ▾ · מול ספט׳ 1–25 ▾" pair, with filters behind "סינון (0)".
  - Target: the ₪ figure's top ≤ 45% of the viewport height at 375×667.
- **Exemplar:**
  - Linear: opinionated defaults with filters in one menu.
  - Mercury Insights: the time-frame selector is a single control at the top end.
  - Arc "Little Arc": interface weight matches the task.
- **Effort:** S · **humanPR:** no.

#### command-07 · P1 · visual · `/dashboard` · owner, manager · both
- **Problem:** The hero footer carries **4 equal-weight actions**:
  - "תצוגה מקדימה של הדוח החודשי"
  - "תצוגה מקדימה: המייל החודשי"
  - "איך הגענו ל־₪760?" (proof)
  - "מה מאחורי המספר" (breakdown, red)

  The last two are near-synonyms that lead to different pages. On the phone they are 4 stacked full-width buttons (`own_phone_he_01.png`). In English at 1440, the `hero.calc` note is squeezed to a ≈100 px column that wraps over 9 lines (`own_desk_en_00.png`).
- **Evidence:** code `page.tsx:476-521`.
- **Rubric:** A1 (S1: ≥3 equal-weight hero actions), C12.
- **Recommendation:**
  - One primary: "לחשבוניות שמאחורי ₪760 ←" (danger-solid only when leak > 0), going to `leaks/breakdown` with the view.
  - One tertiary text link: "איך חישבנו?" (proof).
  - Report, digest and "שאל על המספר הזה" go into a "⋯" menu at the hero's top end.
  - Put `hero.calc` behind an ⓘ popover next to the label "דלף החודש", as a full sentence with the scope.
- **Exemplar:**
  - Stripe Dashboard home: one KPI per card, with an "View more" text link.
  - Ramp: overflow menus for secondary report actions.
- **Effort:** S · **humanPR:** no.

#### command-08 · P1 · functional · `/dashboard` · owner, manager, bookkeeper · both
- **Problem:** The hero is a dead end in 3 of 4 places.
  - `HeroStat` takes an `href` only for "חזר החודש" (probe: `link:false` for "נתפס לפני תשלום", "נדרש מהספקים" and "13 מתוך 35").
  - The ₪ figure itself is not a link.
  - The one link that exists ("חזר החודש") is 84×26 px, below the 44 px touch target.
- **Evidence:**
  - Screenshot: `own_desk_he_00.png`.
  - Code: `page.tsx:437-456, 527-559`; probe output.
- **Rubric:** D6, H3 (proof path), F4.
- **Recommendation:** every number is a link to the **filtered list that sums to it**, from the same tRPC source:
  - ₪760 → `leaks/breakdown?{view}`
  - "₪296" → `approvals?st=open`
  - "₪464" → `leaks/claims`
  - "13/35" → `leaks/breakdown?has_leak=1`
  - "₪1,267" → `recovery`

  Make the whole tile the hit area (≥48 px), with a chevron DirIcon. On desktop, open the list in a 480 px peek (D6) instead of navigating.
- **Exemplar:**
  - Stripe balance summary: amounts click through to the transactions behind them.
  - Mosaic: transaction-level detail within 2 clicks.
- **Effort:** S · **humanPR:** no.

#### command-09 · P1 · ia · `/dashboard` · owner, bookkeeper · desktop
- **Problem:** The desktop home is one vertical stack of full-width cards, 3,745 px tall (4.2 screens at 900), inside `max-w-6xl` (1,104 px usable: 77% of 1440 and 57% of 1920).
  - The order is: hero → VAT card → **daily trend as 22 horizontal bars (≈914 px)** → 2 KPI cards → price-alert teaser → recipes card → price-creep tiles → activity.
  - There is no side-by-side layout, no right rail and no peek.
  - The heatmap's 3 tiles leave a quarter of the row empty (`own_desk_he_03.png`).
  - With the 18-tab nav wrapping to 2 rows, the sticky top area is ≈150 px.
- **Evidence:**
  - Screenshots: `own_desk_he_00..03.png`.
  - Code: `layout.tsx:175` (`max-w-6xl`); `page.tsx:239-256`.
- **Rubric:** B9, B6 (density by persona), A8.
- **Recommendation:**
  - Use a fluid 12-column grid up to 1,600 px for `/dashboard` only.
  - **Main column (8 cols):** Needs-you strip → compact hero ≤260 px (₪, aligned delta, 64 px sparkline, a drivers line "קצביית הכרם +₪74 · ירקות השרון +₪38") → "ספקים מובילים בדליפה" table (8 rows × 36 px, every cell a link).
  - **Right rail (4 cols):** the recovery funnel (נמצא → נדרש → זוכה → הוחזר, ₪ per stage), price alerts with ₪/month, dishes over target, VAT at risk (compact).
  - The full trend sits behind "הצג מגמה" (collapsed by default, state remembered). Activity moves below the fold.
  - Target page height ≤1,800 px.
- **Exemplar:**
  - Stripe Home: KPI grid plus a right-hand "Today" column.
  - Mercury Insights: an overview plus drill tabs.
  - Ramp: sections can be collapsed and stay collapsed per user.
- **Effort:** M · **humanPR:** no.

#### command-10 · P1 · flow · `/dashboard` · bookkeeper · desktop
- **Problem:** The bookkeeper's home is the owner's page (the same toolbar, hero, trend and KPIs) with the heatmap removed.
  - It has no pay-run tile, no "routed to me" queue, no close status, no allocation-number queue beyond the VAT card, and no last-export date.
  - "ממתינות לאישור 4" counts items routed to every role, not to the bookkeeper (`approvals.myQueue` would).
  - The bookkeeper **cannot open** `/dashboard/reports/monthly` or `/reports/digest` (`roles.ts:56-61`), even though the monthly report is the accountant's natural artifact.
- **Evidence:**
  - Screenshots: `dashboard__bookkeeper__desktop-he.png` (`bookkeeper_desk_00..02.png`), `dashboard__bookkeeper__phone-he.png`.
  - Code: `page.tsx:63-67` (VAT only); `roles.ts:56-61`.
- **Rubric:** D1, D7.
- **Recommendation:** add a "שולחן החשב" variant:
  - **Strip:** "מנותב אליי ₪X·n" · "ריצת תשלומים יום ו׳ ₪Y·9" · "סגירת אוק׳ 4/6" · "ללא מספר הקצאה ₪1,123" · "ייצוא אחרון 1.10".
  - **Below it:** a month-close checklist (auto-ticking items: invoices matched, consolidated cross-matched, allocation numbers complete, pay run approved, credit notes recorded, export done). Each item shows ₪ open, owner and due date, and links to its screen.
  - Add `bookkeeper` to `/dashboard/reports` and `/reports/monthly` (read and PDF).
- **Exemplar:**
  - Rillet Close Checklist: tasks, owners, deadlines and status, with continuous close.
  - BILL and Ramp accountant consoles.
- **Effort:** M · **humanPR:** no.

#### command-11 · P1 · flow · `/dashboard` · manager · mobile
- **Problem:** The manager (the floor manager who orders and approves, mostly on a phone) gets the owner's page.
  - No "הזמנה לירקות השרון נסגרת בעוד 2:15", no deliveries today, no ₪ awaiting their approval.
  - "Orders" is not in the manager's bottom bar. The first-four rule produces סקירה · קליטת סחורה · תור אישורים · בלש דליפות, so ordering takes 2+ taps through the drawer.
- **Evidence:**
  - Screenshots: `mgr_phone_00..05.png`.
  - Code: `nav.tsx:275-278`; `page.tsx` (no manager branch).
- **Rubric:** D1, D3, G10.
- **Recommendation:** a `ManagerHome` tile grid, ordered by urgency:
  1. **Order cutoffs:** suppliers sorted by next cutoff, with a clock chip ("נסגר בעוד 2:15"). One tap opens `orders/new?supplier=…&from=last`, prefilled from the order guide.
  2. **"₪2,140 ממתין לאישור שלך (4)"**, opening the approvals cards with swipe and bulk.
  3. **Deliveries today**, with late and arrived states.
  4. **"ספירה פתוחה 34/80"** when there is one.

  Hard-code the manager's bar as הזמנה · קבלה · אישורים · דליפות · עוד.
- **Exemplar:**
  - US Foods MOXē: cutoff alerts and a delivery tracker on the home.
  - Choco: the order thread starts from the supplier.
  - R365 "Autofill to Par".
- **Effort:** M · **humanPR:** no.

#### command-12 · P1 · flow · `/dashboard` · owner with 2+ branches · desktop
- **Problem:** The demo owner has 3 branches (switcher badge "3"), but the home shows only the active branch.
  - Cross-branch money lives on a separate "רשת" tab.
  - Switching branch reloads to `/dashboard` (`branch-switcher.tsx` → `window.location.assign`) and loses the page.
  - There is no "מוצג: כל הסניפים" scope on the home, and no branch × metric roll-up where each cell is a link.
- **Evidence:**
  - Screenshot: `own_desk_he_00.png` (switcher "כפר הזיתים 3").
  - Code: `layout.tsx:91-98`; `nav.tsx` (chain tab).
- **Rubric:** D8, D1 (chain owner).
- **Recommendation:**
  - Add a scope chip in the header: "מוצג: כפר הזיתים ▾ / כל הסניפים". Keep the current path and the `b=` param in the URL.
  - With "כל הסניפים", the Needs-you strip is summed with per-branch split chips.
  - The hero shows "דליפה ברשת" plus a roll-up matrix: branch × (leak ₪, %, waiting ₪, claimed ₪, Δ), with a pinned total row. Each cell links to that branch's filtered list.
- **Exemplar:**
  - Toast multi-location: a location group selector on reports.
  - R365: dashboards scoped to the Primary Location Group.
  - Rillet: one switch between entity and consolidated views.
- **Effort:** L · **humanPR:** no.

#### command-13 · P1 · rtl · `/dashboard` (recipes card) vs `/dashboard/ask` · owner, manager, chef · both
- **Problem:** Price moves render in **opposite visual orders** across surfaces.
  - The recipes card forces `<bdi dir="ltr">` "29.3% → 31.4%" and the dish alert "(139.00 ₪ → 149.00 ₪)": old on the left, an arrow pointing right, so a right-to-left reader meets the new value first.
  - Ask renders "139.00 ₪ ← 144.57 ₪" (old ← new, R-4).
  - The same `dir="ltr"` wrapper around he-IL money puts the ₪ on the wrong side and detaches the concatenated sign: "**+ 3.41₪** לצלחת" (`zoom_recipe_delta.png`).
- **Evidence:**
  - Screenshots: `zoom_price_alert.png`, `zoom_recipe_delta.png`, `own_phone_he_04.png`.
  - Code: `app/dashboard/recipes/overview-card.tsx:77-88`; `recipes/price-alert.tsx:16-21, 71-78`; `recipes/recipe-ui.ts:21-26` (`${sign}${ils()}`).
- **Rubric:** E5 (S1), E4 (S1), E2 (hard-coded "→").
- **Recommendation:**
  - Build one `<PriceMove from to delta?>` in `lib/components`: old value at the start, a `←`/`→` DirIcon by locale, new value at the end, inside a plain `<bdi>` (no `dir="ltr"`). Use it on the recipes card, the dish alert, Ask (`answers.priceItem`) and contracts.
  - Replace `ilsDelta` concatenation with a word-led delta chip ("עלייה ₪3.41 לצלחת").
  - Signs from `Intl` `signDisplay` need a `formatIls` option. That is a human-PR proposal for money-format-marshal; until then use the word form.
- **Exemplar:**
  - The Material bidirectionality sequence rule.
  - Israeli bank apps: "היה ← עכשיו" chips.
- **Effort:** S · **humanPR:** no for the component. The `signDisplay` option is a human-PR proposal.

#### command-14 · P1 · trust · `/dashboard` + `/dashboard/ask` · owner · both
- **Problem:** The same product's price rise shows **three different numbers** with no stated baseline:
  - Recipe alert: "אנטריקוט +7.2% (139.00 → 149.00)".
  - Price-creep tile on the same page: "+7.2% · ₪153".
  - Ask "איזה ספק העלה מחירים?": "אנטריקוט 139.00 ₪ ← 144.57 ₪ (+4%), עלות עודפת 139 ₪".

  An owner who compares them stops believing all of them.
- **Evidence:**
  - Screenshots: `own_desk_he_02.png`, `own_desk_he_03.png`; probe ask output.
  - Code: `ask/offline.ts` (`priceRaise`, a 90-day baseline); `recipes.priceAlerts` (last price); `owner.leaks` (`paidExcessIls`).
- **Rubric:** A9 (S1: same fact, different numbers), H1 (basis shown).
- **Recommendation:**
  - Every price move names its baseline in words: "מול מחיר חוזה (01.09)", "מול ממוצע 90 יום" or "מול החשבונית הקודמת". It renders through `PriceMove` with a `basis` prop.
  - Choose **one** default basis for owner-facing surfaces (the contract price when it exists, else the 90-day median) and use it on the home, Ask and alerts alike.
- **Exemplar:**
  - Ramp Price Intelligence: "you paid X vs the median Y across customers", with the basis stated.
  - Stripe Radar: each signal shows its comparison set.
- **Effort:** M · **humanPR:** no.

#### command-15 · P1 · copy · `/dashboard`, `/reports/monthly`, `/reports/digest`, activity, Ask · owner · both
- **Problem:** The leak and the recovery are named differently on every surface.
  - **Leak:**
    - Hero: "דליפה שזוהתה" (eyebrow) + "דלף החודש" + "מההוצאה על סחורה".
    - Report: "₪760 דלפו · 1.8% מהרכש" (it also prints the ₪760 **twice**, `rep_phone_00.png`).
    - Digest: "דלף מהרכש".
    - Email: "דלפו בחודש שעבר".
    - Activity: "הפסד פוטנציאלי".
    - Ask: "מההוצאה שנבדקה".
  - **Recovery:**
    - "חזר החודש" (hero) vs "חזר בפועל" (report) vs "חזר בפועל החודש" (digest).
    - "עדיין חייבים לך (על חשבוניות החודש) ₪464" equals "נדרש ₪464", while "חזר ₪1,267" is larger than both because the scopes differ (returned covers any month).
- **Evidence:**
  - Screenshots: `rep_phone_00.png`, `dig_phone_01.png`, `own_desk_he_00.png`.
  - Code: `lib/i18n/messages/overview/he.ts:10-21`; `recovery/he.ts:11-12, 88-89, 103-104, 145-146`; `packages/api/src/reports/monthly.ts:322-333`.
- **Rubric:** A9 (S1), E9.
- **Recommendation:**
  - Write a glossary in `lib/i18n/messages/glossary` and use it everywhere:
    - "דליפה" for the figure.
    - "מהקניות שנבדקו" for the base.
    - Four recovery states: **נמצא · נדרש · זוכה · הוחזר**.
  - Render recovery as **one funnel with a single scope** ("חשבוניות אוקטובר"). Show "הוחזר החודש על חודשים קודמים ₪1,267" as a separate T3 sentence, not a sibling tile.
  - Drop the duplicated ₪ line in the report hero.
  - Rename the activity "הפסד פוטנציאלי" to "פער".
- **Exemplar:** Stripe: Available, Pending and Reserved are each defined once and reused verbatim in the dashboard, emails and API.
- **Effort:** S · **humanPR:** no.

#### command-16 · P1 · states · `/dashboard` · owner (new tenant, or the 1st of every month) · both
- **Problem:**
  - With no invoices, `hasLeak=false` renders the hero ₪0 in **primary green** (`text-primary`, `page.tsx:410`) with "עדיין אין חשבוניות החודש", and the tiles show ₪0 caught, claimed and recovered. That is the colour of a clean month used for "no data".
  - There is no labelled sample, no first-run checklist and no single CTA ("צלמו חשבונית ראשונה").
  - On the 1st of every month every tenant sees a green ₪0 until the first invoice lands.
- **Evidence:** code `page.tsx:383-433` (also noted from onboarding in `area-auth.md`).
- **Rubric:** A4 (S0 when ₪0 stands for no data → P1 here because the text is honest), J2, C8.
- **Recommendation:** add three typed hero states:
  - (a) **no data:** neutral ink "—", "עוד לא נבדקו חשבוניות באוקטובר", plus a 4-step checklist "1/4" with one primary CTA "צלמו חשבונית".
  - (b) **clean month:** the T3 sentence "₪0 דליפה · 42 חשבוניות נבדקו ✓".
  - (c) **early month** (fewer than 5 invoices): show the ₪ only, with "בסיס דליל" and no %.
- **Exemplar:**
  - Stripe and Ramp setup checklists.
  - Primer Blankslate: one primary action and no guilt.
- **Effort:** S · **humanPR:** no.

#### command-17 · P1 · trust · `/dashboard/ask` · owner, manager · both
- **Problem:** The offline classifier sends **any question containing "כמה"** to `leakTotal`, and any "למה/מדוע" question to `leakChange` (`packages/api/src/ask/offline.ts:16-23`).
  - "כמה שילמתי לירקות השרון החודש?" gets "החודש דלפו ‏760 ‏₪, 1.8%…", answering a different question under the "תשובה מהנתונים" badge.
  - The UI never says which question it answered.
- **Evidence:**
  - Probe output (`command-probe2.cjs`).
  - Code: `ask-client.tsx:62-126`; `offline.ts:22`.
- **Rubric:** H4 (S1: ungrounded ₪ shown as fact), E9.
- **Recommendation:**
  - Every answer opens with the interpreted intent as a chip: "הבנתי: כמה דלף החודש".
  - Add "לא זו השאלה?" with 2–3 alternatives.
  - When a supplier or product name is detected, route to a supplier-spend intent, or answer honestly "אין לי עדיין תשובה לזה" with a link to `suppliers/ledger?supplier=…`.
  - Tighten the regex rules: "כמה" alone never matches; require "דלף/דליפ/הפסד".
  - Add unit tests with 20 real owner phrasings (`test-sentinel`).
- **Exemplar:**
  - Notion AI Q&A: shows its sources and says when it can't find an answer.
  - Mercury Command: stages and echoes intent before acting.
- **Effort:** S · **humanPR:** no.

#### command-18 · P1 · functional · `/dashboard/reports/monthly` · owner, manager · both
- **Problem:** The report lists the right actions but makes them dead ends.
  - "לתזכר 32 דרישות זיכוי באיחור (₪1,522)", "להחליט על 4 פערים פתוחים (₪296)", "לשלוח מכתבי דרישה על 10 פערים (₪451)" and "לשייך 2 חשבוניות" are `<li>` text with no links (`page.tsx:49-66, 153-160`).
  - The top suppliers and top issues are not links either.
  - The month nav offers only this month and last month, though `?month=` accepts any.
  - There is no comparison with the previous month.
  - The open month is not labelled "פתוח · מתעדכן" and a closed month is not labelled "סגור ב-05.11"; `frozen` exists in the digest but isn't shown here.
- **Evidence:**
  - Screenshots: `dashboard_reports_monthly__owner__desktop-he.png`, `rep_phone_01.png`.
  - Code: `app/dashboard/reports/monthly/page.tsx:41-42, 49-66, 78-85, 117-160`.
- **Rubric:** H3 (S1: no live/closed label), D6, P4 (every number links).
- **Recommendation:**
  - Turn each next action into a T2 row with ₪ and one verb linking to the filtered queue ("תזכר ספקים (32) ←" → `recovery?st=overdue`).
  - Make the supplier and issue rows link to `leaks/breakdown?supplier=`/`?type=`.
  - Add a month select (the last 12 months).
  - Add a "מול ספטמבר" delta on the hero.
  - Add a status pill "פתוח · עד 25.10" or "סגור · 05.11 · לא ישתנה", with dated correction lines for late changes.
- **Exemplar:**
  - Stripe Financial Reports: closed periods are explicit and drill to the itemised rows.
  - Pilot: live views vs closed books.
- **Effort:** M · **humanPR:** no.

#### command-19 · P1 · a11y · `/dashboard`, `/reports/*`, `/ask` · all · both
- **Problem:**
  - The interactive elements in this area use `focus-visible:ring-2 ring-primary/60`, which measures 2.73–2.81:1, below the 3:1 floor. This covers the hero CTAs, the KPI link, the "לכל הדליפות" link, the digest CTA, `HeroStat` (`ring-gold/60`) and the price-alert card.
  - Every page's `<title>` is "RestoMatch", so tabs and history are indistinguishable.
  - The hero eyebrow and KPI labels use `uppercase tracking-wider` on Hebrew.
- **Evidence:**
  - Code: `page.tsx:263, 303, 482, 492, 502, 515, 549`; `reports/digest/page.tsx:154`; `contracts/overview-card.tsx:21`; crawl `title` field.
- **Rubric:** F3 (S1), F5/J4 (titles), E6.
- **Recommendation:**
  - Use the single `--c-focus` token (R-5: 2 px ring, 2 px offset, #1A5BC7) through a shared `focusRing` class. Replace every `ring-primary/60` and `ring-gold/60` in these files.
  - Add `generateMetadata` titles: "חדר הבקרה · כפר הזיתים", "שאלו את RestoMatch", "הדוח החודשי · אוקטובר 2026".
  - Gate `uppercase tracking-*` behind `ltr:`.
- **Exemplar:**
  - GitHub Primer: the 2 px focus ring is mandatory.
  - Polaris: page titles.
- **Effort:** S · **humanPR:** no.

### P2

#### command-20 · P2 · functional · `/dashboard/ask` · owner, manager · both
- **Problem:** Ask is a dead-end page rather than a layer you can reach from anywhere.
  - On the phone the composer is not pinned: after one answer the input sits at y=922 on a 844 px viewport, behind the bottom nav (`probe_ask_phone_after.png`).
  - The conversation lives in `useState` only, so it is gone after Back.
  - `/ask?q=` is ignored (`ask/page.tsx` reads no `searchParams`).
  - There is no "שאל על המספר הזה" from the hero.
  - Ask is drawer-only on mobile (`nav.tsx:275`) and not in a ⌘K palette (`Ctrl+K` does nothing).
  - The ungrounded warning renders **below** the answer in `text-xs text-gold` (`ask-client.tsx:270-275`).
  - Sources are full-page links at the bottom, not inline citations or peeks.
  - The offline disclaimer repeats in every answer.
  - The suggestion chips never change into follow-ups.
  - The bookkeeper is excluded (`roles.ts:60`).
- **Evidence:**
  - Screenshots: `dashboard_ask__owner__phone-he.png`, `probe_ask_answer_desk.png`.
  - Code: `ask-client.tsx:135-252, 254-301`.
- **Rubric:** H4, D4, G2, D8.
- **Recommendation:**
  - Pin the composer (sticky bottom above the nav, 56 px).
  - Keep the session thread in `sessionStorage` (try/catch).
  - Read `?q=` and auto-submit.
  - Add "שאל על המספר הזה" to the hero "⋯" menu, prefilled with the scope.
  - Show the ungrounded banner **above** the answer in warn tone, and render ungrounded numbers muted.
  - Use inline superscript citations that open a peek.
  - Show the offline note once per session.
  - After each answer, show 2 follow-up chips from the intent (for example after `leakChange`: "פירוט לפי ספק", "שלח תזכורת לספק").
  - Allow the bookkeeper read-only Ask.
- **Exemplar:**
  - Notion AI: inline sources.
  - Mercury Command: actions staged, then confirmed.
  - Raycast: fallback commands from the palette.
- **Effort:** M · **humanPR:** no.

#### command-21 · P2 · ia · `/dashboard/reports/digest` + `/reports/monthly` · owner, manager · both
- **Problem:** There are **two previews of the same monthly email**.
  - The report's "מייל" tab shows the real email HTML in a 640 px iframe.
  - `/reports/digest` re-draws it in React with a different layout.
  - The hero links to both, "דוח חודשי" is a top-level nav tab, and the digest is an orphan route.
  - Neither page lets the owner manage recipients, send a test to themselves, or change the schedule.
  - The digest footer exposes internal governance copy ("השליחה עצמה עוברת רק דרך תור ההודעות ובאישור אדם").
- **Evidence:**
  - Screenshots: `dashboard_reports_digest__owner__desktop-he.png`, `dashboard_reports_monthly__owner__desktop-he.png`.
  - Code: `reports/digest/page.tsx:46-50, 163-166`; `reports/monthly/page.tsx:163-227`.
- **Rubric:** D2 (one hub), J3, E9.
- **Recommendation:**
  - Merge into one "דוח חודשי" with tabs: סיכום · מייל · וואטסאפ · PDF. Redirect `/reports/digest` to `?tab=email`.
  - Add a "נמענים: owner@… · ערוך ←" link to settings.
  - "שלח לי עותק עכשיו" is a deferred send via outbox: a human-PR proposal, shown as "בקרוב" until then.
  - Replace the governance note with "המייל נשלח ב-1 לחודש ב-07:45".
- **Exemplar:**
  - Stripe Sigma scheduled reports: one place to preview, schedule and choose recipients.
  - Linear email digests.
- **Effort:** S · **humanPR:** no. The schedule and send are a proposal that touches `outbox.ts`/`cron.ts`, which is human-only.

#### command-22 · P2 · copy · `/reports/digest`, `/reports/monthly` · owner · both
- **Problem:**
  - The subject and headline template is `${amount} דלפו בחודש שעבר` (`packages/api/src/reports/monthly.ts:324`, subject at L485). The in-app preview of the **open** month (October 1–25) therefore reads "₪760 דלפו בחודש שעבר · 1.8% מהרכש".
  - The real email template is still **dark-era**: a near-black frame with mono money (`probe_monthly_iframe.png`), although the product went light on 2026-10-24.
  - The preview iframe is a fixed 640 px with nested scroll.
- **Evidence:**
  - Screenshots: `dashboard_reports_digest__owner__desktop-he.png` (subject line), `probe_monthly_iframe.png`.
  - Code: `monthly.ts:324, 485`; `reports/monthly/page.tsx:205-213`.
- **Rubric:** H3, A9, J3.
- **Recommendation:**
  - Make the headline depend on `frozen` or the month: "₪760 דלפו באוקטובר (עד 25.10)" for an open month, "₪X דלפו באוקטובר" when sent on the 1st.
  - Port the email frame to the light tokens (`notifications/templates`, which is in scope; `outbox.ts` is not), with the money in Heebo tabular.
  - Auto-size the iframe height from `srcDoc` via a ResizeObserver message, or render the email inline.
- **Exemplar:** Stripe: receipts and emails share the dashboard's type and colour system.
- **Effort:** S · **humanPR:** no.

#### command-23 · P2 · visual · `/dashboard` · owner, manager, bookkeeper · both
- **Problem:** The VAT-at-risk card is the **second-loudest ₪ on the page** (`text-3xl` warn ₪1,123 under the hero, above decisions), yet it is not urgent.
  - It has a solid warn badge "חשבונית אחת" with **154 days** left, where H8 says neutral above 7 days.
  - Its action is copy-only: the CTA reveals a read-only textarea plus "העתק". It cannot send by WhatsApp or email, cannot mark the request as sent, has no countdown chip, and nothing returns it to "requested".
- **Evidence:**
  - Screenshots: `own_desk_he_01.png` (top), `own_phone_he_02.png`.
  - Code: `app/dashboard/vat-at-risk.tsx:101, 109, 135, 148-187`.
- **Rubric:** H8 (S1 for tone), A7, A1 (competing ₪), C10.
- **Recommendation:**
  - Make it a row in the Needs-you stack ("ללא מספר הקצאה · ₪1,123 · נותרו 154 יום · עד 28.03.2027"), neutral above 30 days, warn at 30 days or less, danger when 7 days or less or late.
  - In the request sheet:
    - "שלח בוואטסאפ" (a `wa.me` deep link with the prefilled text, supplier phone from the supplier record).
    - "שלח במייל" (`mailto:`).
    - "העתק".
    - A "סמן שנשלח" state that turns the row into "נשלחה בקשה · 25.10".
- **Exemplar:**
  - Stripe Disputes: `due_by` countdown and a single submission.
  - Israeli supplier comms via WhatsApp deep links (Choco pattern).
- **Effort:** S · **humanPR:** no.

#### command-24 · P2 · visual · `/dashboard` · owner, manager, bookkeeper · both
- **Problem:** The trend chart misstates or wastes its data.
  - Days with ₪0 are drawn as red stubs (`Math.max(1.5, …)`) with a red "₪ 0" label, so a clean day looks like a leak (`own_desk_he_01.png`).
  - Time runs top to bottom in a horizontal bar list (22 rows ≈914 px desktop, ≈2,000 px phone).
  - The line variant flips with `rtl:-scale-x-100`, so in Hebrew time runs right to left, against R-3.
  - The SVG `aria-label` is just the caption "מגמת הדליפה".
- **Evidence:** code `lib/components/views/BreakdownChart.tsx:91, 131, 137, 181`.
- **Rubric:** C14 (S1 for contradicting time axes), A4, A3.
- **Recommendation:**
  - On the home, replace it with a 64 px column **sparkline** in the hero (left = oldest in both locales, the last point dotted). Use `aria-label`: "מגמת דליפה ב-25 הימים האחרונים: יורדת, מ-₪131 ב-12.10 ל-₪0 ב-24.10".
  - ₪0 days render as muted baseline ticks, never danger.
  - Keep the full chart on the leaks hub with a table toggle. Remove `rtl:-scale-x-100` from the SVG.
- **Exemplar:**
  - Stripe Apps Sparkline.
  - Apple RTL guidance: graphs are not flipped.
- **Effort:** S · **humanPR:** no.

#### command-25 · P2 · states · `/dashboard` · all · both
- **Problem:** The secondary KPIs are tone-wrong or unexplained.
  - "התאמות נקיות השבוע 62.5%" has a warn-orange icon with no definition and no action.
  - For receiver and chef, "ממתינות לאישור 4" is an un-clickable number with the hint "חריגות בתור — בעלים, מנהל, הנהלת חשבונות".
  - The price-alert teaser is a danger-toned card with a count only: "**1 מוצרים** עלו במחיר מעל הסף שהגדרתם." There is no product, no ₪/month and no materiality test.
  - Each KPI card adds its own glow blob and `flow-stream` hairline.
- **Evidence:**
  - Screenshots: `own_desk_he_02.png`, `rcv_phone_01.png`.
  - Code: `page.tsx:144-162, 270-276`; `contracts/overview-card.tsx:23-31`; `lib/i18n/messages/contracts/he.ts:235`; `lib/components/KpiCard.tsx:7-13, 67-69, 108-110`.
- **Rubric:** A5 (materiality), A7, J4.
- **Recommendation:**
  - Fold the pending count into Needs-you. Hide it for non-deciders.
  - Turn match health into a T4 completeness line in the hero ("35 חשבוניות נבדקו · 22 נקיות · 2 ממתינות"), with ⓘ for the definition.
  - Price alerts:
    - Show the top alert, for example "אנטריקוט · קצביית הכרם · +7.2% · ≈₪153 לחודש".
    - Apply the T2 tone only when the rise is ≥3% and ≥₪50 a month; below that it is T4.
    - Fix the plural with ICU (`{count, plural, one {מוצר אחד עלה} other {# מוצרים עלו}}`).
  - Remove the KPI glow blobs (keep 1 decoration per view).
- **Exemplar:**
  - Ramp Price Intelligence: materiality and ₪ impact.
  - IBM Carbon: no status indicator when no action is required.
- **Effort:** S · **humanPR:** no.

#### command-26 · P2 · ia · `/dashboard` · owner · both
- **Problem:** The "זחילת מחירים · 30 יום אחרונים" tiles are a second ₪ metric on the home that is explicitly "לא נכלל בדליפת החודש שלמעלה". Their link reads "לכל הדליפות". The tiles are danger-subtle pink with mono "+7.9%", and they compete with the T1 story: a third set of ₪ next to the leak and the VAT card.
- **Evidence:**
  - Screenshots: `own_desk_he_02/03.png`, `own_phone_he_04/05.png`.
  - Code: `page.tsx:289-317`; `overview/he.ts:37-41`.
- **Rubric:** A9, A6, J4.
- **Recommendation:**
  - Move price creep to the leaks hub ("מגמות מחיר" tab).
  - On the home, surface it only through the hero's drivers line or as a price-alert row with ₪/month.
  - If it stays, retitle it "מחירים שעלו (לא חלק מהדליפה)" with neutral ink tiles and a link "לכל עליות המחיר".
- **Exemplar:** Mercury: one overview, with drill tabs for flows.
- **Effort:** S · **humanPR:** no.

#### command-27 · P2 · functional · `/dashboard` · all · both
- **Problem:** The activity feed is ≈500 px of non-interactive log.
  - 0 of 8 rows link anywhere.
  - Each invoice appears twice ("התקבלה" and then "הותאמה").
  - No actor ("who").
  - Mono timestamps with no relative time.
  - Truncated detail with no `title`.
  - For the receiver and chef it is the main content of their home.
- **Evidence:**
  - Screenshots: `own_desk_he_03.png`, `rcv_phone_02.png`.
  - Code: `app/dashboard/activity.tsx:42-47`; `lib/components/ActivityFeed.tsx:62-99`.
- **Rubric:** D6, H7, B2.
- **Recommendation:**
  - Group events per object: "MF-24108 · דגי הים התיכון · התקבלה 11:20 → הותאמה 11:21 · פער ₪53".
  - Rows open an L1 peek of the invoice.
  - Add an actor chip and a relative time with the absolute time in `<time title>`.
  - Add a "רק כסף" filter.
  - Collapse it under the fold on desktop, and remove it from the receiver and chef homes.
- **Exemplar:**
  - Linear activity: grouped, actor-attributed, each row a link.
  - Brex per-expense audit trail.
- **Effort:** S · **humanPR:** no.

#### command-28 · P2 · perf · `/dashboard`, `/ask`, `/reports/*` · all · both
- **Problem:** The home has no streaming and no per-card failure isolation.
  - No `loading.tsx` for `/dashboard`, `/dashboard/ask` or `/dashboard/reports/*`. It was removed after a soft-nav stall (`ViewToolbar.tsx:113-115` comment).
  - No `error.tsx` anywhere under `/dashboard`.
  - `page.tsx` awaits `vatAtRisk`, `getT(leakProof)`, `returnedThisMonth` and `owner.leaks` **one after another** after the main `Promise.all`.
  - The async cards (`PriceAlertsTeaser`, `RecipesOverviewCard`) render inline without `<Suspense>`, so the slowest card holds the T1 number.
  - The layout and the page duplicate `myMemberships`, `recovery.flags`, `enabledFeatures` and `recipes.enabled`.
  - A throw in `recovery.returnedThisMonth()` or `owner.kpis()` (uncaught) blanks the whole home with the root error.
  - Crawl loadMs is 1.5–2.0 s for the home vs 1.3–1.5 s for other pages.
- **Evidence:** code `page.tsx:55-119, 281-287`; `layout.tsx:36-98`.
- **Rubric:** I4 (S1 for the home), C8, I1.
- **Recommendation:**
  - Stream the hero first: wrap the trend, VAT, recipes, alerts and activity in `<Suspense>` with layout-true skeletons (hero ≈240 px desktop and ≈280 px mobile, 3 Needs-you rows).
  - Give each card a local error boundary rendering "לא נטען · נסה שוב" (never ₪0).
  - Wrap shared server calls in React `cache()` so the layout and page share them.
  - Run the sequential awaits in parallel.
  - Re-add a route `loading.tsx` once `scripts/check-soft-nav.mjs` passes, or keep the per-card Suspense only.
- **Exemplar:**
  - Next.js streaming and partial prerendering.
  - Polaris SkeletonPage.
  - Linear: local-first, the T1 number paints first.
- **Effort:** M · **humanPR:** no.

#### command-29 · P2 · visual · `/dashboard`, `/reports/*`, digest · all · both
- **Problem:** Money typography and emphasis drift.
  - The hero ₪ and every money tile are in **JetBrains Mono** with a full-size ₪ glyph and a wide gap ("₪  760", "13   מתוך   35"), against R-2: Heebo tabular, with the ₪ at 0.55em muted.
  - The hero hints use `text-[11px]` (below the 12 px floor).
  - The KPI labels and hero eyebrow are `uppercase tracking-wider` (spaced Hebrew, `own_desk_he_00.png`).
  - The report hero and digest repeat the same mono style.
- **Evidence:** code `page.tsx:400, 410, 547, 556`; `KpiCard.tsx:90`; `reports/monthly/page.tsx:95`; `reports/digest/page.tsx:101, 145`.
- **Rubric:** B2 (S1 on T1), B1, E6.
- **Recommendation:**
  - Introduce `<Money size="hero|lg|md">`, a wrapper around `formatIls` that only changes styling and is owned by `rtl-design-steward`. It renders Heebo 800 tabular digits, the ₪ in its own span at 0.55em, weight 600, muted, and one `aria-label`.
  - Swap it in on the hero, the tiles, the report and the digest.
  - Raise hints to the 12 px `caption`.
  - Use `ltr:` for uppercase and tracking.
- **Exemplar:** Stripe, Mercury and Ramp balances: brand sans with tabular digits and a de-emphasised currency.
- **Effort:** S · **humanPR:** no. `formatIls` stays untouched.

#### command-30 · P2 · flow · `/dashboard` (mobile nav) · receiver, chef, manager, owner · mobile
- **Problem:** The bottom bar is the role's first 4 visible items (`nav.tsx:275-278`).
  - Receiver: סקירה · קליטת סחורה · **הגדרות** · עוד.
  - Chef: סקירה · עלות מנה · ספירת מלאי · **הגדרות** · עוד.
  - Manager: no Orders.
  - Owner: no badge on תור אישורים.
  - Labels are 11 px with `truncate` (`nav.tsx:432, 450`).
  - The first tab is always the owner overview, not the role's job.
- **Evidence:**
  - Screenshots: `rcv_phone_00.png`, `chef_phone_00.png`, `mgr_phone_00.png`.
  - Code: `nav.tsx:275-278, 432, 450`.
- **Rubric:** D3 (S1 for 11 px truncation), D2 (badges).
- **Recommendation:** hard-code a bar per role:
  - receiver: היום · קבלה · חשבוניות · עוד
  - chef: היום · ספירה · מנות · הזמנה · עוד
  - manager: היום · הזמנה · קבלה · אישורים · עוד
  - owner: בית · אישורים (badge) · דליפות · דוח · עוד

  Use 12 px labels of at most 7 characters with no truncation. Put Settings in "עוד".
- **Exemplar:**
  - The Material 3 navigation bar.
  - The iOS tab bar with badges.
- **Effort:** S · **humanPR:** no.

### P3

#### command-31 · P3 · copy · `/dashboard`, `/ask` · all · both
- **Problem:** The voice drifts and the copy has nits.
  - The home mixes masculine singular ("ברגע שתקלוט… ותטפל", "שאישרת") with the plural imperative used on Ask ("שאלו", "בחרו").
  - The h1 "חדר הבקרה" is the same for all roles.
  - The subtitle promises "ומה דורש את ההחלטה שלך עכשיו" but the page doesn't deliver it.
  - Ask's subtitle line-wraps an orphaned "באה." on the phone.
- **Evidence:**
  - Code: `overview/he.ts:6-7, 17, 45`; `ask/he.ts`.
  - Screenshot: `dashboard_ask__owner__phone-he.png`.
- **Rubric:** E9.
- **Recommendation:**
  - Use the plural imperative and infinitive convention product-wide.
  - Give each role an h1 (command-01).
  - Apply `text-wrap: balance` to subtitles.
- **Exemplar:** Intuit Content Design and Polaris voice and tone.
- **Effort:** S · **humanPR:** no.

#### command-32 · P3 · states · `/dashboard` · owner, manager · desktop
- **Problem:** Saved views live in `localStorage` (`listSavedViews`), so they don't follow the owner from laptop to phone or to a teammate.
  - "Full-screen TV mode" is a nice wall-screen feature but is undiscoverable as an icon-only chip on mobile.
  - The filtered-state note "מסונן" is `text-xs text-subtle` above the hero.
- **Evidence:** code `ViewToolbar.tsx:96-101`; `page.tsx:193`.
- **Rubric:** D8, A8.
- **Recommendation:**
  - Store views per user server-side and add "העתק קישור".
  - Show filters as a removable chip row with "נקה".
  - Move TV mode to the "⋯" menu with a label.
- **Exemplar:** Linear views (shared, synced); Stripe filters stored in the URL.
- **Effort:** M · **humanPR:** no.

---

## 5. Big moves (benchmark-grade redesigns for this area)

### BM-1 · "מחכה לך": a per-viewer ₪ action stack as the first thing on every finance home
- **Why:** The owner's 5-second question is about ₪ that needs a decision. Today it is a count 2,200–3,100 px down, and the overdue claims (₪1,522) never surface.
- **What:**
  - Desktop: a 3–5 tile strip at y≤330. Phone: a 3-row stack directly under a compact hero.
  - Rows: חוסם תשלום · ממתין להחלטה · דרישות באיחור · מכתבי דרישה לשליחה · ריצת תשלומים · ללא מספר הקצאה.
  - Each row: ₪ + count + age + one money-naming verb. Ranked by ₪ × urgency, scoped "שלי / הכול".
  - Inbox zero is a calm T3 line.
  - The same counts drive the nav badges and the PWA app badge.
  - On the phone, tapping a row opens swipe-able decision cards with Undo (Pattern 5).
- **Data:** `approvals.myQueue`, `recovery.summary`, `payRun.month`, `owner.vatAtRisk`, `priceAlerts.openCount`, `consolidated.coverage`. All exist.
- **Exemplar:** Ramp Homepage task feed (replaced Inbox; All / Mine); Linear Inbox and Triage; R365 My List; BILL mobile approvals.
- **Device:** both · **Effort:** M.

### BM-2 · Role homes: a "Today" tile grid for receiver, chef and manager
- **Why:** Most work happens on a phone, and today every staff role opens on an owner money page that also exposes food spend.
- **What:** `/dashboard` renders by role.
  - **Receiver:** "היום: 5 משלוחים · 2 התקבלו · 1 באיחור", then an enlarged next-truck card with one 56 px state CTA straight into the PO, then "חשבונית בלי הזמנה" and the offline-queue chip.
  - **Chef:** count tile (start or continue, progress ring), dishes that crossed target with the cause ingredient, suppliers to order by cutoff.
  - **Manager:** cutoff countdowns with "כמו בפעם הקודמת" prefilled orders, "₪ ממתין לאישור שלך", deliveries today, open count.
  - **No ₪ hero for receiver and chef.** Hard-coded role bottom bars.
  - Precache today's POs at shift start for offline.
- **Exemplar:** Shopify POS smart grid; Apicbase mobile home (Count · Waste · Receive); US Foods MOXē Delivery Tracker and cutoff alerts; DoorDash "Needs Action".
- **Device:** mobile · **Effort:** M.

### BM-3 · Desktop command center: a 2-column, every-number-is-a-link layout with peek
- **Why:** The bosses on desktop need density and 2-click drill. Today it is 4.2 screens of full-width cards in 77% of the screen.
- **What:**
  - A fluid 12-column grid up to 1,600 px.
  - **Main column:** Needs-you strip → compact hero ≤260 px (₪, an aligned "▼ ₪182 לעומת 1–25 בספטמבר", a 64 px sparkline, a drivers line "קצביית הכרם +₪74 · ירקות השרון +₪38", one primary CTA plus "⋯") → a top-suppliers table with every cell a link.
  - **Right rail:** recovery funnel (נמצא → נדרש → זוכה → הוחזר), price alerts with ₪/month, dishes over target, VAT at risk.
  - Any list row opens a 480 px side peek (Space), and Back restores position.
  - The full trend and activity are collapsed and remembered.
  - Page ≤1,800 px. Top bar ≤56 px, with the 18-tab nav moved to a 7-group sidebar.
- **Exemplar:** Stripe Home (KPI grid plus Today column, amounts that click through); Mercury Insights (overview plus drill tabs); Linear Peek; Ramp collapsible sections.
- **Device:** desktop · **Effort:** L.

### BM-4 · "שולחן החשב": a bookkeeper home with a living month-close checklist
- **Why:** The bookkeeper is the second desktop boss and today gets an owner clone with no close status and no report access.
- **What:**
  - **Strip:** מנותב אליי · ריצת תשלומים (date, ₪, n) · סגירת אוק׳ 4/6 · ללא מספר הקצאה ₪ · ייצוא אחרון.
  - **Close checklist:** auto-ticking items (invoices matched, consolidated cross-matched, allocation numbers complete, pay run approved, credit notes recorded, export done), each with ₪ open, owner, due date and link. Overdue items are T2, done items T3.
  - An invoice index with saved-view tabs (החודש · חריגות · ממתין לתשלום · ריכוז · ללא הקצאה) and keyboard triage.
  - Monthly report and PDF access.
- **Exemplar:** Rillet Close Checklist and continuous close; BILL accountant console; Stripe Financial Reports (closed periods).
- **Device:** desktop · **Effort:** M.

### BM-5 · One monthly report, frozen and actionable, with a subscribe-to-view brief
- **Why:** Report and digest duplicate each other. The next steps are dead text, the open month is mislabelled "last month", and the bookkeeper can't read it.
- **What:**
  - One "דוח חודשי" with tabs סיכום · מייל · וואטסאפ · PDF.
  - Status pill "פתוח · עד 25.10" / "סגור · 05.11 · לא ישתנה", with dated correction lines.
  - A 12-month select and a delta vs the previous month.
  - Next steps as T2 rows with ₪ and one verb each ("תזכר 32 ספקים · ₪1,522 ←").
  - Supplier and issue rows link to the breakdown.
  - Recipients and "שלח לי עותק".
  - A **daily brief** (07:30, nothing sent when nothing is pending) built from the same grounded facts as Ask.
  - The scheduling and send parts are human-PR proposals (`outbox.ts`, `cron.ts`); the UI shows "בקרוב" until then.
- **Exemplar:** Stripe Sigma scheduled reports; Linear Pulse daily brief and unread-only email digests; Pilot (live views vs closed books).
- **Device:** both · **Effort:** M (+ human PR for the schedule).

### BM-6 · Ask everywhere: palette fallback, "ask about this number", cited answers that stage actions
- **Why:** Ask is a separate drawer-only page. It forgets the conversation, misreads "כמה…" questions, and compares partial with full months as fact.
- **What:**
  - ⌘K / `/` palette with the sections Needs-you → Go to → Records → Actions → Ask. Unmatched text becomes "שאל את RestoMatch: …" via `/ask?q=`.
  - A "שאל על המספר הזה" entry on every hero and tile "⋯", prefilled with scope and period.
  - Answers open with the interpreted intent chip, cite each ₪ inline (opening a peek), and put the ungrounded warning above in warn tone.
  - Answers can **stage** an action ("הכן תזכורת ל-32 ספקים") that the user confirms on the target screen.
  - The composer is pinned on the phone, and the thread persists for the session.
- **Exemplar:** Mercury Command (stages actions, requires explicit confirm); Notion AI Q&A with sources; Superhuman and Raycast command palettes with fallback commands.
- **Device:** both · **Effort:** M.

---

## 6. Rubric scorecard for this area

| Criterion | Home (owner) | Home (staff) | Ask | Monthly | Digest | Note |
|---|---|---|---|---|---|---|
| A1 one T1, one action | Fail (4 hero actions; VAT ₪ competes) | Fail | n/a | Partial (5 equal tiles) | Pass | command-07, -23 |
| A2 hero story | Fail (no delta by default; MTD vs full month) | Fail | Fail (leakChange) | Fail (no compare) | Partial | command-03 |
| A4 zero vs no data | Fail (green ₪0) | Fail | n/a | Partial | Partial | command-16 |
| A5 T2 first, in ₪ | **Fail** (count at y≈2,200) | Fail | n/a | Fail (bullets) | n/a | command-02 |
| A6/A7 calm T3 / neutral T4 | Fail (T2 shown as gold T3); **Pass** for the pending-link T4 notice | — | — | Partial | Partial | command-04, -25 |
| A9 one vocabulary | Fail | — | Fail | Fail | Fail | command-14, -15 |
| B2 money face | Fail (mono) | Fail | Partial | Fail | Fail | command-29 |
| C8 states | Fail (no loading/error) | Fail | Partial | Fail | Fail | command-28 |
| C14 charts | Fail (red ₪0, flipped line) | n/a | n/a | n/a | n/a | command-24 |
| D1 role lands on job | Partial | **Fail** | — | — | — | command-01, -10, -11 |
| D2/D3 nav and badges | Fail (no approvals badge) | Fail (Settings in bar) | Fail (drawer-only) | Partial | Fail (orphan) | command-02, -30 |
| D6 glance → peek | Fail (dead tiles, no peek) | — | Fail | Fail | — | command-08, -27 |
| E4/E5 ₪ and price moves | Fail (recipes card) | Fail | Pass (←) | Pass | Pass | command-13 |
| E6 no Hebrew tracking | Fail | Fail | Pass | Pass | Pass | command-19, -29 |
| F3 focus ≥3:1 | Fail | Fail | Partial | Partial | Fail | command-19 |
| F5 titles/h1/skip | Partial (skip link ✓, titles ✗) | Partial | Partial | Partial | Partial | command-19 |
| G2/G10 thumb zone | Fail (filters first, CTA at y=1,609) | Fail | Fail (composer below fold) | Partial | Partial | command-06, -20 |
| H3 provable hero | Partial (proof link exists, flag) | — | — | Fail (no frozen label) | Partial (frozen flag) | command-18 |
| H4 grounded AI | — | — | Fail | — | — | command-17 |
| H8 deadlines | Fail (VAT warn at 154 days) | — | — | — | — | command-23 |
| I4 skeletons | Fail | Fail | Fail | Fail | Fail | command-28 |
| J4 restraint | Fail (3 glow blobs and hairlines) | Fail | Pass | Partial | Partial | command-25, -29 |

**What already works and should be kept:**
- The hero's honest **T4 pending notices** ("2 חשבוניות (₪3,603) ממתינות לשיוך להזמנה — כנראה חשבוניות ריכוז. הן לא נספרות בדליפה ולא בהוצאה" and the awaiting-count line), neutral with an hourglass.
- The **drill keeps period and filters** (`serializeView`).
- The `hero.calc` scope sentence, which just needs a better home.
- The **% of spend with its base**.
- The VAT card never being summed into the leak.
- TV mode for a wall screen.
- The Ask mode badge and source chips.
- PDF he/en.
- The digest's "never sends from here" safety.
- 0 axe violations and 0 horizontal overflow.

---

## 7. Governance notes (AGENTS.md)
- **No finding requires editing an immutable file.** Fix owners:
  - `web-feature-engineer`: `apps/web/app/dashboard/*`, routers `owner.ts`, `ask` and `reports/monthly.ts` (non-immutable).
  - `rtl-design-steward`: `<Money>`, `<PriceMove>`, focus token, tracking.
  - `growth-pmm-engineer`: none here.
  - `test-sentinel`: role-home e2e, Ask phrasing tests, and **adding** coverage entries when `leakHero`/`leakSummary` move to `financeProcedure`.
- **Human-PR proposals** (write them up, then stop):
  - (a) Scheduled sends, "שלח לי עותק" and the daily brief touch `packages/api/src/notifications/outbox.ts` and `apps/worker/src/cron.ts`.
  - (b) Signs via `Intl` `signDisplay` need a `formatIls` option (money-format-marshal).
  - (c) Any change to the leak definition itself (`packages/matching`). None is proposed; all fixes reuse existing bounds and procedures.
- `packages/charts` (charts SQL) is owned by `matching-engine-guardian`. The aligned comparison already exists in `leak-views.ts`; the fix only calls it.

## 8. Suggested build order (value ÷ risk)
1. **command-03** (aligned compare on hero and Ask) and **command-04** (₪296 tier). Both S; they remove the two trust-breakers before any demo.
2. **command-06 + command-07** (collapse toolbar on phone, one hero CTA). S; the ₪ comes back above the fold.
3. **BM-1 / command-02** (Needs-you stack plus nav badges). M; this answers the owner's 5-second question.
4. **BM-2 / command-01, -05, -11, -30** (role homes, tightened procedures, role bars). M; this is where the mobile work happens.
5. **command-08, -13, -15, -17, -18, -19** (links, PriceMove, glossary, Ask intent echo, actionable report, focus ring).
6. **BM-3 / BM-4** (desktop layout, bookkeeper desk).
7. **BM-5 / BM-6** (report hub and brief, Ask everywhere).
