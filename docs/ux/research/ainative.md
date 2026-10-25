# AI-native, attention & triage UX — research for RestoMatch

**Researcher lens:** senior UX researcher, topic = "what needs me now", triage, command palette, explaining automated findings, progressive disclosure, attention-respecting notifications, perceived speed.
**Studied:** Linear (Triage, Inbox, Peek, command menu, Triage Intelligence, Pulse, sync engine), Superhuman (100 ms rule, Command, Split Inbox, Get Me To Zero, Undo), Ramp (Policy Agent, AI coding, suggestion badges), Brex (audit/review agents), Notion AI (Q&A with sources), Arc (Command Bar, Peek, Little Arc), Raycast (Action Panel, frecency, fallback commands), Height (autonomous triage), plus the governing references these teams build on: Stripe Radar risk insights, Microsoft HAX guidelines, Google PAIR guidebook, Apple HIG interruption levels, GitHub Primer messaging, NN/g response-time limits, WCAG 2.2, Next.js prefetching, React `useOptimistic`.
**Date:** 2026-10-25.

---

## 0. Evidence method and honesty note

- **WebSearch worked; direct page fetches did not.** `WebFetch` failed DNS for `linear.app` and `blog.superhuman.com`. `curl` through the agent proxy got `CONNECT tunnel failed, response 403` (`connect_rejected`) for `linear.app`, `blog.superhuman.com` and `www.raycast.com`. So every **[W]** citation below comes from the search engine's summary of that exact official page, usually with quoted wording. It does not come from my own read of the full page.
- **[K]** = from my knowledge of the company's published product or guidelines. I did not re-check it this session. Verify these before quoting them to a customer.
- **[C]** = something I verified in the RestoMatch code (file and line behaviour quoted).
- Immutable files (AGENTS.md) are marked **⚠ human-PR**. Any recommendation that touches them is a *proposal* only: `packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts`, `packages/api/src/approvals/engine.ts`, `packages/matching/src/tolerances.ts`, `formatIls()`.

---

## 1. What the leaders actually do (facts extracted)

### Linear
- **Triage** is an inbox for issues from integrations or from people outside the team. The shortcuts are `G` then `T` to open it, **`1` accept, `2` mark duplicate, `3` decline, `H` snooze**. You can also act by hover or right-click, and `Cmd/Ctrl K` opens the command menu inside Triage with every issue action. [W] linear.app/docs/triage
- **Inbox:** `G` then `I` from anywhere. **`J/K` or arrows move**, `U` toggles read/unread, `H` snoozes. [W] linear.app/docs/inbox.md
- **Peek:** `Space` toggles a preview. **Holding** Space keeps it open only while the key is down. `J/K` move through the list with the peek open. Peek is keyboard-only. The command menu has its own "quick look" on the **right arrow** that opens a preview beside the menu. [W] linear.app/docs/peek.md
- **Triage Intelligence:** for duplicate and related suggestions, "users can **hover over the suggestion to see why it's appearing**" and then accept, dismiss, or follow the reference. Per property type (assignee, label), teams choose whether suggestions are **shown, hidden, or auto-applied**. Guidance can be set per team, sub-team or workspace, and the most local guidance is weighted most. Linear's engineering post gives the goal: "making the model's reasoning visible so that teams can validate its output." [W] linear.app/docs/triage-intelligence, linear.app/now/how-we-built-product-intelligence
- **Notifications:** desktop, mobile and Slack are sent in real time. **Email digests are delayed by urgency and sent only if you haven't already read the inbox notification.** Notifications are bundled by type. [W] linear.app/docs/notifications.md
- **Pulse (2025-04-16):** a personalised feed plus an **AI summary delivered daily or weekly**, readable or playable as audio. [W] linear.app/changelog/2025-04-16-pulse
- **Speed:** local-first. Each action updates local state instantly, queues a transaction, syncs, and receives deltas. Every transaction keeps its pre-mutation state, so a server rejection reverts the model. [W] secondary analyses (performance.dev/what-makes-linear-feel-instant and others)
- **Philosophy:** "Productivity software should be opinionated… Flexible software lets everyone invent their own workflows, which eventually creates chaos." [W] figma.com/blog/the-linear-method-opinionated-software
- [K] `X` selects a row and `Shift`+click selects a range, for bulk actions. `?` opens the shortcut sheet. Right-click opens the context menu.

### Superhuman
- **The 100 ms rule:** "every online task should take less than 100ms so it feels instantaneous… Superhuman treats the 100ms rule as the maximum, and actually aims for latency **less than 50ms**." The new renderer shows email in under **32 ms**. [W] blog.superhuman.com/superhuman-is-built-for-speed
- **Command (Cmd+K):** do any action instantly, and the palette **teaches the shortcut for next time**. A command palette is "a free-form input field that helps users find an action by narrowing down a list". It surfaces features "that could never warrant a button". [W] blog.superhuman.com/how-to-build-a-remarkable-command-palette
- **Split Inbox / Auto Labels:** marketing, cold pitches and social updates are separated automatically. You can create custom Auto Labels from short AI prompts, and splits sit at the top of the inbox. **Auto Archive** handles the low-value categories. **One-line summaries above every new email.** Auto reminders bring back unanswered threads. [W] help.superhuman.com "Sort Smarter", techcrunch 2025-02-19, alternativeto 2025-04
- **Get Me To Zero:** a setting that marks older messages as Done. You get a clean start, and the messages stay in Done. The product prompts for it at setup. [W] gotranscript transcript of Superhuman walkthrough
- **Undo:** "a single Undo brings back a message that was sent". Keys: `E` done, `Z` undo, `H` remind or snooze, `Cmd+K` command. [W] Superhuman blog and shortcut sheet. [K] auto-advance setting: after an action, open the next or previous conversation.

### Ramp
- Reviewer footer actions: **Flag Transaction / Approve / Request Repayment**. Reject branches into "Request changes" or "Request repay", which opens an email thread with the cardholder. [W] support.ramp.com/…4417421399699
- **Disagreeing with a flag is a first-class path.** A reviewer picks the reason **"Policy is wrong"**, which produces a **suggested policy change**. Admins edit directly, and reviewers' edits become suggestions. [W] support.ramp.com/update-your-policy-during-expense-review
- **Adaptive automation:** memo automation moves from "no automation" to **pre-fill after 7 accepted suggestions** within two weeks, and frequent edits step it back. **Hovering a suggestion badge shows why it is suggested** ("receipt present", "all fields coded"). A separate **Auto-mark-ready** toggle covers low-risk, complete expenses. [W] support.ramp.com Accounting Agent admin guide
- Policy Agents review **every** expense against policy in real time and "get smarter with every decision". [W] ramp.com product page

### Brex
- An audit agent "categorizes potential violations **by risk level**". A review agent "**auto-approves low-risk** expenses… **escalates exceptions**, and follows up with anyone out of compliance". The AI assistant "**explains why** an expense is out of policy", down to line-item level (for example, a specific liquor brand on a receipt that only lists a general category). [W] brex.com/intelligence, Brex press release, anthropic.com/customers/brex

