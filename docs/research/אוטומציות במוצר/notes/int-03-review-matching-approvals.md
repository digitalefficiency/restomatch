# INT-03 — Invoice review, matching and approvals: current state and automation opportunities

Scope: invoice review/correction, the 3-way match (`match.runForInvoice` and the `match-invoice` worker job), the
`packages/matching` engine (read-only), the approval routing engine (7 rules), `approvals.*` procedures (myQueue,
queueSummary, approve/reject/escalate/reopen/history), the approvals and pay-run pages, the notifications sent for
each `match_run`, and the tenant-side `leakCheck` router.

Code base read: `release/train-a` checkout at `scratchpad/trainA` (HEAD `c6132c0e Merge #208 into train A`). Paths
below are relative to that root. `main` (`/home/user/restomatch`, HEAD `759fb554`) has an older
`packages/api/src/routers/approvals.ts` (the file differs), so the queue/undo/waive-reason work described here may
exist only on train-A. `packages/api/src/approvals/engine.ts` is the same on both branches.

Note: this is a read-only investigation. Nothing was changed except this note.

---

## 1. Building blocks at a glance

| Block | Where | Immutable? |
|---|---|---|
| Matching engine `runMatch` (12 types, severities, `TOTAL_TOLERANCE_ILS = 0.1`) | `packages/matching/src/engine.ts:22,136-430` | **YES** |
| Tolerances (price 2% / ₪5, qty 3% / 1, block at 10%) | `packages/matching/src/tolerances.ts:4-10` | **YES** |
| Approval routing engine (7 rules + fallback) | `packages/api/src/approvals/engine.ts:114-212` | **YES** |
| Persisting a run, routing each finding, carrying prior decisions | `packages/api/src/match/persist.ts:303-466` | no |
| MatchInput assembly (PO discovery, GR, baselines) | `packages/api/src/match/buildMatchInput.ts` (507 lines) | no |
| Interactive re-match | `packages/api/src/routers/match.ts:30-109` | no |
| Background job `match-invoice` | `apps/worker/src/jobs/matchInvoice.ts:70-266` | no (but cron.ts and outbox.ts are) |
| Approval queue + decisions | `packages/api/src/routers/approvals.ts:173-613` | no |
| Role visibility / who may decide | `packages/api/src/lib/roles.ts:4-25` | no |
| Never-claimable types (`PRICE_LOWER`, `UNORDERED_ARRIVAL`, `MISSING_ON_INVOICE`) | `packages/api/src/lib/claims.ts:19-25` | no (₪ rule, owner-decided) |
| Charts leak filter `LEAK_FILTER` | `packages/charts/src/leak-views.ts:134-136` | no (owned by matching-engine-guardian, human-PR for ₪ math) |
| Outbox enqueue/markSent | `packages/api/src/notifications/outbox.ts` | **YES** |
| Cron registrations | `apps/worker/src/cron.ts:51-145` | **YES** |
| Feature flags (`restaurants.settings.features`, `FEATURES_OFF` kill switch) | `packages/api/src/lib/features.ts:11-71` | no |
| Approval thresholds per tenant (`settings.approvalThresholds`) | `packages/api/src/routers/settings.ts:46,106-121`; UI `apps/web/app/dashboard/settings/form.tsx:38-70` | settings router no; `schema.ts:160` **YES** |

`invoicesRouter` is an empty placeholder (`packages/api/src/routers/invoices.ts:10`). Invoice reads and edits live
in `receiving.*` (`getInvoice`, `updateInvoiceHeader` at `receiving.ts:610`, `updateInvoiceLine` at `receiving.ts:693`).

---

## 2. Workflow A — Invoice gets matched automatically (OCR → match job)

**Roles:** none act. Receiver/manager uploaded the invoice earlier (INT-01).

**Flow:**
1. `ocr-invoice` finishes. `needsHumanReview = result.needsHumanReview || duplicateOf !== undefined`
   (`apps/worker/src/jobs/ocrInvoice.ts:294`). The OCR review threshold is 0.85 (`packages/ocr/src/types.ts:92`).
