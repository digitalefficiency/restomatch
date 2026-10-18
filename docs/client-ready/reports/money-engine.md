# S3 — Money engine (leak correctness, approvals, owner dashboard)

Branch `claude/client-ready-money-engine` → draft PR into `claude/client-ready`.

**Headline:** the ₪ number was wrong in four ways (fabricated shortages, double counts, and every
demo invoice flagged as its own duplicate). Those are fixed with tests, the leak canary is
unchanged, and `/dashboard` now opens on one hero: **"₪X leaked this month · Y% of food spend ·
₪Z caught before payment"**. One tap goes from that number to the invoices and lines behind it, and
from there to a printable credit-request letter per supplier. Everything works in Hebrew and English.

Demo tenant after the fixes (October 2026): **₪381 leaked, 5.3% of ₪7,240 spend**, 6 of 9 invoices
flagged. Previous month: ₪1,179 (6.7%). Before the seed fix, every invoice's whole total was counted
on top of these numbers.

## Works (verified)

- Engine: 86 matching tests, including the canary (₪32.00 / ₪5.63, unchanged) and property tests.
- `persistMatchRun` now writes `price_history`. A backfill on the demo DB produced 150 rows and
  **50 baselines** (it was 0 before, so the leak detective was empty). Leak-detective heatmap verified.
- Approvals: owner, manager and bookkeeper queues; bookkeeper can approve, reject and escalate
  duplicates. Receivers are refused.
- Dashboard, leaks, breakdown, claims and approvals pages were clicked through in he + en, at
  desktop and phone width (390px). There is no horizontal page scroll; the leaks table scrolls inside
  its own card. Screenshots are in `docs/client-ready/screenshots/dashboard-*.png`.

## Fixed

| # | Problem | Fix | Test |
|---|---|---|---|
| M2 | Several partial goods receipts against one PO line: the last one won, so the received qty was under-counted and a **fake QTY_SHORT** appeared | Sum `qtyReceived` per `poLineId` | `packages/matching/src/__tests__/engine.money-fixes.test.ts` (M2 block) |
| M3 | Baseline check added a **second PRICE_HIGHER** on a line the PO check had already flagged (double count). It also compared the raw per-g price against a per-kg baseline | Skip the baseline when the PO check already flagged the line. Use unit-normalized price and qty. Skip when units can't be converted | same file (M3 block) |
| new | Ordered 10, received 8, billed 10 → QTY_SHORT ₪16 **and** QTY_OVER ₪16 for the same 2 missing units (₪32) | QTY_SHORT keeps only the shortfall that was *not* billed. Both facts are still reported | same file ("counted once") |
| new | `ק״ג` (Hebrew gershayim, the most common unit in the data) was "unknown", so there was a **false UNIT_MISMATCH vs `kg`** and the units couldn't be converted | `units.ts` normalizer strips ׳ ״ | `units.test.ts` |
| M1 | Nothing in production wrote `price_history`, so baselines and the leak detective stayed empty forever | `writePriceHistoryForInvoice`, called from `persistMatchRun`. Idempotent per invoice, tenant-scoped, unit-normalized to the product's default unit, skips unmapped lines and duplicates. Plus `backfillPriceHistory` and `packages/api/scripts/backfill-price-history.ts` (also recomputes baselines) | `packages/api/src/__tests__/match-money.test.ts` |
| new | DUPLICATE_INVOICE could never fire: the DB unique index `(supplier_id, invoice_number)` rejects an exact repeat, and real double bills arrive re-typed (`INV-0012` vs `12`). Re-matching the original after a duplicate would also flag the original | Duplicate check uses normalized numbers (letters/digits, upper-case, no leading zeros) and only looks at invoices created **before** this one | `match-money.test.ts` |
| new (seed) | `seed-demo.ts` added the invoice number to `knownInvoiceNumbers` *before* `runMatch` (same Set, by reference), so **all 30 demo invoices were DUPLICATE_INVOICE blockers at their full total** | Register the number after `runMatch` (1 line) | Verified on the dev DB: 0 duplicates after reseed |
| W2 | Approvals role deadlock: DUPLICATE_INVOICE routed to the bookkeeper, but approve/reject/escalate were manager-only, and a manager couldn't even see the item | approve/reject/escalate allow owner, manager and bookkeeper. `ensureCanAct` still enforces `requires_role`. Items with no routing stay owner/manager only | `approvals-router.test.ts` (4 new tests) |
| new (all English pages) | `globals.css` sets `html { direction: rtl }`, which overrides `<html dir>`, so **every English page rendered right-to-left** | Appended `html[dir='ltr'] { direction: ltr }` | Visual: screenshots |
| UI | Dashboard KPI "savings captured" also counted auto-accepted `info` items. Approvals showed English engine text and raw epoch numbers (DATE_ANOMALY). Leaks table overflowed on phones. Everything was Hebrew-only | New hero (below). Approvals: translated type, plain-language "why", routing reason looked up by `ruleId`, product/supplier/invoice context, escalate button, error state, values without NUMERIC noise. Leaks table scrolls inside its card | typecheck + i18n parity test |

