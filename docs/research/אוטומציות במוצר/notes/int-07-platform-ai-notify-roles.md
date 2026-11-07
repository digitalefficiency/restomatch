# INT-07 — Platform: Ask AI, notifications, jobs/cron, feature flags, roles & nav

Research note for the "in-product automations" project. Code read: `release/train-a`
(scratchpad `trainA`, HEAD `c6132c0e`). Every file compared below
(`cron.ts`, `serverless.ts`, `/api/cron/jobs/route.ts`, `ask.ts`, `tasks.ts`, `push.ts`,
`outbox.ts`, `lib/features.ts`, `home/caller.ts`) is **byte-identical on `main`** (`759fb554`), so
nothing in this area is train-A-only. Paths below are relative to the repo root.

Legend: **[IMM]** = on the AGENTS.md immutability list, so any change there must be a human-authored PR.

---

## 1. Roles: who exists and what each one lands on

### 1.1 Role set and procedure guards

| Thing | Where | Notes |
|---|---|---|
| DB enum `user_role` = owner, manager, receiver, bookkeeper, chef | `packages/db/src/schema.ts:27-33` **[IMM]** | 5 roles, no per-user permission overrides |
| Display labels (בעלים / מנהל/ת / מקבל סחורה / חשב/ת / שף) | `apps/web/lib/roles.ts:11-20` | |
| `memberProcedure` (any member) | `packages/api/src/trpc.ts:133` | |
| `ownerProcedure` / `managerProcedure` (owner+manager) / `receiverProcedure` (owner, manager, receiver) / `bookkeeperProcedure` (owner, bookkeeper) / `chefProcedure` (owner, manager, chef) | `packages/api/src/trpc.ts:147-151` | role lists are hard-coded |
| `invoiceReaderProcedure` (all but chef), `financeProcedure` (owner, manager, bookkeeper) | `packages/api/src/trpc.ts:158-162` | |
| `adminProcedure` (platform admin: `users.is_platform_admin` OR `PLATFORM_ADMIN_EMAILS` + verified email + TOTP) | `packages/api/src/trpc.ts:172-208` | cross-tenant, owner DB connection |
| Approval visibility: owner sees owner+manager+bookkeeper queues; manager/bookkeeper see their own | `packages/api/src/lib/roles.ts:4-15`, `canActOn` `:22-25` | |

### 1.2 Landing page ("Today") per role

`/dashboard` reads the role before it fetches any money (`apps/web/app/dashboard/page.tsx:16-22, 46-60`):

| Role | Home component | tRPC namespaces it may call (`home/caller.ts:13-19`) | What it shows |
|---|---|---|---|
| receiver | `ReceiverHome` (`home/staff.tsx`) | `receiving` only | today's deliveries `receiving.todayExpectations({includeLate})` (`staff.tsx:26`). No ₪ |
| chef | `ChefHome` | `inventory`, `recipes` | open inventory count (`staff.tsx:52-54`), dish price alerts `recipes.priceAlerts` (`staff.tsx:90-92`) |
| manager | `FinanceHome` | approvals, receiving, inventory, suppliers, owner, activity | "מחכה לך" act-now strip (`home/needs-you.tsx:28-32`), leak hero, activity |
| bookkeeper | `FinanceHome` | approvals, payRun, owner, recovery, activity | same shell, pay-run + recovery |
| owner | `FinanceHome` | approvals, owner, recovery, payRun, activity, receiving | full: hero, leaks (`finance.tsx:537`), activity (`:577`), returned this month (`:603`) |

The namespace allow-list is enforced by a `Proxy` over the server caller (`home/caller.ts:24-32`), which
is a **UI-side** guard only. See §7, surprise 1: the API itself still serves ₪ aggregates to receiver and chef.

### 1.3 Nav per role (route registry → middleware gate → sidebar)

The roles and flags for each route are generated from `apps/web/lib/nav/routes/*.ts` (`apps/web/lib/roles.ts:47`).
Visibility = role gate + "at least one flag on" + chain mode (`apps/web/lib/nav/visibility.ts:13-43`).

