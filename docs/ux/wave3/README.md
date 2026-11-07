# Wave 3 automation track: the shared playbook (read this first, once)

## 0. You are here
- You are **one automation package session (AU-xx)** for RestoMatch: a Hebrew-first, RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli restaurants. Next.js 15 in `apps/web`, tRPC in `packages/api`, Drizzle + Postgres RLS in `packages/db`, the engine in `packages/matching`, jobs inside Vercel at `/api/cron/jobs` (schedules registered in `apps/worker/src/cron.ts`, reused by `apps/worker/src/serverless.ts`).
- **Your brief is `docs/ux/wave3/AU-xx.md`** (new; one per package). It holds your write boundary, dependencies, interims, acceptance list, tests and line pointers. This README is the contract shared by all AU sessions. On package specifics the brief wins; `AGENTS.md` wins over both; the wave-2 playbook `docs/ux/wave2/README.md` (§7, §8, §12, §13) binds wherever this file is silent.
- **The orchestrator is session `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns work, answers boundary questions, integrates, reviews and merges. You build one package on one branch and open a **draft** PR.
- **What this track is.** The AU packages are the **automation layer** on top of the existing plan. `docs/ux/IMPLEMENTATION-PLAN.md` §4 already sketches wave 3 (W3-01..W3-11) and the human-PR track (H-04..H-11); wave 2 (`docs/ux/wave2/`) is in flight. AU packages **credit and never duplicate** W2/G/W3/H items: they wire, schedule, route and measure what those packages build. If your work overlaps a W2/W3/H item, you build only the automation delta and name the item you build on in the PR body.
- **Already planned elsewhere (do not rebuild):** claims at decision, auto-built letters, 10 s undo, overdue reminder drafts (W2-10, W2-04); auto re-match on OCR edit (W2-02); due dates, mark paid, holds, the G-17 terms flag (W2-03, G-17, W2-11); order guide and wa.me send (W2-06); task spine, badges, bell (W2-08); real recipients, quiet hours, ≤6/day (G-06); `awaitingDecision` (G-12); `moneyText` (G-13); PO lifecycle and supplier-answer notify (W3-09); credit-note OCR and statements (W3-11); price-list inbox (W3-10); Ask drafts and palette (W3-04); close checklist and exports (W3-05); real push, WhatsApp templates, role→phone, late-truck 15 min, chase drafts 3/7/14 (H-05); claim portal (H-06); funnel and closed months (H-07); revised expectation and consolidated accept (H-08); least-privilege ₪ (H-11).
- **Timing.** Train A merges this weekend (#228), train B Tue 10.11, the pilot at ציקטי goes live Wed 11.11. Phase A runs 16–30.11, Phase B in December, Phase C Jan–Mar 2027. Every AU branch starts from `main` **after train B** plus the wave-2 merges your brief names. Vercel builds only `main`; GitHub CI runs on every PR push.

## 1. First 10 minutes (checklist)
- [ ] `AGENTS.md` is auto-loaded. Read it: it binds (immutable list, ownership map, money facts, design vocabulary).
- [ ] Read this README, then your brief's §1 "Start here", §2 "Write boundary", §3 "Depends on" and §5 "Acceptance". Read the rest when you reach that work.
- [ ] Read `docs/ux/wave2/README.md` §7 and §12–§13 once (owner decisions). Skip the rest of it unless this file points you there.
- [ ] `sed -n 1,40p STATE.md`: the top section only.
- [ ] `git fetch origin main && git switch -c claude/au-xx-<slug> origin/main` (exact name in your brief §3).
- [ ] Check your dependencies merged: `git log --oneline origin/main | grep -E '<ids from brief §3>'`. If one has not, build against the interim your brief names (§10) and say so in your first message.
- [ ] Start the lab **in the background** (`run_in_background`): `bash docs/ux/wave2/lab.sh AU-xx <port>` (§3). Packages with no UI use `--tests-only`.
- [ ] `. ~/.rm-lab/au_xx/env`, run your brief's targeted tests and see them **green before you change anything**. Red on clean `main` is not yours: say so in your first message.
- [ ] Put all day-1 requests (path additions, one router line, `AuditAction` values, flag keys) in **one** QUESTION message (§6), then start on what depends on nothing.

## 2. Token-efficiency rules
`docs/ux/wave2/README.md` §2 applies in full (read in ranges, never read lockfiles or big docs whole, targeted tests while iterating, logs in files, one push per milestone, no subagents or workflows, DoD screenshots only, reuse the verified primitives, ask instead of exploring). Additions for this track:
1. The research behind this track lives in `docs/research/אוטומציות במוצר/` (report + `notes/int-0*.md` code maps, `notes/ext-0*.md` external sources). **Never read them whole.** Your brief cites `notes/int-0N-*.md` line ranges; read ±30 lines.
2. Worker jobs are short but run on a schedule you cannot trigger from the UI. Test the job body directly (call the exported job function with a fixed Israel clock), never by waiting for a schedule.
3. `cron.ts`, `outbox.ts` and `approvals/engine.ts` are immutable: read them to understand the call shape, never open them for editing.

## 3. The lab
Reuse `docs/ux/wave2/lab.sh` unchanged in behaviour (local Postgres only, strips remote credentials, placeholder keys, no e-mail or WhatsApp provider, deploys nothing). Everything in `docs/ux/wave2/README.md` §3 holds: logins, the safety prefix `. ~/.rm-lab/<slug>/env &&` before every DB-touching command, e2e, `shot.cjs`, Chromium at `/opt/pw-browsers/chromium`.
- **Ports for AU ids.** `lab.sh` derives ports only for W2/G/H ids today. The orchestrator extends `default_port()` per AU id to **3700+NN** (AU-04 → 3704; e2e = port+100, stub = port+50, both clear of the wave-2 ranges). Until that lands, pass the port explicitly: `bash docs/ux/wave2/lab.sh AU-04 3704 --tests-only`. Slug: `au_04`.
- **Flags in the lab.** The demo tenant has `features: { all: true }`, so every automation is ON in the lab. Flag-off behaviour (§4 rule 6) is tested in the test DB with an explicit `features` object, never by editing the seed.
- **Clock.** The lab seed uses `DEMO_TODAY=2026-10-25`. Briefs and digests compute "today" in Asia/Jerusalem; tests pin it with the seeded month or the Israel-day fixtures (`israelToday`/`israelMonth`, wave-2 README §13), never the UTC day.
- **Notifications in the lab** land in `notifications_outbox` and stop there (no provider). Assert on outbox rows (`target`, `scheduled_at`, `dedupe_key`, body), never on delivery.

## 4. Quality bar
**DoD-1..9** from `docs/ux/wave2/README.md` §4 apply to every AU package with UI (screens, axe, keyboard, RTL and money, states, copy, field, API, build). The tests-and-review rules there (failing first, never weaken a test, canary green, check layer, two reviewers) apply unchanged. **Automation-specific rules (every package, enforced in review):**
1. **Propose, then confirm.** Automation prepares drafts, holds, suggestions and pre-addressed messages; a human taps. No money state changes (approve, waive, claim, allocate, mark paid, recovered) without a human-confirmed mutation, unless an owner rule in §7 says otherwise (only AU-16 under H-12, Phase C). Test: the job/procedure leaves the money state untouched until the confirm mutation runs.
2. **Nothing goes to a supplier automatically.** Supplier-facing text is a `wa.me`/`mailto` draft or a prefilled screen. Undecided gaps never reach a supplier (decision 18); one channel per state (decision 19). Test: no `notifications_outbox` row targets a supplier address. Server send to suppliers is Phase C only (AU-17, after H-05/H-06) and still one owner tap per send.
3. **Quiet hours and volume via G-06.** No direct `enqueueNotification` for people: use G-06 `notify()` (audience → verified addresses, never `role:` targets), which applies 23:00–06:00 + Shabbat and ≤6 per person per day through `scheduled_at` and `payload.digest`. Before G-06 merges, use the interim your brief names and keep the call site one line. Test: an event at 23:30 is scheduled for 06:00 (or after Shabbat).
4. **₪ only via `moneyText` / `formatIls`.** Server text (e-mail, WhatsApp, digest, PDF) uses G-13 `moneyText`; UI uses `formatIls()` / `<Money>`. No inline `Intl.NumberFormat`. AU-04 removes the inline formatter from `apps/worker/src/lib/notifyHelpers.ts` once G-13 merges.
5. **Role payloads.** The receiver gets **no ₪** anywhere (no amount, no ₪ glyph, no leak or purchase figure); the chef gets ₪ only for orders and recipes. Every brief, digest or alert with a receiver or chef recipient has a test asserting its rendered payload contains no `₪` and no amount for that role. Build ₪-free payloads regardless of H-11's server strip.
6. **Every automation has an off switch.** Each one is behind a feature flag in `packages/api/src/lib/features.ts` (`FEATURE_KEYS` at :11), honours the `FEATURES_OFF` kill-switch, and no-ops cleanly when off (job writes "skipped: flag off", UI hides the surface). Test both states. Owner-toggleable flags go on AU-01's allow-list.
7. **Dedupe keys.** Every scheduled or event-driven send carries a stable `dedupeKey` (the outbox uses a partial unique index, `DEDUPE_INDEX_PREDICATE` in `notifications/outbox.ts`). Shape: `au:<A-id>:<restaurantId>:<recipientId>:<IL date or entity id>`. Test: running the job twice yields one row. At most one message per role per slot.
8. **AU-07 KPI hook.** Every automation run, proposal, confirm and dismiss writes through the existing `audit_log` / `activity_events` with a stable `automationId` (the A-id from the research catalogue, e.g. `A12`) in its payload, so AU-07 counts it without a schema change. Name the events in your PR body under "KPI hook".
9. **No new schedule, no new `DiscrepancyType`, no leak-definition change.** Ride the existing slots (§8 lists them) or fire on events (G-05 `emit()`). New findings are holds or flags (T2/T4), never leak ₪. A new schedule is an H-05 addendum line (§8).
10. **Honest numbers.** Hours-₪ and leak-₪ are never summed; every estimate shows its assumption; "unknown" is never ₪0; never show a "1.5% target".

## 5. Merge protocol
- **Branch** `claude/au-xx-<slug>` from `main` after train B and the wave-2 merges in your brief §3.
- **Draft PR** titled `auto(AU-xx): <title>`. Body sections: **Acceptance checklist** (ticked, with how verified) · **Evidence** (test names, red→green runs, screenshot paths) · **Builds on** (the W2/G/W3/H items you credit) · **Owner decisions applied** (§7, incl. which open D-defaults you built to) · **Off switch** (flag key, default) · **KPI hook** (event names) · **Placeholders** · **Path additions / requested exceptions** · **API for dependents** · **Human-PR proposals** (§8).
- Every new tRPC procedure adds an add-only coverage fragment `packages/api/src/__tests__/coverage/AU-xx.ts` (W2-01 pattern; until W2-01 merges, the file exists but isn't loaded) plus a cross-tenant attack test.
- Subscribe to the PR's activity (`subscribe_pr_activity`) and drive CI to green. **Self-repair cap: 2**; on the third failure stop and send BLOCKED.
- **Never merge, deploy, write to a production DB, send real e-mail or WhatsApp, or spend money.** The orchestrator integrates in §10 order and merges. No model names in commits or PR text.

## 6. Communication
Same as `docs/ux/wave2/README.md` §6: one message per event to `session_015veCjPjLCiZbqnYFJpdzvR` via the claude-code-remote `send_message` tool. Format `[AU-xx] GREEN|BLOCKED|QUESTION · PR #<n> · <≤3 lines>`. GREEN = CI green and acceptance done; BLOCKED = retry cap, a dependency past its date, an immutable file needed; QUESTION = boundary, contract or an owner decision (§7 D-list). No progress chatter. A hand-back of paths (§9) is announced in the GREEN message.