2. If confident, `ocrAutoMatchHold` decides whether to wait for a receipt count (`ocrInvoice.ts:334-341`, it marks
   "held for count" so screens say "waiting for the count").
3. If it may match, it enqueues `match-invoice` with `{restaurantId, invoiceId, poId?}` (`ocrInvoice.ts:342-357`).
   Low-confidence invoices are **not** matched. They wait for a human (see Workflow B).
4. `processMatchInvoice` (`matchInvoice.ts:165`) checks the tenant (`findJobInvoice`, `:174`). It then runs
   `matchInvoiceForJob`, which skips in these cases: invoice still `ocr_pending` (`:77`), already matched and the job
   is not a rematch (`:87`), a rematch hold (`:93-96`), no lines (`:104`), the job's PO is rejected (`:109`), or the
   receipt is still open (`:116-120`).
5. Thresholds come from `restaurants.settings.approvalThresholds` (`:122-128`). Then `runMatch` runs (`:129`), and
   `persistMatchRun` runs in one transaction (`:131-148`).
6. `persistMatchRun` writes the `match_runs` row (`persist.ts:312-322`). For each finding it calls
   `evaluateApproval` (`:350`). `auto_approve` becomes `accepted`, everything else stays `open` (`:351`). It writes
   `discrepancies` with `requires_role`, `rule_id` and `rule_name` (`:365-388`). It sets the invoice to `disputed`
   when the run is blocked, else `matched`, but never moves an invoice out of `approved` or `paid` (`:405-416`). It
   writes `price_history` (`:420`) and an `activity_events` row `invoice_matched` with leak metadata (`:427-459`).
7. **Notifications per match_run** (only the first run, `!replaced`, `matchInvoice.ts:191`), for each role in
   `rolesNeedingNotification`:
   - WhatsApp to `target: role:<role>`, only if the entitlement `whatsapp_alerts` is active (`:192-208`). Usage is
     recorded with `recordUsage(... 'whatsapp_sends')`.
   - Push to `role:<role>`, always (`:210-218`). This is **MockPushNotifier**: it writes the outbox row and marks it
     sent at once (`packages/api/src/notifications/push.ts:9-19`). `outboxDispatch` has no push provider
     (`apps/worker/src/jobs/outboxDispatch.ts:184,238`).
   - Email to the real mailbox of each member with that role (`recipientsForRestaurant`,
     `packages/api/src/notifications/recipients.ts:35-60`), using the `approvalNeededEmail` template with a link to
     `/dashboard/approvals` (`matchInvoice.ts:225-255`). Resend is used when `RESEND_API_KEY` is set, otherwise the
     console notifier.

**Tables touched:** `invoices`, `match_runs`, `discrepancies`, `price_history`, `activity_events`,
`notifications_outbox`, usage counters.

**Automatic today:** the whole chain. The trigger is event-driven (OCR or receipt), not cron.

**Gaps and defects found:**
- **The real WhatsApp path is broken for approvals.** `WhatsAppCloudNotifier.dispatch(payload.target, …)` posts
  `to: "role:manager"` to Graph (`packages/api/src/notifications/whatsappCloud.ts:33,47-58`). No code resolves
  `role:` into phone numbers (grep of `role:` in `notifications/` finds only `recipients.ts` comments). So once
  `WHATSAPP_*` env vars are set, approval WhatsApps fail. Until then the mock only logs
  (`notifications/factory.ts:63-73`).
- **The notification ₪ is the engine total, not the leak.** The summary is `${n} פערים, סה"כ הפסד פוטנציאלי
  ₪${result.totalDiscrepancyAmount.toFixed(0)}` (`matchInvoice.ts:194,240`). That total is Σ|delta| over **all**
  findings (`engine.ts:423`), including PRICE_LOWER, UNORDERED_ARRIVAL and MISSING_ON_INVOICE. MISSING_ON_INVOICE
  carries the full ordered value as its delta (`engine.ts:359-365`). This breaks the owner rule that
  MISSING_ON_INVOICE is out of the leak, and it bypasses `formatIls()` (AGENTS.md money-display rule). The feed
  already has the correct, capped figure (`matchActivitySummary`, `persist.ts:245-287`).