| Route | Roles | Flag(s) |
|---|---|---|
| `/dashboard` | all 5 | — (`routes/home.ts:7-11`) |
| `/dashboard/receiving` | owner, manager, receiver | — (`routes/receiving.ts:6-10`) |
| `/dashboard/orders` | owner, manager, chef | — (`routes/orders.ts:6-11`) |
| `/dashboard/recipes` | owner, manager, chef | `recipes` (`routes/recipes.ts:7-12`) |
| `/dashboard/inventory` | owner, manager, chef | `inventoryCount` (`routes/inventory.ts:7-12`) |
| `/dashboard/approvals` | owner, manager, bookkeeper | — (`routes/approvals.ts:6-12`); `/pay-run` needs `payRun` (`:23-28`) |
| `/dashboard/leaks` (+claims) | owner, manager, bookkeeper | — ; `/proof` needs `leakProof` (`routes/leaks.ts:6-61`) |
| `/dashboard/recovery` | owner, manager, bookkeeper | `recovery` (`routes/recovery.ts:7-12`) |
| `/dashboard/reports/monthly` | owner, manager | `monthlyReport` (`routes/reports.ts:16-21`) |
| `/dashboard/ask` | owner, manager | `aiAssistant` (`routes/ask.ts:7-12`) |
| `/dashboard/inbox` | owner, manager, bookkeeper | `ingestWhatsapp` or `ingestEmail` (`routes/inbox.ts:9-14`) |
| `/dashboard/contracts` | owner, manager, bookkeeper | `contracts` or `priceAlerts` (`routes/contracts.ts:8-13`) |
| `/dashboard/suppliers` | owner, manager; `/ledger` + bookkeeper with `supplierLedger` (`routes/suppliers.ts:6-25`) |
| `/dashboard/exports` | owner, bookkeeper | — (plan entitlement `accounting_export`, `routers/exports.ts:23`) |
| `/dashboard/integrations` | owner, manager, bookkeeper | `integrations` (`routes/integrations.ts:9-14`) |
| `/dashboard/team` | owner, manager | — (`routes/team.ts:8-12`) |
| `/dashboard/branches`, `/chain` | owner | — (`routes/branches.ts:8-13`, `routes/chain.ts:8-13`) |
| `/dashboard/settings` | all 5 | — (`routes/settings.ts:9-13`) |

Nav badges: the layout fills exactly **one** badge, the open price-alert count on contracts
(`apps/web/app/dashboard/layout.tsx:154` → `badges = { contracts: wave1Access.openAlerts }`; renderer `nav.tsx:218-232`).
Approvals, claims, overdue recovery and receiving have **no badge**. `navRouter` was registered for
"badges, whereIs" but is empty (`packages/api/src/routers/nav.ts:1-10`).

### 1.4 Team management (manual)

- `team.invite` / `resendInvite` / `revokeInvite` / `updateMemberRole` / `removeMember` are owner-only (`packages/api/src/routers/team.ts:128,211,268,297,346`).
  `team.list` and `setMemberLocale` need manager (`:67,470`), and `acceptInvite` needs only a logged-in user (`:387`).
- The invite email is sent **directly** by a server action, not through the outbox (`apps/web/app/dashboard/team/actions.ts:61-75`, `sendEmail` at ~`:74`). Without email configured, the link is only printed to the console.
- A platform admin can also change a role (`admin.setMemberRole`, `packages/api/src/routers/admin.ts:407-468`, with a last-owner guard).
- Manual cost: each invite takes about 4 actions (open Team, type email, pick role, send). There is no bulk invite, no phone/WhatsApp invite, and no role templates.

---

## 2. Ask RestoMatch (AI assistant)

**Flow.** An owner or manager opens `/dashboard/ask` → `ask.status` (the page 404s when the flag is off, `apps/web/app/dashboard/ask/page.tsx:17`)
→ they type a question or tap one of 5 suggestion chips (`ask-client.tsx:17,133-143`) → `ask.ask` mutation (`ask-client.tsx:111`).

