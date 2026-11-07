# Wave 3: the shared playbook (read this first, once)

> **Orchestrator update, Sat 7.11 (binding; it overrides §0 "Timing" and §10 where they differ):**
> - **The owner approved a full wave-3 start now.** Every package whose dependencies are met starts now as a draft. A package whose dependency is not on `main` yet starts on its independent slice only (new files, server parts, tests) and adopts the dependency when it lands. It never copies another package's unmerged code.
> - **No brief yet?** Your first commit is your own brief, `docs/ux/wave3/<ID>.md`, in this kit's shape (§0 of wave-2 briefs: One line · 1 Start here · 2 Write boundary · 3 Depends on / base / branch · 4 Slices · 5 Acceptance · 6 Tests · 7 Done). Source it from `docs/ux/IMPLEMENTATION-PLAN.md` (your W3-xx section: paths and scope), `docs/ux/wave2/ref/GAP-PACKAGES.md` (G-14/G-15/G-16) and `docs/ux/wave2/ref/PROGRAMME-PLAN-0711.md` §5.3 (your row: start, base, notes, train, owner approval). Send the orchestrator a 10-line summary of it, then build.
> - **The lab and the real date:** `lab.sh` aborts on 7.11+ because the demo hero check measures the real month (November = ₪0 for a 25.10 seed). Until the kit fix lands, run it under libfaketime: `FAKETIME_DONT_FAKE_MONOTONIC=1 faketime -f '@2026-10-25 09:30:00' bash docs/ux/wave2/lab.sh <ID>`, and pin the Playwright clock to 2026-10-25T09:40Z. A `check:demo` failure on "hero leak 0.00%" alone is the known month issue, not your regression. Run `pnpm install` OUTSIDE faketime first (under a 2026-10-25 clock TLS fails with CERT_NOT_YET_VALID); the lab may also need the local postgres password set and pgvector installed.
> - **Budget:** the weekly usage is at the warning level until Sat 14.11 08:00 IL. Keep runs lean: targeted tests, one push per milestone, no workflows, at most one review subagent before the final push. The pilot (train B merges Tue 10.11, ציקטי goes live Wed 11.11) always comes first. If the orchestrator says PAUSE, commit WIP and stop.