### Notion AI
- Answers retrieve pages and blocks and **cite sources**. The user scopes sources ("All sources" toggles, `@` mentions). The Q&A is framed as discovery, not structured extraction. [W] notion.com/help/guides/everything-you-can-do-with-notion-ai and third-party guides

### Arc
- **Command Bar (Cmd+T)** searches tabs, history, bookmarks **and actions** at once: "finding beats organizing". **Peek:** Shift+click opens a link without leaving the current view. **Little Arc:** match the weight of the interface to the task. [W] third-party design studies (blakecrosley.com/blog/design-study-arc). There is no primary source from The Browser Company.

### Raycast
- **Action Panel:** `⌘K` lists every action for the selected item. **`Enter` runs the primary action, `⌘Enter` the secondary, `⌘⇧Enter` the tertiary.** [W] manual.raycast.com/action-panel, /keyboard-shortcuts
- **Ranking:** frecency, with a "Reset Ranking" action. Favorites pin items to the top with no typing. **Aliases use strict matching and jump to the top.** Fuzzy matching (`msg` finds Messages, `slk` finds Slack). **Fallback commands** appear when a search has no results. [W] manual.raycast.com/search-bar.md, /command-aliases-and-hotkeys.md, /fallback-commands

### Height
- Positioned as chat plus an autonomous agent plus PM. The AI prioritises, assigns and escalates bugs, prunes the backlog, and drafts progress reports. Copilot suggests details, assignees and lists. [W] businesswire 2024-10-08 and the TechRepublic review. (Height has since shut down [K]. Its lesson is that an *autonomous* agent with no visible reasoning did not build durable trust.)

### Governing references
- **Stripe Radar risk insights** explain *why* a payment got its score, highlight "the most relevant signals" plus "key data points", and **list related payments** that share an email, IP or card. Approve closes the review with no change. [W] docs.stripe.com/radar/risk-evaluation, /radar/reviews
- **Microsoft HAX: 18 guidelines in four phases** (initially, during interaction, when wrong, over time). They were validated with 49 practitioners against 20 products. [W] microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction. The numbering below is [K]: G1 make clear what the system can do; G2 how well it can do it; G3 time services on context; G7 efficient invocation; G8 efficient dismissal; G9 efficient correction; G10 scope when in doubt; G11 make clear why; G12 remember recent interactions; G13 learn from behaviour; G14 update cautiously; G15 granular feedback; G16 convey consequences; G17 global controls; G18 notify about changes.
- **Google PAIR, Explainability + Trust:** users should not trust the system completely. Explanations should calibrate when to trust and when to use their own judgment. The choice of "**whether, when, and how** to show confidence" strongly affects decisions. Explain data sources to prevent surprise and over-trust. [W] pair.withgoogle.com/chapter/explainability-trust
- **Apple HIG interruption levels:** *Passive* (no sound, no screen wake), *Active* (default), *Time Sensitive* (breaks through Focus and the summary, for "information that affects the user directly and needs prompt attention"), *Critical* (needs an entitlement). Represent urgency accurately to build trust. [W] developer.apple.com/design/human-interface-guidelines/managing-notifications
- **GitHub Primer:** "Toasts pose significant accessibility concerns and are **not recommended**." Use banners or dialogs for feedback on errors. [W] primer.style/accessibility/toasts. Red Hat adds that toasts appear away from the trigger, time out, and are hard to find in reading order. [W] ux.redhat.com/patterns/alert/accessibility
- **Material / Compose snackbar:** "Snackbars with an action **should not timeout or self-dismiss** until the user performs another action." [W] developer.android.com Snackbar composable
- **NN/g response limits:** 0.1 s feels instant (direct manipulation), 1 s keeps the flow of thought, and 10 s is the limit of attention. Past 1 s show working state. Past 10 s give an estimate and let the user do other things. [W] nngroup.com/videos/3-response-time-limits-interaction-design
- **Skeletons:** NN/g recommends them for full-page loads, but the Viget study (n=136) found skeletons worst on perceived speed. Use them only where the layout is predictable. [W] nngroup.com/videos/skeleton-screens-vs-progress-bars-vs-spinners plus secondary write-ups
- **Next.js prefetching:** for **dynamic routes, only the partial route down to the nearest `loading.js` boundary is prefetched**. Prefetching runs only in production, and links in the viewport and links under hover or touch are queued first. [W] nextjs.org/docs/app/guides/prefetching, /api-reference/components/link
- **React `useOptimistic`:** optimistic state lives only while the action is pending and reverts automatically if the real state is not updated. It must run inside a transition or action. [W] react.dev mirrors and guides
- **Target size:** WCAG 2.2 SC 2.5.8 (AA) requires 24×24 CSS px or spacing. 2.5.5 (AAA) requires 44×44. Apple recommends 44×44 pt and Material 48×48 dp. [W] wcag.com/developers/2-5-8-target-size-minimum-level-aa

---

## 2. Where RestoMatch stands today (code audit for this topic)

| Area | What the code does now [C] | Gap vs. leaders |
|---|---|---|
| Home `/dashboard` (`app/dashboard/page.tsx`) | The page is a **report**: T1 leak hero → VAT card → trend chart → 2 KPI cards (pending approvals is a *count* card that links to the queue) → price-alerts teaser → recipes → heatmap → activity feed. The comment says "the hero is for every role". About 10 server queries and **no `loading.tsx`** for the route. | No "what needs me now" list. Decisions waiting sit as a number, below the trend chart on desktop. A receiver or chef gets the owner's ₪ hero. |
| Approvals `/dashboard/approvals` (`list.tsx`) | Good base: summary strip (in queue / ₪ at risk / blockers), severity rail, a **"למה סומן?"** block with expected ↔ actual, tolerance and routing, and one primary button. On approve, `mutate` waits → `onSuccess: refreshFirstPage()` refetches page 1 → the row drops. A spinner shows on the busy row. Reject **requires typed text** (`disabled={!rejectReason.trim()}`). Errors render as one card **at the top of the list**. `compact` density **hides "why flagged" entirely**. No keyboard, no undo, no bulk, no evidence links beyond "פתח חשבונית / תקן OCR" (a full navigation). | Not optimistic, no auto-advance, no keyboard triage verbs, no undo, dispute friction, error far from its trigger, evidence one full page-load away. |
| Global search (`search.tsx`) | A combobox in the header (desktop) or drawer (mobile). It searches 3 entity types, waits for **min 2 chars** and a **250 ms debounce**, and has a good WAI-ARIA combobox. **No hotkey** (`⌘K` / `/`), no actions, no recents, no fallback to Ask. On mobile it is buried in the drawer. | A search box, not a command palette. |
| Keyboard | The only app shortcut is `⌘S` in `products/names-grid.tsx`. Matching on `e.key` would also break on the Hebrew layout. | No keyboard-first path anywhere. |
| AI assistant `/dashboard/ask` (`ask-client.tsx`) | Strong: suggestion chips, `aria-live` answers, `claude`/`offline` mode badge, an **"ungrounded"** warning, and source chips with ₪ values that link to screens. | It is a separate page. It should also be reachable from the palette and from any number ("why is this ₪?"). Citations come after the answer, not inline next to each figure. |
| Toasts (`lib/components/Toast.tsx`) | `success` lasts 3500 ms and `error` 7000 ms. There is **no action slot** (no Undo) and the stack holds at most 4. `role=alert` is used for errors. | No undo pattern. Errors for row-level actions belong inline (Primer). |
| Loading / prefetch | Only **5 `loading.tsx` files** exist (approvals, receiving, settings, suppliers, exports). Counting ancestor boundaries, they cover **10 of 43** dashboard pages. 12 pages are `force-dynamic`. There is a global `RouteProgress` bar (creeps to 85% over 2500 ms and respects `motion-reduce`). | Most clicks get no instant shell, and Next can't prefetch a shell without the boundary. |
| OCR confidence | `ocrReviewThreshold` and auto-link at ≥ 0.95 exist (STATE.md), but **no confidence appears anywhere in the dashboard** except the catalog import wizard. | Users can't tell read-from-scan numbers from contract or PO facts. |
| Catalog mapping (`mapper.tsx`) | For each unmapped SKU: "מפה" → type to search → choose. **No pre-suggested candidate**, though the catalog matcher computes one (pgvector). | The textbook case for "suggestion + why + one-key accept". |
| Nav badges (`nav.tsx`) | A count pill only on **contracts** (`NavBadge` hard-coded to `itemKey === 'contracts'`). | The approvals, inbox-needs-review and claims queues have no badge. |
| Motion | The global CSS respects `prefers-reduced-motion`. The receiver `AdjustQuantities` uses a **GSAP** stagger (0.4 s, 0.05 s stagger) that CSS media queries **do not** stop. | Reduced motion is not honoured for GSAP. |
| Notifications | Dispatch is per unique role per match_run, already batched. WhatsApp and push are mocked into the outbox, and email goes through Resend. | No interruption levels, no "already seen in app → skip" rule, no daily brief. ⚠ human-PR for outbox and cron. |
| Touch targets | `@media (pointer: coarse)` lifts every `button` to min 44×44. Good. | OK, but swipe actions don't exist yet. |