## 7. Owner decisions
### 7.1 Binding (build to these; no session reopens them)
- **Everything in `docs/ux/wave2/README.md` §7, §12 and §13** (terms, roles, money limits ₪200 bulk / ₪500 one-tap / never bulk a blocking item, payment rules 18/19, alerts rule, design tiers, consolidated flags, month-start honesty).
- **Approval routing:** the manager decides gaps of ₪50–300 or 2–5%; the owner decides above that **and every blocking gap**. (Engine changes to routing are H-12, human.)
- **Roles and ₪:** the chef sees ₪ only on orders and recipes; the receiver sees **no ₪** anywhere, including notifications.
- **MISSING_ON_INVOICE is not claimable and is out of the leak figure.** No claim, letter, recovery item or claimable ₪ for it; alerts and digests filter it out.
- **A credit claim is overdue after 7 days** (one shared constant, `OVERDUE_DAYS`, exported from `packages/api/src/index.ts`); job and UI use the same rule.
- **Payment terms are fully in wave 2** (W2-11 picker, W2-03 due date, G-17 OCR). "תנאים קצרים מהמוסכם" is a warn chip and **never carries leak ₪**. AU packages read it; they don't rebuild it.
- **Consolidated detection lands before the pilot** (train B). Build on its fields (`raw.kind`, period, delivery notes); never re-detect.
- **Product links come with a question** (G-08 `decideLink`: a guess becomes a review item, never certainty, never a silent alias).
- **One leak definition**; T4 pending and consolidated items stay neutral, never a false alarm.
- **Every money action is human-confirmed** unless an owner rule says otherwise. Supplier messages always need a human tap.