### New: leak hero and drill-down (`owner.leakHero`, `owner.leakBreakdown`)

`packages/charts/src/leak-hero.ts`, tests in `packages/charts/src/__tests__/leak-hero.test.ts`.
The rules are designed so an owner believes the number:

- **Month:** the restaurant's local calendar month (`restaurants.timezone`), by invoice date. The
  spend uses the same basis.
- **Leak:** Σ|delta| of `warn` and `block` discrepancies.
  - Excluded: `info` (inside the tolerance bands), PRICE_LOWER (the supplier under-charged, so it's
    not a leak) and **UNORDERED_ARRIVAL**. A no-PO invoice is usually a consolidated invoice
    (חשבונית ריכוז), so it shows calmly as "waiting for a PO link" with its own count and amount,
    never as a leak.
  - **Each invoice is capped at its own total.**
- **Spend:** pre-VAT invoice totals for the month.
- **Caught before payment:** leak on invoices that aren't marked paid.
- **Claimed:** discrepancies the team accepted to claim back.
- **Breakdown:** the invoices sum exactly to the hero (tested). Includes a month switcher.

### New: supplier credit-request letters (`/dashboard/leaks/claims`)

The highest-value proposal, implemented. It produces one printable letter per supplier (print or
save as PDF) listing every line you can claim, with the total. No new money math: it is built on the
breakdown, and each invoice is capped at its capped leak.

## Still broken / not done

- **Consolidated invoices aren't actually linked.** They are now shown as pending instead of as a
  leak, but linking one invoice to several POs (the StagedMatch idea) is still to do. Proposal #3.
- **Engine `totalDiscrepancyAmount` still includes PRICE_LOWER and stacks DUPLICATE with line
  findings** (`Σ|delta|` is the documented contract). The hero corrects for both in SQL. The
  per-match-run total (used in approval routing, notifications and `match_runs`) is unchanged.
  Changing it is a contract change for the owner to decide.
- **Short delivery that wasn't billed is still counted as leak** (the canary's headline scenario,
  ₪16 for 2 kg not delivered and not billed). That is a product decision baked into the canary, and I
  didn't change it. If the owner wants "leak = money paid for nothing", the canary would become ₪16
  instead of ₪32. **Proposed value, not applied.**
- **Activity feed text** is written in Hebrew at insert time (`logActivity` titles), so it stays
  Hebrew in English. A proper fix stores an event key plus params; the component belongs to S5.
- **Claim letter restaurant name** uses the user's first membership (fine for single-restaurant
  owners).
- `owner.kpis` (`monthSavingsCapturedIls`) still counts auto-accepted info items. The dashboard no
  longer shows it, and I left the function's contract and tests alone.