---

## 3. Principles (22) — each checkable, each mapped

> Format: **Rule** (checkable) → **Apply** (screen / file) · Source.

### A. The "what needs me now" home

**P1. The home opens on decisions, not on a report.**
Rule: in the first viewport (375×667 mobile, 1280×800 desktop), below the T1 hero, render a **"מחכה לך" (Needs you)** stack of at most **3** items. Rank them by `₪ at stake × urgency`, where urgency means a payment cutoff or delivery today. Each row = T2 badge + one-line claim + ₪ + **one** primary verb. More than 3 → "עוד N ←" opens the queue. Zero → an inbox-zero line (P3). The trend chart moves below this stack.
Apply: `app/dashboard/page.tsx`. Insert the stack between `<LeakHero>` and `<VatAtRiskCard>`. Its sources are `approvals.myQueue` (block/warn), ingest `needs_review`, `recovery` claims in status `claimed` with no letter sent, receiving rows that differ from the PO, and VAT allocation numbers missing above the threshold.
Source: Linear Inbox/Triage as the single queue [W]; Superhuman Split Inbox puts the important split at the top [W]; HAX G4 "show contextually relevant information" [K].

**P2. The home is role-shaped.**
Rule: each role's first viewport answers *their* question in under 10 seconds:
- **owner** = leak hero + Needs-you (3).
- **manager** = Needs-you first, then the hero.
- **bookkeeper** = pay-run blockers + VAT at risk + duplicate invoices.
- **receiver** = today's deliveries, with no ₪ hero (`receiving.todayExpectations`).
- **chef** = recipe cost alerts.
No role sees a module it cannot act on.
Apply: `page.tsx`. Today the comment says "the hero is for every role". Branch on `role` and redirect receivers to a home made from `/dashboard/receiving`.
Source: Superhuman splits by *type of work* [W]; Arc/Little Arc "match the interface weight to the task" [W]; HAX G3 [K].

**P3. Inbox-zero is a designed state, not an empty div.**
Rule: when a queue empties, show (a) a calm T3 confirmation such as "הכל מטופל ✓", (b) what the system handled for you, with count and ₪ (for example "12 פערי מידע אושרו אוטומטית · ₪0 בסיכון"), (c) when the next thing is expected ("המשלוח הבא: תנובה, 07:30"). Never show a bare "no items" message.
Apply: approvals `EmptyState` (`empty.title: 'אין חריגות בתור כרגע'`), receiving empty state, and the Needs-you stack.
Source: Superhuman Get Me To Zero [W]; Brex review agent auto-approves low-risk items, which makes "handled for you" visible [W]; HAX G1 [K].

### B. Triage queues

**P4. Three verbs, numbered, the same on every queue.**
Rule: every triage list (approvals, inbox documents, mapping, claims, price alerts) supports:
- `J`/`K` and `↓`/`↑` to move focus.
- `Enter` to open in a peek.
- `1` primary (אשר / approve), `2` dispute (חלוק / dispute → claim), `3` defer (העבר / escalate, or snooze with `H`).
- `X` select, `Shift+X` range.
- `Z` / `⌘Z` undo.
- `?` cheat-sheet.
The same digits mean the same verbs on every queue. The focused row has a visible 2px `primary` focus ring and `aria-selected`.
Apply: `approvals/list.tsx` first (approve / reject / escalate already map 1:1 to 1 / 2 / 3), then `inbox/inbox-client.tsx` and `catalog/mapping/mapper.tsx`.
Source: Linear Triage `1` accept / `2` duplicate / `3` decline / `H` snooze [W]; Linear Inbox `J/K/U/H` [W]; Superhuman `E` / `Z` [W].

**P5. Shortcuts bind to physical keys, so they survive the Hebrew layout.**
Rule: match on `KeyboardEvent.code` (`KeyJ`, `KeyK`, `Digit1`, `KeyK` + `metaKey`/`ctrlKey`), **never** on `e.key`. On the Israeli SI-1452 layout `j` types `ח` and `k` types `ל`, so `e.key === 'k'` silently fails for Hebrew typists. Shortcuts are suppressed while focus is inside `input`, `textarea`, `[contenteditable]` or `select`, except `Esc` and `⌘K`. Shortcut chips show Latin letters, wrapped in `<kbd dir="ltr">`.
Apply: the new `useHotkeys` util in `apps/web/lib/`. Also fix `products/names-grid.tsx:107`, which uses `e.key.toLowerCase() === 's'`.
Source: RestoMatch-specific inference from the Linear and Superhuman key maps [K + C].

**P6. A decision commits visually in under 100 ms. The network is not the UI.**
Rule: approve, dispute, escalate, map and accept-document update local state **synchronously**. The row collapses in **160 ms**, the summary tiles (`בתור`, `₪ בסיכון`, `חוסמים`) re-count at once, and the server call runs in the background. On failure the row **re-inserts at its original index** with an inline error on that row and a "נסה שוב" button. A global card at the top of the list is not acceptable. Never call `router.refresh()` or refetch page 1 to remove a row the user just decided.
Apply: `approvals/list.tsx`. Replace `onSuccess: refreshFirstPage` and `busyId` spinners with optimistic removal via `utils.approvals.myQueue.setData` or `useOptimistic` + `startTransition`. Do the same for `inbox-client.tsx act()` (which today does `router.refresh()` + toast) and `mapper.tsx`.
Source: Superhuman 100 ms max / <50 ms goal [W]; Linear's local-first transaction + rollback [W]; React `useOptimistic` [W]; NN/g 0.1 s [W].