### 7.2 Open decisions (build to the recommended default until the owner answers)
| # | Question | Default the sessions build to | Affects |
|---|---|---|---|
| D1 | Flags ON for ציקטי at Phase A start | Add `priceAlerts`, `vatAtRisk` to pilot defaults (`recovery`, `monthlyReport`, `supplierLedger` are already in `PILOT_DEFAULTS`, `FeaturesPanel.tsx:20-31`, `pilot-config.ts:28-35` on train A); `payRun` + `consolidatedMatch` only after W2-03 / G-04 merge | AU-01 |
| D2 | Owner self-serve toggles without admin | Yes, allow-listed flags only, audited; the kill-switch stays with admin | AU-01 |
| D3 | Receiver morning brief channel before H-05 | In-app bell + e-mail now; WhatsApp after H-05 templates | AU-04 |
| D4 | Approval SLA | Nudge the assignee at 24 h, notice to owner at 48 h | AU-12 |
| D5 | Chase an "acknowledged" claim at day 7 | Yes, softer wording | AU-03 |
| D6 | Bookkeeper gets recovery reminders + weekly digest | Opt-in per bookkeeper, default on for the restaurant's own bookkeeper | AU-03, AU-12 |
| D7 | Earned autonomy (per-supplier auto-approve) | Yes from Phase C: N=10 clean invoices, cap ₪300/invoice, owner-only grant, revocable, never blocking/duplicate/new supplier/bank change | AU-16, H-12 |
| D8 | Route approvals on leak ₪ (excl. MISSING_ON_INVOICE) | Yes, via H-12 | H-12 |
| D9 | Weekly digest slot; order cut-off push lead | Sunday 08:00; 2 h before cut-off | AU-12, AU-11, H-05 add. |
| D10 | Server-sent supplier messages (Phase C) | Always one owner tap per send, never automatic | AU-17 |
| D11 | Price-list import writes `price_history` | No until matching-engine-guardian review; diff mail only | AU-13 |
| D12 | Pay-run bank-detail change | Hard hold, owner-only release | AU-14 |
| D13 | Masav payment file (Phase C) | Yes, file only; a human uploads and signs at the bank | AU-19 |
| D14 | Tax Authority buyer API (Phase C) | Owner starts the credential/registration process in December (Phase-6, human-only) | AU-18 |

