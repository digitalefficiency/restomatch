# WhatsApp agent track (WA): the shared playbook (read this first, once)

## 0. You are here
- You are **one WhatsApp-agent package session (WA-xx)** for RestoMatch: a Hebrew-first, RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli independent restaurants (owner-operators, 1–3 branches). Next.js 15 in `apps/web`, tRPC in `packages/api`, Drizzle + Postgres RLS in `packages/db`, jobs in `apps/worker` (schedules in the immutable `apps/worker/src/cron.ts`).
- **Your brief is `docs/ux/whatsapp-agent/WA-xx.md`.** It holds your write boundary, dependencies, interims, acceptance list, tests and line pointers. This README is the contract shared by all WA sessions. On package specifics the brief wins; `AGENTS.md` wins over both; the automation playbook (`docs/ux/automation/README.md` §1–§6, AU track) and the wave-2 playbook (`docs/ux/wave2/README.md` §2, §3, §7, §8, §12–§13) bind wherever this file is silent.
- **The design is authoritative:** `docs/research/סוכן וואטסאפ/notes/10-design-and-plan.md` (§A policy, §B role jobs and Hebrew copy, §C safety, §D architecture, §E cost, §F plan, §G competition). The code map is `notes/int-01-code-map-whatsapp.md` (baseline `4c887688`; your brief's §1 re-verified the lines on `main` with train A). **Never read the notes whole:** your brief cites sections; read ±30 lines.
- **The orchestrator is session `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns work, answers boundary questions, integrates and merges. You build one package on one branch and open a **draft** PR.
- **What this track is.** A thin, role-scoped WhatsApp layer over procedures that already exist (or that a W2/G/W3/H/AU package is building). It **credits and never duplicates**: Ask is the brain (G-12b, AU-06, W3-04b), G-06 `notify()` + H-05ʰ are the mouth, the ingest pipeline is the ears, G-05 `withIdempotency` guards the hands, G-07 + H-11ʰ redact ₪. A WA package builds only the WhatsApp delta and names the item it builds on in its PR body.
- **What it is not.** Not a general chatbot ("ask our AI anything" is forbidden positioning, design §A.3), not a supplier channel (nothing is sent to a supplier from our number), not a second notification pipe, not a second quiet-hours rule, not a second Ask engine.

## 1. First 10 minutes (checklist)
- [ ] `AGENTS.md` is auto-loaded. Read it: immutable list, ownership map, money facts.
- [ ] Read this README, then your brief §1–§3 and §5. The rest when you reach that work.
- [ ] `sed -n 1,40p STATE.md` (top section only).
- [ ] `git fetch origin main && git switch -c claude/wa-xx-<slug> origin/main` (exact name in your brief §3). Human-PR proposals use `claude/wa-xx-hpr-<slug>`.
- [ ] Check dependencies: `git log --oneline origin/main | grep -E '<ids from brief §3>'`. If a hard one has not merged, build against the interim your brief names and say so in your first message.
- [ ] Lab in the background: `bash docs/ux/wave2/lab.sh WA-xx <3800+NN> --tests-only` (slug `wa_xx`; e2e = port+100, stub = port+50). Prefix DB commands with `. ~/.rm-lab/wa_xx/env &&`.
- [ ] Run your brief's targeted tests green **before** changing anything. Red on clean `main` is not yours: say so.
- [ ] One QUESTION message with all day-1 requests (path additions, flag keys, `AuditAction` values, `api/index.ts` export lines).

## 2. Quality bar (WhatsApp-specific; every package, enforced in review)
DoD-1..9 of the wave-2 README apply to any screen (WA-04's connect page, WA-11's automations row). On top:
1. **Confirm + undo + audit + idempotency for every money effect.** The model only *proposes* a typed action. The server re-reads the row, computes the ₪ itself (integer agorot), stores a staged action (single-use token, 30-min expiry, payload hash) and sends a button whose title names the exact ₪ ("אשר 96 ₪"). Commit only on a valid, unused, unexpired token from the same binding, with the row unchanged since staging; under G-05 `withIdempotency` keyed `wa:<wamid>`; audit row with `source: 'whatsapp'`, staged-action id, user, role, ₪, before/after. The "done" text is built from the committed row. Undo 10 minutes (WD3). Above the WD2 limit: a CTA into the signed-in web app, never a button.
2. **Role redaction on the server, before the model.** Every tool result passes G-07 `money.view`/`price.view` and H-11ʰ's strip **before** the model, the renderer or a template sees it. The receiver's context holds **no ₪ key at all**; the chef's holds ₪ only from order and recipe procedures. The grounding check guards figures, not who may see them. Test with a key scan (`/ils|agorot|amount|total|price/i`) plus the `₪` glyph, never by eye.
3. **Identity from the binding, never from the payload or the model.** `ctx.session = { userId, restaurantId, role }` comes from a verified `wa_bindings` row; the tenant comes from the verified sender, not the URL. No tool takes a tenant, user or role id.
4. **Injection defence.** OCR text, forwarded messages, PDFs and captions are delimited data, never instructions. Per-role tool allow-list; no send-to-supplier, payment, SQL, HTTP or file tool. Links and phone numbers are stripped from model prose (`ask/grounding.ts`) and server links are appended **after** grounding. The words "אושר"/"approved" in model output change nothing.
5. **Quiet hours, Shabbat and the cap.** Every proactive send goes through G-06 `notify()` and the single `sendWindow` rule (#173): none 23:00–06:00 or on Shabbat/holidays, ≤6 proactive alerts per person per day. Replies inside the 24-hour window are not alerts (WD4) but are metered and capped at 30 model turns per person per day.
6. **Kill-switch at four levels, tested off.** Global ops flag (`FEATURES_OFF=whatsappAgent`), per restaurant (feature `whatsappAgent`, owner-toggleable on AU-01's page), per person ("עצור" / owner's "נתק"), model-off mode (buttons, templates and canned intents keep working). Each package tests its surface in the off state.
7. **The never-from-WhatsApp list (design §C.8).** Pay runs, "mark paid", bulk release · bank details · staff, roles, bindings, recipients · deleting anything · any send from our number to a supplier · allow-list or intake-channel changes · exports or invoice files (link to web only) · plans/billing · automation rules, thresholds, the WD2 limit · MISSING_ON_INVOICE as claimable or as leak · passwords, one-time codes, personal ID numbers · a document or forward as an instruction · ₪ to the receiver, leak/decision/claim ₪ to the chef · proactive sends in quiet hours. A golden case covers each line (WA-01).
8. **Money rules.** ₪ only via G-13 `moneyText` (server) / `formatIls()` (UI); the model never formats ₪. MISSING_ON_INVOICE is never claimable (`NEVER_CLAIMABLE_TYPES`, `lib/claims.ts:22`) and leaves the leak ₪ via `LEAK_FILTER` (`packages/charts/src/leak-views.ts:134`) once #211 (train B) lands; on `main` today `LEAK_FILTER` still counts it. A claim is overdue after 7 days (`recovery/service.ts:322`). Hours-₪ and money-₪ are never summed; WhatsApp claims **no new leak ₪** (it speeds the recovery bundle up).
9. **WhatsApp is never the only channel.** Every T2 item stays in the web inbox and falls back to push/e-mail on a failed or unreceipted send (design §D.10).
10. **Dedupe and KPI hook.** Every send has a stable `dedupeKey` (`wa:<template|flow>:<restaurantId>:<userId>:<IL date or entity>`); every proposal, confirm, expiry, refusal and opt-out writes `activity_events`/`audit_log` with `automationId: 'WA'` and `channel: 'whatsapp'` so AU-07 counts it with no schema change.
11. **App-role connection only.** Agent turns and WA-07 commits run on the app-role connection (`DATABASE_URL_APP` / `resolveWebDbUrl`), also when called from `/api/cron/jobs`; the owner connection is used only inside named `SECURITY DEFINER` functions. Test: `current_user = restomatch_app` inside a tool call and inside a commit. Each message is processed in its own `withRestaurant` transaction; group-context messages are ignored.
12. **Identity re-checked every message.** `activeContext()` re-reads `memberships`, `users.phone`, `phone_verified_at` and `tokenVersion` on every inbound message and again inside the commit transaction; any failure suspends the binding. Revoke on: phone changed/unverified, `tokenVersion` bump, admin set, DSR erasure, restaurant deletion, a Meta number/identity-change event (SIM swap; field names unverified → suspend until re-confirmed on the web). Owner e-mail/push on every new binding (and every WhatsApp money decision, WD11).
13. **Forwards and taps.** Parse `context.forwarded` / `frequently_forwarded` / `context.id` (field names unverified); forwarded content takes a data-only path. A tap is accepted only when `context.id` equals the outbound wamid that carried its token.
14. **Rate limits never drop signed traffic.** Per-IP limits count HMAC failures only (or a much higher ceiling for verified traffic); never 429 a valid signed delivery; per-sender limits run after verification; the Ask DB budget (fails closed) is the hard cost cap. Load-test N status callbacks/min.
15. **Templates and variables.** Templates carry counts + a deep link, no ₪ and no supplier names. Every template/interactive variable passes the link/phone sanitiser plus a length cap (golden case: a supplier named "www.x.co.il 054-…").
16. **Kill switch is fast.** A DB-backed ops flag cached ≤ 30 s, checked by the webhook, the agent loop and the dispatcher; `FEATURES_OFF` (needs a redeploy) stays as the backstop; the runbook also lists disabling the webhook in the Meta app.
17. **Quiet hours = WD4, no exceptions in v1.** Anything not sent inside the user's own turn is proactive. WA-06ʰ is gated on #173 (`sendWindow` is not on `main`). A per-person rest day is a lawyer item.

## 3. Merge protocol and communication
- Draft PR titled `wa(WA-xx): <title>`; body sections as the AU README §5 (Acceptance · Evidence · Builds on · Owner decisions applied · Off switch · KPI hook · Placeholders · Path additions · API for dependents · Human-PR proposals).
- Every new tRPC procedure: an add-only fragment `packages/api/src/__tests__/coverage/WA-xx.ts` + a cross-tenant attack test. Never weaken an assertion.
- Self-repair cap **2**; on the third CI failure send BLOCKED and stop.
- **Never merge, deploy, write to a production DB, send real WhatsApp or e-mail, call Meta, or spend money.** No Meta credential exists in the repo; tests use the mock notifier and recorded model responses. No model identifiers in docs, commits or PR text ("the latest Claude models" only).
- One message per event to `session_015veCjPjLCiZbqnYFJpdzvR` via `send_message`: `[WA-xx] GREEN|BLOCKED|QUESTION · PR #<n> · <≤3 lines>`. No progress chatter.

## 4. Immutable files this track presses on (human-authored PR only)
`notifications/outbox.ts` + `apps/worker/src/cron.ts` (→ **WA-06ʰ**, an H-05 addendum) · `schema.ts`, migrations, `rls/0002`, `rls.ts`, `rls.attack.test.ts` (→ **WA-03ʰ**) · a new public route + `apps/web/lib/rateLimit.ts` if needed (→ **WA-05ʰ**) · `cross-tenant.attack.test.ts` COVERAGE (add-only) · `OPERATING.md` runbook (→ WA-11, human-written). **Not touched by any WA package:** `approvals/engine.ts`, `packages/matching/**`, `leads.ts`, `app/api/trpc/[trpc]/route.ts`, `plans.ts`/`billing` (WD7 would be an H-10-style human PR). Procedure: proposal branch, draft PR `HUMAN-PR proposal (WA-xx): …`, one message, stop that part, build the rest behind the interim.

## 5. Ownership ledger (who may edit what; anything not listed is read-only: ask first)
`api/` = `packages/api/src/`. Every package also owns its `coverage/WA-xx.ts` and the tests its brief lists.

| Pkg | Owns | Hands back after merge |
|---|---|---|
| WA-00ʰ | `apps/web/app/api/whatsapp/pilot/**` (route), `api/agent/pilot/**` (handler + tests); consumes Ask and owner/approvals/recovery read procedures, edits none | deleted by WA-05ʰ |
| WA-01 | `api/agent/__tests__/golden/**` (cases), `api/agent/__tests__/sim/**` (simulator), `api/agent/__tests__/recorded/**` | golden set stays with test-sentinel |
| WA-02 | `api/agent/{index,router,registry,redact,render,links,budget,prompt}.ts`, `api/agent/tools/**`; `ask/**` only as a W3-04b addendum line (`channel` option) | `agent/**` core → WA-07/08 add files only |
| WA-03ʰ | `packages/db/src/schema.ts` (4 tables), one migration, `rls/0002` list, `rls.ts`, `rls.attack.test.ts` (add-only probes) | schema → H-lane owner |
| WA-04 | `api/agent/identity/**`, `api/routers/whatsapp.ts` (pre-registered empty); asks for a carve-out of `apps/web/app/dashboard/settings/whatsapp/**` after W3-07a-2 + W4-01 (read-only until then) | settings page → W3-07a's successor |
| WA-05ʰ | `apps/web/app/api/whatsapp/agent/**`, `api/agent/http.ts`, `api/__tests__/wa-webhook.attack.test.ts`; **ask first:** `packages/ingest/**` is unowned, so the orchestrator grants the additive `payloads.ts` parse and the one orchestrator-serialised `publicPaths.ts` line | `payloads.ts` → ingest owner |
| WA-06ʰ | `api/notifications/**` incl. `outbox.ts`, `apps/worker/src/cron.ts`, `jobs/outboxDispatch.ts` (inside H-05's paths) | → H-05 owner |
| WA-07 | `api/agent/actions/**`; the WhatsApp undo window in `api/routers/approvals.ts` (one constant + one branch, after W3-01 releases it) | `approvals.ts` → W3-01 owner |
| WA-08 | `api/agent/flows/{owner,manager,bookkeeper}/**`, `apps/worker/src/jobs/waOwnerBrief.ts` (new) + its `handlers.ts`/`index.ts` lines | — |
| WA-09 | `api/agent/flows/chef/**` | — |
| WA-10 | `api/agent/flows/receiver/**` | — |
| WA-11 | `api/agent/ops/**`, one AU-01 registry row, one `features.ts` key, `docs/COSTS.md` line (leak-economist) | — |
| WA-12ʰ | none (credentials and legal text; human only) | — |

**Shared one-liners:** `api/index.ts` exports and the `whatsapp` router line are orchestrator-serialised (one pre-registration PR, as the AU routers); `FEATURE_KEYS` gets `whatsappAgent` once (WA-11 owns it; WA-02 uses the interim `aiAssistant` check until then).

## 6. Start order, dependency map and the shared session cap
**Cap (binding).** WA sessions count **inside the AU allowance, inside the programme's 8 build slots**: AU + WA ≤ 2 sessions at once until 3.12 and ≤ 3 from 3.12 (programme plan §2 and §3 AU cap; counting WA inside it is this track's proposal, the programme plan does not name WA). No WA session and no WA decision before the Sat 14.11 usage reset; no WA build session before 7.12. In W-h a WA session takes an AU slot only when one is truly idle, never ahead of AU-06/AU-10. The pilot always preempts. **Everything WA below is a proposal: not in the programme plan.** A human-PR session frees its slot once its proposal is drafted. Under the WARNING pause order, WA pauses **with** AU (first). **Lanes (programme plan §6.4):** Ask after W3-04b (W3-γ 31.12, deploy Tue 5.1) · orders after W3-09 (W3-β) · ingest after W3-11 (W3-δ 14.1) · delivery after H-05ʰ (deploy Tue 19.1). **Wave 4 (17.1–30.1): W4-01 holds `apps/web` solo** → WA work is server-only; the connect page and the webhook route file land ≥31.1. Schema (WA-03ʰ) queues after H-13ʰ as migration 0075 (renumbered at merge) on its own deploy Tuesday (≥ Tue 9.2, backup + second gate); WA-06ʰ and the WA server PRs go after H-09ʰ.

| Window | WA sessions (inside AU+WA ≤3) | Notes |
|---|---|---|
| ≥ Thu 12.11 | **WA-12ʰ** owner-only steps 1, 2, 7 (human, no slot) | Meta verification, number, lawyer pack: weeks elapsed |
| W-h 7.12 → 20.12 | ✱WA-00ʰ draft (human author), only in a truly idle AU slot | WA-00ʰ only consumes `ask.ask` (no `ask/**` edit); WA-01 PR a lands in γ or later, by orchestrator decision only |
| Thu 17.12 merge (W3-α) → Tue 22.12 deploy, or Tue 5.1 with W3-γ | WA-00ʰ live: **RestoMatch owner on lab data only** | needs orchestrator + owner OK + a named reviewer; deploy outside the 09:00 schema window. Pilot-owner data only after WA-12 steps 6–7 (legal basis) |
| W-i/W-j 5.1 → 30.1 | ✱WA-02 (Tue 5.1) · WA-03ʰ draft · WA-04 + WA-07 server · WA-06ʰ draft (after H-05 merges) · WA-05ʰ server half | **server only** after 17.1 |
| ≥ Tue 9.2 (own deploy Tue) | WA-03ʰ merge (after H-13ʰ, migration 0075) → WA-06ʰ + WA-02/04/07 server after H-09ʰ | backup + 2nd gate |
| Feb 2027 (after 9.2) | WA-05ʰ route, WA-04 web, ✱WA-08 (owner read-only E3 → decisions E4 a week later), ✱WA-11 | E3 ~late Feb |
| Mar–Apr 2027 | ✱WA-09 · ✱WA-10 (≥2 weeks after H-11ʰ is in production) | E4 Mar, E5 Mar–Apr |

```
WA-12ʰ (≥12.11, human) ────────────────────────────────────────────┐ (E2 needs step 1; E3 needs all)
AU-06 + G-12b + W3-04b + G-07 + G-13 ─→ WA-02 ─┬─→ WA-07 ─┬─→ WA-08 ─→ WA-11 ─→ WA-09 (W3-09 + AU-11 ⇢)
WA-01 (Dec, fixtures) ─⇢ runs on WA-02 ─────────┘          │            └─→ WA-10 (H-11ʰ prod ≥2 wks, W3-03)
G-03ʰ + H-03ʰ + H-04 CHECK ─→ WA-03ʰ (2.2) ─→ WA-04 ─→ WA-05ʰ (W3-11) ─┘
H-05ʰ + H-05a + AU-04 + AU-12 ─→ WA-06ʰ ─→ WA-08
```

## 7. Package index
| ID | One line | Owner agent | Effort | Phase | ʰ |
|---|---|---|---|---|---|
| [WA-00ʰ](WA-00.md) | December pull-only owner pilot: "בוקר" brief + Ask, read-only, env allow-list, in-window replies only; deleted by WA-05ʰ | web-feature-engineer + human | S–M | ≥7.12, live ≈22.12 | **yes** |
| [WA-01](WA-01.md) | ≥80 Hebrew golden conversations (≥20 adversarial) + the WhatsApp simulator | test-sentinel | M | WA-A, ≥7.12 | no |
| [WA-02](WA-02.md) | Read-only agent core on Ask: role tools, server redaction, Hebrew renderer, links after grounding, per-person budgets | web-feature-engineer | L | WA-B, 5.1 → deploy 2.2 | no |
| [WA-03ʰ](WA-03.md) | Schema + RLS: bindings, conversations, staged actions, message log, sender resolver | tenant-security-warden + human | M | WA-C, merge Tue 2.2 | **yes** |
| [WA-04](WA-04.md) | Phone onboarding: wa.me code, opt-in + AI notice, re-verify, revoke, role/restaurant switch | web-feature-engineer | M | WA-C; web ≥31.1 | no |
| [WA-05ʰ](WA-05.md) | Public conversation webhook, extended parser, attack suite | ocr-procurement-engineer + human | M | WA-D, after 2.2 | **yes** |
| [WA-06ʰ](WA-06.md) | H-05 addendum: message kinds, role-checked templates, status, 24-h window, cap, 07:30 + sweep, fallback | human (+ ocr-procurement-engineer draft) | M | WA-C, deploy 2.2 | **yes** |
| [WA-07](WA-07.md) | Money actions: stage → amount-named confirm → idempotent commit + audit; 10-min undo; step-up | web-feature-engineer | M–L | WA-C/D | no |
| [WA-08](WA-08.md) | Owner/manager/bookkeeper flows: brief, decision cards, leak by supplier, claim hand-off, late truck, digest, close, export link | web-feature-engineer + ocr-procurement-engineer | L | WA-D, Feb | no |
| [WA-09](WA-09.md) | Chef: "like last week" → draft → own-WhatsApp send; cut-off reminder | web-feature-engineer | M | WA-E, ~Mar | no |
| [WA-10](WA-10.md) | Receiver, no ₪: photo at the door → count → mismatch to the manager | ocr-procurement-engineer + web-feature-engineer | M | WA-E, ≥2 wks after H-11 | no |
| [WA-11](WA-11.md) | Ops: kill-switch levels, AU-01 row, AU-07 metrics, cost meter + cap, COSTS line, runbook | web-feature-engineer + leak-economist | M | WA-D | partly |
| [WA-12ʰ](WA-12.md) | Phase-6 human setup: Meta, number, PIN, templates, payment, AI-provider terms, privacy pack | the owner (human only) | S (weeks elapsed) | now | **yes** |

## 8. KPIs (AU-07 telemetry; baselines in the 2 weeks before E3)
- **Adoption:** share of owner/manager gap decisions made from WhatsApp **≥50%** by week 4 of E4; brief recipients who act the same day **≥40%**.
- **Speed:** median gap created → decided **<24 h** on weekdays; median days leak found → claim letter sent **halved** vs baseline; letter → credited tracked (no target yet).
- **Hours-₪ (ASSUMPTION, never summed with money-₪; overlaps with AU-04/06/12 not additive):** owner 0.5–1 h/week (₪225–445/month), manager 0.5–1 (₪225–445), chef 0.25–0.5 (₪135–275), receiver 0.25–0.5 (₪70–135), bookkeeper 0.1–0.25 (₪40–95).
- **Money-₪:** none of its own; the recovery bundle (catalogue A12, central ≈ ₪540/month) arrives faster. Measured in days.
- **Cost (a COSTS.md line, never netted against leak):** ≈ ₪24/restaurant/month typical, ₪8 light → ₪62 heavy at 10 restaurants (₪15–₪65 at the 3-restaurant pilot, ₪7–₪61 at 100) (ASSUMPTIONS, `notes/30-cost-model.md`, which supersedes design §E; not a hard ceiling: model spend is bounded by the restaurant's ≈ $3/day Ask budget, ≈ ₪333/month at 30 days, metered at the top-tier rate).
- **Safety (hard, weekly):** 0 ₪ fields in a receiver turn · 0 leak/decision/claim ₪ to a chef · 0 commits without a token tap · 0 messages from our number to a supplier · 0 cross-tenant reads · grounding failures <2% · delivery success ≥98% · opt-out <10% · 0 templates re-categorised.

## 9. Owner decisions (build to the recommended default until the owner answers, except WD2, which is decided and binding)
- **WD1 · Number and route:** one shared RestoMatch number, direct Cloud API; 360dialog only if Meta onboarding stalls.
- **WD2 · Money by tap: DECIDED (binding owner rule: one-tap WhatsApp approve at ₪500 per item; wave-2 README §7 and review decision #10).** A tap commits only when ALL hold:
  1. the role passes the engine's `requiredRole`: a manager only on manager-routed items (₪50–300 cumulative per invoice / 2–5%, or `approvalThresholds`); the owner on owner-routed items and every block; the bookkeeper per `DECIDER_ROLES`; receiver and chef never;
  2. claimable ₪ ≤ ₪500, computed by the server and named on the button: W2-04's `ONE_TAP_APPROVE_CAP_AGOROT` (PR #209, `bulkPolicy.ts`), imported; WA defines no constant of its own;
  3. not a block, never bulk;
  4. the server refuses > ₪500 or a block even with a valid token;
  5. a waive that releases an invoice (`payRun.ts:14-23` hold → pay): the confirm shows the released invoice total; proposal for owner OK: the cap applies to max(gap, released invoice);
  6. unknown-document approval and DUPLICATE "not a duplicate" are web-only in v1;
  7. anything else → CTA "לאישור באפליקציה", no token;
  8. never from WhatsApp: payments, pay runs, mark paid, bulk release, allow-list/intake changes, cap changes. AU-01 overrides may only LOWER the cap;
  9. undo 10 min (WD3); a credit note has no undo, so corrections on the web only; the undo must pass `approvals.reopen`'s audit check.
  Commit via `approvals.approve` / `reject` with `channel: 'quick'`.
- **WD3 · Undo:** 10 minutes for WhatsApp-originated decisions (web keeps 15 s).
- **WD4 · What counts as an alert:** only proactive sends count toward 6/day and quiet hours; replies don't, but ≤30 model turns/person/day. No quiet-hours exceptions in v1.
- **WD5 · Owner brief:** 07:30 Sun–Fri, skipped when nothing waits, on a new `cron.ts` line (WA-06ʰ); or ride 06:00 with `scheduled_at` 07:30.
- **WD6 · Rollout:** owner read-only → owner decisions → manager → bookkeeper → chef → receiver (after H-11 has run 2 weeks in production).
- **WD7 · Packaging:** in Pro and Chain; Basic gets alert templates only. Any plan change is an H-10-style human PR.
- **WD8 · Model tier and budget:** a small tier of the latest Claude models for routing and simple reads, the top tier for complex requests; 30 turns/person/day inside the restaurant's 60-question, ≈$3/day Ask budget.
- **WD9 · Retention:** text 30 days, media 90, traces 90, outbound log 13 months; ask the lawyer about Meta's "no storage" mode.
- **WD10 · December pull-only pilot (WA-00ʰ):** yes: read-only, the RestoMatch owner on lab data first; the pilot owner only after WA-12 steps 6–7 (transfer basis, DPA/sub-processors, the AI provider's no-training terms); a reply path beside the outbox that WA-05ʰ deletes; or wait for E3 in February.
- **WD11 · Daily totals (OPEN):** a per-person WhatsApp money cap (≤ ₪1,500 a day, or none); a per-restaurant daily WhatsApp ₪ cap; and an owner e-mail/push for every WhatsApp money decision and every new binding (anti SIM-swap). Recommendation: a per-restaurant daily cap plus the owner notice on every money decision and binding.
- **Defaults (not decisions):** voice notes are not in v1; WA-12ʰ owner-only steps 1, 2 and 7 start ≥ Thu 12.11. WD1, WD3–WD11 go to the combined owner decision page after Sat 14.11.

## 10. Updates from the orchestrator
(none yet)
