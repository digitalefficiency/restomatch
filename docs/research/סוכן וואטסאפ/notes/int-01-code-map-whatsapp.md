# int-01: Code map for running RestoMatch from WhatsApp

**Date written:** 2026-11-07. **Track:** WhatsApp agent research (docs only). **Status:** internal, read-only code map. It changes no code and edits nothing on the immutable list. Every "needs a human PR" item is a proposal for the owner.

**Baseline.** Branch `claude/whatsapp-agent-research` = `origin/main` @ `4c887688` (train A). All `file:line` references are against that commit; re-grep after train B (Tue 10.11) and after each wave-2 train. "Planned" means a wave-2/3 brief (`docs/ux/wave2/*.md`, `docs/ux/IMPLEMENTATION-PLAN.md` §4) or the programme plan of 7.11 says it will exist. It is **not** on `main` today.

**Owner rules this map is checked against.** The receiver sees no ₪. The chef sees ₪ only on orders and recipes. Every money action is confirmed by a person unless an owner rule says otherwise. Nothing goes to a supplier automatically. MISSING_ON_INVOICE is not claimable and is outside the leak. A claim is overdue after 7 days. Quiet hours are 23:00–06:00 plus Shabbat, and each person gets at most 6 alerts a day.

---

## 0. In one screen

1. **Inbound WhatsApp exists as an intake pipe, not a conversation.** `POST /api/ingest/whatsapp/<token>` (one restaurant per token; HMAC, rate limits, `phone_number_id` binding, 7-day replay window) turns images/PDFs into OCR jobs and, behind `orderCapture`, an allow-listed text into a **draft** PO. It never replies, and it drops status callbacks, button replies and voice notes.
2. **Outbound WhatsApp is a scaffold with three defects:** `role:` targets are posted to Meta as the `to` number (`matchInvoice.ts:200`, `reports/send.ts:91`); only free-form text is sent, so every proactive alert outside the 24 h window would fail; mocks mark rows `sent`. G-06 (wave 2) and H-05ʰ (wave 3) fix these.
3. **Ask RestoMatch is the natural brain:** a tool loop over 4 read-only leak tools, per-restaurant budgets, a burst limit, a grounding check (strips links and phones, flags unmatched figures) and an offline fallback. But it is owner/manager only, leak-only, and offline answers are `facts` for the web, not text.
4. **Identity is the hard gap.** `users.phone` exists (`schema.ts:181`) with no writer and no verification, and nothing maps a phone to (user, restaurant, role). Verification, opt-in, prefs and idempotency are planned (G-03ʰ/H-03ʰ on 24.11, W2-14, G-05, G-06), none on `main`.
5. **The tools mostly exist as tRPC procedures,** callable server-side under the person's own session and RLS (`trpc.ts:98-132`). But on `main` `owner.leakHero` and `orders.get` return ₪ to a receiver; redaction is G-07 and H-11. No receiver-facing agent before those land.
6. **At least five immutable files** are involved (`outbox.ts`, `cron.ts`, schema/migrations + RLS, COVERAGE add-only, likely `rateLimit.ts`), plus a new public webhook. All human PR; Meta credentials are Phase-6 human intake.

---

## 1. Inbound today: WhatsApp and e-mail intake

### 1.1 The route and the guard order
- `apps/web/app/api/ingest/whatsapp/[token]/route.ts:20-40`: `GET` = Meta handshake (`handleWhatsAppVerify`); `POST` runs `guardPublicRequest` (method, streamed body cap, per-IP limit `ingest:wa:ip`) and then `handleWhatsAppWebhook`. Public through `apps/web/lib/publicPaths.ts:43-46`. The e-mail sibling (`ingest/email/route.ts:59-73`) finds the tenant from `inv_<token>@<domain>` and checks a Svix signature.
- `packages/api/src/ingest/http.ts` is framework-free (Request in, Response out) so that `ingest.attack.test.ts` can drive it. Guard order (`:97-108`):
  1. Channel configured (no secret ⇒ 503).
  2. Per-IP limit: `INGEST_IP_LIMIT` = 120/min (`:123`).
  3. Size cap ⇒ 413.
  4. HMAC `X-Hub-Signature-256` over the raw bytes ⇒ 401 (`:247`).
  5. Parse ⇒ 400.
  6. Tenant = **hashed URL token** via `app.ingest_resolve_channel()` (`pipeline.ts:52-64`). A restaurant id is never taken from the payload.
  7. Per-channel limit: `INGEST_CHANNEL_LIMIT` = 60/min (`:124`, `:196`).
  8. Replay: messages older than `WHATSAPP_MAX_AGE_SEC` = 7 days are rejected (`:126`, `:210`), and the unique `(restaurant, kind, provider_message_id)` index catches re-deliveries (`schema.ts`, `ingest_messages_replay_uq`).