| Step | Where |
|---|---|
| Router: `managerProcedure`; gated by flag `aiAssistant` (`assertFeature`) | `packages/api/src/routers/ask.ts:12-33` |
| Orchestration: Claude when `ANTHROPIC_API_KEY` is set and `ASK_WITH_CLAUDE!=='0'`, otherwise the deterministic offline engine; any Claude error falls back to offline | `packages/api/src/ask/index.ts:35-100` |
| Model id pinned in code, ≤4 tool round-trips, 8000 max tokens | `packages/api/src/ask/claude.ts:18-21` |
| Budgets: 60 questions/day/restaurant, $3/day, burst 30/min | `packages/api/src/ask/budget.ts:10-21` |
| **Read-only** tools: `leak_hero`, `leak_report`, `leak_breakdown`, `claimable_lines` | `packages/api/src/ask/tools.ts:178-210` |
| `claimable_lines` keeps open/escalated lines only and runs through `claimableLines` (which honours `NEVER_CLAIMABLE_TYPES` = PRICE_LOWER, UNORDERED_ARRIVAL, MISSING_ON_INVOICE) | `tools.ts:136-152`, `packages/api/src/lib/claims.ts:19-22` |
| Offline intents (keyword regex he+en): leakChange, leakTotal, priceRaise, claimWeek, topSupplier | `packages/api/src/ask/offline.ts:18-31` |
| Grounding: every ₪/% figure in the answer is checked against the tool outputs, and links are filtered to cited ones | `ask/index.ts:67-77`, `ask/grounding.ts` |
| Usage table `assistant_usage` (counts only, no text stored) | `packages/db/src/schema.ts:2247` **[IMM]** |

**Manual today.** Ask is **pull-only** and **answer-only**: there is no write tool and it cannot draft a claim, open an approval or schedule anything.
Each answer ends in links to screens (e.g. `/dashboard/leaks/claims`, invoice pages, `tools.ts:294-298`), which the user then
works through by hand. Receiver, chef and bookkeeper cannot use Ask (route `routes/ask.ts:10`, procedure `managerProcedure`).
Bookkeepers are excluded even though they handle claims and pay-run.

**Flag.** `aiAssistant` is **off by default** (every flag is off unless set, `packages/api/src/lib/features.ts:7-9,62-70`).

---

## 3. Notifications pipeline

### 3.1 Building blocks

| Block | Where | Behaviour |
|---|---|---|
| `enqueueNotification` → `notifications_outbox` row `status='queued'`, optional `dedupeKey` (partial unique index) | `packages/api/src/notifications/outbox.ts:18-65` **[IMM]** | HTML is stored in `payload.__html`, attachments in `__attachments` (`types.ts:316-326`) |
| `markSent` / `markFailed` | `outbox.ts:70-92` **[IMM]** | |
| Provider factory: Email → Resend if `RESEND_API_KEY`, else console `EmailNotifier`; WhatsApp → `WhatsAppCloudNotifier` if `WHATSAPP_PHONE_NUMBER_ID`+`WHATSAPP_ACCESS_TOKEN`, else `MockWhatsAppNotifier`; Push → always `MockPushNotifier` | `packages/api/src/notifications/factory.ts:1-94` | |
| `MockWhatsAppNotifier` writes the outbox row and **immediately marks it sent** with `wa-mock-*`; nothing leaves the building | `notifications/whatsapp.ts:12-24` | |
| `MockPushNotifier` does the same with `push-mock-*` | `notifications/push.ts:9-19` | no web-push/Expo provider and no subscription table |
| Dev `EmailNotifier` (no key) also marks **sent** without sending | `notifications/email.ts:18-26` | |
| `recipientsForRestaurant(db, rid, roles=['owner','manager'])` resolves users' **email** addresses | `notifications/recipients.ts:16-63` | no phone resolution, although `users.phone` exists (`schema.ts:181`) |
| `outboxDispatch` job: claim batch `queued→sending` FOR UPDATE SKIP LOCKED (50/tick); whatsapp/email via real API, otherwise park as `failed` + `skipped_no_provider`; push → **always no_provider**; retries 30s/1m/5m/30m/2h, max 5 | `apps/worker/src/jobs/outboxDispatch.ts:73-174, 191-246` | runs every 60 s (`cron.ts:70-74`) |
| `push` tRPC router | `packages/api/src/routers/push.ts:1-10` | **empty** stub ("later wave") |

### 3.2 Who gets notified today (producers)