## Feature and improvement proposals (ranked by client value ÷ effort)

1. **Credit-request letters** — *done* (S).
2. **Monthly leak report email/PDF** to the owner on the 1st: the hero, the top 5 invoices and the
   claim letters attached. The data is all in `leakHero`/`leakBreakdown`; needs a cron job (S7/S4
   own cron and email). **M, ~1 day.**
3. **Consolidated-invoice linking:** suggest the POs inside a חשבונית ריכוז by supplier and date
   range, then one-click link and re-match. Removes the last false-alarm path. **M–L, 2–3 days.**
4. **Supplier price-creep alert:** "Sharon Produce raised tomatoes 3 times in 60 days, +14%." The
   baselines now exist; needs a weekly job plus a card. **S–M, ~1 day.**
5. **Credit-note tracking:** mark a claim as sent, then credit received (amount and date). "Claimed →
   recovered" becomes a real ₪ number and closes the loop on the hero. **M, ~1–2 days.**
6. **Pay-hold integration:** block "mark paid" while blocker discrepancies are open. That makes
   "caught before payment" enforceable. **S.**
7. **Fuzzy duplicate detection** on same supplier + same total ±₪1 + date ±3 days (beyond
   invoice-number normalization). **S.**

## Immutable files touched (owner-authorized this sprint)

- `packages/matching/src/engine.ts` — M2 sum, M3 baseline guard and unit normalization, QTY_SHORT
  overlap. The money helpers, tolerances, VAT and severity thresholds are untouched.
  **Canary unchanged and green.**
- `packages/matching/src/units.ts` — normalizer strips ׳ ״ (one regex).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts` — **additive**: COVERAGE entries plus
  isolation tests for `owner.leakHero` and `owner.leakBreakdown`. No assertion removed.
- `packages/api/src/routers/approvals.ts` *(not on the list, but it is the approvals trust
  surface)* — role gate widened to include the bookkeeper. Per-item `requires_role` is still
  enforced, and unrouted items are tightened to owner/manager.
- `packages/api/src/approvals/engine.ts` — **not touched**. The deadlock was fixed on the router side
  so the routing rules stay byte-identical.

## Needs another area

- **S1 (seed/db):** I made a 1-line fix in `apps/worker/scripts/seed-demo.ts` (register the
  invoice number after `runMatch`). Please keep it when merging. Also:
  - call `computeBaselines` at the end of the seed, or run `packages/api/scripts/backfill-price-history.ts`,
    so the leak detective is populated in the demo;
  - populate `products.name_en` and `suppliers.name_en`. My pages already show them in English
    when present.
- **S6 (landing / globals.css):** I appended `html[dir='ltr'] { direction: ltr }`. The base rule
  `html { direction: rtl }` broke every English page. Keep it or fold it into the base rule.
- **S5 (components):** `DashboardSearch` throws a hydration mismatch warning (`caret-color` style).
  `ActivityFeed` titles are Hebrew-only (see above).
- **S7 (worker/cron):** schedule the `baselines` job after the nightly `match` batch, and add the
  monthly leak report (proposal #2).
- **S2 (scans):** `invoice_lines.raw_description_en` is shown in the breakdown when the product
  isn't mapped.

## Gate

```
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test pnpm test
  → Tasks 12/12 successful (matching 86, charts 26, api 399, web 132, worker 9+1 skipped, …)
packages/matching: npx vitest run              → 86 passed (new tests fail 7/9 on the old engine)
packages/api|charts: npx tsc --noEmit -p .      → 0 errors
apps/web: npx tsc --noEmit -p .                  → 0 errors
apps/web: npx vitest run lib/__tests__/i18n.test.ts → 31 passed
apps/web: pnpm build (with .env.local)          → success (all routes compiled)
apps/web: npx vitest run                         → 132 passed (after final UI edits)
Playwright screenshots (he/en × desktop/390px)   → 20 shots, 0px horizontal page overflow
```