- **`phone_number_id` binding** (`http.ts:202-209`). The Meta app secret is platform-wide, so the signature does not bind an event to a tenant. The channel's `phone_number_id` does, and it is mandatory in production (`cfg.requirePhoneNumberId`). **Consequence for an agent:** today each restaurant's intake channel is bound to *one* WhatsApp business number. A single shared "RestoMatch" agent number that serves many restaurants does not fit this model. It needs a sender-phone → tenant resolver instead of a URL token (§6).

### 1.2 The payload parser
- `packages/ingest/src/payloads.ts:98-160` `parseWhatsAppWebhook`.
  - It keeps only `field === 'messages'`, and only `image`, `document` and `text`.
  - **Status callbacks (delivered/read) are discarded by design** (`:139-140`). Nothing records delivery or read state for outbound messages.
  - `interactive` (button and list replies), `button` (template quick-replies), `audio` (voice notes) and `location` are parsed as nothing. A confirm-by-button agent needs these.
  - It stamps `authVerdict: 'pass'` for every WhatsApp sender (`:157`): Meta asserts the `from` number. E-mail gets a real SPF/DKIM/DMARC verdict (`:236`, `:259`).
- Media bytes are fetched through `packages/ingest/src/providers.ts:101-130` (a Graph media-id fetch with a strict id regex) and stored with `storeIngestedFile` (`ingest/store.ts:16-47`). The storage path is `invoice-scans/<restaurantId>/<scanId>.<ext>`, the same bucket and path an authenticated upload uses. The scan id is deterministic per (restaurant, sha256).

### 1.3 The pipeline, the allow-list and orderCapture
- `packages/api/src/ingest/pipeline.ts:193-436` `processInboundMessage`. Everything runs inside `withRestaurant(db, channel.restaurantId)` (`:200`), so every statement is under the tenant's RLS GUC.
- **Feature gate:** `ingestWhatsapp` / `ingestEmail` per restaurant (`:34-38`, `:206`). A disabled feature answers 404, the same as an unknown token (`http.ts:216`).
- **Allow-list:** `ingest_senders (restaurant_id, kind, sender, supplier_id?, label)` (`schema.ts:1353-1368`, unique on `(restaurant_id, kind, sender)`).
  - Lookup is at `pipeline.ts:210-232`. An optional supplier link is re-checked to belong to the same tenant (`:222-230`).
  - An unknown sender's documents are **stored but not OCR'd** and count against a quota (`:317-340`).
  - Only `senderAllowed && authVerdict === 'pass'` auto-registers an invoice (`:312-316`).
- **The allow-list is a list of numbers, not of people.** A row is "a phone that may send us invoices", optionally tied to a supplier. It carries no `user_id` and no role. Staff and suppliers share it.
- **orderCapture** (`pipeline.ts:391-423`, flag `orderCapture`). A WhatsApp **text** with no media, from an allow-listed sender, becomes `captureOrderDraft(...)` with `source: 'whatsapp'` and `senderPhone: sender` (`packages/api/src/orders/captureOrder.ts`).
  - The result is a **draft** PO, or `needs_supplier` with candidates. It never creates a supplier and never sends anything.
  - The text is kept in `ingest_messages.subject` so the inbox can open it in the capture screen.
  - The same parser is exposed to the web as `orders.captureFromText` (`routers/orders.ts:744`, chefProcedure).
  - **This is the only "WhatsApp text → action" path in the product today.** It is one-way: the sender gets no confirmation.

### 1.4 The inbox and its tRPC surface
Web: `apps/web/app/dashboard/inbox/`. Router `routers/ingest.ts:97-367`: reads `overview`/`senders`/`inbox` are `financeProcedure`; `rotateChannel`, `revokeChannel`, `addSender`, `removeSender`, `approveDocument`, `rejectDocument` are `managerProcedure`. Tokens are shown once and stored hashed (`schema.ts:1334-1351`).

---

## 2. Outbound today: notifications

### 2.1 The modules
- `packages/api/src/notifications/types.ts:11-48`: `NotificationPayload { restaurantId, channel: 'whatsapp'|'push'|'email', target: string, subject?, body, html?, attachments?, payload?, relatedEntity*, dedupeKey? }`. `target` is a free string, with no type that tells a phone from a role.
- `outbox.ts:18-65` `enqueueNotification` (**immutable**). It inserts `status: 'queued'` with optional dedupe on the partial unique index. `markSent` (`:70-79`) and `markFailed` (`:84-92`) round it out.
- `whatsappCloud.ts:15-68` `WhatsAppCloudNotifier`.
  - `dispatch(to, body)` posts `{ messaging_product: 'whatsapp', to, type: 'text', text: { body } }` to `graph.facebook.com/v20.0/<phoneNumberId>/messages` (`:46-66`).
  - There is **no template message type, no interactive buttons and no media**.
  - `send()` enqueues and then dispatches **immediately** (`:29-38`).