| Trigger | Producer | Channel → recipients | Gate | Dedupe |
|---|---|---|---|---|
| Invoice matched with discrepancies needing a decision (first match only) | `apps/worker/src/jobs/matchInvoice.ts:186-255` | WhatsApp `target: role:<role>` (only with the `whatsapp_alerts` entitlement) + push `role:<role>` (mock) + email to the real addresses of `rolesNeedingNotification` | entitlement for WA; none for push/email | none |
| 06:45 ops health digest | `jobs/healthDigest.ts:235-268` | email → `HEALTH_DIGEST_EMAILS ?? WORKER_ALERT_EMAILS ?? PLATFORM_ADMIN_EMAILS` | env | per day |
| 07:00 sustained price rise | `packages/api/src/priceAlerts/sweep.ts:74,247,264` | email → owner+manager | flag `priceAlerts` | per alert+email |
| 08:30 overdue claims (supplier silent for 7+ days, re-chased every 7) | `packages/api/src/recovery/reminders.ts:144-164`; `OVERDUE_DAYS = CLAIM_ANSWER_DAYS = 7` (`recovery/service.ts:322-324`, `lib/claims.ts:34`) | email → owner+manager | flag `recovery` | per day+email |
| 09:00 no PO on an order day | `jobs/orderReminders.ts:101-122` | email → owner+manager | **none** | per supplier/day |
| 10:00 placed PO past delivery | `jobs/supplierDelays.ts:121-155` | email → owner+manager | **none** | per PO/days-late |
| 19:00 end-of-day open-credits digest | `jobs/endOfDayReport.ts` (`recipientsForRestaurant` ~l.105, enqueue ~l.119) | email → owner+manager | **none** | per day+email |
| 1st of month 07:45 "one number" report | `packages/api/src/reports/send.ts:29-105` | email per owner/manager in their own locale + WhatsApp `target:'role:owner'` through a **hard-coded `MockWhatsAppNotifier`** (`send.ts:34,88-96`) | flag `monthlyReport` | per month+email |
| Supplier PO send (WhatsApp/email to supplier) | `packages/api/src/routers/orders.ts:925-929, 997` | supplier target | entitlement `whatsapp_alerts` | — (covered in int-05) |
| Job runner down | `apps/web/app/api/cron/worker-heartbeat/route.ts` (every 5 min) | direct `sendEmail` → `WORKER_ALERT_EMAILS ?? PLATFORM_ADMIN_EMAILS` | env | 6 h marker |

**Coverage gaps by role.** Receiver, chef and bookkeeper receive **nothing** from any scheduled job, because every
job uses the default `MANAGER_ROLES = ['owner','manager']` (`recipients.ts:16`). The match notification can reach a
bookkeeper only when the approvals engine routes an item to that role. `dailyExpectations` (06:00) computes the day's
delivery list but only writes an `audit_log` row (`jobs/dailyExpectations.ts:123`), so the receiver is never told what is arriving.
Chef dish price alerts (`dishPriceAlert`) are computed on demand when the chef home loads (`routers/recipes.ts:569`,
`recipes/alerts.ts:61`). They have no producer job and are never pushed.

---

## 4. Job runtime, schedule and producers

Runtime: a Postgres `job_queue` (BullMQ/Redis removed, `apps/worker/src/queue.ts:24-39`). Schedules live in
`apps/worker/src/cron.ts` **[IMM]**, in Asia/Jerusalem time. Production has **no worker process**: Vercel Cron calls
`/api/cron/jobs` every minute (`apps/web/vercel.json` `"* * * * *"`). That runs `runServerlessTick` (heartbeat, stall recovery,
due schedules via `registerCronSchedules`, then drains the queue for ~240 s; `apps/worker/src/serverless.ts:74-155`,
`apps/web/app/api/cron/jobs/route.ts:36-63`). Each slot runs at most once (`dedupe_key 'cron:<id>:<slot>'`).
`SERVERLESS_CRON_SKIP` pauses tasks (`cronSkip.ts:17`), and `JOB_KICK=off` disables the after-request kick for
`ocr-invoice`, `match-invoice` and `import-catalog` (`apps/web/lib/jobKick.ts:31,162`).