An answered decision arrives as an orchestrator message; swap the default in one place (a constant or a flag), never in scattered code.

## 8. Immutable files: human-authored PR only
The list in `AGENTS.md` and `docs/ux/wave2/README.md` §8 applies unchanged. The ones this track presses on: `apps/worker/src/cron.ts` (all schedules), `packages/api/src/notifications/outbox.ts` (delivery), `packages/api/src/approvals/engine.ts` (routing), `packages/matching/**` (leak math), `packages/db/src/schema.ts` + migrations + RLS, `apps/web/lib/money.ts`, the attack suites (add-only fragments), and after G-13 `packages/types/src/{number-input.ts,money/**}`. Procedure when you need one: wave-2 README §8 (separate proposal branch `claude/au-xx-hpr-<slug>`, draft PR `HUMAN-PR proposal (AU-xx): …`, one message, stop that part, build the rest behind an interim).

**Existing slots to ride (Asia/Jerusalem, `cron.ts:58-139`):** daily-expectations 06:00 · baselines 02:00 · health-digest 06:45 · price-alerts 07:00 · monthly-report 1st 07:45 · recovery-reminders 08:30 · order-reminders 09:00 · supplier-delays 10:00 · end-of-day 19:00 · retention 03:30 (opt-in) · outbox-dispatch every 60 s · ocr-sweep every 5 min. Job bodies in `apps/worker/src/jobs/` are **not** immutable.