- `whatsapp.ts:10-24` `MockWhatsAppNotifier` enqueues and then `markSent` with a synthetic id. `push.ts:17` does the same. Both report **`sent` for a message that went nowhere**.
- `factory.ts:57-66`: the real WhatsApp notifier only when `WHATSAPP_PHONE_NUMBER_ID` **and** `WHATSAPP_ACCESS_TOKEN` are set, else the mock. `delivery.ts:9-32` holds `SKIPPED_NO_PROVIDER`, the honest "not configured" marker the dispatcher uses.
- `recipients.ts:34-68` `recipientsForRestaurant(db, rid, roles)` returns **e-mail addresses only**, de-duplicated by e-mail. The header (`:1-8`) states the gap itself: WhatsApp and push still use symbolic `role:` targets.
- `templates.ts` holds e-mail renderers (`approvalNeededEmail` `:362`, `endOfDayReportEmail` `:419`, …) and `DECISION_COPY` (`:337`). There are no WhatsApp templates. The monthly WhatsApp body comes from `monthlyReportWhatsApp` in `reports/`.

### 2.2 The dispatcher
`apps/worker/src/jobs/outboxDispatch.ts` claims a batch atomically (`FOR UPDATE SKIP LOCKED`, `:86-98`), retries up to `MAX_ATTEMPTS = 5` (`:39`), parks a missing provider as `failed` + `skipped_no_provider` (`:124-130`) and sends WhatsApp as `dispatch(row.target, row.body)` (`:205-213`). Its slot is in `cron.ts:70-75` (**immutable**); production fires every schedule from the minute tick at `/api/cron/jobs`.

### 2.3 The `role:` target bug and two related defects
1. **`role:` sent as a phone number.**
   - `apps/worker/src/jobs/matchInvoice.ts:195-217` calls `whatsapp.send({ target: \`role:${role}\` })` for every `rolesNeedingNotification`, gated on the `whatsapp_alerts` entitlement, and records usage `whatsapp_sends` (`:206-208`).
   - `packages/api/src/reports/send.ts:88-95` sends the monthly report to `target: 'role:owner'`.
   - With real keys set, Meta gets `"to": "role:owner"`, the call fails, and the row retries 5 times before parking as `failed`. With the mock, the row says `sent`.
   - G-06 names this finding functional-flows-02 (P0): "Meta would reject every `role:` target".
2. **Possible double send.** `WhatsAppCloudNotifier.send()` inserts a `queued` row and then dispatches in-process. Between those two steps the dispatcher tick may claim the same `queued` row (`scheduled_at <= now()`) and send it a second time. Status: **plausible**, not reproduced. G-06/H-05 should send through the outbox only.
3. **₪ formatting outside the util.** The match alert body is built with `₪${result.totalDiscrepancyAmount.toFixed(0)}` (`matchInvoice.ts:194`), not `formatIls()`/`moneyText`. It is a whole-shekel figure with no `he-IL` grouping and no bidi isolation, and it is about to be posted into a WhatsApp chat.