| Queue | Schedule (`cron.ts`) | Producer besides cron | Gate | Output |
|---|---|---|---|---|
| baselines | 02:00 daily (`:63-67`) | — | — | price baselines |
| retention | 03:30, **only if `RETENTION_CRON_ENABLED=1`** (`:52,136-142`); deletes only if `RETENTION_PURGE_ENABLED=1` (`jobs/retention.ts:9-41`) | — | env, both off by default | dry-run log |
| daily-expectations | 06:00 (`:56-60`) | — | — | audit_log only |
| health-digest | 06:45 (`:121-125`) | — | env recipients | ops email |
| price-alerts | 07:00 (`:98-102`) | — | flag `priceAlerts` | email |
| monthly-report | 1st 07:45 (`:113-117`) | — | flag `monthlyReport` | email + mock WA |
| recovery-reminders | 08:30 (`:106-110`) | — | flag `recovery` | email |
| order-reminders | 09:00 (`:77-81`) | — | none | email |
| supplier-delays | 10:00 (`:84-88`) | — | none | email |
| end-of-day-report | 19:00 (`:91-95`) | — | none | email |
| outbox-dispatch | every 60 s (`:70-74`) | — | — | provider sends |
| ocr-sweep | every 5 min (`:128-132`) | — | — | re-enqueue stuck OCR |
| ocr-invoice / match-invoice / import-catalog | event-driven | upload / ingest + after() kick (`jobKick.ts:31`) | — | — |
| **sync-platforms** | **none.** The header comment says "every 30 minutes" (`cron.ts:9-10`), but no `upsertJobScheduler` exists | **none** (only `scripts/smoke-all-jobs.ts:132`) | — | **dead consumer** (`handlers.ts:33`, `index.ts:58`) |

Note: `unregisterCronSchedules` is complete (`cron.ts:152-165`).

---

## 5. Feature flags vs plan entitlements (two separate systems)

### 5.1 Per-restaurant feature flags (wave-1)

- 33 keys in `FEATURE_KEYS` (`packages/api/src/lib/features.ts:11-48`), stored in `restaurants.settings.features` jsonb.
- **Everything is OFF by default.** `{all:true}` turns every flag on (used only by the seeded demo tenant), and `FEATURES_OFF=all|k1,k2`
  is a global env kill-switch (`features.ts:7-9,56-70`).
- Gate helpers: `isFeatureOn` / `assertFeature` / `assertFeatureOn` (`packages/api/src/lib/featureGate.ts:6-34`).
- The **only** way to toggle a flag is the platform-admin console: `admin.setFeatures` merges a jsonb patch and writes
  an audit row (`packages/api/src/routers/admin.ts:364-404`), using the UI `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx` (140 lines).
  A restaurant owner **cannot** self-enable anything, and `settings.update` (owner) has no features key (`routers/settings.ts:46,106`).
- Exceptions read by env rather than tenant: `growth` (`routers/growth.ts:41`), `leakCheck` (`leakCheck/security.ts:24`),
  `receiverLanguages` (`apps/web/lib/i18n/server.ts:31`).

### 5.2 Plan entitlements (billing)

- `PLAN_SEED` features: `integrations`, `whatsapp_alerts`, `advanced_analytics`, `accounting_export`. Trial/pro/chain get all
  four; basic (₪349) gets none (`packages/db/src/plans.ts:20-63`) **[IMM]**.
- With no billing account or no subscription the restaurant gets an **implicit trial** with all features (`packages/api/src/entitlements/entitlements.ts:46-108`).
- Gate: `requireFeature()` middleware (`trpc.ts:219-237`), used by exports, integrations, `orders.ts:1128`, and
  `owner.leaks/suppliers` (`routers/owner.ts:44-45`). WhatsApp is gated inline (`matchInvoice.ts:191-192`, `orders.ts:925`).
- Admin overrides: `admin.setOverrides` (limits/features on the subscription, audited) (`admin.ts:317-362`), UI `OverridesForm.tsx` (110 lines);
  `admin.assignPlan` (`admin.ts:227`).

---

## 6. Search & Activity

- **Search** `search.global` (memberProcedure) does trigram + ILIKE matching over suppliers, products and invoice numbers, 5 results per kind
  (`packages/api/src/routers/search.ts:15-60`). The client hides record groups a role cannot open
  (`apps/web/app/dashboard/search.tsx:71-73,104`). It does not search discrepancies, claims, POs, recipes or ₪ amounts,
  and it has no actions ("approve", "claim").