**Three proposals this track raises (drafted by the named session, authored and merged by a human):**
- **H-05 addendum: automation schedules** (to the existing H-05 delivery-and-scheduling package). Register in `cron.ts`: `weekly-digest` Sun 08:00 IL (AU-12); `missing-docs` 8th of month 08:00 IL (AU-18); `allocation-deadline` daily 08:15 IL, or fold into recovery-reminders (AU-08); intraday `order-cutoff` every 15 min 06:00–22:00 for the draft-ready push N h before cut-off (AU-11). Quiet hours unchanged. State explicitly: `notifications/outbox.ts` needs **no change** for Phase A/B (the enqueue API is enough). Until it merges, AU-11/AU-12 ride the 09:00/08:30/19:00 slots and ship a preview page.
- **H-12 · Approval routing on leak ₪ + earned autonomy** (`packages/api/src/approvals/engine.ts`, persist the routing input). (1) Route on the leak-filtered total (exclude MISSING_ON_INVOICE, PRICE_LOWER, UNORDERED_ARRIVAL) so a missing line does not escalate a whole invoice; (2) new rule `supplier-autonomy` below duplicate/blocking/large-without-PO: auto-approve only when an owner grant exists for (supplier, max ₪, types) and the run has no blocking, duplicate, new-supplier or bank-change signal; (3) info-only runs auto-approve before the total rules. Owner sign-off; the leak canary stays unmoved. Drafted with AU-16.
- **H-13 · Schema batch C: automation** (`schema.ts` + one migration + RLS list + shape tests). `autonomy_grants` (restaurant_id, supplier_id, max_agorot, types[], granted_by, revoked_at) for AU-16; `claim_replies` (classifier tags) for AU-17; `suppliers.reconciliation_contact`. Prefer existing jsonb settings for automation settings (likely no column). Keep minimal; list what lives in jsonb instead. AU-07 sends any missing telemetry column here, never a local schema edit.

**Notes on existing human-PR packages:**
- **H-07 (₪ definitions and closed months):** on train A, charts `LEAK_FILTER` (`packages/charts/src/leak-views.ts:134-136`) excludes PRICE_LOWER and UNORDERED_ARRIVAL but still counts MISSING_ON_INVOICE, which the owner took out of the leak (train B, W1-08). AU-07 verifies on `main` after train B; if still counted, flag it to matching-engine-guardian / H-07 as a pre-pilot bug. The AU-07 funnel uses H-07's definitions and never patches `LEAK_FILTER`.
- **H-11 (least-privilege ₪):** receiver ₪ still leaves the server (owner KPIs, leak hero/summary, `orders.list` totals, catalog list price, ledger via the invoice reader, PO/dock slip). That is a prerequisite for any receiver automation that carries data; AU-04 builds ₪-free receiver payloads regardless and tests them.

## 9. Ownership ledger (who may edit what, when)
Abbreviations as wave-2 README §9: `dash/` = `apps/web/app/dashboard/`, `api/` = `packages/api/src/`, `wkr/` = `apps/worker/`, `msg/` = `apps/web/lib/i18n/messages/`. "(new)" = does not exist on train A. Every package also owns its `api/__tests__/coverage/AU-xx.ts`, `apps/web/e2e/AU-xx.spec.ts` + `__screenshots__/AU-xx/**` and the tests its brief lists. **Anything not listed is read-only: ask first.**