- **A re-match never notifies** (`!replaced`), even when a finding came back larger and reopened. `persist.ts:397`
  computes the roles for exactly that case, but the worker drops them. `match.runForInvoice` ignores them as well
  (`persist.ts:291-292`).
- **Push is a mock**, so the `push` router/PWA subscription is not used for approvals.

---

## 3. Workflow B — Manager reviews or corrects an invoice and re-runs the match

**Role:** owner/manager (`canEdit`, `apps/web/app/dashboard/invoices/[invoiceId]/page.tsx:53`). The bookkeeper sees
the page and the consolidated proposal (`:62-63`) but cannot edit. The chef is excluded from the VAT panel (`:56`).

**Screens:** `/dashboard/invoices/[invoiceId]` → `InvoiceCorrection` (`correction-client.tsx`). Older scan view:
`/scans/[invoiceId]`.

**Manual steps today:**
1. Open the invoice from an approvals card. The card has a deep link to `#line-<id>` (`approvals/list.tsx:547`).
   Low-confidence invoices are reached from the scans/pending list.
2. Edit the header (number, date, excl/VAT/incl). That is 5 fields + save, through `receiving.updateInvoiceHeader`
   (`correction-client.tsx:87-131`). Values are **re-typed** from the paper or photo.
3. Edit a line (description, qty, unit, price, total). That is 1 click to open, up to 5 fields, then save, through
   `receiving.updateInvoiceLine` (`correction-client.tsx:105-160`).
4. **Press "re-run match" by hand** (`trpc.match.runForInvoice`, `correction-client.tsx:112-119`). The header and
   line mutations do **not** enqueue a re-match. The router comment says "re-run the match afterwards"
   (`receiving.ts:617,701`).
5. `runForInvoice` (`match.ts:41-118`) refuses consolidated invoices (`:50-60`). It pins the prior PO (`:64-72`),
   releases bare claims (`releaseClaimsForRematch`, `:86`; it refuses if a claim is in progress), keeps prior human
   decisions (`loadPriorDecisions`, `:89`), deletes the old run, and persists the new one inline. **No
   notification is sent.**

Rough cost: one OCR price fix takes about 4–8 clicks plus typing. A full low-confidence invoice takes about 5 + 5×N
fields, plus one manual re-match click.

**Automatic today:**
- Product-link changes in catalog mapping call `requeueInvoicesForRematch` (`packages/api/src/routers/mapping.ts:45-80`).
  It skips invoices that are claimed, consolidated or settled, and waits 3 s for the transaction (`:30`).
- Submitting a receipt enqueues `rematch: true` with the counted PO (`receiving.ts:1254-1265`).
- Prior decisions carry over only while they are still equivalent: same severity, ₪ not larger, routing not
  stricter, same duplicate key (`persist.ts:58-76`, pairing at `:114-144`).

**Flags:** `vatAtRisk` (VAT panel, `page.tsx:56`), `consolidatedMatch` (consolidated proposal),
`dockPriceContext` and `contracts` badges. All are OFF by default (`features.ts:7-9,61-71`).

---

## 4. The approval routing engine — 7 rules (IMMUTABLE)

`buildRules()` (`packages/api/src/approvals/engine.ts:114-180`) uses thresholds that can be overridden per tenant
(`:80-101`). Defaults are at `:80-87`.