## 0. You are here
- You are **one wave-3 package session** for RestoMatch (Hebrew-first RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli restaurants; Next.js 15 `apps/web`, tRPC `packages/api`, Drizzle + Postgres RLS `packages/db`, engine `packages/matching`, jobs in Vercel `/api/cron/jobs`).
- **Your brief is `docs/ux/wave3/<ID>.md`.** It holds your write boundary, slices, dependencies, interims, acceptance, tests and line pointers. This README is shared by all wave-3 sessions. On package specifics the brief wins; `AGENTS.md` wins over both; `docs/ux/wave2/README.md` §2, §7, §8, §12, §13 bind wherever this file is silent.
- **The orchestrator is `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns slots, grants hot-file locks, integrates on `release/wave-3`, reviews and merges. You build one package (possibly in slices a/b) on one branch per slice and open **draft** PRs.
- **Timing.** The wave-3 gate is W2-01, W2-08, W2-13 and H-03 merged (target Thu 26.11; at the latest Thu 3.12). Before it, only the early slices named in §10 run, as drafts, each approved by the owner by name. **G-14ʰ merges first in the wave (W3-α, Thu 17.12).** Wave 3 closes Sat 16.1. Merges happen on Thursdays, deploys on Tuesdays. Schema PRs (H-04ʰ, H-13ʰ) merge on a deploy Tuesday at 09:00: the merge applies the migration.
- **Automation track.** `AU-xx` packages live in `docs/ux/automation/`. They wire, schedule and measure what waves 2–3 build, and they run between a lane's wave-2 owner and its wave-3 successor (§12). They share the same 8 session slots.

## 1. First 10 minutes (checklist)
- [ ] Read AGENTS.md (auto-loaded). Then read this README, then your brief §1 "Start here", §2 "Write boundary", §3 "Depends on", §5 "Acceptance".
- [ ] Read `docs/ux/wave2/README.md` §7, §12 and §13 (owner decisions; binding) by line range.
- [ ] `git fetch origin && git switch -c <branch from brief §3> <base from brief §3>`. The base is `origin/main` or `origin/release/wave-3` at the tag your brief names. Never base on another package's branch.
- [ ] Start the lab in the background: `bash docs/ux/wave2/lab.sh <ID>` (`--tests-only` for no-UI packages). Run your targeted tests green **before** changing anything.
- [ ] Put your day-1 requests (path additions, a hot-file lock, an export line, a registry line, `AuditAction` values, a flag) in **one** QUESTION message (§6). Work on the independent parts meanwhile.

## 2. Token-efficiency rules
`docs/ux/wave2/README.md` §2 applies verbatim. Wave-3 additions:
- **Reuse the wave-2 deliverables, never re-implement them:**
  - `DrillLink`, `flags/why.ts` (W2-09b);
  - `<Explain>` + the explain namespace (W2-16);
  - `LegalLinks` + the legal registry (G-11);
  - `awaitingDecision` (G-12a);
  - `computeDueDate` (W2-03), `termsCheck` (G-17);
  - `parseDecimalInput` / `moneyText` (G-13), `formatIls({signDisplay})` (H-01);
  - the transition kernel, `withIdempotency`, domain events and `invoiceStateOf` (G-05);
  - the capabilities (G-07), `receiptTruth` / `PO_MATCHABLE` (G-04), `TaskSource` + `tasks.mine` + nav badges (W2-08);
  - `resolveExpectedPrice` (W2-06), `registerOutboxKind` (W2-05), `notify()` / recipients (G-06), `decideLink` (G-08);
  - COVERAGE fragments `coverage/<ID>.ts` (W2-01).
- A slice is one PR. Between slices your session idles and frees its slot.

## 3. The lab
Same as wave 2 (`docs/ux/wave2/README.md` §3, `lab.sh`, `shot.cjs`). Seeded months: `apps/web/e2e/seededMonth.ts`; Israel-day fixtures `israelToday` / `israelMonth`. Never the UTC day.

## 4. Quality bar
Wave-2 §4 plus the wave-3 exit criteria your package contributes to:
- **Money:** the money states sum to the hero leak to the agora; each decision has one effect across all 8 readers (site, e-mail, WhatsApp, Ask, mobile, report, export, digest); every metric shows the same ₪ everywhere; a closed month never restates.
- **Alerts:** real push only once Phase-6 credentials exist. Until then, mock providers report `skipped`.
- **Tests:** G-16 invariants green in warn mode. The leak canary and both attack suites are always green.
- **₪-moving changes and data fixes** (G-14, H-07, H-08, any backfill) need a signed before/after report, and ציקטי is told before the deploy. A data fix also needs a read-only report and human approval (decision 24).

## 5. Merge protocol
- **Branch:** `claude/ux-<id>[<slice>]-<slug>` (e.g. `claude/ux-w3-02a-recipes-workbench`).
- **Draft PR** `ux(<ID>): <title>`. Body sections as in wave-2 §5, plus **Lane hand-offs** (what the next package in your lane receives).
- **Subscribe to PR activity; self-repair cap 2;** then BLOCKED. A red that is only the COVERAGE completeness check (your fragment waits for a base entry) does not count: report `GREEN-pending-<PR>`.
- **Never merge, deploy, write to a production DB, send real e-mail or WhatsApp, or spend money.** The orchestrator integrates on `release/wave-3` in §10 order.
- **Human-PR (ʰ) packages** draft a proposal branch + a Hebrew summary. The owner approves, and a human merges.

## 6. Communication
As in wave-2 §6: `[<ID>] GREEN|GREEN-pending-<PR>|BLOCKED|QUESTION · PR #<n> · <≤3 lines>` to the orchestrator via `send_message`. No progress chatter.

