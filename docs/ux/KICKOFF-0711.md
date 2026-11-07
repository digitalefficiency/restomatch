# Kickoff 7.11: "build all the waves and don't stop" (owner)

On the evening of Sat 7.11 the owner ordered: **build every remaining package of every wave now, and don't stop.** This file is the shared kickoff for every session started that evening. It overrides the start dates in `docs/ux/wave3/README.md` §10, `docs/ux/wave2/ref/PROGRAMME-PLAN-0711.md` §5.3 and the AU/WA session caps. It does NOT override `AGENTS.md`, the immutable list, the ownership ledger, the hot-file locks, the merge trains, or the binding owner decisions.

## 1. Common rules (every package)
1. **Read first, by line range, never whole big docs.**
   - Always: `AGENTS.md` (auto-loaded); `sed -n 1,40p STATE.md`.
   - From the kit branch (`git fetch origin claude/wave2-kit-addendum-0711`, then `git show FETCH_HEAD:<path>`):
     - this file;
     - `docs/ux/OWNER-DECISIONS-0711.md` (binding);
     - `docs/ux/terms/GLOSSARY.md` §1–§2 (partner wording toward suppliers);
     - your track playbook (§2).
2. **Start now, even if a dependency is not on `main`.**
   - Build your independent slice first: new files, server parts, pure logic and tests.
   - Adopt each dependency when it lands on `main`, by merging `main`.
   - Never copy another package's unmerged code.
   - Never base on another package's branch. The schema lane is the exception: it stacks as the briefs say.
3. **Your first commit is your own brief**, `docs/ux/<track>/<ID>.md`, in the kit shape: One line · 1 Start here · 2 Write boundary · 3 Depends on / base / branch · 4 Slices · 5 Acceptance · 6 Tests · 7 Done.
   - Source it from your row in §3 below, `docs/ux/IMPLEMENTATION-PLAN.md` (your section), and your track's docs.
   - Send the orchestrator a ≤10-line summary of it, then **keep building**. Do not wait for a reply.
4. **Boundaries.**
   - The ownership ledger (`docs/ux/wave3/README.md` §9) and the hot-file locks are binding.
   - If you need a file you don't own, send ONE QUESTION and work on the rest meanwhile.
   - A line in `nav/registry.ts`, `publicPaths.ts`, `msg/index.ts` (W3-08 only), `features.ts` or `api/index.ts` goes through the orchestrator.
5. **Immutable files** (`AGENTS.md` list): draft a HUMAN-PR proposal branch `claude/<id>-hpr-<slug>`, open it as a draft PR titled `HUMAN-PR proposal (<ID>): …`, stop that part, and build the rest behind an interim.
6. **Quality.**
   - Hebrew-first RTL, every pair AA.
   - ₪ only via `formatIls()` / `<Money>` (UI) and `moneyText` (server).
   - Tier vocabulary T1–T4.
   - Partner wording toward suppliers: בקשת זיכוי, never דרישה / תביעה / מחלוקת / חוב / באיחור (glossary).
   - Receiver and chef see no ₪, except the chef on orders and recipes.
   - Every new tRPC procedure gets `coverage/<ID>.ts` (`git add -f`), never base COVERAGE lines, plus a cross-tenant attack test. The coverage-completeness red that waits on #180 is expected and known.
7. **Lab.**
   - `bash docs/ux/wave2/lab.sh <ID>` under faketime: `FAKETIME_DONT_FAKE_MONOTONIC=1 faketime -f '@2026-10-25 09:30:00' …`.
   - Run `pnpm install` OUTSIDE faketime.
   - Pin the Playwright clock to 2026-10-25T09:40Z.
   - Clear `rate_limit_counters` before e2e runs.
   - Run nav-fit and W1-03 at real time.
   - The lab may need `ALTER USER postgres PASSWORD 'postgres'` plus the pgvector and faketime apt packages.
8. **Delivery.**
   - Targeted tests while iterating; one push per milestone; draft PRs only.
   - Never merge, deploy, write to prod, send real messages or spend money.
   - Efficient budget: no workflows, and at most one review subagent before your final push.