| Pri | Rule id | Predicate | → role / action |
|---|---|---|---|
| 100 | duplicate-invoice | type = DUPLICATE_INVOICE | bookkeeper / block |
| 95 | large-invoice-without-po | UNORDERED_ARRIVAL and invoice > ₪5,000 | owner / block |
| 90 | unordered-item-significant | UNORDERED_ITEM and delta > ₪100 | owner / block |
| 80 | severity-block | severity = block | owner / block |
| 70 | cumulative-large | run Σ > 5% or > ₪300 | owner / queue_review |
| 60 | cumulative-medium | 2–5% or ₪50–300 | manager / queue_review |
| 10 | minor-info | severity = info | null / **auto_approve** |
| — | fallback | none matched | manager / queue_review (`:190-212`) |

This matches the owner rules: manager ₪50–300 / 2–5%, owner above that, and owner for every blocking gap.

**Observations:**
- **Info findings are auto-approved only on small runs.** `minor-info` has priority 10, below both cumulative rules.
  So an *info* finding on a run whose Σ is over ₪50 / 2% goes to a manager or owner `queue_review` instead of being
  auto-accepted. A warn finding on a run of ₪50 or less, and 2% or less, falls to the fallback (manager).
- **The run Σ includes non-leak types.** `persist.ts:342-348` passes `result.totalDiscrepancyAmount` (all types) as
  `matchRun.totalDiscrepancyAmount`. One MISSING_ON_INVOICE (warn, delta = the full ordered line) can push every
  finding on the invoice into the **owner** queue. Routing would honour the owner rule ("MISSING_ON_INVOICE out of
  leak") if this context value were the LEAK_FILTER/claims total. That change is in `persist.ts` (not immutable),
  but it changes who approves money, so an owner must sign off on it.
- **`poExists` is computed but no rule reads it** (`persist.ts:347`, `engine.ts:28`).
- **`LEAK_FILTER` still counts MISSING_ON_INVOICE** (`packages/charts/src/leak-views.ts:134-136`). So do
  `matchActivitySummary` (`persist.ts:254-261`) and `endOfDayReport`'s "open credits" sum
  (`apps/worker/src/jobs/endOfDayReport.ts:54-64`, Σ|delta| over open findings). Only `lib/claims`
  (`claims.ts:22`) and the approvals UI (`isClaimableRow`, `approvals.ts:97-103`) exclude it. This is a ₪
  inconsistency that the research should flag to the owner. It is not an automation, but it affects the hero number.

---

## 5. Workflow C — Deciding approvals (owner / manager / bookkeeper)

**Screen:** `/dashboard/approvals` (`apps/web/app/dashboard/approvals/page.tsx`, `list.tsx`, 1194 lines). On the
server it loads `approvals.myQueue({limit:50})`, `approvals.queueSummary`, `owner.viewOptions` and memberships
(`page.tsx:57-64`). Filters in the URL are types, severities and suppliers (`page.tsx:42-46`; procedures
`approvals.ts:127-144`).

**Visibility** (`lib/roles.ts:4-25`): the owner sees owner+manager+bookkeeper items, the manager sees manager items
only, and the bookkeeper sees bookkeeper items only. Chef and receiver get `[role]`, so an empty queue. `myQueue`
is a `memberProcedure` (`approvals.ts:185`), and the receiver/chef see no ₪ there because nothing is routed to them.
Deciding requires owner, manager or bookkeeper (`DECIDER_ROLES`, `approvals.ts:44-53`), and `canActOn` is applied
per row by `ensureCanAct`. The old deadlock, where the bookkeeper received the duplicate notification but could not
act, was fixed (`approvals.ts:36-43`).

**Order:** block → warn → info, then invoice due date, then largest ₪ (`approvals.ts:146-171`), with keyset paging.

**Per-card actions** (`vocab.ts:137-154`, `list.tsx:518-830`):

| Finding | Primary actions | Taps |
|---|---|---|
| Claimable (warn/block, ₪ ≠ 0, not never-claimable) | "דרוש ₪X" (approve → `accepted`, copy "נדרש מהספק") / "שולם כפי שחויב" (reject + reason chip) | approve 1; reject 2 (button + reason chip; "other" adds a textarea) |
| DUPLICATE_INVOICE | hold the copy (approve) / not a duplicate (reject) | 1 / 2 |
| PRICE_LOWER, MISSING_ON_INVOICE, any non-claimable | "סמנו כנבדק" (reject with `reasonCode:'reviewed'`) | 1 |
| UNORDERED_ARRIVAL | "link" → navigates to the invoice page (`list.tsx:722-726`); no inline action | 1 plus work elsewhere |
| Any | "⋯" → escalate to owner (`approvals.ts:478-503`: status `escalated`, `requires_role='owner'`) | 2 |

The undo toast calls `approvals.reopen` within a 15 s window (`approvals.ts:62,514-593`). Waive reason codes are
in `approvals.ts:69-80`, and the per-type chips in `vocab.ts:169-180`. Every decision writes `audit_log` and
`activity_events` (`approvals.ts:393-418, 444-475`). `queueSummary` tiles split "להחלטה (₪)" from "לבדיקה" and
show an "others" lane so the owner knows what other roles still hold (`approvals.ts:311-375`).

**Manual today:** every open finding is decided **one card at a time**. There is **no batch approve, no
"approve all for this invoice/supplier", and no learned auto-rule.** A grep for `batch|bulk|approveAll|approveMany`
across `routers/*.ts` and `approvals/*.tsx` finds nothing relevant. A 10-line price-increase invoice therefore
takes 10–20 taps.

**Downstream:** an accepted finding becomes a recovery claim only when `syncClaims` runs. That happens on the
recovery page (`recovery.ts:50,71`), in the monthly report (`reports/monthly.ts:163`), or in the recovery-reminders
cron at 08:30 (`recovery/reminders.ts:146`, `cron.ts:108`). It is not triggered on approve. Recovery is
flag-gated (`recovery`).

**Pay run** (`/dashboard/approvals/pay-run`, flag `payRun`, `payRun.ts:157-170`) is read-only. It shows pay / hold /
claim per invoice. "Not paid" means `status <> 'paid'`, and there is no payment rail (`payRun.ts:14-29`).

**No scheduled nudges for approvals.** `cron.ts` registers daily-expectations, baselines, outbox-dispatch,
order-reminders, supplier-delays, end-of-day-report (19:00, open-credits ₪), price-alerts, recovery-reminders,
monthly-report, health-digest, ocr-sweep and retention (`cron.ts:58-140`). None of them is "you have N decisions
waiting for X days" or "an invoice due tomorrow is still on hold".

---

## 6. Workflow D — Owner tunes routing thresholds

`settings.update` is `ownerProcedure` (`settings.ts:106`) and merges `approvalThresholds` key by key (`:118-121`).
The UI has currency and percent fields (`apps/web/app/dashboard/settings/form.tsx:38-70`). The new values apply
**only to future runs**. Existing open rows keep their `requires_role` until a re-match. The tolerances
(`settings.tolerances`) work the same way.

---

## 7. Workflow E — Leak check carried into the tenant

`leakCheck.claim` (owner) attaches a prospect's sandbox result through a signed link. `leakCheck.claimed`
(manager+) lists it (`packages/api/src/routers/leakCheck.ts:21-70`). Both are gated by the `leakCheck` flag
(`:27`, OFF by default). The findings are display-only: they do not create `match_runs` or approvals. One possible
automation is turning carried-over findings into a first "here is your leak" queue, but that needs the sandbox
invoices re-ingested.

---

## 8. Flags, entitlements, env — this area

| Gate | Effect here | Default |
|---|---|---|
| Entitlement `whatsapp_alerts` (`matchInvoice.ts:192-193`) | WhatsApp approval alert | depends on plan (billing, immutable) |
| Env `WHATSAPP_PHONE_NUMBER_ID`+`WHATSAPP_ACCESS_TOKEN` | Real WhatsApp, which then fails on `role:` targets | unset → mock |
| Env `RESEND_API_KEY` | Real approval email | unset → console |
| Push | always mock | — |
| Flag `payRun` | pay-run page and link | OFF |
| Flag `recovery` | claims lifecycle after approve | OFF |
| Flag `consolidatedMatch` | consolidated invoice cross-match panel | OFF |
| Flag `vatAtRisk`, `dockPriceContext`, `contracts` | invoice page badges and panels | OFF |
| Flag `leakCheck` | carried leak check | OFF |
| Flag `aiAssistant` | Ask (`routers/ask.ts:13,31`); tools are read-only leak tools (`ask/tools.ts:180-204`), **no approvals tool** | OFF |
| `FEATURES_OFF` env | global kill switch (`features.ts:56-59`) | — |

---

## 9. Stubs, mocks, dead code

- `MockPushNotifier` marks a row sent without delivering it (`notifications/push.ts:9-19`). `outboxDispatch` has
  no push provider (`outboxDispatch.ts:238`).
- `MockWhatsAppNotifier` is the default (`factory.ts:73`). The real Cloud notifier cannot resolve `role:` targets
  (see §2).
- `invoicesRouter` is an empty router (`routers/invoices.ts:10`).
- `ApprovalContext.matchRun.poExists` is never read by a rule.
- `PersistMatchResult.rolesNeedingNotification` is ignored by `match.runForInvoice` and on worker re-matches.
- The `queueSummary` "known limit until W2-13" comment (`approvals.ts:305-309`): open rows of superseded runs can
  still count. In practice runs are deleted on re-match, so this is a stale-row risk only.

---

## 10. Automation opportunities

Each item below gives the trigger, the action, what a human still confirms, the data needed, the parts that can be
reused, and whether an immutable file is involved.

1. **Batch decide per invoice/supplier ("approve all ₪ claims on this invoice")**
   - Trigger: the user opens a card group (invoice or supplier).
   - Action: a new `approvals.decideMany({ids, procedure})` that loops `ensureCanAct` plus the existing
     approve/reject logic, with one undo through `reopen` per id.
   - Human: the decider taps once to confirm the ₪ total.
   - Data: `myQueue` rows grouped by `invoiceId`/supplier.
   - Reuse: `approvals.ts:377-503`, `checkedRow`, `decidedConflict`, audit and activity writes.
   - Immutable: no. A COVERAGE entry must be added in `cross-tenant.attack.test.ts`, which is add-only.
   - Roles: owner, manager, bookkeeper.

2. **Auto-re-match after a manual invoice correction**
   - Trigger: `receiving.updateInvoiceHeader` or `updateInvoiceLine` succeeds.
   - Action: enqueue `match-invoice {rematch:true}` (or call the `runForInvoice` logic inline). Keep the
     settled/claimed skips from `requeueInvoicesForRematch`.
   - Human: none. Decisions carry over through `decisionStillApplies`.
   - Reuse: `mapping.ts:45-80` `requeueInvoicesForRematch`, `REMATCH_DELAY_MS`.
   - Immutable: no.
   - Saves one click and avoids stale findings when the user forgets to re-run.

3. **Daily "decisions waiting" digest and SLA escalation**
   - Trigger: a new daily job, or a step inside the existing `end-of-day-report` job (which already reads open
     discrepancies, `endOfDayReport.ts:54-64`).
   - Action: per role, send "N items, ₪X, oldest D days, invoices due ≤2 days still on hold". Optionally
     suggest escalation after N days.
   - Human: all decisions stay human.
   - Data: `queueSummary` logic (`oldestAt`, `invoiceDueDate`).
   - Reuse: outbox via `email.send`, `recipientsForRestaurant`.
   - Immutable: adding a **new cron entry is HUMAN-PR** (`cron.ts`). Extending `endOfDayReport.ts` is not.
   - Roles: owner, manager, bookkeeper.

4. **Fix the notification ₪ and the WhatsApp target**
   - Trigger: `processMatchInvoice` notifies.
   - Action: use `matchActivitySummary(...).leakIls` (or the claims total) through `formatIls`, and send a "to
     review" count when there is no ₪. Resolve `role:` into member phones the way email resolves addresses (needs
     phone numbers on users or memberships, which is likely a schema change → HUMAN-PR).
   - Human: none.
   - Reuse: `persist.ts:245-287`, `recipients.ts`.
   - Immutable: `matchInvoice.ts` is not immutable. A schema change for phone numbers is.