## 7. Owner decisions (binding)
- Everything in `docs/ux/wave2/README.md` §7, §12 and §13.
- **Decided since:**
  - 7 (the bookkeeper reads everything; account-card edits are audited);
  - 11 (a 30-day Pro trial; the prices and entitlements are still open, H-10ʰ);
  - 12 (the old mobile app is frozen; kit §7);
  - 14 (no alerts 23:00–06:00 or on Shabbat, ≤6 per person per day);
  - 16 (a supplier reminder is a draft sent only on a click).
- **Pending owner** (treat as open until §13 records the confirmation):
  - 6 (receiver and chef see no ₪ server-side; the chef is exempt on `orders.*` and recipes). Kit §7 already holds the UI rule; H-11ʰ's server strip waits for the owner's confirmation;
  - 13 (no PIN and no device mode: H-04 and W3-07b drop them). Kit §7 already says "no PIN"; device mode is confirmed by approval 7. Until then, build nothing that needs either.
- **Still open:** 2 (legal facts; H-02), 15 (right-aligned numbers, 3-user test; W4-01), and the AU defaults D1–D14 (`docs/ux/automation/README.md` §7.2).

## 8. Immutable files: human-authored PR only
- The AGENTS.md list.
- **Plus, once G-13ʰ merges and the owner amends AGENTS.md:** `packages/types/src/{number-input.ts,money/**}` and `packages/api/src/reports/{bidi,money}.ts`.
- **₪ definitions in `packages/charts`** (G-14ʰ, H-07ʰ, and the co-owned `chain.ts` / `coverage.ts` / `automation.ts` slices when their ₪ math changes) are human-PR by the ownership map.
- **Globs never include immutable files:**
  - W3-08 `reports/**` excludes `bidi.ts` and `money.ts`;
  - H-05ʰ owns `outbox.ts` and `cron.ts` as a human PR; H-07ʰ adds one `cron.ts` registration line in its own human PR;
  - W3-06 and W3-07b exclude `lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`;
  - W4-01 excludes `lib/money.ts`, `lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`.
- Attack suites (`*attack*`) are add-only, and tenant-security-warden reviews them.

## 9. Wave-3 ownership ledger (who may edit what)
Abbreviations as in wave-2 §9 (`web/`, `dash/`, `cmp/`, `nav/` = `apps/web/lib/nav/routes/`, `msg/`, `api/`, `wkr/`).

Every package also owns:
- `api/__tests__/coverage/<ID>.ts`;
- `web/e2e/<ID>.spec.ts` and `__screenshots__/<ID>/**`;
- the tests its brief lists.

**Route-folder rule:** owning `dash/<seg>/**` includes `nav/<seg>.ts`, except W3-01's nav core, and only on a base that contains W2-08's merge. Lines in `nav/registry.ts` and `web/lib/publicPaths.ts` come through the orchestrator. Anything not listed is read-only: ask first.