**P7. Auto-advance: the next item is already in focus.**
Rule: after any verb, focus moves to the **next** row (or the previous row if the last was decided). Scroll position stays put. On mobile the next card slides up into the vacated slot (160 ms). The user never has to hunt for "where was I".
Apply: approvals and inbox queues. On mobile, pair with P10.
Source: Superhuman auto-advance setting [K]; Linear Inbox J/K flow [W].

**P8. Undo replaces confirmation for reversible money decisions.**
Rule: approve, dispute and escalate show **no confirm dialog**. They show an action snackbar: "אושר · ₪52 · **בטל (Z)**". The snackbar **stays until the next user action or 10 s, whichever is later**, and pauses on hover or focus. For *irreversible outward* actions, such as sending a claim letter or WhatsApp to a supplier, defer the actual send by **10 s** with a visible countdown and "בטל שליחה". `ConfirmDialog` is reserved for actions that are both irreversible and above ₪5,000, or that delete data.
Apply: add an `action` slot + `undo()` to `lib/components/Toast.tsx`. Today it has `success`/`error` only, 3500/7000 ms, and no action. Use it in approvals, inbox, mapping, and the claims send flow (`leaks/claims`).
Source: Superhuman single Undo and `Z` [W]; Compose Material 3 "snackbars with an action should not timeout until the user performs another action" [W]; Gmail Undo Send offers 5/10/20/30 s [K].

**P9. Dispute is one tap with a reason, not a blank textarea.**
Rule: "חלוק" opens 3–5 **reason chips** prefilled from the discrepancy type, for example:
- PRICE_HIGHER: "מחיר מעל ההסכם", "מבצע לא הוחל", "אחר".
- QTY_SHORT: "לא הגיע", "הגיע פגום", "אחר".
One tap commits. Free text is optional and only required for "אחר". The chips include **"הכלל שגוי / הסף לא נכון"** (the rule or threshold is wrong). That chip **files a proposal to the owner** and never changes a tolerance on its own.
Apply: the reject branch in `approvals/list.tsx`, which today has `rejectReason: 'סיבת דחייה (חובה)'` and a button disabled until text is typed. ⚠ `tolerances.ts` and `approvals/engine.ts` are human-PR: the "rule is wrong" path writes a suggestion record and stops.
Source: Ramp "Policy is wrong" → suggested policy change [W]; HAX G9 efficient correction, G15 granular feedback [K].

**P10. Swipe on phones, defined by logical edge.**
Rule: on `pointer: coarse` queues (approvals and inbox for managers and owners on the phone), add swipe actions:
- A **swipe toward the inline-end edge** reveals the primary verb (אשר, `primary`).
- A swipe toward inline-start reveals dispute (`danger`).
- A full swipe past **50% of row width** commits. A partial swipe snaps open and shows the 44 px buttons.
- In RTL the physical directions mirror automatically because they are computed from `dir`.
- Every swipe action has a visible button twin, because swipe is invisible and a11y needs a non-gesture path (WCAG 2.5.1).
- A `navigator.vibrate(10)` tick fires on commit where supported. iOS Safari ignores it, which is fine.
Apply: approvals cards and `inbox-client` documents. Not in the receiver wizard, where gloves and hurry make an accidental swipe costly. Keep its big buttons.
Source: Superhuman mobile triage and iOS Mail swipe actions [K]; WCAG 2.5.8 / Apple 44 pt [W].

**P11. Batch the boring, never the money.**
Rule: bulk select (`X`, `Shift+X`, or long-press on mobile) is allowed only for `info` and `warn` items, each **< ₪200**. The bulk bar shows the summed ₪ before the verb ("אשר 7 · ₪312"). `block` severity items are excluded from select-all, and the UI says why ("פריטים חוסמים מאושרים אחד-אחד").
Apply: approvals and pay-run (`approvals/pay-run`).
Source: Brex "auto-approves low-risk… escalates exceptions" [W]; Ramp auto-mark-ready for low-risk, complete items [W]; Linear multi-select [K].

### C. Command palette and search

**P12. One palette for go, find, do and ask.**
Rule: `⌘K` / `Ctrl+K` (by `code`), plus `/` when no input is focused, opens a centred palette from **every** dashboard page, and a **search icon in the mobile top bar** opens it full-screen. It holds five sections in fixed order:
1. **Needs you** (top 3)
2. **Go to** (the nav items the role can see)
3. **Records** (suppliers, products, invoices by number, POs)
4. **Actions** ("סרוק חשבונית", "הזמנה חדשה", "ייצוא לרו״ח", "אשר הבא בתור")
5. **Ask** (fallback: "שאל את RestoMatch: <query>" → `/dashboard/ask?q=`)
`Esc` closes it and returns focus to the trigger.
Apply: replace the header `DashboardSearch` in `search.tsx`, which has 3 entity groups, no hotkey and no actions. Keep its combobox a11y. The Ask fallback reuses `ask.ask` and is only shown when `aiAssistant` is on.
Source: Superhuman Command "instantly do any action" [W]; Linear command menu [W]; Arc Command Bar searches tabs + history + actions [W]; Raycast fallback commands [W].

**P13. The palette is fast before you type, and teaches as you use it.**
Rule:
- On open (0 chars), show **recents ranked by frecency** + Needs-you + pinned. This needs no server call, using a client cache of the last 20 picks with `localStorage` in try/catch.
- Local items (nav, actions) filter on **every keystroke from 1 char in < 16 ms** (one frame).
- Server records debounce at **≤ 150 ms**, down from 250, and show stale results while fetching instead of the "מחפש…" text.
- Every action row shows its shortcut chip ("אשר הבא · `1`"). `?` lists all shortcuts.
- Strict **aliases** jump to the top: `אש` → אישורים, `קב` → קבלת סחורה, `inv` → invoices.
Apply: the `search.tsx` replacement. Today it has `minChars` 2, a 250 ms debounce, and a "מחפש…" placeholder.
Source: Raycast frecency, favorites and strict aliases [W]; Superhuman palette "teaches the shortcut for next time" and a <50 ms target [W].

**P14. Search understands Hebrew the way Israelis actually type.**
Rule: queries are normalised before matching, both on the server and in the client:
1. **Wrong-layout correction.** SI-1452 ↔ QWERTY, so `,bucv` finds **תנובה** and `ayrtux` finds **שטראוס**.
2. **Final letters folded** (ם→מ, ן→נ, ץ→צ, ף→פ, ך→כ).
3. **Geresh and gershayim** (`'`, `׳`, `"`, `״`) ignored, so צ'יפס = ציפס and מע"מ = מעמ.
4. **Niqqud stripped.**
5. English `nameEn` and supplier aliases matched too.
6. **Digits-only queries** match invoice numbers, PO numbers and **₪ totals** (`1240` → invoices totalling ₪1,240.00 ±₪1).
Apply: the `search.global` router (`packages/api`) + `searchOptions.ts`, and a shared `normalizeHe()` util in `apps/web/lib`.
Source: Raycast fuzzy matching (`msg` → Messages) [W]. The layout and orthography rules are RestoMatch-specific [K].

