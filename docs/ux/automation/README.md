# Automation track (AU): the shared playbook (read this first, once)

## 0. You are here
- You are **one automation package session (AU-xx)** for RestoMatch: a Hebrew-first, RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli restaurants. Next.js 15 in `apps/web`, tRPC in `packages/api`, Drizzle + Postgres RLS in `packages/db`, the engine in `packages/matching`, jobs inside Vercel at `/api/cron/jobs` (schedules registered in `apps/worker/src/cron.ts`, reused by `apps/worker/src/serverless.ts`).
- **Your brief is `docs/ux/automation/AU-xx.md`** (new; one per package). It holds your write boundary, dependencies, interims, acceptance list, tests and line pointers. This README is the contract shared by all AU sessions. On package specifics the brief wins; `AGENTS.md` wins over both; the wave-2 playbook `docs/ux/wave2/README.md` (§7, §8, §12, §13) binds wherever this file is silent.
- **The orchestrator is session `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns work, answers boundary questions, integrates, reviews and merges. You build one package on one branch and open a **draft** PR.
- **What this track is.** The AU packages are the **automation layer** on top of the existing plan. `docs/ux/IMPLEMENTATION-PLAN.md` §4 already sketches wave 3 (W3-01..W3-11) and the human-PR track (H-04..H-11); wave 2 (`docs/ux/wave2/`) is in flight. AU packages **credit and never duplicate** W2/G/W3/H items: they wire, schedule, route and measure what those packages build. If your work overlaps a W2/W3/H item, you build only the automation delta and name the item you build on in the PR body. The AU packages are **not** wave-3 packages and take no W3-xx ids: each catalogue item maps to the existing W2/G/W3/W4/H package that covers it where one fits, and only the remainder is an AU package (§10a). The wave-2 work they build on is mostly built but not merged (§10b).
- **Already planned elsewhere (do not rebuild):** claims at decision, auto-built letters, 10 s undo, overdue reminder drafts (W2-10, W2-04); auto re-match on OCR edit (W2-02); due dates, mark paid, holds, the G-17 terms flag (W2-03, G-17, W2-11); order guide and wa.me send (W2-06); task spine, badges, bell (W2-08); real recipients, quiet hours, ≤6/day (G-06); `awaitingDecision` (G-12); `moneyText` (G-13); PO lifecycle and supplier-answer notify (W3-09); credit-note OCR and statements (W3-11); price-list inbox (W3-10); Ask drafts and palette (W3-04); close checklist and exports (W3-05); real push, WhatsApp templates, role→phone, late-truck 15 min (H-05; its "chase drafts 3/7/14" are re-scoped to the 7-day rule and AU-03's builder, §8); claim portal (H-06); funnel and closed months (H-07); revised expectation and consolidated accept (H-08); least-privilege ₪ (H-11).
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
6. **Every automation has an off switch.** Each one is behind a feature flag in `packages/api/src/lib/features.ts` (`FEATURE_KEYS` at :11, honouring the `FEATURES_OFF` kill-switch) **or** an AU-01 registry option (`packages/api/src/automations/registry.ts` row, read with `automationOption(settings, key)` from `restaurants.settings.automations`), and no-ops cleanly when off (job writes "skipped: flag off" / "skipped: option off", UI hides the surface). Test both states. Owner-toggleable flags go on AU-01's `OWNER_TOGGLEABLE` allow-list; options are always owner-settable.
7. **Dedupe keys.** Every scheduled or event-driven send carries a stable `dedupeKey` (the outbox uses a partial unique index, `DEDUPE_INDEX_PREDICATE` in `notifications/outbox.ts`). Shape: `au:<A-id>:<restaurantId>:<recipientId>:<IL date or entity id>`. Test: running the job twice yields one row. At most one message per role per slot.
8. **AU-07 KPI hook.** Every automation run, proposal, confirm and dismiss writes through the existing `audit_log` / `activity_events` with a stable `automationId` (the A-id from the research catalogue, e.g. `A12`) in its payload, so AU-07 counts it without a schema change. Name the events in your PR body under "KPI hook".
9. **No new schedule, no new `DiscrepancyType`, no leak-definition change.** Ride the existing slots (§8 lists them) or fire on events (G-05 `emit()`). New findings are holds or flags (T2/T4), never leak ₪. A new schedule is an H-05 addendum line (§8).
10. **Honest numbers.** Hours-₪ and leak-₪ are never summed; every estimate shows its assumption; "unknown" is never ₪0; never show a "1.5% target".

## 5. Merge protocol
- **Branch** `claude/au-xx-<slug>` from `main` after train B and the wave-2 merges in your brief §3.
- **Draft PR** titled `auto(AU-xx): <title>`. Body sections: **Acceptance checklist** (ticked, with how verified) · **Evidence** (test names, red→green runs, screenshot paths) · **Builds on** (the W2/G/W3/H items you credit) · **Owner decisions applied** (§7, incl. which open AD-defaults you built to) · **Off switch** (flag key, default) · **KPI hook** (event names) · **Placeholders** · **Path additions / requested exceptions** · **API for dependents** · **Human-PR proposals** (§8).
- Every new tRPC procedure adds an add-only coverage fragment `packages/api/src/__tests__/coverage/AU-xx.ts` (W2-01 pattern; until W2-01 merges, the file exists but isn't loaded) plus a cross-tenant attack test.
- Subscribe to the PR's activity (`subscribe_pr_activity`) and drive CI to green. **Self-repair cap: 2**; on the third failure stop and send BLOCKED.
- **Never merge, deploy, write to a production DB, send real e-mail or WhatsApp, or spend money.** The orchestrator integrates in §10 order and merges. No model names in commits or PR text.

## 6. Communication
Same as `docs/ux/wave2/README.md` §6: one message per event to `session_015veCjPjLCiZbqnYFJpdzvR` via the claude-code-remote `send_message` tool. Format `[AU-xx] GREEN|BLOCKED|QUESTION · PR #<n> · <≤3 lines>`. GREEN = CI green and acceptance done; BLOCKED = retry cap, a dependency past its date, an immutable file needed; QUESTION = boundary, contract or an owner decision (§7 AD-list). No progress chatter. A hand-back of paths (§9) is announced in the GREEN message.

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
| AD1 | Flags ON for ציקטי at Phase A start | Add `priceAlerts` to pilot defaults now; add `vatAtRisk` only after `owner.vatAtRisk` is narrowed from `invoiceReaderProcedure` (which includes the receiver, `owner.ts:93`, `trpc.ts:158`) to `financeProcedure` by a small pre-flip fix (web-feature-engineer, W2-09's file) or H-11, AU-01 AC 1. `recovery`, `monthlyReport`, `supplierLedger` are already in `PILOT_DEFAULTS` (`FeaturesPanel.tsx:20-31`, `pilot-config.ts:28-35` on train A); `payRun` + `consolidatedMatch` only after W2-03 / G-04 merge | AU-01 |
| AD2 | Owner self-serve toggles without admin | Yes, allow-listed flags only, audited; the kill-switch stays with admin | AU-01 |
| AD3 | Receiver morning brief channel before H-05 | In-app bell + e-mail now; WhatsApp after H-05 templates | AU-04 |
| AD4 | Approval SLA | Nudge the assignee at 24 h, notice to owner at 48 h | AU-12 |
| AD5 | Chase an "acknowledged" claim at day 7 | Yes, softer wording | AU-03 |
| AD6 | Bookkeeper gets recovery reminders + weekly digest | Opt-in per bookkeeper, default on for the restaurant's own bookkeeper | AU-03, AU-12 |
| AD7 | Earned autonomy (per-supplier auto-decide of small gaps) | Yes from Phase C: for one supplier, small `warn` gaps of the granted types (PRICE_HIGHER, QTY_SHORT, QTY_OVER) are auto-decided **as a claim ("לדרוש זיכוי"), never a waive**, up to min(grant, ₪300, the tenant's cumulative-large amount) per invoice and ≤ its cumulative-large %; N=10 clean invoices first, owner-only grant, revocable; never blocking/duplicate/new supplier/bank change. Whole invoices are **not** auto-approved | AU-16, H-12 |
| AD8 | Route approvals on leak ₪ (excl. MISSING_ON_INVOICE) | Yes, via H-12 | H-12 |
| AD9 | Weekly digest slot; order cut-off push lead | Sunday 08:00; 2 h before cut-off | AU-12, AU-11, H-05 add. |
| AD10 | Server-sent supplier messages (Phase C) | Always one owner tap per send, never automatic | AU-17 |
| AD11 | Price-list import writes `price_history` | No until matching-engine-guardian review; diff mail only | AU-13 |
| AD12 | Pay-run bank-detail change | Hard hold, owner-only release | AU-14 |
| AD13 | Masav payment file (Phase C) | Yes, file only; a human uploads and signs at the bank | AU-19 |
| AD14 | Tax Authority buyer API (Phase C) | Owner starts the credential/registration process in December (Phase-6, human-only) | AU-18 |

The automation decisions are numbered **AD1–AD14** so they never collide with other owner-decision labels (e.g. IMPLEMENTATION-PLAN's "owner decision D-6" for least-privilege ₪, H-11). An answered decision arrives as an orchestrator message; swap the default in one place (a constant or a flag), never in scattered code.

## 8. Immutable files: human-authored PR only
The list in `AGENTS.md` and `docs/ux/wave2/README.md` §8 applies unchanged. The ones this track presses on: `apps/worker/src/cron.ts` (all schedules), `packages/api/src/notifications/outbox.ts` (delivery), `packages/api/src/approvals/engine.ts` (routing), `packages/matching/**` (leak math), `packages/db/src/schema.ts` + migrations + RLS, `apps/web/lib/money.ts`, the attack suites (add-only fragments), and after G-13 `packages/types/src/{number-input.ts,money/**}`. Procedure when you need one: wave-2 README §8 (separate proposal branch `claude/au-xx-hpr-<slug>`, draft PR `HUMAN-PR proposal (AU-xx): …`, one message, stop that part, build the rest behind an interim).

**Existing slots to ride (Asia/Jerusalem, `cron.ts:56-142`, `registerCronSchedules` 54-150):** daily-expectations 06:00 · baselines 02:00 · health-digest 06:45 · price-alerts 07:00 · monthly-report 1st 07:45 · recovery-reminders 08:30 · order-reminders 09:00 · supplier-delays 10:00 · end-of-day 19:00 · retention 03:30 (opt-in) · outbox-dispatch every 60 s · ocr-sweep every 5 min. Job bodies in `apps/worker/src/jobs/` are **not** immutable.

**Three proposals this track raises (drafted by the named session, authored and merged by a human):**
- **H-05 addendum: automation schedules** (to the existing H-05 delivery-and-scheduling package). Register in `cron.ts`: `weekly-digest` Sun 08:00 IL (AU-12); `missing-docs` 8th of month 08:00 IL (AU-18); `allocation-deadline` daily 08:15 IL, or fold into recovery-reminders (AU-08 builder; job file AU-12); intraday `order-cutoff` every 15 min 06:00–21:45 (`*/15 6-21 * * *`) for the draft-ready push 2 h before cut-off (AU-11; one bucket rule shared with H-05a §5.B; cut-offs before 08:00 rely on the previous day's 09:00 prepared-draft message). The pinned tests `cron.test.ts` and `cron.registry.db.test.ts` grow add-only. Quiet hours unchanged. **Note to H-05 core:** its "claim chase drafts on days 3/7/14" becomes `OVERDUE_DAYS` (= 7) + `REMIND_EVERY_DAYS` reusing AU-03's `recovery/chase.ts` builder; day 3 is dropped (or a pre-overdue courtesy that never says "overdue"); H-05 adds only the server send. The brief `H-05a.md` is authoritative. State explicitly: `notifications/outbox.ts` needs **no change** for Phase A/B (the enqueue API is enough). Until it merges, AU-11/AU-12 ride the 09:00/08:30/19:00 slots and ship a preview page.
- **H-12 · Approval routing on leak ₪ + earned autonomy** (`packages/api/src/approvals/engine.ts`, persist the routing input; the brief `H-12.md` is authoritative). (1) Route on the leak-filtered total (exclude MISSING_ON_INVOICE, PRICE_LOWER, UNORDERED_ARRIVAL) so a missing line does not escalate a whole invoice; (2) new rule `supplier-autonomy` at **priority 65**, below duplicate, large-without-PO, unordered-significant, severity-block **and cumulative-large (70)**, above cumulative-medium (60): it applies only when an owner grant exists for (supplier, max ₪, types), the run has no blocking, duplicate, new-supplier, bank-change or reversal signal, and the gap is ≤ min(grant, ₪300, the tenant's `cumulativeLargeAmount`) and ≤ `cumulativeLargePct`; "auto-approve" here means **accepted = claim it**, never waive. The predicate is exported (`supplierAutonomyApplies`) so AU-16's shadow mode imports it. Info-only runs are **not** in H-12: that is G-15 item 3 (existing human package). Owner sign-off; the leak canary stays unmoved. Drafted with AU-16.
- **H-13 · Schema batch C: automation** (`schema.ts` + one migration + RLS list + shape tests). `autonomy_grants` (restaurant_id, supplier_id, max_agorot, types[], granted_by, revoked_at) for AU-16; `claim_replies` (classifier tags) for AU-17; `suppliers.reconciliation_email` + `suppliers.reconciliation_whatsapp` (two columns; a contact needs a channel) and `suppliers.whatsapp_opt_in_at/_source`. Masav runs stay in `audit_log` (`payments.masav_built`), not `export_runs`. Prefer existing jsonb settings for automation settings (likely no column). The brief `H-13.md` is authoritative. Keep minimal; list what lives in jsonb instead. AU-07 sends any missing telemetry column here, never a local schema edit.

**Notes on existing human-PR packages:**
- **H-07 (₪ definitions and closed months):** on train A, charts `LEAK_FILTER` (`packages/charts/src/leak-views.ts:134-136`) excludes PRICE_LOWER and UNORDERED_ARRIVAL but still counts MISSING_ON_INVOICE, which the owner took out of the leak (train B, W1-08). AU-07 verifies on `main` after train B; if still counted, flag it to matching-engine-guardian / H-07 as a pre-pilot bug. The AU-07 funnel uses H-07's definitions and never patches `LEAK_FILTER`. **Open pilot PR #211** (owner-approved 31.10) takes MISSING_ON_INVOICE out of `LEAK_FILTER` and moves the EOD digest onto it; once it merges, H-07 and AU-07 only verify.
- **H-11 (least-privilege ₪):** receiver ₪ still leaves the server (owner KPIs, leak hero/summary, `owner.vatAtRisk`, `orders.list` totals, catalog list price, ledger via the invoice reader, PO/dock slip). `owner.vatAtRisk` is narrowed before `vatAtRisk` joins the pilot defaults (AD1). That is a prerequisite for any receiver automation that carries data; AU-04 builds ₪-free receiver payloads regardless and tests them. **Open pilot PR #219** strips ₪ for receiver/chef from activity, receiving reads and owner aggregates (`lib/staffMoney.ts`); it closes part of this list, H-11 closes the rest.

## 9. Ownership ledger (who may edit what, when)
Abbreviations as wave-2 README §9: `dash/` = `apps/web/app/dashboard/`, `api/` = `packages/api/src/`, `wkr/` = `apps/worker/`, `msg/` = `apps/web/lib/i18n/messages/`. "(new)" = does not exist on train A. Every package also owns its `api/__tests__/coverage/AU-xx.ts`, `apps/web/e2e/AU-xx.spec.ts` + `__screenshots__/AU-xx/**` and the tests its brief lists. **Anything not listed is read-only: ask first.**

| Pkg | Phase | Owns | Wave-2 collision → resolved by ordering | Hands back after merge |
|---|---|---|---|---|
| AU-01 | A | `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx` (PILOT_DEFAULTS only), `packages/db/scripts/pilot-config.ts`, `dash/settings/automations/**` (new), `api/routers/automations.ts` (new) + one line in `appRouter` (`packages/api/src/index.ts:45`, orchestrator-serialised), `api/lib/features.ts` (add an `OWNER_TOGGLEABLE` constant only), `api/automations/**` (new: `registry.ts`, `options.ts`; later rows are appended by other packages, see Shared one-liners), `msg/automations/**` (new) | `dash/settings/**` is W2-14's: AU-01 adds only the new subfolder, after W2-14 merges | settings subfolder → W3-07a |
| AU-02 | A | `wkr/src/jobs/{ocrInvoice,ocrSweep}.ts`, `packages/ocr/src/**` (checks/pipeline), `api/ingest/**` (incl. new `autoMatch.ts`, the moved `ocrMayAutoMatch`) + `api/routers/ingest.ts` (suggested supplier); export lines in `api/index.ts` (serialised) | `ocrInvoice.ts` is G-06's and G-17's; `ingest/**` is G-09's; `pipeline.ts` is G-08's → start after train B, rebase after G-17 / G-09 merge | `ingest/**` + `routers/ingest.ts` → AU-10 (Phase B), then W3-11; `ocrInvoice.ts` → AU-10 (one hook) → W3-11; `packages/ocr/**` → W3-11 |
| AU-03 | A | `wkr/src/jobs/recoveryReminders.ts` (ocr-procurement-engineer), `api/recovery/**` (overdue rule, credit suggestion), `dash/recovery/logic.ts` + its test (browser mirror of the predicate, path addition), `msg/recovery/**` keys | W2-10 owns `recovery/**` → after W2-10 + W2-04 merge | `recovery/**` → W3-11; `recoveryReminders.ts` → H-05 |
| AU-04 | A | `wkr/src/jobs/{dailyExpectations,endOfDayReport,orderReminders,supplierDelays,matchInvoice}.ts`, `wkr/src/lib/notifyHelpers.ts`, `api/briefs/**` (new, pure builders), notification template keys | `matchInvoice`/`endOfDayReport` are W2-04's; `notifyHelpers.ts` is G-13's → after W2-04, G-06, G-12, G-13 merge. NOT `cron.ts`, NOT `outbox.ts` | `dailyExpectations`/`supplierDelays` → W3-03; `orderReminders` → AU-11; `api/briefs/**` + `endOfDayReport` → AU-12; `matchInvoice` → H-05 |
| AU-06 | A | `api/ask/**` (tools + offline intents), `dash/ask/**` (chips only) | `ask/**` is G-12's → after G-12b | `ask/**` + `dash/ask/**` → W3-04 |
| AU-07 | A | `packages/charts/src/automation.ts` (new; matching-engine-guardian), `apps/web/app/admin/automation/**` (new), `admin.automationKpis` procedure in `api/routers/admin.ts` (one procedure only) | `packages/charts/**` is W2-09's → new file only, after 09a | admin page → W3-07a |
| AU-08 | B | `api/vat/**` (`vatAtRisk.ts`), allocation field in the invoice cockpit, vat-at-risk card | cockpit is W2-02's, `dash/vat-at-risk.tsx` W2-08's → after both merge | — |
| AU-09 | B | `api/match/consolidated.ts` (additive exports), `api/match/consolidatedPropose.ts` (new; matching-engine-guardian), `api/routers/consolidated.ts` (two procedures) + consolidated UI panel (web-feature-engineer) | `consolidated.ts` is G-04's → after the G-04 §9 addendum | accept-write path = H-08 (human) |
| AU-10 | B | `api/ingest/**`, `api/routers/ingest.ts` (new procedures), one hook in `wkr/src/jobs/ocrInvoice.ts` (`crossChannelHold`), `dash/inbox/**` | after W2-02 (inbox) and AU-02 merge; before W3-11 takes inbox | `ingest/**` + `routers/ingest.ts` + `dash/inbox/**` + the `ocrInvoice.ts` hook → W3-11 |
| AU-11 | B | `api/orders/**` (draft builder), `api/routers/orders.ts` (new procedures), prepared-draft banner in `dash/orders/**`, `wkr/src/jobs/orderReminders.ts` (from AU-04) + `wkr/src/jobs/orderCutoff.ts` (new) + their `handlers.ts`/`index.ts` lines (ocr-procurement-engineer), backorder hook on receiving submit | `orders/**` is W2-06's → after W2-06 + AU-04; lands before W3-09 or as its addendum | `orders/**`, receiving router → W3-09 |
| AU-12 | B | `api/briefs/**` + `wkr/src/jobs/endOfDayReport.ts` (both from AU-04), `wkr/src/jobs/{weeklyDigest,allocationDeadline}.ts` (new) + their `handlers.ts`/`index.ts` lines (ocr-procurement-engineer), `api/routers/digests.ts` (new) + one `appRouter` line, `dash/settings/notifications/digest-preview/**` (new) | — (W3-03 owns `settings/notifications/**` in wave 3) | digest preview → W3-03; `weeklyDigest.ts`/`allocationDeadline.ts` → H-05 (with their slots) |
| AU-13 | B | `wkr/src/jobs/priceAlerts.ts` (ocr-procurement-engineer), `api/priceAlerts/**`, contracts-expiry query; reads `api/recipes/alerts.ts` | `priceAlerts/**` is W2-12's → after W2-12 merges | `recipes/**` stays W3-02's |
| AU-14 | B | `api/payRun/**` (new: `preflight.ts`, `preflightData.ts`, `remittanceText.ts`), `api/routers/payRun.ts` (new procedures + one guard call in W2-03's `markPaid`), pre-flight panel in `dash/approvals/pay-run/**` | pay-run is W2-03's → after W2-03 + H-03 deployed | pay-run page → W3-01 (branch column) |
| AU-15 | B | `api/suggestions/**` (new), suggestion cards on contracts / mapping | contracts is W2-12's; mapping goes to W3-10 → cards as props into their pages | cards → W3-10 / contracts owner |
| AU-16 | C | earned-autonomy UI (settings + approvals card) | engine rule = H-12, grants table = H-13 | — |
| AU-17 | C | reply classifier (read-only), owner-tap send buttons over **H-06's send primitive** (H-06 owns supplier server send) | after H-05 core + H-06, for every PR | — |
| AU-18 | C | `api/missingDocs/**`, `api/routers/missingDocs.ts`, `wkr/src/jobs/missingDocs.ts` + its `handlers.ts`/`index.ts` lines (ocr-procurement-engineer), panel under W3-05's close desk | after W3-05 + W3-11 + AU-08 | — |
| AU-19 | C | Masav file builder, bank-statement match | after W2-03, H-03, AU-14 | — |

**Shared one-liners (append-only, serialised by the orchestrator):** the `appRouter` registration and every `export` line in `packages/api/src/index.ts`; the `JOB_HANDLERS` map in `apps/worker/src/handlers.ts` and the `start*Worker()` lines in `apps/worker/src/index.ts` (AU-11 and AU-12 both add lines in B2, then AU-18 and the allocation-deadline job; `handlers.test.ts` 21-40 needs both lines of a queue in the same PR, so the orchestrator merges AU-11 then AU-12, each rebased on the other); and the rows of `packages/api/src/automations/registry.ts` (AU-01's file; AU-03/AU-04 and AU-10..AU-19 append rows).

**Ownership exception (AGENTS.md map).** `apps/worker` is ocr-procurement-engineer's and `packages/matching` + charts SQL are matching-engine-guardian's. Where a package crosses those boundaries, its brief names a co-owner per boundary: ocr-procurement-engineer takes the worker job edits in AU-03/AU-11/AU-12/AU-13 (web-feature-engineer leads and owns the pure builders, api and web); web-feature-engineer takes AU-09's router and panel (matching-engine-guardian owns the set search and residual logic); AU-07 splits SQL and page the same way. **`jobs/allocationDeadline.ts`** (and its handler/index lines) is assigned to **AU-12** before H-05a opens. New i18n namespaces (`msg/automations`) go through the owner of `messages/index.ts` (W2-13 in wave 2, W3-08 in wave 3). Only the wave's dependency owner adds packages to `package.json`.

## 10. Start order and batches
At most 8 AU sessions at a time. Every package may **start** before its dependencies merge (build against the named interim); none may **merge** before them. A slot frees when a session's draft PR is green and waiting.

Hard/soft columns copy each brief's §3, which is authoritative if they ever differ.

| Package | Phase | Depends on (hard / soft) | Can run with | Sessions in phase |
|---|---|---|---|---|
| AU-01 | A (16–30.11) | none / W2-14 (settings audit), W2-01, G-07 | all of Phase A | 6 at once |
| AU-02 | A | train B, G-06, G-17, G-09, W2-02 (PR b) / G-08, G-07, AU-01 | all of Phase A | |
| AU-03 | A | W2-10, W2-04 / G-06, G-13, W2-11, AU-01, W2-08 | all of Phase A | |
| AU-04 | A | W2-04, G-06, G-12a, G-13 / W2-03, AU-03, AU-02, AU-01, W2-11, W2-08, H-11 | all of Phase A | |
| AU-06 | A | G-12 (a + b) / W2-03, AU-03, AU-02, G-07, W2-02, G-05 | all of Phase A | |
| AU-07 | A | W2-09a, W2-01 (fragment) / G-05, H-07, AU-01 | all of Phase A; **measure first** (rule below) | |
| AU-08 | B1 (Dec) | W2-02, W2-03, W2-08 / G-05, G-13, G-06, W2-11, AU-01 (+ the `owner.vatAtRisk` narrowing, AD1) | B1 | 5 (B1) |
| AU-09 | B1 | train B, G-04 §9, AU-02, W2-02 / G-05, W2-03, W2-08, AU-01 | B1 | |
| AU-10 | B1 | AU-02, W2-02, G-09, G-05 / AU-01, G-07, W2-05, G-17 | B1 | |
| AU-13 | B1 | W2-12, G-06, G-13 / AU-01 (flag on), W3-02 seam, G-08/W3-10 import diff | B1 | |
| AU-15 | B1 | W2-12, G-05 / W2-04, G-05/W2-05 correction audit (PR b), G-08, W3-10, AU-01, W2-06 | B1 | |
| AU-11 | B2 | W2-06, AU-04, G-05, G-06 / W2-05, G-13, AU-01, H-05 add. (cut-off slot) | B2 | 3 (B2, after AU-04 merges) |
| AU-12 | B2 | AU-04, G-12a, G-06, G-13, W2-03 / W2-08, AU-03, AU-08, H-03, H-05 add. (Sunday slot) | B2 | |
| AU-14 | B2 | W2-03, H-03 deployed / W2-11, G-03, AU-10, G-07 | B2 | |
| H-12 (human) | C (Jan–Mar) | G-15, G-14, H-13 (commit b), H-03 / AU-07, AU-16 shadow, owner sign-off AD7 + AD8 | C | 4 + human PRs |
| H-13 (human) | C | H-03 deployed, H-04 if in flight / G-03 | C | |
| AU-16 | C | AU-01, AU-07 (PR a, shadow); + H-13 deployed (PR b); + H-12 merged (PR c) / G-05, G-07, G-14, H-03 | C | |
| AU-17 | C | W2-10, G-06, AU-03, H-05 core, H-06 (every PR); + H-13 (PR b, c) / H-06 portal answers, H-05 reply-to, W3-11, G-05 | C | |
| AU-18 | C | W3-05, W3-11 (or stubbed flags), AU-08 / H-05a row 2, H-13, G-06, AU-12; ITA credential (Phase-6) for PR c | C | |
| AU-19 | C | W2-03 (+ `PAY_RUN_MARK_PAID`), H-03 + decrypt helper, G-03, AU-14 / W2-10, G-05, G-14, AU-07 | C | |

**Measure first (P5).** AU-07 PR a merges **before** AU-03 and AU-04 switch their options on at ציקטי; if it can't, the orchestrator takes a baseline snapshot from the existing tables for 11.11–16.11 (documents in, arrival → first `invoice_matched` event, decision ages, claim stamps, outbox rows) before those options go on. No Phase A automation is enabled at the pilot without a baseline.

Phase A is path-disjoint by construction: the worker jobs split AU-02 (`ocrInvoice`, `ocrSweep`) / AU-03 (`recoveryReminders`) / AU-04 (`dailyExpectations`, `endOfDayReport`, `orderReminders`, `supplierDelays`, `matchInvoice`, `notifyHelpers`). Total ≈ 17 agent packages + 3 human-PR proposals (H-05 addendum, H-12, H-13).

**Dependency diagram (→ = must merge before):**
```
train B ──┬─→ AU-02 ──┬─→ AU-09 ─→ (H-08 accept, human)
          │           └─→ AU-10 ─→ W3-11
G-06, G-12a, G-13, W2-04 ─→ AU-04 ──┬─→ AU-11 ─→ W3-09
                                    └─→ AU-12 ─→ W3-03
W2-10 ─→ AU-03 ─→ W3-11          G-12b ─→ AU-06 ─→ W3-04
AU-01 + AU-07 ─→ AU-16 PR a (shadow)
H-03 ─→ H-13 (human) ─→ AU-16 PR b (grants)        G-14, G-15, H-13 ─→ H-12 (human) ─→ AU-16 PR c (auto-decide)
AU-01 ─→ AU-13        W2-12 ─→ AU-13, AU-15
W2-02, W2-03, W2-08 ─→ AU-08 ─→ H-05a ←─ AU-12 (weekly-digest + allocation-deadline jobs)        W2-03 + H-03 ─→ AU-14 ─→ AU-19
H-05 core + H-06 ─→ AU-17 (all PRs) ←─ H-13 (PR b, c)       W3-05 + W3-11 + AU-08 ─→ AU-18
```

## 10a. Where AU slots in the W3/W4 plan
No W3-xx ids are created for automation. Each catalogue item (`docs/research/אוטומציות במוצר/notes/10-catalogue-and-impact.md` §A–§C, authoritative) is credited to the existing W2/G/W3/W4/H package that already covers it; the AU package builds only the automation delta. "Lands after" = must merge first; "lands before / hands back to" = the W3/W4/H package that takes the AU-owned paths after the AU merge (wave-3 overlap ledger, `IMPLEMENTATION-PLAN.md` §4).

| A-id | Automation | Already covered by (credit, do not rebuild) | AU package (delta) | Lands after | Lands before / hands back to |
|---|---|---|---|---|---|
| A1 | Pilot switch-on + owner toggles | W2-14 (settings audit), G-07 (`can()`) | AU-01 | train B; W2-14 for PR b | settings subfolder → W3-07a |
| A2 | Time ledger + automation KPIs | W2-09a (charts exports), H-07 (₪ definitions) | AU-07 | W2-09a, W2-01 | admin page → W3-07a |
| A3 | Receiver morning truck brief (no ₪) | W3-03 (06:00 receiver brief), W2-05 (`todayExpectations` board), H-11 / #219 (₪ strip) | AU-04 (pulls W3-03's brief forward) | W2-04, G-06, G-12a, G-13 | `dailyExpectations.ts` / `supplierDelays.ts` → W3-03 |
| A4 | Evening decision digest, fixed | W2-04 (`endOfDayReport.ts` → G-12), #211 (EOD on `LEAK_FILTER`) | AU-04 | as A3 | `briefs/**` + `endOfDayReport.ts` → AU-12 |
| A5 | Order reminder truth | W1-11 / W2-06 (reminder link, order guide) | AU-04 | as A3 | `orderReminders.ts` → AU-11 → W3-09 |
| A6 | Late-truck chase draft | H-05 (15-min late check, WhatsApp template) | AU-04 | as A3 | `supplierDelays.ts` → W3-03; late check = H-05 |
| A7 | Honest match alerts | W2-04 (`matchInvoice` → `notify()`), H-12 (routing) | AU-04 | as A3 | `matchInvoice.ts` → H-05 |
| A8 | Supplier from ח״פ + dead check revived | train B (`supplierBusinessIdMismatch`), G-17 (header persistence) | AU-02 (NULL-supplier suggestion only) | train B, G-06, G-17, G-09 | `ingest/**` → AU-10 → W3-11 |
| A9 | Consolidated recognition from real OCR | **train B #224 / #232** (real consolidated recognition) | AU-02 (verify + tests only) | train B | `packages/ocr/**` → W3-11 |
| A10 | Stuck-OCR re-sign + review nudge | G-06 (OCR-failure hand-off), #216 (manual lines), #222 (waiting-for-lines list), #223 (OCR retries) | AU-02 | train B, G-06 | `ocrInvoice.ts` → AU-10 → W3-11 |
| A11 | Ask: waiting / stuck / owed / to pay | G-12a/b (`awaitingDecision`, Ask period) | AU-06 | G-12a, G-12b | `ask/**` + `dash/ask/**` → W3-04 |
| A12 | Recovery chase loop v1 | W2-10 (claims, letters, reminder drafts), W2-04 (claims at decision), H-05 (chase send) | AU-03 | W2-10, W2-04 | `recovery/**` + `dash/recovery/**` → W3-11; `recoveryReminders.ts` → H-05 |
| A13 | Allocation-number guard + chase | W2-02 (register tab), W2-03 (hold), W2-08 (vat card, task type) | AU-08 | W2-02, W2-03, W2-08 | feeds W3-05 checklist and AU-18; deadline slot → H-05a |
| A14 | Consolidated autopilot (propose) | G-04 §9 (three flags), H-08 (accept, wave 4 human) | AU-09 | train B, G-04 §9, AU-02, W2-02 | accept-write → H-08 (W4) |
| A15 | Intake autopilot 2 | W2-02 (inbox, bulk), G-09 (sender grouping) | AU-10 | AU-02, W2-02, G-09, G-05 | `ingest/**` + `routers/ingest.ts` + `dash/inbox/**` → W3-11 |
| A16 | Order autopilot | W2-06 (guide, cut-off board, wa.me), W3-09 (PO lifecycle) | AU-11 | W2-06, AU-04, G-05, G-06 | `orders/**` + orders/receiving routers → W3-09 (lands before it, or as its addendum) |
| A17 | Decision SLA nudge + weekly bookkeeper digest | W2-04 (go-links), G-12a, H-05 (digest send) | AU-12 | AU-04, G-12a, G-06, G-13, W2-03 | `settings/notifications/digest-preview/**` → W3-03; `weeklyDigest.ts` / `allocationDeadline.ts` → H-05 (via H-05a) |
| A18 | Price creep in ₪/month | W2-12 (₪ queue, ₪/month helper), W3-10 (price-list inbox), W3-02 (recipes room) | AU-13 | W2-12, G-06, G-13 | contracts → W2-12; catalog / import diff → W3-10; `recipes/**` stays W3-02 |
| A19 | Pay-run pre-flight | W2-03 (holds, `markPaid`), H-03 (bank columns) | AU-14 | W2-03, H-03 deployed | pay-run page + `routers/payRun.ts` → W3-01; `payRun/**` → AU-19 |
| A20 | Learn from decisions | W2-12 (contracts), W3-10 (mapping), G-08 (`decideLink`) | AU-15 | W2-12, G-05 | cards → W2-12 (contracts) / W3-10 (mapping) |
| A21 | Earned autonomy (claim, never waive) | — (new); engine rule = H-12, grants table = H-13 (both AU human-PR proposals) | AU-16 | AU-01, AU-07; H-13 (PR b); H-12 (PR c) | — |
| A22 | Supplier communication loop | W2-10 (letters), H-05 core, H-06 (portal + server send) | AU-17 | W2-10, G-06, AU-03, H-05 core, H-06; W3-11 for PR b | — |
| A23 | Missing-documents report + ITA diff | W3-05 (close checklist), W3-11 (statements) | AU-18 | W3-05, W3-11, AU-08 | panel lives under W3-05's close desk; 8th slot → H-05 (via H-05a) |
| A24 | Payment file + bank-evidenced recovery | W2-03 (`markPaid`), H-03, G-03 | AU-19 | W2-03, H-03, G-03, AU-14 | — |
| A25 | Produce market benchmark (opt) | — | none (backlog, icp-keeper gate) | — | — |
| A26 | POS Z-report feed (opt) | W2-07 / W3-02 (`posSales`, food-cost room) cover the data side | none (backlog, ICP veto risk) | — | — |
| — | Automation schedules in `cron.ts` | H-05 (delivery and scheduling) | **H-05a** (addendum, human PR) | AU-12, AU-08 job files (AU-11 for the cut-off line) | → H-05 |

**AU packages against the W3/W4 timeline.** Wave 3 itself is gated on W2-01, W2-08, W2-13 and H-03 merged (`IMPLEMENTATION-PLAN.md` §6); W2-08 and H-03 have **not started** (§10b), so the W3 packages AU-xx hand back to are later than the plan's dates. That ordering is safe: every AU package that hands paths back lands **before** the W3 owner starts, and none waits on a W3 package except AU-18 (W3-05, W3-11) and AU-17 PR b (W3-11).
- **Before W3-03:** AU-04 (`dailyExpectations`, `supplierDelays`), AU-12 (digest preview under `settings/notifications/**`).
- **Before W3-04:** AU-06 (`ask/**`).
- **Before W3-09:** AU-11 (`orders/**`, orders/receiving routers), or as its addendum.
- **Before W3-11:** AU-02 → AU-10 (`ingest/**`, inbox, `ocrInvoice.ts` hook, `packages/ocr/**`), AU-03 (`recovery/**`).
- **Before W3-07a:** AU-01 (settings subfolder), AU-07 (admin page).
- **Before W3-01:** AU-14 (pay-run page, `routers/payRun.ts`).
- **With W2-12 / W3-10:** AU-13, AU-15 mount cards by props; the contracts queue stays W2-12's, mapping and the price-list inbox are W3-10's.
- **After W3-05 (+ W3-11):** AU-18.
- **Wave 4:** AU-09's accept path is H-08; H-11 closes the receiver ₪ list that #219 starts. W4-01's DS/a11y sweep covers AU screens like any other; no AU package waits on wave 4.

## 10b. Wave-2 status this plan builds on
Source: open-PR read of 2026-11-07 (~07:45Z; `origin/main` = `4c887688`). Re-check before each batch start.

**Built, draft, not merged (wave 2 + G):** #180 W2-01 COVERAGE fragments (human-PR) · #181 H-01 signDisplay (human-PR) · #182 G-07 capabilities · #183 W2-09a charts exports · #184 W2-06 Orders 2 · #185 G-05 write kernel · #186 W2-15a drafts kit · #187 G-13 agorot boundary / `moneyText` (human-PR) · #188 G-04 match-input truth · #189 / #202 W2-05 receiving slices A/B · #190 G-09 multi-page · #191 W2-09b drill helpers · #192 G-12a `awaitingDecision` · #193 / #194 / #197 W2-10a / W2-10 claims at decision + recovery desk · #195 G-12b Ask period · #196 W2-09 leak drill (in progress) · #198 G-05c invoice state · #199 G-06 real recipients · #200 G-08 link provenance · #201 / #212 W2-13 copy system · #203 / #214 / #218 W2-15 fixes · #204 W2-16 copy focus · #209 W2-04 approvals desk · #217 W2-02 invoice register / cockpit / intake.

**Not started:** W2-03, W2-07, W2-08, W2-11, W2-12, W2-14, G-10, G-11, H-03, G-17.

**Not in the PR read (verify before relying on them):** G-03, G-14, G-15, H-04, H-05 core, H-06, H-07, H-08, H-11. Train A merges this weekend (#228), train B Tue 10.11.

**Per AU package: hard dependencies that have not started (these push the package).**
| Pkg | Hard deps not started | Effect: interim or slip |
|---|---|---|
| AU-01 | none (soft W2-14 not started) | PR a on time; PR b (settings link line on W2-14's page) slips until W2-14, or mounts at `dash/settings/automations/**` without the audit-drawer link |
| AU-02 | **G-17** | PR a builds on train B + G-06 (#199) + G-09 (#190); merge needs G-17's `ocrInvoice.ts` edits first, so either G-17 starts now or the orchestrator lets AU-02 land first and G-17 rebase on it. A9 is verify + tests only (#224/#232) |
| AU-03 | none (W2-10 #193/#194/#197, W2-04 #209 built); soft W2-11, W2-08 not started | on time against their interims (ported `waPhone`, recovery-page banner) |
| AU-04 | none (W2-04 #209, G-06 #199, G-12a #192, G-13 #187 built); soft W2-03, W2-11, W2-08 not started | on time; the "due ≤2 days" line, wa.me normaliser and bell rows stay omitted per §3 interims |
| AU-06 | none (G-12a #192, G-12b #195 built); soft W2-03 not started | on time; `to_pay_this_week` answers "not live yet", never ₪0 |
| AU-07 | none (W2-09a #183, W2-01 #180 built) | on time |
| AU-08 | **W2-03, W2-08** | API part (`vatAtRisk()`, draft builder) can start in B1; the hold and the card cannot mount, so **Phase B1 merge is gated** on W2-03 + W2-08 |
| AU-09 | none directly (G-04 #188: verify it carries the §9 addendum); **G-17 via AU-02** | PR a (pure set search on fixtures) on time; merge slips with AU-02 |
| AU-10 | **G-17 via AU-02** (G-05 #185, G-09 #190, W2-02 #217 built) | slips with AU-02 |
| AU-11 | none (W2-06 #184, G-05 #185, G-06 #199 built; AU-04) | B2 after AU-04 as planned |
| AU-12 | **W2-03** | builders + preview can start; the due list and hold lines are omitted (brief §3 rule "never ₪0"); merge gated on W2-03 unless the orchestrator downgrades it to soft with those lines omitted |
| AU-13 | **W2-12** | **Phase B1 start gated**: `priceAlerts/**` and the ₪/month helper are W2-12's |
| AU-14 | **W2-03, H-03** | **Phase B2 start gated** on W2-03 + H-03 deployed |
| AU-15 | **W2-12** | **Phase B1 start gated** (contracts queue is W2-12's) |
| AU-16 | **H-03 via H-13** (PR b); G-14/G-15 via H-12 (status unknown) | PR a (shadow) on time after AU-01 + AU-07; PR b/c slip with H-03 |
| AU-17 | **H-03 via H-13** (PR b, c); H-05 core, H-06 unknown | PR a waits for H-05 core + H-06 as before; PR b/c also slip with H-03 |
| AU-18 | W3-05, W3-11 (wave 3, gated on **W2-08 + H-03**); AU-08 (gated on W2-03 + W2-08) | Phase C start slips with wave 3; the stand-alone `dash/close/missing-docs` interim stays available |
| AU-19 | **W2-03, H-03** (G-03 unknown) | pure builder/matcher on fixtures only until both land |
| H-05a | none (job files from AU-12, AU-08) | slips with AU-12 / AU-08 (W2-03) |
| H-12 | **H-03** (bank signal), H-13 (needs H-03); G-14, G-15 unknown | commit (a) can be drafted; (b) slips with H-03 |
| H-13 | **H-03** | cannot take a migration number until H-03 is deployed |

**The critical path is W2-03 + H-03 + W2-12 + G-17** (plus W2-08 for AU-08 and wave 3). Nothing in Phase A except AU-02 (G-17) is held by a not-started package; Phase B1 is held by W2-03/W2-08 (AU-08) and W2-12 (AU-13, AU-15); Phase B2 by W2-03/H-03 (AU-12, AU-14).

**Open pilot PRs that change brief premises (verify on `main` after train B):**
- **#211** MISSING_ON_INVOICE leaves the leak figure (owner-approved 31.10): fixes charts `LEAK_FILTER` and moves the EOD digest onto it. AU-07's labelled "חסר בחשבונית (ממתין לתיקון H-07)" line reads ₪0 and is hidden once merged; AU-04's EOD ₪ fix is already done (verify only). W2-04 draft #209 also rewrites `endOfDayReport.ts` (open credits = `awaitingDecision`): the second of #209/#211 to merge rebases.
- **#219** no ₪ to receiver/chef (activity, receiving reads, owner aggregates, `lib/staffMoney.ts`): partially closes the H-11 list; AU-04 still builds ₪-free payloads and tests them.
- **#224 / #232** (train B) real consolidated invoices recognised: AU-02's A9 item becomes **verify + tests**; AU-09's "real scans reach your code" precondition is met by them.
- **#173** quiet hours, Shabbat and the 6/day cap for staff alerts (`notifications/sendWindow.ts`): overlaps G-06's rule; every AU brief that cites "quiet hours via G-06" uses whichever lands as `staffAlertHold` / `notify()`; do not re-implement.
- **#230** W1-11 `sendStatus` dedupe on orders: AU-04 (A5) and AU-11 read `sendStatus` after it.
- **#222** list of invoices waiting for lines (hold reasons): AU-02's needs-review nudge and AU-06's `intake_stuck` link to it rather than add a list.
- **#216** manual invoice lines when OCR fails (`ocrSweep.ts`, `matchInvoice.ts`): AU-02 rebases its `ocrSweep.ts` re-sign on it; AU-04 rebases `matchInvoice.ts` on it.
- Also relevant: #223 OCR headroom/retries (AU-02), #213 letterhead for דרישת זיכוי (AU-03 drafts, AU-17), #231 outbox retry logging (AU-07).

## 11. Package index
`id · one line · owner agent · effort · phase · humanPR`
- **AU-01** · Automations switch-on: pilot defaults + owner self-serve toggles page ("אוטומציות") · web-feature-engineer (icp-keeper scope, leak-economist copy) · S–M · A · no
- **AU-02** · Intake truth: supplier from ח״פ, consolidated recognition from real OCR (verify first), stuck-OCR re-sign + needs-review nudge · ocr-procurement-engineer · M · A · no
- **AU-03** · Recovery chase loop v1: one 7-day rule, bookkeeper opt-in, pre-addressed reminder drafts, credit-line T2 row · web-feature-engineer (ocr-procurement-engineer: the worker job) · M · A · no
- **AU-04** · Role briefs on existing schedules: receiver truck brief (no ₪), honest evening digest, order-reminder truth, late-truck chase draft, honest match alerts · ocr-procurement-engineer (web-feature-engineer templates; rtl-design-steward + money-format-marshal sign ₪ text) · M–L · A · no
- **AU-05** · not assigned (reserved)
- **AU-06** · Ask answers "what needs me": waiting / stuck / owed / to pay / VAT at risk, read-only, role-redacted · web-feature-engineer · M · A · no
- **AU-07** · Automation telemetry and KPIs: zero-touch %, time ledger, ₪ funnel, alert act rate · matching-engine-guardian (charts SQL) + web-feature-engineer (admin page) · M · A · no
- **AU-08** · Allocation-number guard and chase: hold, request draft, ITA deep-link, deadline countdown · web-feature-engineer (leak-economist: VAT ₪ never in leak) · M · B · no
- **AU-09** · Consolidated autopilot: propose the delivery-note set, explain the residual by cause · matching-engine-guardian (set search, residual) + web-feature-engineer (router, panel) · L · B · no (accept-write = H-08)
- **AU-10** · Intake autopilot 2: sender allow-list proposals, bulk approve, cross-channel duplicate hold · ocr-procurement-engineer · M · B · no
- **AU-11** · Order autopilot: prepared draft PO, backorder draft, failed-send fallback · web-feature-engineer (ocr-procurement-engineer: worker jobs) · M · B · no
- **AU-12** · Decision SLA nudges + weekly bookkeeper digest (builders + preview) + the allocation-deadline job · web-feature-engineer (ocr-procurement-engineer: worker jobs) · M · B · no (Sunday slot = H-05 addendum)
- **AU-13** · Price creep in ₪/month: projection, price-list diff mail, contract expiry, dish crossing target · web-feature-engineer (ocr-procurement-engineer: the worker job; matching-engine-guardian, leak-economist sign) · M · B · no
- **AU-14** · Pay-run pre-flight: duplicate, first payment, bank change (hard hold), unusual amount, dispute-aware remittance · web-feature-engineer (tenant-security-warden, leak-economist) · M · B · no
- **AU-15** · Learn from decisions: contract-price and alias/unit rule suggestions · web-feature-engineer · M · B · no
- **AU-16** · Earned autonomy UI (per-supplier grants to auto-decide small gaps as claims; shadow mode first) · web-feature-engineer · L · C · yes (via H-12, H-13)
- **AU-17** · Supplier communication loop: owner-tap send over H-06's primitive, read-only reply classifier · web-feature-engineer · L · C · no (needs H-05 core + H-06 for every PR)
- **AU-18** · Month-end missing-documents report + Tax Authority diff · ocr-procurement-engineer (+ human ITA credential) · M + L · C · no (credential Phase-6)
- **AU-19** · Masav payment file + bank-evidenced recovery · web-feature-engineer · L · C · no
- **H-03** · Schema batch A (existing, wave 2): bank details + change audit, `paid_at`, `payment_deductions` · web-feature-engineer drafts · — · dependency · yes
- **H-05 addendum** · Automation schedules in `cron.ts` (weekly digest, missing docs, allocation deadline, order cut-off) · ocr-procurement-engineer drafts · S · B–C · yes
- **H-06** · Supplier claim portal + server send (existing) · web-feature-engineer drafts · — · dependency of AU-17 · yes
- **H-07** · ₪ definitions and closed months (existing); note on `LEAK_FILTER` (§8) · matching-engine-guardian · — · note · yes
- **H-08** · Engine: revised expectation + consolidated accept (existing; AU-09 accept path) · matching-engine-guardian · — · dependency · yes
- **H-11** · Least-privilege ₪ server strip (existing); receiver prerequisite (§8) · web-feature-engineer drafts · — · note · yes
- **H-12** · Approval routing on leak ₪ + `supplier-autonomy` rule (priority 65, claim never waive, exported predicate) in `approvals/engine.ts` · web-feature-engineer drafts with AU-16 · L · C · yes
- **H-13** · Schema batch C: `autonomy_grants`, `claim_replies`, `suppliers.reconciliation_email/_whatsapp`, `suppliers.whatsapp_opt_in_*` · web-feature-engineer drafts (tenant-security-warden reviews) · M · C · yes

## 12. KPIs per phase
Owned and rendered by AU-07 per restaurant per week; hours-₪ and leak-₪ shown separately, never summed; MISSING_ON_INVOICE excluded from every ₪ figure; definitions consistent with H-07.

| Phase | Package | KPI | Target / reading |
|---|---|---|---|
| A | AU-07 | % zero-touch invoices (no header/line edit, no mapping) | baseline (before AU-03/AU-04 options go on, §10), then ≥50% by end of December at ציקטי (measured) |
| A | AU-07 | Median arrival → matched (hours) | baseline + trend |
| A | AU-04 / AU-12 | Approvals median age | < 24 h |
| A | AU-04 | Receiver brief delivered on delivery days (`au:A3:` rows vs days with expected POs) | 100% |
| A | AU-04 | Alerts acted-on rate (sent → opened if known → acted, joined on the invoice) | baseline |
| A | AU-01 | Automation flags/options on (count per restaurant) | per AD1 |
| A | AU-02 | Stuck-OCR count (`ocr_pending` > 25 min) and share of supplierless invoices; supplier auto-suggested and accepted % (`intake.supplier_set`, basis) | stuck → 0 per day; supplierless share falling |
| A | AU-03 | Overdue claims chased within 7 days of becoming overdue (reminder drafts opened / overdue claims) | baseline, then measured |
| A | AU-06 | Ask "what needs me" questions per week; golden-set pass rate | usage reported; golden set 100% |
| A | AU-07 | ₪ funnel found → decided → claimed → sent → credited → recovered | live |
| B | AU-03 / W2-10 | ₪ claimed / ₪ claimable | ≥80% |
| B | W2-10 / AU-03 | Letters sent within 48 h of decision | ≥80% |
| B | AU-08 | VAT-at-risk ₪ resolved before the 6-month deadline | 100% |
| B | AU-09 | Consolidated invoices auto-proposed with the exact note set | ≥70% |
| B | AU-10 | Sender allow-list proposals accepted %; documents approved per sender group | reported |
| B | AU-11 | Prepared drafts sent within the day % (`order.prepared_draft_*`) | reported |
| B | AU-13 | Price creep ₪/month surfaced | reported |
| B | AU-14 | Duplicates held before payment | count + ₪ |
| B | AU-15 | Suggestions accepted %; repeat PRICE_HIGHER on accepted pairs (POs priced through `resolveExpectedPrice`) | → 0 on those POs |
| B | AU-12 | Bookkeeper minutes per month | self-reported + telemetry |
| C | AU-17 / AU-19 | ₪ recovered / ₪ claimed (first measured recovery rate) | measured |
| C | AU-16 / H-12 | % gaps auto-decided under grants (as claims, ≤₪300 per invoice, never waived), with 0 reversals | measured; reversals = 0 |
| C | AU-17 | Supplier reply time · days to credit | measured |
| C | AU-18 | Missing documents resolved before the 15th | measured |

Pilot telemetry replaces the research assumptions after 30 days; until then every impact number states its assumption and shows a range.

## 13. Competitive track (AU-20+): packages, dependencies, slotting
Source: `docs/research/אוטומציות במוצר/notes/21-owner-chef-value-and-new-automations.md` (AU-20..AU-26, riders R1–R3, owner decisions OD-C1..OD-C10), built on note 20 (matrix rows M#1–71). Same contract as §0–§12: one brief per package (`AU-20.md` … `AU-26.md`), PR-only, ONE message to the orchestrator `session_015veCjPjLCiZbqnYFJpdzvR` per package. None of these packages crosses an ICP veto (`docs/ICP.md` §5): no par/forecast, no recurring auto-send, no cross-supplier compare, no inventory as core. AU-25 and AU-26 sit near the line and are gated (OD-C7, OD-C9). Every ₪ below is an ASSUMPTION for the ₪200k/month restaurant; hours-₪ and money-₪ are never added; "surfaced" leak is the existing engine's figure on more POs, not recovered money and not a new type.

### 13.1 Package index (AU-20+)
`id · one line · owner agent · effort · phase · humanPR`
- **AU-20** · Coexistence by documents: forwarded MarketMan/Zestt orders become labelled POs (MarketMan PO layout new, Zestt import made platform-aware), new supplier names need a confirm; PR c = Zestt delivery notes as expected qty · ocr-procurement-engineer (web-feature-engineer: `coexist` router + UI props; growth-pmm-engineer: forwarding copy) · M · B1 (PR a, b), D (PR c) · no
- **AU-21** · Coexistence by API: synced lines carry SKU and upsert, our status wins after the dock (PR a); price list = expected price via W3-10 (PR b); health reader + cursor + real contracts (PR c); labelled imported receipts (PR d) · ocr-procurement-engineer (matching-engine-guardian consulted on C3) · L · B2 (a), C (b), D (c, d) · no for its PRs; **H-04** (columns) + **H-05a row 5** (`sync-platforms` slot) are human PRs it proposes
- **AU-22** · Supplier negotiation pack: owner-only page + PDF per supplier (spend, paid-price history, "מחירים שעלו" ₪/month, agreed vs billed, our claims record, ₪-free fill rate), reply draft never sent · web-feature-engineer (matching-engine-guardian: one new charts file) · M · B2 · no
- **AU-23** · Recipe quick-start: 90-day bought-products shortlist + draft dish outlines from the menu (W3-04, draft-only); chef confirms each recipe · web-feature-engineer (as W3-02's addendum; icp-keeper placement gate) · M · C (slips to D with wave 3) · no
- **AU-24** · Agreed (contract-in-force) price printed per line on orders to opted-in suppliers; default off; non-contract prices never printed for them · web-feature-engineer (money-format-marshal, leak-economist sign) · S · B1 · no
- **AU-25** · Food-cost % lite (**OWNER DECISION OD-C7**): one typed monthly sales figure → one report line, purchases-based %, leak in food-cost points · web-feature-engineer (W3-08's owner; leak-economist, icp-keeper sign) · S · C (slips to D with wave 3) · no
- **AU-26** · Same-supplier pack-size hint on order drafts + owner mail section (**icp-keeper gate, OD-C9**); never cross-supplier, never `product_group_id` · web-feature-engineer (icp-keeper, leak-economist) · M · D · no

### 13.2 Items mapped to existing packages (no new brief; the W3/W4 plan is not edited)
| Item (note 21) | Mapped to | What the existing package already covers | What stays with the AU package |
|---|---|---|---|
| **R1** dish-alert names the purchase + four standard responses as copy | **AU-13** (A18, B1) | dish crossing section (AU-13 §5.3); W3-02's "הצע מחיר תפריט" for crossings | nothing new: AU-13 adds the invoice reference and the four responses to its chef section when it builds it |
| **R2** ingredient find-and-replace across recipes | **W3-02** | recipe workbench (`recipes/**`) | none (W3-02 rider; offered when W3-10 merges two products) |
| **R3** chef gets the ₪-free "arrived short" list for kitchen lines | **W2-05** exception event via **G-06** `notify()` | W2-05 partial-delivery alert (manager + owner) | none (add the chef audience to the same event; no second job) |
| AU-21 PR b "מה ישתנה" review screen | **W3-10** | price-list inbox, diff with ₪/month, revert via audit | AU-21 supplies the diff from `listProducts` only |
| AU-21 PR c health line | **W3-07a** | "חיבורים" hub: status chips, last sync, plain-Hebrew last error, one fix CTA | AU-21 supplies the `health` reader and the skipped-order counter |
| AU-21 schedule | **H-05a** (row 5, human) | the four automation slots | proposal text only, after AU-21 PR a + G-04 + #211 merge (OD-C1) |
| AU-21 durable line id + receipt source | **H-04** (human; OD-C2) | schema batch B (`po_lines` revised columns, …) | proposal text only |
| AU-20 / AU-21 coverage effect | **W3-09** | coverage line "בדקנו 78% מהרכש" with drill-down | none: it reports the larger PO base by itself |
| AU-22 host page | **W2-11** (Supplier 360) | supplier page, tabs | the `pack/**` subfolder; interim link on the leak tab |
| AU-23 outlines and mapping | **W3-04** (AI drafts, kill-switch), **W3-10** ("לקשר" queue) | draft-only tools, labels, acceptance tracking; mapping triage | the shortlist and the outline validator |
| AU-24 send paths | **W2-06** (`manualSend`, `redactPrices`), `orderPricesOut` (live) | the order document, contract label "(מחיר חוזה)" | per-supplier opt-in, contract-only printing |
| AU-25 report and checklist | **W3-08**, **W3-05**, **H-07** | monthly report tabs, close checklist, closed months | the formula, the sales input, one line |
| AU-26 units | **W3-10** item master | one unit and pack size per catalog row | the same-supplier comparator |

### 13.3 Dependency map (→ = must merge before)
```
#211 + G-04 (#188) + W2-06 (#184) + #219 + AU-02 ──→ AU-20 PR a ──→ AU-20 PR b (hook in ingest, via AU-10) ──→ AU-11 (orders/importPo.ts handed back)
                                                     └─(shared coexist/**)─→ AU-21 PR a ──→ H-05a row 5 (human) ─┐
G-08 (#200) ─────────────────────────────────────────────────────────────→ AU-21 PR a                           │
W2-08 + H-03 ─→ wave 3 ─┬─→ W3-10 ─→ AU-21 PR b ─→ W3-07a ─→ AU-21 PR c ←─ Phase-6 credentials ←────────────────┘
                        │                                     H-04 (human, OD-C2) ─→ AU-21 PR d ; ─→ AU-20 PR c
                        ├─→ W3-02 (+ OD-C3, #219) ─→ AU-23 PR a ─→ W3-04 (+ OD-C10) ─→ AU-23 PR b
                        ├─→ W3-08 + W3-05 (+ OD-C7, #211; soft H-07) ─→ AU-25
                        └─→ W3-10 + AU-11 + W2-12 (+ OD-C9) ─→ AU-26 PR a ─→ AU-13 ─→ AU-26 PR b
W2-12 ─→ AU-13 ─→ AU-22 PR b        W2-12 + W2-10 (#193/#194/#197) + G-13 (#187) ─→ AU-22 PR a        (W2-11: soft host)
W2-06 (#184) + G-07 (#182) ─→ AU-24 ─→ AU-11 (orders/document/** handed back) ─→ W3-09
AU-01 ─→ registry rows for every AU-20+ option (all default off)        AU-07 ─→ KPI rows below
```

### 13.4 Slotting by phase (sessions are AU sessions; at most 8 at a time, §10)
| Phase | Window | AU-20+ work | Hard gates not yet merged (open-PR read 2026-11-07) | AU sessions in phase (existing + new) |
|---|---|---|---|---|
| B1 | December 2026 | AU-20 PR a (+ PR b after AU-10), AU-24 | #211, #219, G-04 #188, W2-06 #184, G-07 #182 (all built or open, none unstarted); MarketMan PO samples (pilot ops) | 5 + 2 = **7** |
| B2 | Dec 2026–Jan 2027 (after AU-04 merges) | AU-21 PR a, AU-22 | **W2-12 not started** (AU-22, via AU-13); G-08 #200; W2-10 #193/#194/#197; G-13 #187 | 3 + 2 = **5** |
| C | Jan–Mar 2027 | AU-21 PR b, AU-23, AU-25 | **wave 3 gated on W2-08 + H-03 (not started)**: W3-10, W3-02, W3-04, W3-08, W3-05; OD-C3, OD-C7, OD-C10 | 4 + 3 = **7** (+ H-12, H-13 human) |
| **D (new)** | **Apr–Jun 2027** | AU-21 PR c + PR d, AU-20 PR c, AU-26 (+ AU-23 / AU-25 if wave 3 slips) | W3-07a, H-04, H-05a row 5 (human), Phase-6 credentials, AU-11 + W3-10 + OD-C9 | **3** (up to 5 with slips) |

**Why a Phase D.** Every Phase-D item waits on something that cannot land in Jan–Mar under the current state: wave 3 itself is gated on W2-08 and H-03, neither started (§10b), so W3-10 / W3-07a land late in C at best; H-04 is a human schema batch not in the PR read; AU-21 PR c needs Phase-6 credentials (human only) and a human `cron.ts` row that OD-C1 forbids until PR a + G-04 + #211 are merged. Putting them in C would create packages that start and stall. Phase D keeps C's session count at 7 and gives the human PRs (H-04, H-05a row 5) a quarter to land. If wave 3 starts on time, AU-23 and AU-25 stay in C; AU-26 does not move earlier (it also needs AU-11's drafts in production for its quantity basis).

### 13.5 Ownership ledger additions (same rules as §9; anything not listed is read-only)
| Pkg | Phase | Owns | Collision → resolved by ordering | Hands back after merge |
|---|---|---|---|---|
| AU-20 | B1 (+D) | `api/orders/importPo.ts` (carve-out), `api/coexist/**` (except `coexist/sync/**`), `api/routers/coexist.ts`, `procurement/src/adapters/marketmanDocument.ts`, `ocr/src/providers/poLayouts/marketman.ts` (+ one import line), label chip, inbox action as props | `orders/**` is W2-06's → after W2-06; AU-11 owns `orders/**` in B2 → AU-20 PR b merges before AU-11 starts or AU-11 rebases; `ingest/**` is AU-10's in B1 → one hook line by AU-10; `packages/ocr/**` after AU-02 | `importPo.ts` → AU-11 → W3-09; `coexist/**` → AU-21 (Phase C+) |
| AU-21 | B2, C, D | `wkr/src/jobs/syncPlatforms.ts`, `packages/procurement/**` (except AU-20's file), `api/coexist/sync/**` | `catalog/**` (W3-10) and the hub (W3-07a) receive readers by props, never edited; `cron.ts` → H-05a row 5 (human); `schema.ts` → H-04 (human) | — |
| AU-22 | B2 | `dash/suppliers/[id]/pack/**` (carve-out from W2-11), `api/supplierPack/**`, `api/routers/supplierPack.ts`, `packages/charts/src/supplierPack.ts` (matching-engine-guardian) | W2-11 owns `suppliers/**` → subfolder only + one entry line by W2-11; W2-09's leak-card files untouched | pack → W2-11's successor (W3-01 for branch scope) |
| AU-23 | C | `api/recipes/quickstart/**`, two procedures in `routers/recipes.ts`, `dash/recipes/quickstart/**`, one W3-04 tool handler | `recipes/**` is W3-02's → after W3-02 merges, or inside W3-02's session | → W3-02's owner |
| AU-24 | B1 | `api/orders/document/**` (carve-out), `api/routers/agreedPrice.ts`, `dash/settings/automations/agreed-price/**` (carve-out from AU-01) | W2-06 → AU-24 → AU-11 (B2) → W3-09 | `orders/document/**` → AU-11 |
| AU-25 | C | `api/reports/foodCostLite*.ts`, two procedures in `routers/monthlyReport.ts`, report line + checklist step as props | `reports/**` is W3-08's → after W3-08 | → W3-08's owner |
| AU-26 | D | `api/packHint/**`, `api/routers/packHint.ts`, `apps/web/lib/components/orders/PackHint.tsx`, `priceAlerts/sections/packHint.ts` (PR b) | drafts are AU-11's → W3-09's (prop slot); `priceAlerts/**` is AU-13's (one import line) | — |

**New shared one-liners (serialised by the orchestrator, §9):** `appRouter` lines for `coexist`, `supplierPack`, `agreedPrice`, `packHint`; one export in `packages/charts/src/index.ts` (AU-22); registry rows in `automations/registry.ts`: `coexistDocs`, `coexistPoSenders`, `procurementSync`, `procurementPriceList`, `supplierPack`, `recipeQuickstart`, `agreedPriceOnOrders`, `foodCostLite`, `packHint` (all default **off**); one hook line in `ingest/pipeline.ts` (AU-10 adds it for AU-20 PR b).

### 13.6 Owner decisions this track needs (from note 21 §3; recommended defaults until answered)
OD-C1 documents first, no sync scheduler before AU-21 PR a + G-04 + #211 (AU-20, AU-21, H-05a) · OD-C2 approve `po_lines` external line id + `goods_receipts.source` into H-04 (AU-21) · OD-C3 switch `recipes` + `dishPriceAlert` on for one pilot tenant after #219; `inventoryCount` stays off (AU-01, AU-23) · OD-C4 no ₪ to the chef on counts (W2-07, W3-02) · OD-C5 dish cost = last paid price (W3-02, AU-23) · OD-C6 agreed price on POs opt-in per supplier, default off, contract only (AU-24) · **OD-C7 food-cost % lite: allow narrowly or not at all (AU-25 does not merge without an answer)** · OD-C8 pack sections owner-picked; internal notes and staff names excluded; never system-sent (AU-22) · **OD-C9 same-supplier pack hints in Phase D behind icp-keeper (AU-26 does not start without it)** · OD-C10 AI dish outlines draft-only, ₪ never from the model (AU-23, W3-04).

### 13.7 KPIs (AU-07 adds one row each; hours-₪ and leak-₪ never summed)
| Phase | Package | KPI | Reading |
|---|---|---|---|
| B1 | AU-20 | POs imported by platform; share of invoices matched against an imported PO | reported; "surfaced" ₪ labelled, never "recovered" |
| B1 | AU-24 | PRICE_HIGHER count and ₪ per opted-in supplier, 60 days before vs after | comparison, not causality |
| B2 | AU-21 | share of invoices matched against a synced PO; skipped orders (supplier not linked) | skipped → 0 |
| B2 | AU-22 | packs exported per supplier; items whose paid price held or fell in the next 60 days | reported (A18 act rate) |
| C | AU-23 | recipes created in 14 days after `recipes` on; outline acceptance % | acceptance ≥60% (W3-04 kill-switch) |
| C | AU-25 | months with a sales figure; owners opening the report before vs after | reported |
| D | AU-26 | pack hints shown / applied %; avoided cost on applied hints (הערכה) | reported, outside the leak |

### 13.8 Spec corrections found while writing the briefs (verified on `main`, train A merged)
- AU-20: the PO import is Zestt-only end to end (`orders/importPo.ts:177, 241, 295, 308`; `routers/orders.ts` `importPo` input `z.literal('zestt')`), and the intake pipeline turns every document into an invoice (`ingest/pipeline.ts:117-125`): "forward to the ingest address" needs a routing step.
- AU-21: `sync-platforms` was never registered (`cron.ts:9-10` vs `54-150`); the health line already has a home in W3-07a's acceptance.
- AU-22: a per-restaurant supplier scorecard already exists, plan-gated (`packages/charts/src/suppliers.ts:19-29`); reuse it where entitled.
- AU-24: `orderPricesOut` already prints PO prices and labels contract prices (`orders/document/text.ts:20-28`, `load.ts:15-25, 89-110`); the delta is per-supplier opt-in, default off, and suppressing non-contract prices. `resolveExpectedPrice` is W2-06's (#184), not on `main`.
- AU-25: storing the sales figure as a `pos_sales` row would pollute `posVsTheory`; the brief uses a jsonb month map with audit (no schema change).
- AU-26: `supplier_catalog_items.pack_size` already exists (`schema.ts:648`); the real dependency is W3-10's item master.