- **Activity** `activity.feed` (memberProcedure) is a paginated feed of `activity_events` with `metadata` (which can include ₪)
  (`packages/api/src/routers/activity.ts:14-46`). Producers: only `invoice_matched/received` (`packages/api/src/match/persist.ts:434`)
  and `discrepancy_approved/rejected` (`routers/approvals.ts:402,458`) via `logActivity` (`packages/api/src/activity.ts:26`).
  Claims, recovery, orders, receiving and team changes do not log activity.

## 6b. Tasks router (`לטיפולי`)

`tasksRouter = router({})` is **empty** ("Personal task queue — later wave", `packages/api/src/routers/tasks.ts:1-10`).
There is no tasks table. Today the act-now list is built on the fly by `NeedsYou` from `approvals.queueSummary` and similar calls
(`apps/web/app/dashboard/home/needs-you.tsx:28-32`, `home/data.ts:20`).

---

## 7. Surprises / risks found

1. **The "receiver sees no ₪" rule holds only in the UI, for the home aggregates.** `owner.kpis`, `owner.leakHero` and `owner.leakSummary`
   are `memberProcedure` (`routers/owner.ts:115,121,150`), and the comment at `:128` says "a receiver/chef sees only the aggregate hero".
   `activity.feed` (memberProcedure) returns ₪ metadata (`activity.ts:32-34`). Only the `homeCaller` Proxy (`home/caller.ts:7-12`)
   stops these calls, so a receiver calling tRPC directly gets ₪. This conflicts with the owner rule and needs a human decision.
2. **Real WhatsApp would send to `"role:manager"`.** `matchInvoice` sends `target: role:<role>` (`matchInvoice.ts:196`) through
   `createWhatsAppNotifier()`. With Cloud keys set, `WhatsAppCloudNotifier.dispatch` POSTs `to: "role:manager"` (`whatsappCloud.ts:47-59`),
   which is not a phone number, and free text outside the 24 h window needs Meta templates anyway. No code maps a role to a phone, although `users.phone` exists.
3. **The monthly report's WhatsApp is hard-wired to the mock** even when keys exist (`reports/send.ts:34`).
4. **"Sent" does not mean the message was sent.** Mock WhatsApp/push and keyless email mark rows `sent` (`whatsapp.ts:20`, `push.ts:16`,
   `email.ts:24`), while direct `enqueueNotification` rows go to `failed/skipped_no_provider` (`outboxDispatch.ts:124-130`). Rows in the same table mean different things.
5. **Push is 100% mock.** There is no provider, the router is empty and there is no subscription table. Every "push" row is decorative.
6. **`sync-platforms` is a dead job.** It has a consumer but no schedule and no producer, although the cron header documents a 30-minute schedule.
7. **The EOD digest counts every open discrepancy as "open credits"**, including never-claimable MISSING_ON_INVOICE and PRICE_LOWER
   (`endOfDayReport.ts`, `sum(abs(delta))` over `resolutionStatus in (open, escalated)`). This conflicts with "MISSING_ON_INVOICE not claimable, out of leak",
   whereas recovery reminders correctly exclude them (`reminders.ts`, `NEVER_CLAIMABLE_TYPE_SQL`).
8. **Inline ₪ formatting outside `formatIls()`.** `notifyHelpers.formatIlsAmount` re-implements `Intl.NumberFormat('he-IL')`
   (`apps/worker/src/lib/notifyHelpers.ts:64-68`), and `matchInvoice` builds `₪${toFixed(0)}` (`:193,232`). AGENTS.md violation (money-format-marshal).
9. **order-reminders, supplier-delays and EOD are not flag-gated** and email every tenant's owner+manager every day. There are no
   notification preferences anywhere (`settings.ts` has thresholds but no notification keys).
10. Escalation is silent: approving or rejecting (`approvals.ts:402,458`) triggers no notification. An item routed to the owner is only
    announced once, at first match. Re-matches deliberately do not notify (`matchInvoice.ts:183-186`).

---

## 8. Automation opportunities