| Pkg | Phase | Owns | Wave-2 collision → resolved by ordering | Hands back after merge |
|---|---|---|---|---|
| AU-01 | A | `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx` (PILOT_DEFAULTS only), `packages/db/scripts/pilot-config.ts`, `dash/settings/automations/**` (new), `api/routers/automations.ts` (new) + one line in `appRouter` (`packages/api/src/index.ts:45`, orchestrator-serialised), `api/lib/features.ts` (add an `OWNER_TOGGLEABLE` constant only), `msg/automations/**` (new) | `dash/settings/**` is W2-14's: AU-01 adds only the new subfolder, after W2-14 merges | settings subfolder → W3-07a |
| AU-02 | A | `wkr/src/jobs/{ocrInvoice,ocrSweep}.ts`, `packages/ocr/src/**` (checks/pipeline), `api/ingest/**` + `api/routers/ingest.ts` (suggested supplier) | `ocrInvoice.ts` is G-06's and G-17's; `ingest/**` is G-09's; `pipeline.ts` is G-08's → start after train B, rebase after G-17 / G-09 merge | `ingest/**` → AU-10 (Phase B), then W3-11; `packages/ocr/**` → W3-11 |
| AU-03 | A | `wkr/src/jobs/recoveryReminders.ts`, `api/recovery/**` (overdue rule, credit suggestion), `msg/recovery/**` keys | W2-10 owns `recovery/**` → after W2-10 + W2-04 merge | `recovery/**` → W3-11; `recoveryReminders.ts` → H-05 |
| AU-04 | A | `wkr/src/jobs/{dailyExpectations,endOfDayReport,orderReminders,supplierDelays,matchInvoice}.ts`, `wkr/src/lib/notifyHelpers.ts`, `api/briefs/**` (new, pure builders), notification template keys | `matchInvoice`/`endOfDayReport` are W2-04's; `notifyHelpers.ts` is G-13's → after W2-04, G-06, G-12, G-13 merge. NOT `cron.ts`, NOT `outbox.ts` | `dailyExpectations`/`supplierDelays` → W3-03; `orderReminders` → AU-11; `api/briefs/**` → AU-12; `matchInvoice` → H-05 |
| AU-06 | A | `api/ask/**` (tools + offline intents), `dash/ask/**` (chips only) | `ask/**` is G-12's → after G-12b | `ask/**` + `dash/ask/**` → W3-04 |
| AU-07 | A | `packages/charts/src/automation.ts` (new; matching-engine-guardian), `apps/web/app/admin/automation/**` (new), `admin.automationKpis` procedure in `api/routers/admin.ts` (one procedure only) | `packages/charts/**` is W2-09's → new file only, after 09a | admin page → W3-07a |
| AU-08 | B | `api/vat/**` (`vatAtRisk.ts`), allocation field in the invoice cockpit, vat-at-risk card | cockpit is W2-02's, `dash/vat-at-risk.tsx` W2-08's → after both merge | — |
| AU-09 | B | `api/match/consolidated.ts`, `api/match/consolidatedPropose.ts` (new), consolidated UI panel | `consolidated.ts` is G-04's → after the G-04 §9 addendum | accept-write path = H-08 (human) |
| AU-10 | B | `api/ingest/**`, `dash/inbox/**` | after W2-02 (inbox) and AU-02 merge; before W3-11 takes inbox | `ingest/**` + `dash/inbox/**` → W3-11 |
| AU-11 | B | `api/orders/**` (draft builder), prepared-draft banner in `dash/orders/**`, `wkr/src/jobs/orderReminders.ts` (from AU-04), backorder hook on receiving submit | `orders/**` is W2-06's → after W2-06 + AU-04; lands before W3-09 or as its addendum | `orders/**`, receiving router → W3-09 |
| AU-12 | B | `api/briefs/**` (from AU-04), `dash/settings/notifications/digest-preview/**` (new) | — (W3-03 owns `settings/notifications/**` in wave 3) | digest preview → W3-03 |
| AU-13 | B | `wkr/src/jobs/priceAlerts.ts`, `api/priceAlerts/**`, contracts-expiry query; reads `api/recipes/alerts.ts` | `priceAlerts/**` is W2-12's → after W2-12 merges | `recipes/**` stays W3-02's |
| AU-14 | B | `api/payRun/preflight.ts` (new), pre-flight panel in `dash/approvals/pay-run/**` | pay-run is W2-03's → after W2-03 + H-03 deployed | pay-run page → W3-01 (branch column) |
| AU-15 | B | `api/suggestions/**` (new), suggestion cards on contracts / mapping | contracts is W2-12's; mapping goes to W3-10 → cards as props into their pages | cards → W3-10 / contracts owner |
| AU-16 | C | earned-autonomy UI (settings + approvals card) | engine rule = H-12, grants table = H-13 | — |
| AU-17 | C | reply classifier (read-only), send buttons over H-05/H-06 | after H-05 + H-06 | — |
| AU-18 | C | missing-documents report (with W3-05 close desk) | after W3-05 + W3-11 | — |
| AU-19 | C | Masav file builder, bank-statement match | after W2-03, H-03, AU-14 | — |

**Shared one-liners:** the `appRouter` registration in `packages/api/src/index.ts` (AU-01, then AU-07 if it adds a router) and any `export` line there are serialised by the orchestrator. New i18n namespaces (`msg/automations`) go through the owner of `messages/index.ts` (W2-13 in wave 2, W3-08 in wave 3). Only the wave's dependency owner adds packages to `package.json`.

## 10. Start order and batches
At most 8 AU sessions at a time. Every package may **start** before its dependencies merge (build against the named interim); none may **merge** before them. A slot frees when a session's draft PR is green and waiting.