5. **Notify on re-match when a finding re-opens or grows**
   - Trigger: `persistMatchRun` returns non-empty `rolesNeedingNotification` (it is already computed only for new or
     changed findings, `persist.ts:397`).
   - Action: notify the same way also when `replaced`.
   - Human: none.
   - Immutable: no.

6. **Leak-consistent routing context**
   - Trigger: `persistMatchRun`.
   - Action: pass a leak-filtered Σ (LEAK_FILTER minus MISSING_ON_INVOICE, capped) as
     `matchRun.totalDiscrepancyAmount` to `evaluateApproval`, so a MISSING_ON_INVOICE line no longer escalates the
     whole invoice to the owner.
   - Human: the **owner must approve the routing change** (a money rule).
   - Immutable: the change is in `persist.ts`, but it affects routing semantics defined in engine.ts → treat as
     HUMAN-PR, owner sign-off.

7. **Learned auto-accept ("rule_wrong"/"price_agreed" waive loop)**
   - Trigger: the same supplier+product is waived with `price_agreed` K times.
   - Action: *suggest* a contract price or a tolerance override, and show "this would have auto-cleared N items".
   - Human: the owner confirms the new rule. Every money action stays confirmed.
   - Data: audit `after.reasonCode` (`approvals.ts:451-456`) and `WAIVE_REASON_CODES`.
   - Reuse: `contracts` flag and the settings tolerances.
   - Immutable: the suggestion is not. Changing engine auto-approve rules is HUMAN-PR.