| # | Trigger → action | Human still confirms | Data / reuse | Immutable? |
|---|---|---|---|---|
| A1 | **Morning receiver brief.** The 06:00 `daily-expectations` result goes to the receiver as push/WhatsApp ("3 deliveries today: X, Y, Z"), with no ₪ | nothing (informational) | reuse `dailyExpectations.ts` output, `enqueueNotification`, a new recipient role list (`recipientsForRestaurant(db,rid,['receiver'])`) | Adding the schedule edits `cron.ts` **[IMM]**; reusing the 06:00 job body does not |
| A2 | **Role → phone resolver + WhatsApp templates**, so `role:<x>` targets become real numbers (fixes surprise 2) | owner opts in, phone verified | `users.phone`, `recipients.ts`, Meta templates; credentials are Phase-6/human-only | resolver is not immutable; `outbox.ts` **[IMM]** untouched if resolution happens at enqueue |
| A3 | **Approval escalation nudge.** An owner-tier item undecided after N hours (or a manager item after its SLA) gets one reminder, then escalates manager→owner | the decision itself (money action) | `approvals.queueSummary`, outbox dedupe key `approval-nudge:<discId>:<day>` | escalation rule = approvals engine **[IMM]**; the nudge job needs `cron.ts` **[IMM]** |
| A4 | **Approval/claim nav badges + `nav.badges` procedure** (fill the empty `navRouter`) | — | `approvals.queueSummary`, recovery overdue count | needs a COVERAGE entry in `cross-tenant.attack.test.ts` **[IMM, append-only allowed]** |
| A5 | **Ask → action drafts.** "Draft claims for this week" returns a prefilled claim batch / letter preview, and the user taps "send" | every send (owner rule) | `claimable_lines` tool + recovery claim procedures; a write tool behind a confirm step | no immutable file if it reuses existing claim procedures |
| A6 | **Proactive Ask digest.** The offline engine's `leakChange`/`priceRaise` facts are folded into the EOD/monthly email ("why did the leak go up") | none | `offline.ts` intents, `reports/send.ts` | EOD schedule unchanged; no **[IMM]** |
| A7 | **Chef dish-price push.** A nightly job after baselines runs `dishPriceAlerts` and notifies the chef (₪ allowed for recipes) | chef re-prices the dish | `recipes/alerts.ts:61`, outbox | new schedule → `cron.ts` **[IMM]** |
| A8 | **Bookkeeper digest.** Weekly: pay-run ready, claims overdue ≥7 days, VAT-at-risk | pay-run release | `payRun`, `recovery`, `owner.vatAtRisk` | `cron.ts` **[IMM]** |
| A9 | **Persisted task queue (`tasks` router).** Turn `NeedsYou` rows into assigned, dismissable tasks with due dates (claim overdue day 7, receipt unreconciled) | each task's action | needs a new table/migration | `schema.ts` + migrations **[IMM]** → HUMAN-PR |
| A10 | **Owner self-serve flags.** An owner-facing settings page for safe flags (monthlyReport, recovery, priceAlerts, aiAssistant) instead of an admin ticket | owner toggles | `admin.setFeatures` logic → an owner-scoped variant + audit | new procedure needs a COVERAGE entry; no other **[IMM]** |
| A11 | **Notification preferences** (per-user channel/quiet hours/digest vs instant), honoured by all producers | user sets once | `restaurants.settings` jsonb or `memberships`; filter in `recipientsForRestaurant` | jsonb avoids schema change; `outbox.ts` **[IMM]** untouched |
| A12 | **Real web push** (PWA): subscription storage + VAPID provider in `outboxDispatch` | browser permission | `push` router stub, `MockPushNotifier` | needs a table (**[IMM]** schema) |
| A13 | **Schedule or remove `sync-platforms`** (MarketMan/Zester pull every 30 min for tenants with `integrations`) | connect once | `syncPlatforms.ts`, integrations router | `cron.ts` **[IMM]** |
| A14 | **Fix the EOD "open credits" figure** to exclude NEVER_CLAIMABLE types; make the digest role-aware | — | `lib/claims.ts` `NEVER_CLAIMABLE_TYPES` | EOD job is not on the list, but "money math" review is human |
| A15 | **Search actions**: the command palette can "approve / open claim / go to PO #", and searches POs and claims | the action | `search.global`, nav registry | new procedures → COVERAGE entry |

Owner rules respected: no money action is fully automatic (A3, A5 and A8 end in a human tap); the receiver gets no ₪ (A1); the chef sees ₪ only for recipes (A7); MISSING_ON_INVOICE stays out of every claim/leak figure (A5, A14); the 7-day overdue window comes from `CLAIM_ANSWER_DAYS = 7`.