### D. Explaining automated findings

**P15. Every flag reads as claim → ₪ math → evidence → rule → verb, visible without a click for T2.**
Rule: an approvals card (T2) shows, in this order:
1. **Claim**, one sentence in plain Hebrew: "הספק חייב מעל המחיר שסוכם".
2. **₪ math** in mono, LTR-isolated, through `formatIls()`: `₪14.20 × 40 ק״ג − ₪12.90 × 40 = ₪52.00`.
3. **Evidence chips** linking the three sources of a three-way match (`הזמנה #…` line, `תעודת משלוח` line, `חשבונית` line), plus `חוזה` if relevant. Each chip opens a **peek** (P19), not a page.
4. **Rule**, in one line: "סף: מעל 2% מהמחיר החוזי" plus routing ("נשלח למנהל כי > ₪50").
5. **Related**: "אותו ספק, אותה בעיה: 3 פעמים ב-30 יום · ₪140" (links to filtered breakdown).
6. The verb row.
`compact` density may shorten (1)–(4) to one line, but it must **never hide (2)**. Today compact hides `WhyFlagged` entirely.
Apply: `WhyFlagged` in `approvals/list.tsx`. It already has expected/actual/threshold/routing, so this adds the ₪ math, evidence chips and related row. The same block appears on `invoices/[invoiceId]` line badges.
Source: Stripe Radar risk insights, "the most relevant signals… key data points… related payments" [W]; Brex "explains why an expense is out of policy… at the line-item level" [W]; Linear Triage Intelligence "hover to see why" [W]; HAX G11 [K].

**P16. Facts carry no confidence badge; inferences do, and only when it matters.**
Rule: deterministic results (price × qty deltas, the 18% VAT check, duplicate invoice number, missing allocation number above the threshold) are stated as **facts**, with no percentage and no "AI" sparkle. Inputs that came from **OCR or fuzzy matching** carry a confidence marker **only below the restaurant's `ocrReviewThreshold`**. The marker is a dotted underline on the number plus "נקרא מהסריקה — כדאי לבדוק" (read from the scan, worth checking) and a **thumbnail crop of the scanned region**. Show no 97% on everything, and keep at most **one** confidence marker per card. A product link auto-applied at ≥ 0.95 shows a small "קושר אוטומטית" (linked automatically) tag with an "לא נכון?" (wrong?) link.
Apply: approvals cards, `scans/[invoiceId]`, `invoices/[invoiceId]` line table, and the receiver `Reconciliation` step.
Source: PAIR "whether, when, and how to show confidence" + calibrated trust [W]; HAX G2 "make clear how well the system can do" [K].

**P17. Overrides teach the system, and the UI says so.**
Rule: after **5 consistent overrides** of the same `(supplier, product, discrepancy type)` within 30 days, show a T4 suggestion card: "אישרת 5 עליות מחיר של תנובה בחלב. לעדכן את המחיר המוסכם ל-₪6.40?", with **[עדכן] [לא עכשיו] [אל תציע שוב]**. Accepting edits the restaurant's contract or price data. It **never** edits the engine. Rejecting backs the suggestion off for 30 days.
Apply: `contracts` / price alerts and the approvals queue footer. ⚠ Any default tolerance or rule change remains human-PR.
Source: Ramp memo automation, 7 accepts → pre-fill and edits step it back [W]; Ramp reviewer edits become policy suggestions [W]; Linear guidance per team [W]; HAX G13 learn, G14 update cautiously [K].

**P18. AI answers put a source next to every ₪.**
Rule: in `/ask`, every ₪ figure in the answer text is followed by an **inline superscript citation** (¹ ² …) that opens the source screen in a peek. The existing source chips stay below as a list. The `ungrounded` warning is shown **above** the answer (not below) in `warn` tone, and the answer's numbers render in `text-muted` until grounded. The mode badge ("מהנתונים" / "Claude") stays.
Apply: `ask-client.tsx AnswerBody`. It already has `citations`, `grounded` and the mode badge, so this moves citations inline and the warning to the top.
Source: Notion AI Q&A cites sources and lets users scope them [W]; PAIR data transparency [W].

### E. Progressive disclosure

**P19. Three fixed depths: glance, peek, page.**
Rule:
- **L0 glance** = the number + one line (the card).
- **L1 peek** = a side sheet. It is inline-end on desktop at 480 px and a bottom sheet on mobile at 85vh. It opens in **< 100 ms** from cached data, keeps list position, closes with `Esc` or swipe-down, and on desktop toggles with `Space`.
- **L2 page** = a full route, reached by "פתח במסך מלא" or `⌘Enter`.
Evidence chips, invoice links in approvals, heatmap cells, activity rows and search results open L1, not L2.
Apply: approvals "פתח חשבונית / תקן OCR" (today a full navigation), the `LeakHeatmap` cells on the dashboard, `PaginatedActivityFeed` rows, and palette records (right arrow = quick look).
Source: Linear Peek (Space toggle, hold, J/K while open) and command-menu quick look on the right arrow [W]; Arc Peek (Shift+click) [W]; Raycast primary/secondary (`Enter` / `⌘Enter`) [W].

**P20. Hide controls, never money.**
Rule: power controls (period, compare, chart type, density, saved views, TV mode, export, filters) collapse behind **one "תצוגה" button** below `lg`. The ₪ figures, T2 badges and the single primary CTA never collapse, truncate or move below the fold because of controls. A filtered view shows **one** chip row with "נקה" (clear).
Apply: `ViewToolbar` on `/dashboard`, which renders period + compare + chart + tv + saved + filters + export above the hero, and on `/dashboard/approvals`.
Source: Linear "opinionated… strong defaults" [W]; Little Arc "match interface weight to the task" [W]; HAX G17 global controls kept out of the way [K].

### F. Attention-respecting notifications

**P21. Every alert has a declared interruption level and a daily budget.**
Rule: each event type maps to one level:

| Level | Channel | RestoMatch events | Budget |
|---|---|---|---|
| **Time-sensitive** | WhatsApp now + push | duplicate invoice, a `block` ≥ ₪500 **before a scheduled payment**, a receiving count mismatch while the driver is still at the door | at most **3 per person per day**, then batched |
| **Active** | in-app badge + push | new approvals (one per match run), ingest `needs_review` | grouped per match run (already per role per run) |
| **Passive** | in-app + daily brief only | price drift, info discrepancies, T3 good news (caught, recovered), T4 pending consolidated invoices | no push |