8. **Inline UNORDERED_ARRIVAL linking with a PO suggestion**
   - Trigger: an UNORDERED_ARRIVAL card.
   - Action: show the top candidate open PO for that supplier and dates (buildMatchInput discovery) with a
     one-tap "link and re-match" that calls `runForInvoice` with a pinned PO.
   - Human: the manager confirms the PO.
   - Immutable: no.

9. **Approve → claim instantly**
   - Trigger: `approvals.approve` on a claimable row while `recovery` is on.
   - Action: call `syncClaims` for that restaurant, or a targeted version, so the claim and the credit letter are
     ready at once instead of at the next page visit or cron run. Overdue still uses 7 days (`claims.ts:28-31`).
   - Human: sending to the supplier stays human.
   - Immutable: no.

10. **Ask: "what's waiting for me?"**
    - Trigger: an Ask query.
    - Action: a read-only tool wrapping `queueSummary` and `myQueue`.
    - Human: none (read-only).
    - Reuse: `ask/tools.ts`.
    - Flag: `aiAssistant`.
    - Immutable: no.

11. **Auto-clear info-only rows on big runs**
    - Trigger: an info finding on a run with Σ over ₪50.
    - Action: auto-accept it (today it queues).
    - Human: the owner policy decision.
    - Immutable: **HUMAN-PR** (engine.ts rule priority).

---

## 11. Summary

The match pipeline is fully automatic from OCR to routed findings. It is careful about tenancy, receipts that are
still open, and keeping human decisions across re-matches. The manual cost sits in four places:

- one-by-one decisions with no batch action;
- a manual re-match after every correction;
- no reminders about decisions that are waiting;
- UNORDERED_ARRIVAL handled off-card.

The notification layer has three real defects:

- the ₪ figure is not the leak and bypasses `formatIls`;
- WhatsApp `role:` targets cannot be delivered;
- push is a mock.

There is also a cross-surface ₪ inconsistency: MISSING_ON_INVOICE is excluded in `claims` and the approvals UI, but
it still counts in LEAK_FILTER, the feed, end-of-day open credits and the routing Σ.