9. **Messages to the orchestrator** (`session_015veCjPjLCiZbqnYFJpdzvR`, via `send_message`):
   - one per event, `[<ID>] GREEN|BLOCKED|QUESTION · PR #n · ≤5 lines`;
   - no progress chatter.

## 2. Track playbooks
| Track | Playbook | Brief source |
|---|---|---|
| W3 / H / G-16 / W4 | `docs/ux/wave3/README.md` (kit branch) | `docs/ux/wave2/ref/PROGRAMME-PLAN-0711.md` §5.3–5.4 row + `docs/ux/IMPLEMENTATION-PLAN.md` (main) + GAP-PACKAGES |
| AU | `docs/ux/automation/README.md` on `origin/claude/research-in-app-automation` | `docs/ux/automation/AU-xx.md` on the same branch (`git show origin/claude/research-in-app-automation:<path>`). Its §10 session caps are lifted by the owner. |
| WA | `docs/ux/whatsapp-agent/README.md` on `origin/claude/whatsapp-agent-research` | `docs/ux/whatsapp-agent/WA-xx.md` there. Server-only, lab-only; no Meta calls; WD2 = ₪500 rule. |
| IA | `docs/ux/ia/IA-SPEC.md` (kit branch): the 8 rules, density budgets, placement matrix, top-12 | Your row below |