| Package | Phase | Depends on (hard / soft) | Can run with | Sessions in phase |
|---|---|---|---|---|
| AU-01 | A (16–30.11) | none / W2-14 (settings audit) | all of Phase A | 6 at once |
| AU-02 | A | train B, G-17, G-08 / G-09 | all of Phase A | |
| AU-03 | A | W2-10, W2-04 | all of Phase A | |
| AU-04 | A | G-06, G-12a, G-13, W2-04 (go-links) | all of Phase A | |
| AU-06 | A | G-12b / W2-03 (`to_pay` tool behind a check) | all of Phase A | |
| AU-07 | A | W2-09a (charts) / H-07 definitions | all of Phase A; merges after AU-01 (router line) | |
| AU-08 | B1 (Dec) | W2-02, W2-03 / H-03 | B1 | 5 (B1) |
| AU-09 | B1 | AU-02, G-04 §9, train B | B1 | |
| AU-10 | B1 | AU-02, W2-02, G-09 | B1 | |
| AU-13 | B1 | W2-12, AU-01 (flag on) | B1 | |
| AU-15 | B1 | W2-04 (waive reasons), W2-12 | B1 | |
| AU-11 | B2 | W2-06, AU-04 / H-05 add. (cut-off slot) | B2 | 3 (B2, after AU-04 merges) |
| AU-12 | B2 | AU-04, W2-03, W2-08 / H-05 add. (Sunday slot) | B2 | |
| AU-14 | B2 | W2-03, H-03 deployed | B2 | |
| AU-16 + H-12, H-13 | C (Jan–Mar) | AU-07 telemetry, D7 | C | 4 + human PRs |
| AU-17 | C | H-05, H-06 | C | |
| AU-18 | C | W3-05, W3-11 / ITA credential (Phase-6) | C | |
| AU-19 | C | W2-03, H-03, AU-14 | C | |

Phase A is path-disjoint by construction: the worker jobs split AU-02 (`ocrInvoice`, `ocrSweep`) / AU-03 (`recoveryReminders`) / AU-04 (`dailyExpectations`, `endOfDayReport`, `orderReminders`, `supplierDelays`, `matchInvoice`, `notifyHelpers`). Total ≈ 17 agent packages + 3 human-PR proposals (H-05 addendum, H-12, H-13).

**Dependency diagram (→ = must merge before):**
```
train B ──┬─→ AU-02 ──┬─→ AU-09 ─→ (H-08 accept, human)
          │           └─→ AU-10 ─→ W3-11
G-06, G-12a, G-13, W2-04 ─→ AU-04 ──┬─→ AU-11 ─→ W3-09
                                    └─→ AU-12 ─→ W3-03
W2-10 ─→ AU-03 ─→ W3-11          G-12b ─→ AU-06 ─→ W3-04
AU-01 ─→ AU-07 (router line) ─→ AU-16 ─→ H-12 + H-13 (human)
AU-01 ─→ AU-13        W2-12 ─→ AU-13, AU-15
W2-02 ─→ AU-08        W2-03 + H-03 ─→ AU-14 ─→ AU-19
H-05 (+ addendum) ─→ AU-17 ←─ H-06       W3-05 + W3-11 ─→ AU-18
```