| Pkg | Owns |
|---|---|
| G-14ʰ | new `packages/charts/src/{leak-ledger,decisions,metrics}.ts` (from ~24.11); `charts/src/{leak-views,owner-kpis,leaks,index}.ts` (after #196 is frozen); `api/lib/claims.ts`; `api/match/persist.ts` (no basis write); `api/contracts/overContract.ts`; `api/routers/owner.ts`; its tests; pre-exports `charts/src/coverage.ts` for W3-09. Reads `discrepancies.basis` as opaque jsonb with a local type |
| G-15ʰ | `packages/matching/src/{engine,index}.ts` (additive basis), new `matching/src/__tests__/basis.test.ts`, `api/approvals/engine.ts`, new `api/__tests__/approvals-engine-routing.test.ts`, `api/match/consolidated.ts` (after the G-04 addendum), one basis line in `api/match/persist.ts` (after G-14 merges) |
| G-16 | new `web/e2e/invariants/**`, `web/e2e/helpers.ts`, new `api/__tests__/invariants/**`, new `web/scripts/guards/**`, `web/eslint.config.mjs` (after W2-15 final) |
| H-04ʰ | `packages/db/src/schema.ts`, the next migration + journal, `supabase/**` via sync, the `rls/0002` list, shape tests (serial after H-03) |
| H-05ʰ | `api/notifications/**` (incl. `outbox.ts`), `wkr/src/cron.ts` (after H-07's line), `wkr/src/jobs/{outboxDispatch,recoveryReminders,matchInvoice}.ts` (after AU-04 is integrated) |
| H-06ʰ | new `web/app/s/c/**`, `web/app/api/claims/**`, `api/claimPortal/**`, public-route attack tests |
| H-07ʰ | `charts/src/{leak-hero,leak-report}.ts`, new `wkr/src/jobs/leakMonthClose.ts` (catch-up on first run), one registration line in `wkr/src/cron.ts`, named charts tests |
| H-10ʰ | `packages/db/src/plans.ts`, `packages/billing/**` (no migration) |
| W3-01 | `dash/{chain,branches}/**`, `dash/{branch-switcher.tsx,branch-actions.ts,layout.tsx,nav.tsx}`, `web/lib/nav/**` core + `nav/{chain,branches}.ts`, the branch column/filter only in `dash/{approvals,invoices}/**`, `api/routers/{chain,approvals,payRun,invoices}.ts`, `chain.attack.test.ts`, `msg/{chain,nav}/**`. **`charts/src/chain.ts` is a separate slice co-owned by matching-engine-guardian** |
| W3-02 | `dash/{recipes,inventory}/**`, `nav/{recipes,inventory}.ts`, `api/routers/{recipes,inventory}.ts`, `api/{recipes,inventory}/**` (not `recipes/csv.ts` parsing internals), `recipes*.test.ts`, `msg/{recipes,inventory}/**` (after W2-16b's recipes rows) |
| W3-03 | `web/lib/pwa/**`, `web/public/pwa/**`, `web/app/receiver-sw.js/**`, new `dash/share/**`, `dash/receiving/**`, `showcase/receiver/{_steps/**,_state.ts,_mock.ts}`, new `dash/settings/notifications/**`, new `cmp/field/**`, `web/package.json` + `pnpm-lock.yaml` (**the one dependency commit lane**), `wkr/src/jobs/{dailyExpectations,supplierDelays}.ts` (after AU-04), `api/routers/push.ts`, `msg/{receiving,common}/**` |
| W3-04 | `dash/{search.tsx,searchOptions.ts}`, new `web/lib/hotkeys.ts`, new `cmp/palette/**`, `dash/ask/**`, `api/ask/**` (after AU-06), `api/routers/{ask,search}.ts`, `{ask,search}*.test.ts`, `msg/ask/**` |
| W3-05 | new `dash/close/**`, `dash/exports/**`, `nav/{close,exports}.ts`, `api/routers/{close,exports}.ts`, `api/exports/**`, `exports*.test.ts`, `msg/accounting/**` |
| W3-06 | `web/app/(marketing)/**` except `{privacy,terms,cookies}`, `web/app/page.tsx`, `web/app/showcase/**` except `receiver/{_steps,_state,_mock}`, `web/lib/heroMedia.ts`, `web/public/media/**`, `api/routers/leakCheck.ts`, `msg/{marketing (not legal.*),landing,showcase,leakCheck}/**` |
| W3-07a | `web/app/admin/**` (incl. `layout.tsx` once G-11 has merged; not `admin/automation/**`; `admin/restaurants/[id]/FeaturesPanel.tsx` only after AU-01 is GREEN), `dash/integrations/**`, `dash/settings/**` except `notifications/**` and `automations/**`, `api/routers/{admin,integrations,settings}.ts` (not the `admin.automationKpis` procedure), their tests, `msg/{admin,integrations,settings}/**` |
| W3-07b | `dash/team/**`, `web/app/{login,(auth),invite,onboarding,join,welcome}/**`, `web/auth.ts`, `api/routers/{team,onboarding}.ts`, their tests, `msg/{auth,onboarding,team}/**`, `e2e/{auth,consent-login}.spec.ts`. Excludes `web/lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`; warden reviews `/join` |
| W3-08 | `dash/reports/**`, `api/reports/**` except `{bidi,money}.ts`, `api/routers/monthlyReport.ts`, `nav/reports.ts`, **`msg/index.ts` (only W3-08 in wave 3)** + new `msg/reports/**`, `monthly-report*.test.ts` |
| W3-09 | `web/app/s/**` except `c/**`, `web/app/api/supplier-confirm/**`, `api/supplierConfirm/**`, `api/orders/**`, `api/routers/{orders,receiving}.ts`, `dash/orders/**`, `cmp/documents/**`, `wkr/src/jobs/{syncPlatforms,orderReminders,orderCutoff}.ts` (AU-11 addendum), `{order,supplierConfirm}*.test.ts`, `msg/{supplierConfirm,orders}/**`. **New `charts/src/coverage.ts` is a separate slice co-owned by matching-engine-guardian** |
| W3-10 | `dash/{catalog,products}/**`, `dash/contracts/import/**` + `api/contracts/import.ts` (transferred from W2-12), `api/catalog/**`, `api/routers/{catalog,mapping,products}.ts`, `packages/catalog/**` (after the G-08 sweep), `wkr/src/jobs/importCatalog.ts`, `catalog*.test.ts`, `msg/{catalog,products}/**` |
| W3-11 | `packages/ocr/**` (lock after G-17/AU-02/AU-10), `api/ingest/**`, `dash/{inbox,recovery,leaks/claims}/**`, `dash/suppliers/ledger/**`, `api/routers/{ingest,recovery,suppliers}.ts`, `api/{recovery,ledger}/**`, their tests, `msg/{ingest,recovery,suppliers}/**`; a capture component mounted by W3-03 |

**Hot files** (one holder at a time; the orchestrator grants the lock): see the lock table, Appendix B of the programme plan, copied here at kit time.

## 10. Start order, slices and merge steps (at most 8 sessions at a time, AU included)
**Early slices (drafts before the gate; each one named in the owner's approval):**
- G-15ʰ (14.11);
- W3-04a (17.11); W3-02a (~21.11, after W2-16b's recipes rows);
- W3-05a, W3-06a, H-04ʰ (~23.11); W3-07a-1 (after AU-01 + AU-07 GREEN and W2-16b's admin rows);
- G-14ʰ new-files slice (~24.11, critical);
- W3-10, W3-02b, W3-07b, W3-01 matrix (~1.12, each after its W2-16b rows and W2-08's merge); W3-05b, W3-07a-2, W3-03a as slots free.

**After the gate:**
- W3-03b, W3-09 (+AU-11), H-05ʰ (each after AU-04 is integrated); W3-08a, H-06ʰ, G-16a, W3-06b (≥7.12);
- H-07ʰ, W3-11 (after AU-10), W3-08b, G-16b, W3-04b (after AU-06) (after G-14 merges).

**Merge steps** (MASTER-PLAN §5), Thursday trains on `release/wave-3`:
1. W3-α 17.12: G-14ʰ → AU-01, AU-07, AU-04, AU-02 → the independent slices W3-04a, W3-02a, W3-05a, W3-07a-1, W3-06a → H-10ʰ (if decided). H-04ʰ (no CHECK) merges Tue 22.12 09:00 as a schema PR.
2. W3-β 24.12: G-15ʰ, W3-10, W3-02b, W3-05b, W3-07a-2, W3-07b, W3-09 (+AU-11), W3-03; AU-03, AU-06, AU-08, AU-10, AU-13, AU-14.
3. W3-γ 31.12: H-07ʰ, W3-01, W3-08, W3-04b, W3-06b; AU-09, AU-12, AU-15.
4. W3-δ 14.1: W3-11 → H-05ʰ (+H-05a) → H-06ʰ → G-16 last. The H-04 CHECK merges Tue 19.1 as a schema PR.

| Pkg | Start before deps merge? Build against | Step |
|---|---|---|
| (one row per package, from programme plan §5.3) | | |

**Day-1 rule:** publish your dependents' exports in your first commit (e.g. W3-04 `normalizeHe`, W3-03a `ScanButton`, G-14 `charts/coverage.ts`, G-15 the `basis` type).

## 11. Reference copies (read by line range only)
- `docs/ux/IMPLEMENTATION-PLAN.md` §4 (≈520–615, wave 3), §5 (≈616–630, wave 4), §6 (631+).
- `docs/ux/wave2/ref/GAP-PACKAGES.md`: G-14 (201–220), G-15 (222–231), G-16 (233–258); Part B amendments. GAP:207 (G-14 storing G-15's basis) is superseded: G-15 writes that line after W3-α.
- `docs/ux/wave2/ref/MASTER-PLAN.he.md` §1 (critical path), §4 (quality gates), §5 (merge order).

## 12. Automation track hooks (AU-xx, `docs/ux/automation/`)
- **Rule:** an AU package runs after its lane's wave-2 owner is GREEN and integrated, and merges before the wave-3 successor takes the same files; where that can't fit, it is an addendum slice of the successor. It counts toward the 8 slots: at most 2 until 3.12, at most 3 in December.
- **Named hooks:**
  - `⟨AU-hook:switch⟩` AU-01 → W3-07a-1 (after AU-01 GREEN);
  - `⟨AU-hook:kpi⟩` AU-07 → G-14/H-07, W3-07a-1 (`admin/automation/**` carve-out, `admin.automationKpis`);
  - `⟨AU-hook:intake⟩` AU-02 → AU-10 (`crossChannelHold` in `ocrInvoice.ts`) → W3-11;
  - `⟨AU-hook:recovery⟩` AU-03 → W3-11 / H-05;
  - `⟨AU-hook:briefs⟩` AU-04 → AU-12 → H-05 / W3-03 (H-05 and W3-03b start after AU-04 is integrated);
  - `⟨AU-hook:ask⟩` AU-06 → W3-04b;
  - `⟨AU-hook:vat⟩` AU-08 → W3-05;
  - `⟨AU-hook:consolidated⟩` AU-09 (after G-15's `consolidated.ts`) → H-08ʰ;
  - `⟨AU-hook:orders⟩` AU-11 = an addendum slice of W3-09;
  - `⟨AU-hook:prices⟩` AU-13 (beside W3-10, path-disjoint) / `⟨AU-hook:learn⟩` AU-15 (after W3-10 merges) → W3-10's pages by props;
  - `⟨AU-hook:payrun⟩` AU-14 → W3-01;
  - phase C: AU-16 + H-12ʰ/H-13ʰ, AU-17 (after H-05 + H-06), AU-18 (after W3-05 + W3-11), AU-19 (after AU-14).
- **New human PRs from the AU track** follow the same serial lanes:
  - H-12ʰ (`approvals/engine.ts`) goes after G-15;
  - H-13ʰ (schema) goes after H-04, merged on a deploy Tuesday;
  - the H-05a addendum folds into H-05.

## 13. Updates from the orchestrator
- (at kit time) IMPLEMENTATION-PLAN:606 is amended: the registration of the H-07 close job moves from H-05 to H-07's human PR (owner approval 13).
- (binding updates are appended here with a date)
```

---