Quiet hours default to **23:00–06:00 Asia/Jerusalem** plus Shabbat (Friday 2 h before candle-lighting → Saturday nightfall), with a per-user override. Each message states its **one** action and ₪.
Apply: notification preferences in `/dashboard/settings` and the copy in `packages/api/src/notifications/templates.ts`. ⚠ `outbox.ts` and `cron.ts` are human-PR, so routing changes are a proposal.
Source: Apple HIG interruption levels; "Time Sensitive" is for information that "affects the user directly and needs prompt attention" [W]. Linear real-time vs delayed digests [W].

**P22. Never tell someone twice.**
Rule: an item the user has **seen in-app** (row rendered in the viewport for ≥ 1 s, or opened) is dropped from the next email or WhatsApp digest. A **daily brief** at 07:30 (configurable) replaces per-event email: "בוקר טוב · 3 החלטות מחכות · ₪1,240 בסיכון · נתפס אתמול ₪310", with one link. If nothing needs the user, there is **no message**. The weekly and monthly digests (`reports/digest`) follow the same rule.
Apply: `reports/digest`, the WhatsApp and email templates, and `seen_at` tracking on discrepancies (⚠ new migration, schema is human-PR).
Source: Linear "email digests… only sent if you haven't already read the inbox notification" [W]; Linear Pulse daily or weekly AI summary [W]; HAX G3 time services on context [K].

**P23. Badges count decisions, not events. Outcomes live in place, not in toasts.**
Rule:
- Nav badges appear only on queues the viewer can act on: approvals (block + warn), inbox (`needs_review`), claims to send, and contracts (already there).
- Badges hide at 0 and cap at "99+".
- Badge colour follows tier: `danger` only if a `block` item exists, otherwise `warn`.
- Every outcome is reflected **in place**, for example the row turns "אושר ✓" before collapsing, or the hero number ticks.
- The toast is only a hint with Undo.
- Errors from a row action appear **on that row**.
Apply: `nav.tsx NavBadge` (hard-coded to `contracts`), `Toast.tsx`, the approvals error card, and `inbox-client act()`.
Source: GitHub Primer "toasts… not recommended" [W]; Red Hat toasts "appear away from what triggered them" [W]; Linear unread counts [W].

### G. Perceived speed and micro-interactions

**P24. Publish latency budgets, and design each wait state to its budget.**
Rule:

| Interaction | Budget | What the user sees |
|---|---|---|
| keypress, tap, verb | **< 100 ms** to visual commit (Superhuman aims < 50) | optimistic state (P6) |
| route change | **< 100 ms** to destination **shell** · < 1 s to content | `loading.tsx` skeleton mirroring the final layout |
| 1–10 s (search, export) | spinner or skeleton in place, never page-blocking | inline progress |
| > 10 s (OCR of a delivery note) | staged progress + estimate + "אפשר להמשיך; נעדכן" (you can continue; we'll update you) | the receiver may leave, and the result lands in Needs-you |

Apply: every dashboard route. The receiver `PROCESSING` step already has `STILL_READING_AFTER_MS`, so add the estimate and the leave-and-notify path.
Source: NN/g 0.1 / 1 / 10 s [W]; Superhuman 100 / 50 / 32 ms [W].

**P25. Every dynamic route ships a layout-true `loading.tsx`, so hover-prefetch gives an instant shell.**
Rule: all 43 `app/dashboard/**/page.tsx` routes get a `loading.tsx` whose skeleton matches the final page's grid at each breakpoint. For example, `/dashboard` gets a hero block of the same height (≈ 280 px mobile / 240 px desktop) + 3 Needs-you rows + 2 KPI cards. That avoids a layout shift, with **CLS < 0.05**. Skeletons are static, with no shimmer under reduced motion. Primary nav and Needs-you links keep default `prefetch` ("auto"). Next then prefetches down to the boundary on viewport and hover, in production.
Apply: today 5 `loading.tsx` files cover only **10 of 43** pages (with ancestors counted). `/dashboard` itself, `/leaks/*`, `/invoices/*`, `/orders/*`, `/catalog/*` and `/contracts/*` have none, and the home awaits about 10 queries.
Source: Next.js docs, dynamic routes prefetch "down to the nearest segment with a loading.js boundary" [W]; NN/g / Viget: skeletons only where layout is predictable [W].

**P26. Motion explains change: 160 / 240 ms, ease-out, reduced-motion honoured everywhere, GSAP included.**
Rule:
- State change (row collapse, badge count, chip toggle): **160 ms**.
- Enter or exit (peek, palette, snackbar): **240 ms**, `cubic-bezier(0.2, 0, 0, 1)`.
- No motion over **400 ms** except a one-time ₪ count-up.
- Distances ≤ 12 px for list entrances.
- Under `prefers-reduced-motion: reduce`, replace transforms with opacity-only ≤ 100 ms.
- **GSAP** timelines go through `gsap.matchMedia()` with a `(prefers-reduced-motion: no-preference)` branch.
Apply: `showcase/receiver/_steps/AdjustQuantities.tsx` (and sibling steps) use `gsap.from('.adjust-card', { y: 12, duration: 0.4, stagger: 0.05 })` with no reduced-motion guard. Define motion tokens in `packages/ui-tokens` and `globals.css`.
Source: Material motion duration tokens (short 50–200 ms, medium 250–400 ms) [K]; Apple HIG reduced motion [K]. RouteProgress already does `motion-reduce` [C].

**P27. Celebrate caught money quietly, once.**
Rule: when a decision clears the **last** T2 item, or a claim is marked recovered, the T3 tile "נתפס לפני תשלום" / "הוחזר" does a single **600 ms count-up** from the old to the new ₪ value in `gold`, with `aria-live="polite"` announcing the final value. There is no confetti, no sound, and nothing more than once per session. Under reduced motion the value is swapped instantly.
Apply: `HeroStat` in `app/dashboard/page.tsx` and the approvals `SummaryTile`.
Source: Superhuman inbox-zero reward moment [K]; the RestoMatch T3 rule "calm gold/green" [C].

---

## 4. Patterns (15) — exemplar → RestoMatch use

| # | Pattern | Exemplar | RestoMatch use (screen / file) |
|---|---|---|---|
| 1 | **Needs-you stack** (ranked, max 3, one verb each, "עוד N") | Linear Inbox; Superhuman Split Inbox | `/dashboard` directly under `LeakHero`. Sources: approvals block/warn, ingest needs_review, claims to send, receiving mismatches, VAT allocation missing |
| 2 | **Numbered triage verbs + auto-advance** (`1` accept · `2` dispute · `3` defer · `J/K` · `Enter` peek) | Linear Triage (1/2/3/H); Superhuman E/Z | `approvals/list.tsx`, then `inbox-client.tsx`, `mapper.tsx`, `leaks/claims` |
| 3 | **Optimistic commit + Undo snackbar** (no confirm, stays until next action or 10 s) | Superhuman Undo; Linear transactions with rollback; Compose snackbar rule | Approve / reject / escalate, inbox approve / reject document, SKU map confirm. Claim letter send is deferred 10 s with "בטל שליחה" |
| 4 | **Command palette with Ask fallback** (Go · Records · Actions · Ask; frecency; aliases) | Superhuman Command; Linear ⌘K; Arc Command Bar; Raycast fallback commands | Replaces `search.tsx`. `⌘K` / `Ctrl+K` / `/` by `code`, a search icon on mobile. Unmatched queries go to `/dashboard/ask?q=` |
| 5 | **Action panel on the focused row** (`⌘K` on a selection lists every verb; `Enter` primary, `⌘Enter` secondary) | Raycast Action Panel | Approvals card (approve / dispute / escalate / open invoice / copy claim text), invoice line rows, supplier rows |
| 6 | **Risk-insights evidence block** (claim → ₪ math → 3-way evidence chips → rule → related) | Stripe Radar risk insights + related payments; Brex line-item explanations | `WhyFlagged` in approvals, line badges on `invoices/[invoiceId]`, `leaks/proof` |
| 7 | **Suggestion with visible reason** (pre-filled candidate, hover or press-hold to see why, `1` accept / `Esc` dismiss) | Linear Triage Intelligence "hover to see why"; Ramp suggestion badges | `catalog/mapping/mapper.tsx`: pre-fill the pgvector top candidate with "למה: שם דומה 92% · אותו ספק · אותה יחידה". Same for OCR line → product links |
| 8 | **Peek** (`Space` / tap opens a side or bottom sheet; list keeps position; `Esc` closes) | Linear Peek; Arc Peek | Approvals evidence chips and invoice link, heatmap cells, activity feed rows, palette quick look (→) |
| 9 | **Automation ladder** (suggest → pre-fill → auto-apply, earned by accepts and lost by edits, always visible as "טופל אוטומטית") | Ramp memo automation (7 accepts → pre-fill); Brex review agent; Linear show/hide/auto-apply per property | Info discrepancies (already auto-accepted, now made visible in P3), repeated price-rise acceptance → contract update suggestion (P17) |
| 10 | **Interruption-level routing + seen-suppression** | Apple HIG levels; Linear email digest only if unread | `notifications/templates.ts` + settings prefs. ⚠ outbox and cron routing is a proposal (human-PR) |
| 11 | **Daily AI brief** (one message, nothing sent when nothing is pending, optional audio) | Linear Pulse daily or weekly AI summary | 07:30 WhatsApp or email: "3 החלטות · ₪1,240 בסיכון · נתפס אתמול ₪310" + one deep link to the Needs-you stack. Reuse `/ask` grounded facts so the numbers are cited |
| 12 | **Logical-edge swipe actions** with button twins | iOS Mail / Superhuman mobile | Approvals and inbox on `pointer: coarse` for owner and manager. **Not** in the receiver wizard |
| 13 | **Designed inbox-zero** ("הכל מטופל ✓" + what was auto-handled + next expected event) | Superhuman Get Me To Zero | Approvals empty state, receiving empty state, Needs-you empty, inbox empty |
| 14 | **Layout-true skeleton + hover prefetch** | Linear's instant feel; Next.js loading boundary prefetch | `loading.tsx` so all 43 dashboard pages are covered (10 today), `/dashboard` first |
| 15 | **Shortcut teaching** (key chips in palette rows and tooltips; `?` sheet; first-use coach mark after 3 mouse approvals: "טיפ: לחצו 1 לאישור") | Superhuman palette teaches shortcuts; Linear `?` | Palette rows, approvals buttons (`title`/tooltip "אשר · 1"), a `?` overlay listing shortcuts with `<kbd dir="ltr">` |

---

## 5. Screen-by-screen application notes (for the page-by-page reviewers)

### `/dashboard` (home)
1. Order on mobile: T1 hero (number + % + one CTA) → **Needs-you (≤3)** → VAT card (only if > 0) → KPI pair → the rest. On desktop the trend chart moves below Needs-you.
2. The hero's 4 buttons (report / digest / proof / drill) become **one** primary ("לחשבוניות שמאחורי ₪X", danger when leaking) plus a "⋯" menu for report / digest / proof. Today up to 4 equal-weight buttons compete with the T1 CTA.
3. `ViewToolbar` collapses into "תצוגה" below `lg` (P20).
4. Add a `loading.tsx` with exact hero geometry (P25).
5. Receivers and chefs get their own home (P2).

### `/dashboard/approvals`
1. Make it optimistic + auto-advance + undo (P6–P8). Delete `refreshFirstPage` as the removal mechanism. A silent background `invalidate` after 2 s may stay, for consistency.
2. Keys `J/K/1/2/3/X/Z/?` via `code` (P4, P5).
3. Dispute reason chips (P9). Keep `requires_role` guards server-side.
4. `WhyFlagged` gets ₪ math, evidence chips into a peek, and a related row. Compact density must keep the ₪ math (P15).
5. Bulk for info and warn items < ₪200 only (P11).
6. Errors render inline per row (P23).

### Global search → command palette
P12–P14. Mobile: a magnifier icon in the top bar (44×44), next to the language switcher, opens the palette full-screen with the input auto-focused and the keyboard up.

### `/dashboard/ask`
P18, plus deep-linking `?q=` from the palette fallback and a "שאל על המספר הזה" (ask about this number) entry in the hero "⋯" menu. That entry pre-fills the question with the hero context.

### `/dashboard/catalog/mapping`
Pattern 7: show the top candidate pre-selected with a reason line. `1` confirms, `2` shows other candidates, `3` creates a new product. The row collapses optimistically with a toast "קושר · עודכנו 14 שורות · בטל".

### `/dashboard/inbox`
Same queue grammar as approvals (P4, P6, P8). `needs_review` documents get the badge in the nav (P23).

### `/dashboard/receiving/[poId]` (receiver at the back door)
- No keyboard or swipe here. The rules are **big targets** (already 44 px via `pointer: coarse`; recommend **56 px** for the primary step button, since gloves widen the fingertip), **one primary per step**, and an OCR wait that lets the user leave (P24).
- Reduced-motion for GSAP (P26).
- Offline queue state stays visible as T4 (never red).

### Notifications and digests
P21, P22, pattern 11. These are template and preference work only. Routing and cron changes ⚠ go to a human PR.

---

## 6. Hebrew microcopy starters (RTL, he-IL)

| Context | Hebrew | English |
|---|---|---|
| Needs-you header | מחכה לך · 3 החלטות · ₪1,240 | Needs you · 3 decisions · ₪1,240 |
| Inbox-zero | הכל מטופל ✓ · 12 פערים קטנים אושרו אוטומטית · המשלוח הבא: תנובה, 07:30 | All handled ✓ · 12 small gaps auto-approved · Next delivery: Tnuva, 07:30 |
| Undo snackbar | אושר · ₪52 · **בטל (Z)** | Approved · ₪52 · **Undo (Z)** |
| Deferred send | נשלח לספק בעוד 10 שניות · **בטל שליחה** | Sending to supplier in 10 s · **Cancel send** |
| Dispute chips | מחיר מעל ההסכם · מבצע לא הוחל · לא הגיע · הגיע פגום · הכלל שגוי · אחר | Above agreed price · Promo not applied · Not delivered · Arrived damaged · Rule is wrong · Other |
| Low-confidence marker | נקרא מהסריקה — כדאי לבדוק | Read from the scan — worth checking |
| Auto-linked tag | קושר אוטומטית · לא נכון? | Linked automatically · Wrong? |
| Learning suggestion | אישרת 5 עליות מחיר של תנובה בחלב. לעדכן את המחיר המוסכם ל-₪6.40? | You approved 5 Tnuva milk price rises. Update the agreed price to ₪6.40? |
| Shortcut coach mark | טיפ: לחצו 1 לאישור, 2 לחלוקה | Tip: press 1 to approve, 2 to dispute |
| Palette fallback | שאל את RestoMatch: "<query>" | Ask RestoMatch: "<query>" |
| Daily brief | בוקר טוב · 3 החלטות מחכות · ₪1,240 בסיכון · נתפס אתמול ₪310 | Good morning · 3 decisions waiting · ₪1,240 at risk · ₪310 caught yesterday |

All ₪ go through `formatIls()`. Wrap mono math in `dir="ltr"` with `unicode-bidi: isolate`.

---

## 7. Acceptance checklist (testable in Playwright / manual QA)

1. `/dashboard` at 375×667 as owner: the hero ₪ **and** the first Needs-you row are both visible without scrolling.
2. With the Hebrew keyboard layout active, `⌘K` / `Ctrl+K` opens the palette and `J` moves focus in approvals (`event.code`).
3. Approve in approvals: the row is gone and the "₪ בסיכון" tile has updated **before** the tRPC response (throttle the network to 3 s and assert within 100 ms).
4. Force the server to fail approve: the row returns to the **same index** with an inline error, and no page-top error card appears.
5. Undo snackbar: still visible 10 s after approve with no user input, and pressing `Z` restores the row and calls the reverse mutation.
6. Reject is committable with **one tap** on a reason chip, with no typing.
7. Palette with 0 chars shows recents + Needs-you with no network request. Typing `,bucv` returns תנובה. Typing an invoice number returns that invoice first.
8. Every `app/dashboard/**/page.tsx` has a sibling or ancestor `loading.tsx` (a static check in CI, test-sentinel scope).
9. With `prefers-reduced-motion: reduce` emulated, the receiver adjust step renders with **no** transform animation (GSAP included).
10. A `block` item cannot be included in a bulk approve; the bulk bar's ₪ sum equals Σ|delta| of the selected items.
11. Nav shows an approvals badge with the actionable count, hides it at 0, and shows "99+" above 99.
12. An item viewed in-app is absent from the next digest (once P22 lands via human-PR).

---

## 8. Sources

Every [W] page below was surfaced and quoted by WebSearch on 2026-10-25. Direct fetches were blocked by the egress proxy, as described in §0.

- Linear — Triage: https://linear.app/docs/triage
- Linear — Inbox: https://linear.app/docs/inbox.md
- Linear — Peek preview: https://linear.app/docs/peek.md
- Linear — Triage Intelligence: https://linear.app/docs/triage-intelligence
- Linear — How we built product intelligence: https://linear.app/now/how-we-built-product-intelligence
- Linear — Notifications: https://linear.app/docs/notifications.md
- Linear — Pulse changelog (2025-04-16): https://linear.app/changelog/2025-04-16-pulse
- Linear method (Figma interview): https://www.figma.com/blog/the-linear-method-opinionated-software/
- Linear sync/local-first analysis (secondary): https://performance.dev/what-makes-linear-feel-instant
- Superhuman — Built for speed / 100 ms rule: https://blog.superhuman.com/superhuman-is-built-for-speed/
- Superhuman — How to build a remarkable command palette: https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- Superhuman — The fastest email experience ever made: https://blog.superhuman.com/the-fastest-email-experience-ever-made/
- Superhuman — Sort Smarter (Auto Labels / Split Inbox): https://help.superhuman.com/hc/en-us/articles/45266296636947-Sort-Smarter
- Superhuman AI categorisation (TechCrunch 2025-02-19): https://techcrunch.com/2025/02/19/superhuman-introduces-ai-powered-categorization-to-reduce-spammy-emails-in-your-inbox
- Superhuman Get Me To Zero walkthrough: https://gotranscript.com/public/how-superhuman-mail-uses-ai-to-achieve-inbox-zero
- Ramp — Reviewing transactions: https://support.ramp.com/hc/en-us/articles/4417421399699-Reviewing-transactions-from-Ramp-cards
- Ramp — Update your policy during expense review: https://support.ramp.com/update-your-policy-during-expense-review
- Ramp — Policy flags: https://support.ramp.com/hc/en-us/articles/20804476914707-Automatically-flag-transactions-with-policy-flags
- Ramp — Accounting Agent admin guide: https://support.ramp.com/ramp-accounting-agent-enablement-daily-use-admin-guide
- Brex — Intelligence / agents: https://brex.com/intelligence
- Brex — AI expense assistant press: https://brex.com/journal/press/brex-gives-every-employee-an-expense-assistant-with-ai
- Anthropic — Brex customer story: https://www.anthropic.com/customers/brex
- Notion — Everything you can do with Notion AI: https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai
- Arc design study (secondary): https://blakecrosley.com/blog/design-study-arc
- Raycast — Action Panel: https://manual.raycast.com/action-panel
- Raycast — Keyboard shortcuts: https://manual.raycast.com/keyboard-shortcuts.md
- Raycast — Search bar: https://manual.raycast.com/search-bar.md
- Raycast — Aliases & hotkeys: https://manual.raycast.com/command-aliases-and-hotkeys.md
- Raycast — Fallback commands: https://manual.raycast.com/fallback-commands
- Height launch (BusinessWire 2024-10-08): https://www.businesswire.com/news/home/20241008197812/en
- Stripe — Radar risk evaluation: https://docs.stripe.com/radar/risk-evaluation
- Stripe — Radar reviews: https://docs.stripe.com/radar/reviews
- Microsoft Research — Guidelines for Human-AI Interaction: https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/
- Google PAIR — Explainability + Trust: https://pair.withgoogle.com/chapter/explainability-trust/
- Apple HIG — Managing notifications: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- GitHub Primer — Accessible notifications and messages: https://primer.style/accessibility/toasts/
- Red Hat — Alert accessibility: https://ux.redhat.com/patterns/alert/accessibility/
- Android Compose Material 3 Snackbar: https://developer.android.com/reference/kotlin/androidx/compose/material3/Snackbar.composable
- NN/g — 3 response-time limits: https://www.nngroup.com/videos/3-response-time-limits-interaction-design/
- NN/g — Skeleton screens vs progress bars vs spinners: https://www.nngroup.com/videos/skeleton-screens-vs-progress-bars-vs-spinners/
- Next.js — Prefetching guide: https://nextjs.org/docs/app/guides/prefetching
- Next.js — Link component: https://nextjs.org/docs/app/api-reference/components/link
- WCAG 2.5.8 target size (secondary): https://wcag.com/developers/2-5-8-target-size-minimum-level-aa/

**[K] items to verify before external use:** Superhuman auto-advance; Gmail Undo Send 5/10/20/30 s; Material motion duration tokens; the HAX guideline numbers G1–G18; Linear `X` / `?` shortcuts; iOS Mail swipe semantics; Height's shutdown.