## 11. Package index
`id · one line · owner agent · effort · phase · humanPR`
- **AU-01** · Automations switch-on: pilot defaults + owner self-serve toggles page ("אוטומציות") · web-feature-engineer (icp-keeper scope, leak-economist copy) · S–M · A · no
- **AU-02** · Intake truth: supplier from ח״פ, consolidated recognition from real OCR (verify first), stuck-OCR re-sign + needs-review nudge · ocr-procurement-engineer · M · A · no
- **AU-03** · Recovery chase loop v1: one 7-day rule, bookkeeper opt-in, pre-addressed reminder drafts, credit-line T2 row · web-feature-engineer · M · A · no
- **AU-04** · Role briefs on existing schedules: receiver truck brief (no ₪), honest evening digest, order-reminder truth, late-truck chase draft, honest match alerts · ocr-procurement-engineer (web-feature-engineer templates; rtl-design-steward + money-format-marshal sign ₪ text) · M–L · A · no
- **AU-05** · not assigned (reserved)
- **AU-06** · Ask answers "what needs me": waiting / stuck / owed / to pay / VAT at risk, read-only, role-redacted · web-feature-engineer · M · A · no
- **AU-07** · Automation telemetry and KPIs: zero-touch %, time ledger, ₪ funnel, alert act rate · matching-engine-guardian (charts SQL) + web-feature-engineer (admin page) · M · A · no
- **AU-08** · Allocation-number guard and chase: hold, request draft, ITA deep-link, deadline countdown · web-feature-engineer (leak-economist: VAT ₪ never in leak) · M · B · no
- **AU-09** · Consolidated autopilot: propose the delivery-note set, explain the residual by cause · matching-engine-guardian · L · B · no (accept-write = H-08)
- **AU-10** · Intake autopilot 2: sender allow-list proposals, bulk approve, cross-channel duplicate hold · ocr-procurement-engineer · M · B · no
- **AU-11** · Order autopilot: prepared draft PO, backorder draft, failed-send fallback · web-feature-engineer · M · B · no
- **AU-12** · Decision SLA nudges + weekly bookkeeper digest (builders + preview) · web-feature-engineer · M · B · no (Sunday slot = H-05 addendum)
- **AU-13** · Price creep in ₪/month: projection, price-list diff mail, contract expiry, dish crossing target · web-feature-engineer (matching-engine-guardian, leak-economist sign) · M · B · no
- **AU-14** · Pay-run pre-flight: duplicate, first payment, bank change (hard hold), unusual amount, dispute-aware remittance · web-feature-engineer (tenant-security-warden, leak-economist) · M · B · no
- **AU-15** · Learn from decisions: contract-price and alias/unit rule suggestions · web-feature-engineer · M · B · no
- **AU-16** · Earned autonomy UI (per-supplier auto-approve grants) · web-feature-engineer · L · C · yes (via H-12, H-13)
- **AU-17** · Supplier communication loop: owner-tap server send, read-only reply classifier · web-feature-engineer · L · C · no (needs H-05, H-06)
- **AU-18** · Month-end missing-documents report + Tax Authority diff · ocr-procurement-engineer (+ human ITA credential) · M + L · C · no (credential Phase-6)
- **AU-19** · Masav payment file + bank-evidenced recovery · web-feature-engineer · L · C · no
- **H-03** · Schema batch A (existing, wave 2): bank details + change audit, `paid_at`, `payment_deductions` · web-feature-engineer drafts · — · dependency · yes
- **H-05 addendum** · Automation schedules in `cron.ts` (weekly digest, missing docs, allocation deadline, order cut-off) · ocr-procurement-engineer drafts · S · B–C · yes
- **H-06** · Supplier claim portal + server send (existing) · web-feature-engineer drafts · — · dependency of AU-17 · yes
- **H-07** · ₪ definitions and closed months (existing); note on `LEAK_FILTER` (§8) · matching-engine-guardian · — · note · yes
- **H-08** · Engine: revised expectation + consolidated accept (existing; AU-09 accept path) · matching-engine-guardian · — · dependency · yes
- **H-11** · Least-privilege ₪ server strip (existing); receiver prerequisite (§8) · web-feature-engineer drafts · — · note · yes
- **H-12** · Approval routing on leak ₪ + `supplier-autonomy` rule in `approvals/engine.ts` · web-feature-engineer drafts with AU-16 · L · C · yes
- **H-13** · Schema batch C: `autonomy_grants`, `claim_replies`, `suppliers.reconciliation_contact` · web-feature-engineer drafts (tenant-security-warden reviews) · M · C · yes

## 12. KPIs per phase
Owned and rendered by AU-07 per restaurant per week; hours-₪ and leak-₪ shown separately, never summed; MISSING_ON_INVOICE excluded from every ₪ figure; definitions consistent with H-07.

| Phase | KPI | Target / reading |
|---|---|---|
| A | % zero-touch invoices (no header/line edit, no mapping) | baseline, then ≥50% by end of December at ציקטי (measured) |
| A | Median arrival → matched (hours) | baseline + trend |
| A | Approvals median age | < 24 h |
| A | Receiver brief delivered on delivery days | 100% |
| A | Alerts acted-on rate (sent → opened if known → acted) | baseline |
| A | Automation flags on (count per restaurant) | per D1 |
| A | ₪ funnel found → decided → claimed → sent → credited → recovered | live |
| B | ₪ claimed / ₪ claimable | ≥80% |
| B | Letters sent within 48 h of decision | ≥80% |
| B | VAT-at-risk ₪ resolved before the 6-month deadline | 100% |
| B | Consolidated invoices auto-proposed with the exact note set | ≥70% |
| B | Price creep ₪/month surfaced | reported |
| B | Duplicates held before payment | count + ₪ |
| B | Bookkeeper minutes per month | self-reported + telemetry |
| C | ₪ recovered / ₪ claimed (first measured recovery rate) | measured |
| C | % invoices auto-approved under grants, with 0 reversals | measured; reversals = 0 |
| C | Supplier reply time · days to credit | measured |

Pilot telemetry replaces the research assumptions after 30 days; until then every impact number states its assumption and shows a range.