## 3. Packages started 7.11 evening (what to build first)
| ID | Branch | Start now (independent slice) | Adopt later | Human PR? |
|---|---|---|---|---|
| W2-16b | claude/ux-w2-16b-copy-rows | Copy rows in order: recipes → admin → catalog/products → chain/branches → auth/onboarding → reports. Also the supplier-wording rest in GLOSSARY §3c, and `packages/api/src/reports/monthly.ts` wording. Each row goes GREEN so W3-02 / W3-07a / W3-10 / W3-01 / W3-07b / W3-08 can adopt it. | W2-16 (#204) on main | no |
| W3-01 | claude/ux-w3-01-chain | Matrix slice: `api/routers/chain.ts` procedures + `chain.attack.test.ts` + the `dash/chain/**` page against a local nav entry. `charts/src/chain.ts` is a separate slice (co-owned by matching-engine-guardian; human PR if ₪ math changes). | W2-08 nav (merge), W2-16b chain rows, G-14, AU-14 pay-run column | chain.ts only if ₪ math changes |
| W3-02 | claude/ux-w3-02-recipes | a: recipes (router, `recipes.preview`, `coverage/W3-02.ts`, `parseDecimalInput`). IA-02's kitchen numbers: fix the chef's error card at the top of "עלות מנה". b: inventory and control room after W2-07 lands. | W2-16b recipes rows, W2-07 (#253), H-04 kitchen-card fields | no |
| W3-06 | claude/ux-w3-06-marketing | a: pricing and showcase pages. The lead form is a Server Action behind the leads guard. | G-11 on main; H-10 (trial copy, after the pilot) | **yes if** it touches leads.ts, route.ts or rateLimit.ts |
| W3-07a | claude/ux-w3-07a-admin | 1: admin console with staged writes and a required reason, using the plan's fallback carve-outs (FeaturesPanel, api/lib/features.ts, admin.automationKpis left to AU-01/AU-07). 2: integrations + settings after W2-14. | AU-01 + AU-07 GREEN, W2-16b admin rows, W2-14 merge | no |
| W3-07b | claude/ux-w3-07b-team-auth | `/join/[token]` + e-mail code server flow (tenant-security-warden reviews), `/welcome`, team screens. publicPaths line via orchestrator. Excludes `lib/rateLimit.ts` and `api/trpc/[trpc]/route.ts`. | W2-14, G-11, W2-16b auth rows | human PR if it needs an excluded file |
| W3-08 | claude/ux-w3-08-reports | a: owner decision I4 "דוח החודש" with 3 tabs (המספר וההוכחה · לפי ספק וסוג · כך זה נשלח) replacing the 5 month summaries; adds `reports` to `msg/index.ts` (only W3-08). Owner decision D11: Frank Ruhl Libre on the report cover and print header (coordinate the font file with W2-15's β swap). b: money after G-14. | W2-16b reports rows, W2-08 nav, G-14 | no |
| W3-09 | claude/ux-w3-09-orders | Orders and supplier confirm, plus the AU-11 addendum (draft builder, `orderCutoff.ts`, backorder hook). Server parts and tests first. `charts/src/coverage.ts` is a co-owned slice. | W2-06, G-10, G-05 on main; AU-04; H-04 opened_at | coverage.ts only if ₪ math changes |
| W3-10 | claude/ux-w3-10-catalog | Catalog and products pages, mapping (narrow mapping.ts/catalog.ts taken over from G-08), contracts import (from W2-12). Build against `normalizeHe` from #246 by merging main once W3-04a lands; until then, a local adapter. | G-08 sweep, W2-08, W2-16b catalog rows, H-03 effective_from | no |
| W3-11 | claude/ux-w3-11-documents | ONLY the non-locked slices now: `dash/{inbox,recovery,leaks/claims}/**`, `dash/suppliers/ledger/**`, routers ingest/recovery/suppliers. `packages/ocr/**` and `ocrInvoice.ts` are LOCKED (order G-06 → G-09 r5 → G-17 → AU-02 → AU-10 → W3-11): do not touch them. A credit note is never a short-pay. | G-14, AU-02/03/10, W2-10/W2-11 | no |
| H-05ʰ | claude/ux-h-05-notify-send | Send path through mocks; the H-05a addendum (AU schedules); quiet hours / Shabbat / ≤6 per person via G-06 notify(); chase drafts day 3/7/14 reconciled with the 7-day rule. outbox.ts + cron.ts are immutable → HUMAN-PR proposal. | AU-04, G-06, #173 | **yes** |
| H-06ʰ | claude/ux-h-06-claim-portal | Supplier reply link for a credit-request letter: a 72 h per-letter token via claim_letters or a signed token; guardPublicRequest per IP and per token hash; partner wording ("מכתב בקשת זיכוי"). publicPaths line via orchestrator. | W2-10, G-03 deployed (24.11) | **yes** |
| H-07ʰ | claude/ux-h-07-month-close | `leakMonthClose` job body + tests (snapshot on the 5th, catch-up for closed months, dated corrections, "a closed month never restates"); reads H-03 leak_month_* (stack on H-03's branch for the schema only). The `cron.ts` registration line is a HUMAN-PR proposal. | G-14 merge, H-03 deploy | **yes** |
| G-16 | claude/ux-g-16-guards | a: guards + API invariants in warn mode with per-area counts (`web/e2e/invariants/**`, `api/__tests__/invariants/**`). b: the e2e crawl after W2-08 + W2-09. | W2-08, W2-09, W2-15 final (eslint) | no |
| IA | claude/ux-ia-01-03 | IA-01: density-budget check (per screen type: words, numbers, colour marks, primary buttons) in report mode, first on the homes, queues and records. IA-03: visible role lenses: one permission source deciding what each role sees, a "next step" on 403, bookkeeper read-only on the 10 screens (owner I3). Server strips stay H-11ʰ. IA-02 kitchen numbers are done by W3-02. | W2-08 (homes), G-07 (can()), H-11 | no |
| H-11ʰ | claude/ux-h-11-money-strip | Server-side ₪ strip for receiver and chef (chef exempt on orders.* and recipes): orders.list, catalog listPrice, suppliers.ledger/ledgerGrid, honest typing, FORBIDDEN assertions (add-only). Today owner.leakHero/leakSummary/kpis and recovery.returnedThisMonth return ₪ to any member (IA review). Pilot #219 already strips several procedures. | #219 on main (train B), G-14 (owner.ts) | **yes** |
| AU-01 · AU-03 · AU-04 · AU-06 · AU-07 · AU-08 · AU-13 · AU-14 | claude/au-xx-<slug> (brief §3) | Per their brief. AU-02 and AU-10 wait for the ocrInvoice.ts lock. AU-09 waits for G-15 merge, AU-12 for W3-03, AU-15 for W3-10. | per brief | per brief |
| WA-01 · WA-02 | claude/wa-xx-<slug> | WA-01: golden set + simulator + recorded responses (tests only). WA-02: agent core (registry, redact, render, budget, prompt) on the Ask engine, server-only, no webhook. | Ask (G-12b/AU-06/W3-04b), G-07/H-11 | no |