### 2.4 Planned (not on `main`)
- **G-06** (wave 2, not a human PR): `notify(tx, { event, audience, template, vars, deepLink, entity })` with `audience` = `{userIds} | {roles} | {poSenderOf} | {decidersOf}`, resolved at enqueue to one outbox row per (user, address); a verified phone gives a WhatsApp row, an unverified one none. `reports/send.ts` moves onto it; #173 `sendWindow.ts` is the single quiet-hours rule.
- **H-05ʰ** (wave 3, ~14.1, human PR; `notifications/**`, `cron.ts`, `jobs/{outboxDispatch,recoveryReminders,matchInvoice}.ts`): utility templates `rm_decision_needed`, `rm_delivery_late`, `rm_claim_reply`; role → member phone at enqueue; mocks write `skipped_no_provider`; quiet hours + Shabbat/holidays; ≤6 per user per day; claim-chase drafts on days 3/7/14 **awaiting a tap**; monthly report send. **H-05a** adds four `cron.ts` slots.
- **Cost** (`ext-02`): since 1 Oct 2026 free-form service replies and in-window utility templates are **billed** (secondary source: ≈ $0.0053 per message in Israel; the "1,000 free per month" allowance is per business phone number and is confirmed by Meta's pricing page extract, `ext-02` §2). Every agent reply costs money; `usage_metric 'whatsapp_sends'` (`schema.ts:130`) is the meter.

---

## 3. Ask RestoMatch: the core a WhatsApp agent would reuse

| Piece | Where | What it does today |
|---|---|---|
| Router | `routers/ask.ts:11-34` | `status` and `ask` are both **managerProcedure** (owner/manager). `ask` input is `question` (2–500 chars) and `locale: 'he'|'en'`. Feature `aiAssistant` (`assertFeature`). |
| Orchestration | `ask/index.ts:76-134` `runAsk` | Burst check, then reserve a question **before** any spend, then the model leg, then the grounding check. On no key, an exhausted budget or any model error it falls back to the **offline** engine. It always records usage, and **stores no question text**. |
| Model loop | `ask/claude.ts` | A pinned model constant from the latest Claude models (`ASK_MODEL`, `:18`). `MAX_TURNS = 4` tool round trips (`:19`, `:143`) and `MAX_TOKENS = 8000` (`:21`). Answer schema `AnswerSchema`; `askSystemPrompt(locale, today)` (`:24`). A failed leg still bills its usage (`AskRunError`, `:101`). |
| Tools | `ask/tools.ts:27`, `:178-300` | **4 read-only tools:** `leak_hero`, `leak_report`, `leak_breakdown`, `claimable_lines`. All are scoped by the server's `restaurantId` (`ToolContext`, `:212-221`) and none takes a tenant id from the model. They return `ScreenLink`s (`/dashboard/...`) and a `Figures` set by unit (`…Ils`/`…Price` → ₪, `…Pct` → %, count; `:36-41`, `:154`). |
| Budgets | `ask/budget.ts` | `ASK_QUESTIONS_PER_DAY = 60` and a ≈ $3/day cost ceiling per restaurant (`:10-12`, in micro-USD). `ASK_BURST_PER_MINUTE = 30` (`:18`). The shared limiter policy `ASK_BURST_LIMIT` has prefix `ask` (`:67`). Token cost estimate at `:20-21`, `:101`. |
| Grounding | `ask/grounding.ts:1-15`, `:223`, `:282` | Keeps only citations whose href a tool produced and whose value matches a tool figure **of the same unit**. Strips URLs, any `label.word` (with defanged variants), IPs, e-mail addresses, markdown links and **phone numbers**, and then flags `grounded: false`. Every number in the prose must match a tool figure, or the answer is flagged. |
| Offline | `ask/offline.ts:18-226` | `CANNED_INTENTS = leakChange, leakTotal, priceRaise, claimWeek, topSupplier`, chosen by regex (`classifyQuestion`, `:33`). It returns **`facts` + `links` for the web to render** (`answer: null`). |

**What this means for a WhatsApp agent.**
- *Reuse as is:* the tenant-scoped tool contract, the reserve-before-spend budget, the grounding post-check (a WhatsApp reply is a worse place for an injected link than the web), and the offline fallback.
- *Gaps:*
  1. **Read-only and leak-only.** There are no tools for the approval queue, orders, receiving, the claim list or close status.
  2. **Roles.** Owner and manager only. A bookkeeper, chef or receiver cannot ask.
  3. **No text rendering offline.** WhatsApp needs a server-side Hebrew text renderer for `facts`, and its ₪ must go through `formatIls()` / G-13 `moneyText` with bidi isolation.
  4. **Screen links are relative** (`/dashboard/...`). WhatsApp needs absolute deep links, and the grounding check currently treats an absolute URL in the answer as an injection signal. Links therefore have to be appended by the server **after** grounding, never written by the model.
  5. **Budgets are per restaurant, not per person.** A chatty manager can spend the owner's 60 questions.
  6. **Write tools do not exist.** Any action tool (approve, draft an order) must be a *proposal* the person confirms with an explicit tap (owner rule). The model never calls a mutation directly.
- *Planned:* W3-04b ("Ask + drafts", ≥ mid-December) and G-12b (#195) own `ask/tools.ts` first.

---

## 4. Identity: who is texting, and in which restaurant

| Item | On `main` 4c887688 | Planned (owner, timing) |
|---|---|---|
| `users.phone varchar(32)` | **Exists** (`schema.ts:181`). **No writer**: it is read only by DSR export (`routers/dsr.ts:89`) and the order document contact (`routers/orders.ts:276`). Not normalised, not unique, not verified. | W2-14 (starts Sat 14.11): profile phone in E.164 (+972), OTP hashed with a 10-minute expiry behind flag `phoneVerify` (off). The write must use the owner connection scoped `WHERE id = session.userId` (the `dsr.ts:45-51` pattern), because `rls.ts:196-201` revokes app-role writes on `users`. |
| `users.phone_verified_at` | Absent | **G-03ʰ** schema batch 0, migration ~0071, merging **Tue 24.11 09:00 IL** (the merge applies it to production). W2-14 switches to the durable column at its γ rebase. |
| `idempotency_keys` | Absent | G-03ʰ. The consumer is **G-05** `withIdempotency(ctx, {key, procedure}, fn)` in `lib/idempotency.ts`, plus `emit` / `registerEffectHandler` domain events. The interim key lives in the audit row's `after.clientMutationId`. Sweep PR 26–29.11 → δ. |
| `users.whatsapp_opt_in` (+ proposed `_at`, `_source`) | Absent | **H-03ʰ** (~0072, same Tue 24.11 merge). |
| `notification_prefs` (per restaurant/user/channel/event_kind; `quiet_start 23:00`, `quiet_end 06:00`, `observe_shabbat true`, `daily_cap 6`) | Absent | H-03ʰ. Its writers are W3-03 and H-05. |
| `push_subscriptions` | Absent | H-03ʰ. |
| Roles | `user_role` = owner, manager, receiver, bookkeeper, chef (`schema.ts:27-33`). `memberships` PK = (user, restaurant, **role**) (`:249-265`), so one person can hold several roles and several restaurants. `preferredLocale` per membership. | — |
| Session shape | `Session { userId, restaurantId, role }`, **one active role** (`context.ts`). `memberProcedureBase` opens a `withRestaurant` transaction and sets `app.current_user_id` (`trpc.ts:98-132`). | — |
| Tier middleware | `owner`, `manager`, `receiver` (+owner/manager), `bookkeeper` (+owner), `chef` (+owner/manager), `invoiceReader` (no chef), `finance` (owner/manager/bookkeeper) (`trpc.ts:147-162`). `approvals.deciderProcedure` = owner/manager/bookkeeper (`approvals.ts:44-53`). | **G-07** (#182; α merges Mon 16.11): `lib/capabilities.ts` `CAP`, `can(cap)`, procedure `meta: { cap }`, split `VISIBLE_TO` vs `ACT_ON`, `money.view`/`price.view`, and a test that walks every procedure. #219 (G-07 pilot redaction) rides train B. **H-11ʰ** (wave 4): server strip of ₪ for the receiver. |
| Supplier WhatsApp | `suppliers.contact_whatsapp varchar(32)` (`schema.ts:434`). wa.me helpers in `orders/order-logic.ts:162` and `s/[token]/logic.ts:171`. | — |

**The identity gap in one line.** Nothing maps an inbound WhatsApp `from` number to a verified `(user, restaurant, role)`. The existing allow-list maps it to a *restaurant channel* (and optionally a supplier), with no person and no role. A WhatsApp agent needs:
- a verified phone (G-03 + W2-14);
- an opt-in (H-03);
- a resolver that refuses an ambiguous number (two users, or a user and a supplier);
- a role/restaurant picker when one person has several memberships, defaulting to the least-privileged role with an explicit switch.

A supplier's number must **never** resolve to a staff session.

---

## 5. Role jobs → agent tools

**How a tool would run.** The agent builds a server-side caller over `appRouter` (`packages/api/src/index.ts:45`) with `ctx = { db, session: { userId, restaurantId, role } }` taken from the verified phone. The call goes through the same tier middleware and RLS transaction as the web. Nothing bypasses RLS, and no tenant id comes from model output.

**Legend.** ₪? = whether the result carries ₪ on `main`. "Web today" = the taps a person makes now.

### 5.1 Owner: morning brief
| Tool | Procedure (type) | ₪? | Web today |
|---|---|---|---|
| Leak hero | `owner.leakHero` (**memberProcedure**, `owner.ts:121`) | yes (leak ₪, % of checked spend, caught, recovered) | `/dashboard` hero |
| Awaiting decision | `approvals.queueSummary` (memberProcedure, `approvals.ts:311`, filtered by `expandVisibleRoles`) and `approvals.myQueue` (memberProcedure, `:185`) | yes (`deltaAmount`) | `/dashboard/approvals` |
| KPIs | `owner.kpis` (memberProcedure, `:115`) | yes | dashboard |
| Leak summary | `owner.leakSummary` (memberProcedure, `:150`) | yes | dashboard |
| VAT at risk | `owner.vatAtRisk` (invoiceReaderProcedure, `:93`) | yes | dashboard card |

There is no `awaitingDecision` procedure on `main`. The brief is assembled from the rows above. W2-04 (#209) reshapes `myQueue` with `canAct`/`waitingOn` (G-07). The end-of-day e-mail (`jobs/endOfDayReport.ts`, 19:00) is the closest existing "brief". A morning WhatsApp brief is a new `cron.ts` slot (H-05/H-05a, human PR), and its delivery goes through `notify()` + quiet hours.

### 5.2 Owner/manager/bookkeeper: approve or claim a gap, with undo
| Tool | Procedure (type) | ₪? | Notes |
|---|---|---|---|
| Approve (accept as a gap) | `approvals.approve` (**deciderProcedure** = owner/manager/bookkeeper, `approvals.ts:377`) | returns the row (₪) | `ensureCanAct` (`requiredRole`); optimistic `checkedRow` → `decidedConflict`; `audit_log` + activity |
| Waive | `approvals.reject` (decider, `:422`) | yes | `reason` required plus `WAIVE_REASON_CODES` |
| Escalate | `approvals.escalate` (decider, `:478`) | — | |
| Undo | `approvals.reopen` (decider, `:514`) | — | **`REOPEN_WINDOW_MS = 15_000`** (`:62`): only within 15 s of the person's own last decision, read from `audit_log` |
| History | `approvals.history` (financeProcedure, `:598`) | yes | |

- *Fit for WhatsApp.* A 15-second undo is too short for a chat round trip. An agent needs "confirm → do → offer undo". Either the window is extended for the channel, or the agent stages the action and commits it only on the person's tap (preferred: the human confirms before anything is written).
- *Replay.* A button tap delivered twice must not decide twice. That needs G-05 `withIdempotency` keyed on the WhatsApp message id, and `idempotency_keys` from G-03.
- *Claims.* The `recovery.*` procedures are `financeProcedure` behind the `recovery` flag (`recovery.ts:26-32`): `summary`, `list`, `history`, `transition` (`:84`, letter sent / acknowledged / disputed / written off / recovered / reopen), `recordCreditNote` (`:109`) and `creditLineSuggestions`.
  - "Overdue" is `OVERDUE_DAYS = CLAIM_ANSWER_DAYS` (`recovery/service.ts:322`, `:66-72`).
  - MISSING_ON_INVOICE must stay out of any "claim this" button. The claimable set comes from the leak tools (`claimable_lines`), which already follow the engine's leak definition. The agent must not compute its own.

### 5.3 "How much leaked at supplier X?"
- Ask tools `leak_report` / `leak_breakdown` (managerProcedure via `ask.ask`).
- Directly: `owner.leakBreakdown` (financeProcedure, `:129`), `owner.leakGrouped` (finance, `:170`), `owner.leakTrend` (finance, `:184`), `owner.leakReport` (managerProcedure, `:210`), and `owner.leaks` / `owner.suppliers` (`advanced_analytics` feature, `:216`, `:232`).
- All return ₪. The web path is `/dashboard/leaks` → breakdown → supplier filter.

### 5.4 Manager decisions
These are the same decider tools as §5.2. Add `ingest.approveDocument` / `rejectDocument` (managerProcedure) for unknown-sender documents and `match.runForInvoice` (managerProcedure, `match.ts:31`). Invoice header and line corrections (`receiving.updateInvoiceHeader` / `updateInvoiceLine`, managerProcedure, `:610`, `:693`) are web-only work and poor chat material.

### 5.5 Chef: "order like last week from supplier Y"
| Tool | Procedure (type) | ₪? | Notes |
|---|---|---|---|
| Past orders | `orders.list` / `orders.get` (memberProcedure, `orders.ts:337`, `:390`) | yes (prices) | **any member, receiver included, reads PO prices on `main`** |
| Draft | `orders.createDraft` (**chefProcedure**, `:457`) | yes | `lines` 1–500; `assertSupplierOwned` |
| From text | `orders.captureFromText` (chefProcedure, `:744`) | yes | flag `orderCapture`; same parser as WhatsApp intake |
| Edit lines | `updateOrderLine` / `deleteOrderLine` / `cancelOrder` (chefProcedure) | yes | |
| Send | `orders.placeOrder` (chefProcedure, `:878`) | — | `channel: 'email'|'whatsapp'|'none'`; only `draft` can be sent |
| State | `orders.sendStatus`, `guardrail`, `supplierMessagePreview` (memberProcedure) | partly | |

- **No "order guide / repeat last week" on `main`.** W2-06 (#184) adds `orders/guide.ts` (the median of the last 4 of 8 POs, **chef output with no price keys**), `drafts.ts` and `manualSend.ts` ("send from my own WhatsApp"). AU-11 (W3-09 addendum) adds the cut-off draft builder.
- **Owner rule clash.** `placeOrder` with `channel: 'whatsapp'` enqueues a message *to the supplier* through the outbox. Through an agent that is "send to supplier", and it must only ever follow an explicit tap by the chef or manager on a shown draft. W2-06's "send from my WhatsApp" (wa.me hand-off, nothing queued by us) is the safer default.
- The chef sees ₪ on orders (owner rule), so prices in an order draft to the chef are allowed. Prices in anything else the chef receives (leak, approvals) are not.

### 5.6 Receiver: photo at the door (no ₪)
| Tool | Procedure (type) | ₪? |
|---|---|---|
| Upload | `scans.upload` (memberProcedure, `scans.ts:36`; base64, `clientUploadId` dedupe) | no |
| Today's deliveries | `receiving.todayExpectations` (memberProcedure, `:88`) | check: PO-derived |
| Count | `receiving.startReceipt` / `markGrLine` / `submitReceipt` (receiverProcedure, `:750`, `:863`, `:933`) | no (quantities) |
| Register invoice | `receiving.registerInvoice` (receiverProcedure, `:1013`) | — |
| OCR poll | `receiving.getInvoice` (**invoiceReaderProcedure**, `:521`) | **yes**; `trpc.ts:152-158` says "stripping ₪ fields for the receiver is H-11" |

- A WhatsApp photo from an allow-listed receiver number **already** becomes an OCR job (§1.3); the agent only adds a no-₪ acknowledgment.
- On `main` a receiver session can read `owner.leakHero` (memberProcedure). A receiver-facing agent needs a server-side output filter (H-11 / G-07 `money.view`), not a prompt instruction.

### 5.7 Bookkeeper: close status and exports
- `exports.invoicesCsv` and `exports.uniform1000` (`exportProcedure` = bookkeeperProcedure + `accounting_export`, `exports.ts:23-77`). These are files, not chat answers, so the agent sends a link, not the file.
- `payRun.enabled` / `payRun.month` (financeProcedure, `payRun.ts:164-166`).
- **`close` and `tasks` routers are empty stubs** (`routers/close.ts:10`, `routers/tasks.ts:10`). The close checklist is W3-05a (`routers/close.ts`, ~23.11). Export run logs (`export_runs`) come with W2-14/W3-05b after H-03 is deployed.
- `ask` is managerProcedure, so the bookkeeper cannot use Ask today.

### 5.8 Supplier confirmation link and claim letters
- **Supplier confirmation:** `supplierConfirm.createLink` (managerProcedure, `supplierConfirm.ts:15`; flag `supplierConfirm`) returns `/s/<token>`, only for a sent PO. `responses` (memberProcedure, `:29`) shows the supplier's answer. The public answer route is `apps/web/app/api/supplier-confirm/[token]/route.ts` (no session, token = credential, `guardPublicRequest`, per-IP + per-token-hash limit 10/10 min). The page (`app/s/[token]/page.tsx:74`) offers a wa.me reply.
- **Claim letters:** they are built in the **web client** (`apps/web/app/dashboard/leaks/claims/{letters,letter-actions}.tsx`) and the owner sends them by hand (copy / wa.me / mail). There is no server send.
- **Planned:** H-06ʰ adds the server send and a 72 h claim portal (`app/s/c/**`, `api/claims/**`, `claimPortal/**`; public attack surface, human PR).
- An agent may *prepare* a letter and hand the owner a wa.me link. It must never send to a supplier itself.

---

## 6. Gaps, and the immutable files a WhatsApp agent would touch

### 6.1 Functional gaps (in build order)
1. **Phone identity.** Verified phone → (user, restaurant, role) resolver; ambiguity refusal; supplier/staff separation; multi-membership picker. Depends on G-03 + W2-14 + H-03.
2. **Conversation webhook.** Today's webhook is per-restaurant-token and intake-only. An agent number shared across tenants needs a webhook where the tenant comes from the *verified sender*, not the URL. It must parse `interactive`/`button` replies and record status callbacks (delivered/read/failed) against outbox rows. Voice notes are a later, separate decision.
3. **Replies inside the service window.** `WhatsAppCloudNotifier` sends text only. An agent needs template sends (outside 24 h), interactive buttons (confirm/undo), and a per-conversation window tracker (last inbound time).
4. **Action safety.** A stage → confirm → commit pattern for every mutation. `withIdempotency` keyed on the provider message id (G-05). An undo window that survives a chat round trip (`REOPEN_WINDOW_MS` is 15 s). An audit `source: 'whatsapp'` on each decision.
5. **Role-safe output.** A server-side redaction pass on every tool result before the model or the template sees it: receiver no ₪; chef ₪ only for orders/recipes. G-07 `money.view` + H-11. The Ask grounding check guards *figures*, not *who may see them*.
6. **Ask widening.** Tools for queue, orders, receiving, claims and close. Bookkeeper/chef/receiver access through capabilities. Per-person budgets. Text rendering of offline facts with `formatIls()`/`moneyText`. Absolute deep links appended after grounding.
7. **Delivery hygiene and cost.** `notify()` audiences (G-06), quiet hours 23:00–06:00 + Shabbat and ≤6 alerts per person per day (H-03 + H-05). Whether replies to a person who just wrote count against the alert cap is an owner decision. Meter every send on `whatsapp_sends` with a daily cap per restaurant; keep digests transactional (utility, not marketing).

### 6.2 Immutable / human-PR files the agent would need
| File (AGENTS.md list) | Why the agent needs it | Route |
|---|---|---|
| `packages/api/src/notifications/outbox.ts` | Template name + variables, interactive payloads, `skipped`/delivered status, per-person counting | H-05ʰ (wave 3); an agent addendum like H-05a |
| `apps/worker/src/cron.ts` | Morning brief slot, window-expiry sweep, claim-overdue (7 days) nudges | H-05ʰ / H-05a pattern |
| `packages/db/src/schema.ts` + new migrations | `whatsapp_conversations` (sender, user, restaurant, role, `last_inbound_at`), staged actions, delivery receipts; RLS for each | Its own schema PR after G-03/H-03 (24.11); merge = production deploy, 2nd human gate |
| `packages/db/drizzle/rls/0002_core_tenant_rls.sql`, `packages/db/src/rls.ts` | RLS for the new tenant tables; the phone resolver needs a SECURITY DEFINER lookup like `app.ingest_resolve_channel` | tenant-security-warden + human |
| `packages/api/src/__tests__/cross-tenant.attack.test.ts` (COVERAGE) | Add-only entries for any new procedure (for example `agent.*`) | Add-only, allowed for agents; never weaken |
| `apps/web/lib/rateLimit.ts` | A per-sender / per-conversation limit store for the new webhook | Human PR, if the existing `guardPublicRequest` options are not enough |
| `apps/web/app/api/trpc/[trpc]/route.ts`, `routers/leads.ts` | Not needed: the agent should use a server-side caller, not the public tRPC route | Do not touch |
| `packages/api/src/approvals/engine.ts` | Not needed: the agent reads `requiredRole`, never the thresholds | Do not touch |
| `packages/matching/**` | Not needed: leak ₪ comes from the existing tools | Do not touch |
| New webhook route (`apps/web/app/api/whatsapp/agent/**` or similar) | New public attack surface. Same guard order as `ingest/http.ts`, plus an attack suite | Human PR (as with H-06) |
| Meta app secret, system-user token, phone-number id, template approvals | Phase-6 credential intake | Human only |

### 6.3 Owned by other packages (not immutable)
`notifications/{recipients,templates,whatsapp*,factory}.ts` (G-06 → H-05), `ask/**` (W3-04b, G-12b), `ingest/**` + `routers/ingest.ts` (W3-11), `orders/**` (W2-06 → W3-09), `lib/{roles,capabilities}.ts` + `trpc.ts` (G-07). An agent package starts after these merge, or adds new files and consumes them read-only.

---

## 7. Seams I would build on (non-binding)

- **Brain:** `runAsk` with a `channel: 'whatsapp'` option, a text renderer for offline facts, and links appended after grounding.
- **Hands:** *proposal* tools that return a staged action plus a button. The commit is the existing tRPC mutation, run under the person's own session after their tap, through G-05 `withIdempotency`.
- **Ears:** a new conversation webhook reusing `verifyMetaSignature`, an extended `parseWhatsAppWebhook` and the http.ts guard order. Media from a verified receiver goes into the **existing** `processInboundMessage`.
- **Mouth:** G-06 `notify()` + H-05 templates for anything proactive; free-form only inside an open window, metered.
- **Gate order:** redaction (G-07 + H-11) and verified phone + opt-in (G-03/H-03 + W2-14) before any non-owner role. An owner-only, read-only pilot needs G-03/W2-14/H-03, G-06, H-05 templates and credentials.

**Assumptions stated.** Line numbers are against `4c887688`. The double-send race (§2.3 item 2) is inferred from code, not reproduced. WhatsApp prices are secondary-source, as labelled in `ext-02`. The plan dates are from the 7.11 programme plan and may move.
