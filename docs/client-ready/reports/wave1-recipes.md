# Wave 1 — Food cost per dish (`recipes`) — S17 report

Branch `claude/wave1-recipes` → draft PR into `claude/client-ready`. Flag key `recipes` (off by default;
on for the demo tenant through `features.all`; `FEATURES_OFF=recipes` kills it).

> **לבעלים:** מסך "עלות מנה" — כמה עולה כל מנה לפי המחירים ששולמו בפועל, אחוז עלות מזון מול יעד
> (ירוק/כתום/אדום), רווח לצלחת, "מה השתנה החודש" (מה הזיז את העלות), "מה אם המחיר יעלה?"
> (עוף +12% ← אילו מנות נפגעות ובכמה), עורך מתכונים עם תתי-מתכונים, וייבוא מ-CSV. במסעדת הדמו:
> 8 מנות + 2 רטבים; הסטייק (₪199 בתפריט) חצה את יעד 30% החודש — 29.3% ← 31.4% — כי קצביית הכרם העלתה את
> האנטריקוט מ-₪139 ל-₪149/ק״ג (+₪3.41 לצלחת). התראה על כך מופיעה על כרטיס המנה (דגל `dishPriceAlert`).
> (מספרים לפי DEMO_TODAY=2026-10-25; הסעיפים ההיסטוריים למטה מתעדים את המספרים של אותו סבב.)
> מספרי הדליפה לא זזו.

## What was built

| Area | What |
|---|---|
| Data | Migrations **0056** (`products (id, restaurant_id)` unique key as a composite-FK target + a latest-price index on `price_history`) and **0057** (`recipes`, `recipe_items`). Lines are EITHER a product OR a sub-recipe (CHECK), net qty + unit + waste % + an optional unit bridge (`units_per_product_unit`, e.g. 30 eggs per tray). Menu price is **integer agorot** + `menu_price_includes_vat`. Same-tenant **composite FKs** for every reference, products/sub-recipes in use are `RESTRICT`, and RLS is **enabled in the migration** with the same `<table>_tenant` policy as `rls/0002`'s loop. Shape test: `packages/db/src/__tests__/migration-0057.test.ts`. `pnpm db:supabase-sync` appended 0056/0057 + a re-provision RLS file. |
| Cost engine | `packages/api/src/recipes/cost.ts` (pure). NUMERIC strings are parsed into scaled BigInts at the boundary. Each line is an exact rational in agorot, **rounded half-up once** (documented at the top of the file). A sub-recipe line is `batch × used / yield` (exact, rounded once). VAT is netted out of the menu price; food cost is in basis points; margin is net minus cost. Unit conversion uses `@restomatch/matching` `unitConversionFactor` (made exact via a rational) plus count/portion synonyms. Sub-recipes are recursive and memoised; cycles are blocked. Absurd inputs get an `overflow` status. Other outputs: price-change impact and month-over-month diff, the latter with the "why" line. |
| Prices | `recipes/data.ts` `latestPrices()` reads the latest **actually paid** unit price per product (`price_history`, ex-VAT, per the product's default unit). It is the single place to add contract prices once S11's `contracts` lands; nothing depends on it. |
| API | `recipes` router (`packages/api/src/routers/recipes.ts`): `enabled`, `list`, `get`, `save`, `delete`, `searchProducts`, `subRecipes`, `impact`, `changes`, `setTarget`, `importCsv`. Read/edit is `chefProcedure` (owner/manager/chef). `setTarget` is manager+. Everything except `enabled` is gated: FORBIDDEN with `appCode: 'FEATURE_DISABLED'`. The target lives in `restaurants.settings.recipes.targetFoodCostBp` (default 30%; amber band = 3 points). |
| UI | `/dashboard/recipes` has a target bar and 4 KPI cards, then 4 tabs: **Dishes** (food-cost lights + margin per plate; sub-recipes listed separately), **What changed this month**, **What if a price rises?**, **Import CSV** (dry-run preview, then commit). Editor at `/dashboard/recipes/new` and `/[id]`: product search combobox with last paid price, unit picker limited to convertible units (the bridge field appears when needed), waste %, sub-recipes, reorder. Nav link "עלות מנה / Food cost" shows only when the flag is on and the role may see it. Route roles: owner/manager/chef. |
| i18n | New namespace `recipes` (he source + typed en); `nav.links.recipes`. |
| Demo | `apps/worker/scripts/seed-recipes-demo.ts` (new, idempotent): 8 dishes + 2 sub-recipes built from the demo products. It writes **no prices**, so the hero numbers are unchanged (discrepancies 49, price_history 594, Σ\|Δ\| ₪1,859.62 before and after, run twice). The hurt dish is the **entrecôte steak**: seed-demo's butchery creep moves it from 32.8% (amber) to 34.9% (red), +₪3.10/plate. |

Run the demo: `DATABASE_URL=…/restomatch_dev pnpm --filter @restomatch/worker exec tsx scripts/seed-recipes-demo.ts` (after seed + seed-demo).

## Security

- **COVERAGE:** all 11 procedures are declared in `cross-tenant.attack.test.ts`. A new `recipes.*` block covers:
  - foreign recipe / product / sub-recipe ids → NOT_FOUND, with B's data untouched;
  - CSV names never resolve another tenant's product;
  - lists, changes and target are isolated (A's cost is computed from A's price only);
  - flag-off → FORBIDDEN.
- **RLS:** `rls.attack.test.ts` adds raw probes as `restomatch_app`:
  - GUC=A sees only A's recipes and lines; with no GUC it sees nothing;
  - a cross-tenant INSERT is refused by RLS and a cross-tenant UPDATE affects 0 rows;
  - `recipes.list` works through the app role.
- No public routes, no external services, no spending.

## Immutable / shared files touched

| File | Why |
|---|---|
| `packages/db/src/schema.ts` | Additive `recipes` / `recipeItems` tables, mirroring 0057. |
| `packages/db/drizzle/meta/_journal.json`, `supabase/released-migrations.json` + 3 new `supabase/migrations/*` | Journal entries for 0056/0057 and the supabase-sync **append** (no existing entry changed). |
| `packages/api/src/__tests__/cross-tenant.attack.test.ts`, `rls.attack.test.ts` | COVERAGE entries and recipes isolation/RLS blocks. Additions only; no assertion weakened. |
| `packages/api/src/__tests__/fixtures.ts` | `resetDb` deletes recipes before products (recipe_items → products is RESTRICT). |
| `packages/api/src/errors.ts` + `apps/web/lib/serverErrors.ts` | Added the `FEATURE_DISABLED` appCode (MASTER-PLAN §1.3), mapped to the generic "forbidden" text. Other wave-1 sessions will add the same line, so expect a trivial merge. |
| `packages/api/src/routers/products.ts` (S5) | `products.delete` returns a friendly CONFLICT for a product a recipe uses, instead of a raw FK 500. |
| `apps/web/app/dashboard/{nav,layout}.tsx`, `lib/roles.ts`, `lib/i18n/messages/nav/*`, `test/appRouterShape.test.ts` | Flag-gated nav item, route roles, nav label, router key. |
| **`drizzle/rls/0002_core_tenant_rls.sql` — NOT touched** | Editing it was blocked as immutable. 0057 instead enables RLS itself, with the identical policy and the byte-identical `app.current_restaurant_id()` (CREATE OR REPLACE). 0002's completeness invariant and `check-rls` stay green. **Owner choice:** if you prefer the tables listed in 0002's loop too, add `'recipes','recipe_items'` there (harmless; same policy). |

## Verification (2 layers)

### Layer 1 — automated gate (final code, head of this branch)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `DATABASE_URL_TEST=…restomatch_test pnpm exec turbo run test --concurrency=1` | ✅ 13/13 tasks. api **545** tests (recipes-cost 20, recipes-router 17, cross-tenant 107, rls 61); web **200** tests; db 16 files incl. migration-0057, upgrade-path, supabase-deploy, doctor; matching 86 incl. the **leak canary (unchanged)** |
| `pnpm exec turbo run typecheck` | ✅ |
| `pnpm --filter @restomatch/web exec tsc --noEmit -p .` | ✅ 0 errors |
| `pnpm --filter @restomatch/web lint` | ✅ 0 errors |
| `pnpm db:supabase-sync --check` | ✅ up to date (42 files) |
| `cd apps/web && pnpm build` | ✅ (`/dashboard/recipes`, `/new`, `/[recipeId]`) |

The first gate run found a real defect: `db:doctor` reported 3 unindexed composite FKs on `recipe_items`. That broke `upgrade-path` and `supabase-deploy`. Fix: composite indexes in 0057. My unreleased supabase-sync entries were regenerated, and no released entry was edited.

### Layer 2a — production build, he + en, every role

`next build && next start` with `NODE_ENV=production`. The web runs on the **RLS app role** (`DATABASE_URL_APP=restomatch_app`). Password login uses the seeded demo users. Local placeholder values were set for `RESEND_API_KEY` / `EMAIL_FROM` / `SUPABASE_SERVICE_ROLE_KEY` only so `assertWebEnv` boots; no email is sent. The script is `docs/client-ready/reports/wave1-recipes/layer2-recipes.mjs`.

**Result: 103/103 checks passed. Server log: 0 errors.**

- **owner / manager / chef × he / en:**
  - the nav link shows; `/dashboard/recipes` returns 200; `<html lang dir>` is correct;
  - the steak row shows **34.9%** and **₪98.80** margin;
  - What changed: steak **+₪3.10/plate**, why = **entrecôte ₪139.70 → ₪149.00**;
  - What-if: chicken +12% reaches the schnitzel;
  - the editor returns 200 and shows **₪52.89/plate**;
  - zero console errors and zero 5xx.
- **chef (he):** created a dish through the UI, saved it (verified in the DB), and deleted it through the UI.
- **receiver / bookkeeper × he / en:** no nav link; the route bounces to `/dashboard`; zero 5xx.
- **Flag off** (demo tenant `features.recipes=false`):
  - the nav link is hidden and the page renders the 404 UI;
  - `recipes.list` over HTTP returns **403 with `FEATURE_DISABLED`**;
  - the settings were restored afterwards.
- **Note:** the HTML status of a flag-off page is 200 because `dashboard/loading.tsx` streams. The content is the 404 page, the same behaviour as the existing `notFound()` pages.

Screenshots: `docs/client-ready/reports/wave1-recipes/recipes-{list,changes,impact,editor}-{he,en}.png`.

### Layer 2b — independent refuter (a subagent that did not write the code)

It found **4 confirmed defect groups. All are fixed, each with a regression test** (`recipes-router.test.ts` "refuter regressions", `recipes-cost.test.ts` "overflow is contained", `app/dashboard/__tests__/recipes-ui.test.ts`):

1. **D1 — overflow blanked every screen.** A chef could save a 0.0001-yield sub-recipe used ×99,999,999. After that, `list` / `changes` / `impact` threw a 500.
   - Fix: the engine marks that recipe `overflow` (neighbours are unaffected), and `save` rejects it with `recipes.tooLarge`.
2. **D2 — CSV dry run said OK, then the commit returned a 500 or 409.** Causes: name > 120 characters, price > ₪100k, > 80 lines, a sub-recipe that uses a later-row sub-recipe, and re-importing an in-use sub-recipe.
   - Fix: the parser enforces the same limits as save; sub-recipes are imported in dependency order; cycle and in-use problems are reported in the dry run; any commit failure rolls the whole import back.
3. **D3 — a CSV replace wiped the menu price, names, notes and flags.**
   - Fix: a replace swaps only the lines and the fields the CSV states.
4. **D4 — lenient number parsing.** `"68,50"` became ₪6,850, and `0x10` / `1e1` were accepted as waste.
   - Fix: a comma is accepted only as a thousands separator; waste must be decimal 0–95 with ≤ 2 decimals. The same fix applies to the UI price parser.

Plausible items also fixed:
- recipe names are now unique case-insensitively;
- waste must have ≤ 2 decimals (exact NUMERIC(5,2));
- `setTarget` tolerates non-object `settings.recipes`;
- a CSV mid-field quote no longer swallows later rows;
- the UI knows the count-unit synonyms.

Layer 2a also found 3 UI defects, which are fixed:
- Hebrew ₪ deltas and arrows were reordered by bidi. They are now `<bdi>`-isolated.
- Deleting a recipe refetched the deleted id and logged console 404s.
- Sub-recipes showed an empty "— → —" food cost in What changed.

Re-verified after the fixes: Layer 1 full rerun, and Layer 2a 103/103.

## Still open / proposals

- **Not fixed (judgement calls):**
  - `startOfMonthInTz` is wrong for UTC+13/+14 zones (irrelevant for Asia/Jerusalem).
  - The `products.delete` guard message is Hebrew, consistent with that file.
  - Cost for corrupted cyclic data depends on traversal order; save blocks cycles.
- **Proposals:**
  1. Contract prices as the preferred price source once S11 merges (one seam: `latestPrices`).
  2. POS sales mix × dish margin gives total ₪ margin lost this month — the "one number" for food cost.
  3. Weekly "dishes that crossed red" alert into the monthly report (S12).
  4. Live client-side cost preview in the editor (the engine is pure and could be shared via a tiny package).
- **Needs another area:**
  - S5: `searchOptions` could list recipes.
  - S1: `scripts/dev-setup.sh` could run `seed-recipes-demo.ts` after `seed-demo.ts`.
  - Orchestrator: `FEATURE_DISABLED` appCode merge.

## Follow-up round (orchestrator asks, 2026-10-18 afternoon)

| Item | What | Test |
|---|---|---|
| **Merge** | `origin/claude/client-ready` merged three times: 8289ce1, then 197e718, then 80a3934 (the last one brought the doctor wave-1 checks). Conflicts resolved by keeping both sides: nav/layout `showChain` plus the recipes flag, the api/i18n registries, the journal (0056/0057 re-appended after the base's 0033), and the supabase lock. The supabase lock was regenerated with `supabase-sync`, not by hand; the orchestrator rebuilds the RLS files at integration. `seed-recipes-demo` now targets the oldest restaurant, the same as `seed-demo`, because the chain seed adds branches. | Layer 1 + 2 below |
| **R1** (S4 cross-QA) | `recipes.save` / `importCsv` first take `pg_advisory_xact_lock(hashtext('recipes:'‖restaurant_id))`. A second save that would close a cycle concurrently now waits, sees the committed edge, and gets `recipes.cycle` instead of a deadlock 500. | `recipes-router.test.ts` "concurrent cycle saves": 5 racing rounds. It **reproduced `deadlock detected` with the lock disabled** and passes with it. |
| **NUM-10** | `OwnerKpis.weekCleanMatchPct` is now `number \| null` (**deliberate contract change**). With no match runs in 7 days it returns null instead of a fake 100%. The web overview shows "—" + "No matches yet this week" (he/en) in a neutral tone; mobile shows "אין התאמות עדיין". Rounding is now half-up on integers (old float: 23/80 → 28.7, new → 28.8); no value crosses the 80% line differently (refuter checked t ≤ 20000). | `owner-kpis.test.ts`: the empty case expects `null` |
| **Overview card** | "Dishes hurt by price rises this month" on `/dashboard`, behind the `recipes` flag, for owner/manager/chef. It shows the top 3 active dishes with food cost before → after and +₪/plate, and links to `/dashboard/recipes`. With no dishes it says "No dishes yet". It is not rendered in TV mode, and errors are logged instead of breaking the page. | router test (`active`, `activeDishCount`); Layer 2 |

**Refuter (independent, round 2):** no confirmed defects in NUM-10 or the card. Its plausible items are fixed:
- the false "prices are steady" when there are no recipes;
- inactive dishes being counted;
- the per-minute cost in TV mode;
- errors being swallowed;
- `earliestPricesFrom` scanning beyond recipe products;
- `originalProps` on dish names.

Left as is:
- `<Suspense>` around the card: the pinned `@types/react` rejects it (TS2786), and no page in the app uses it yet.
- `MILESTONE-7-REPORT.md` still says "100% when no runs" (historical doc).
- The card is not shown on the chain views.

**Verification on the final head:**
- **Layer 1:** `turbo test` 13/13 (api 589, web 259, db 69, charts 64, matching 86, leak canary unchanged), `turbo typecheck` (incl. mobile), web `tsc`, web lint 0 errors, `supabase-sync --check`, `next build`: all ✅.
- **Layer 2:** production build on the RLS app role, he + en:
  - `layer2-overview.mjs` **79/79**:
    - card shown to owner/manager/chef with steak 32.8% → 34.9%, +₪3.10/plate;
    - absent for receiver/bookkeeper, with the flag off, and in TV mode;
    - "No dishes yet" with no active dishes;
    - NUM-10 "No matches yet this week" with no runs in 7 days and no fake 100%;
    - 0 console errors, 0 5xx.
  - `layer2-recipes.mjs` **103/103** (regression).
- Screenshots: `overview-card-{he,en}.png`, `overview-num10-{he,en}.png`.

**Re-verified after merging 80a3934:** Layer 1 all ✅ (api 589, web 263, db 74 incl. the doctor wave-1 checks), and Layer 2 again 79/79 + 103/103.

## Theoretical vs actual food cost per dish (POS) — orchestrator ask, owner decision

**What it does.** A new tab, "תיאורטי מול בפועל / Theoretical vs actual", appears on `/dashboard/recipes` only when **both** the `recipes` and `integrations` flags are on. For the current or previous month, each dish shows:
- units sold and the average price actually charged (POS net sales ÷ units);
- the food-cost % at the **menu** price vs the food-cost % on **actual** POS net sales (discounts, comps and promotions included), and the gap between them;
- the food cost of the plates sold.

Totals cover the linked mix. POS items that aren't linked to any recipe are listed with their sales.

**Data link.** I coded against S5's interface without merging S5's branch. `recipes/data.ts` `loadPosSales` runs the same aggregate as `integrations.posSummary` over `pos_sales` (S5's 0058). It reads only when the table exists **and** the app role has SELECT on it. Otherwise, and when `integrations` is off, `recipes.posVsTheory` returns `available:false` with a reason and never errors:
- `integrationsOff`: the tab is hidden.
- `noPosData`: a neutral empty state.

**Matching POS items to dishes.**
- By the item's ref or name against the dish's name, in this order: exact primary name, then normalized primary name, then normalized English name.
- Normalization: NFKC, bidi marks removed, geresh/gershayim/quotes removed, maqaf/dashes unified, NBSP collapsed, lowercase.
- Sub-recipes never match.

**Money.** POS NUMERIC values are converted to agorot/qty×1000 at the boundary and handled as exact BigInt, rounded half-up once and capped like the engine. A dish with net sales ≤ 0 or an actual food cost above 200% (refunds, comps, a mis-keyed price) is shown as **"check POS data"** instead of a gap. A dish with a missing ingredient price is flagged as understated.

**Security.** `posVsTheory` is a `recipesProcedure` (chef and up, recipes flag) with a COVERAGE entry. Isolation is tested: A's per-dish totals exclude B's sales of the same item on the same day.

**Refuter (round 3).** One confirmed merge-breaker and three defects; all are fixed with tests.
1. The suite inserted into `pos_sales` without `import_id`, which S5's real 0058 requires (NOT NULL). The test now builds the real 0058 shape. **Verified by applying S5's actual 0058 SQL to a scratch DB: 10/10.**
2. A dish's own name could lose to another dish's English name. Fixed by the precedence order above.
3. Hebrew/Unicode spelling variants didn't match. Fixed by `normName`.
4. Outliers had no guard (₪0.01 sales ranked as a 10,000,000% gap). They are now flagged implausible and capped.

Also fixed from its plausible list: the incomplete-cost flag; unlinked items are now listed, with the Hebrew copy corrected; a matched dish without a cost now stays in the unmatched list; a missing grant degrades to `null`; the unused i18n key was removed.

**Verification (ae12d8d):**
- **Layer 1:** all ✅. `turbo test` 13/13 (api 599 incl. `recipes-pos` 10, web 263), typecheck, web tsc, lint, supabase-sync check, build.
- **Layer 2** (prod build, RLS app role, he + en):
  - `layer2-pos.mjs` **44/44**: steak 34.9% menu vs 40.7% actual (avg ₪130.00 charged, gap +5.8 pts); ₪0.01 shakshuka → "check POS data"; Lemonade listed as unlinked; last month → neutral empty state; integrations off → tab hidden; 0 console errors / 5xx.
  - Regression: recipes **103/103**, overview **79/79**.
- Screenshots: `recipes-pos-{he,en}.png`.

**Re-verified after merging client-ready 807a865** (head after this commit): Layer 1 all ✅ (api 601, web 263, db 74); Layer 2 POS 44/44, recipes 103/103, overview 79/79.

## Demo-eve round (2026-10-24, orchestrator "full build mode", demo 2026-10-25 08:00 UTC)

Branch `claude/wave1-recipes`, merged with `origin/main` (145023c) and the security branch
`claude/sec-next-15-5-28` (Next.js 15.5.28, a regular merge with no force push). Local DB seeded with `DEMO_TODAY=2026-10-25`.

### (a) QA: food cost per dish and the "dishes hurt" card, with the flag ON

- **Recipe prices are the actually paid prices, and they agree with the leak figures.** Each recipe ingredient's latest
  `price_history` equals its latest invoice line, with two exceptions: burger buns (₪2.41 vs ₪2.39) and eggs (₪34.00 vs ₪34.17).
  Both newer lines come from **consolidated pending invoices (חשבוניות ריכוז) dated 2026-10-24**. By design those write
  no price history, and the leak engine also excludes them, so recipe costs and the leak number read the same
  invoices. This is by design, so no fix is needed.
- **Phone (390px), bug found and fixed:** the dish alert sat inside the dish-name column and wrapped word by word. It now
  has its own full-width row under the dish (`recipes-home.tsx`).
- **Overview card, wording fixed:** the alert repeated the row's own `before → after` and ₪/plate. On the card it now
  states only the crossing and its cause.
- he/en at 1366 and 390: no page-level horizontal overflow on `/dashboard`, any recipes tab, or the editor;
  0 console errors and 0 5xx (`layer2-phone.mjs`).

### (b) NEW: `dishPriceAlert` (flag; off means unchanged)

When a dish's food cost **crosses** its target this month because a supplier raised a price, the dish card shows:
before → after %, the target, **+₪ per plate**, the product with its old → new paid price (+%), and **the supplier**.

| Where | What |
|---|---|
| API | `recipes.priceAlerts` (recipesProcedure: owner/manager/chef plus the `recipes` flag). Flag off returns `{ enabled: false, alerts: [] }` and does no work. Pure rule `packages/api/src/recipes/alerts.ts`. |
| Rule | Active menu dish; food cost ≤ target at the start of the month and > target now; cost per plate rose; the cause is the biggest **paid-price rise at the same supplier** as at the start of the month (`changes.rows[].riser`). A switch to a pricier supplier, a recipe edit, a sub-recipe or a price drop is never reported as "a supplier raised a price". |
| Data | Existing data only: `price_history` (paid ex-VAT prices with `supplier_id`) and `suppliers`, filtered by `restaurant_id`, inside the RLS member transaction. No migration. |
| UI | Dish list (full-width row), editor banner (`role="alert"`), overview "dishes hurt" card (cause only). i18n he/en: `recipes.alert.*`. |
| Demo | `seed-recipes-demo.ts`: steak menu ₪179 → **₪199**, so that it crosses: 29.3% → 31.4%, +₪3.41/plate, entrecôte ₪139.00 → ₪149.00 (+7.2%), HaKerem Butchery (קצביית הכרם). |
| Coverage | COVERAGE entry `recipes.priceAlerts` (additive). |

**Demo caveat:** the alert compares against the start of the **month**. It fires on 2026-10-25. After 1 November
without a reseed it disappears, because the steak no longer crossed *this* month.

### Verification (2 layers)

**Layer 1: automated gate** @ 08052c4: `scripts/verify.sh` **PASS** (install, fresh-db, migrate, provision-rls,
check-rls, db-doctor, supabase-sync, typecheck, test, web-lint, web-build, web-tsc, audit). Worker tests run with
`REDIS_URL`: 25/25. `recipes-alerts.test.ts` 11/11, covering:
- the pure rule: crossing / at-target / already over / improved / sub-recipe / inactive / no menu price / no rise / ordering;
- A's alert with exact bp and ₪ figures, plus supplier;
- B isolation (no alert);
- the flag off, `FEATURES_OFF=dishPriceAlert`, and `recipes` off (FORBIDDEN) cases;
- roles: chef and manager pass, receiver and bookkeeper get FORBIDDEN;
- **refuter regressions:** a supplier switch gives no alert; a biggest-move price drop still alerts on the biggest rise.

**Layer 2: production build (`next start`), he + en, every role**
- `VERIFY_E2E=1 VERIFY_SOFTNAV=1 … scripts/verify.sh layer2` **PASS** (verify-db, prod-start, verify-prod, soft-nav, e2e).
- `layer2-recipes.mjs` **133/133**: the steak shows 31.4% and ₪115.75 margin; exactly one alert, 29.3% → 31.4%, +₪3.41,
  ₪139.00 → ₪149.00 (+7.2%), naming the supplier; the changes tab shows +₪3.41 and why = entrecôte ₪139.00 → ₪149.00;
  flag off gives 404 and 403 FEATURE_DISABLED.
- `layer2-overview.mjs` **97/97**: the card shows 29.3% → 31.4%, +₪3.41, and one alert naming the supplier that does not repeat
  the ₪/plate; receiver and bookkeeper see no card.
- `layer2-pos.mjs` **44/44**: steak at 31.4% menu vs 40.7% actual, gap +9.3 pts.
- `layer2-phone.mjs` **44/44**: 1366 and 390, he/en, no horizontal overflow, alert in the list and the editor.
- All suites: 0 console errors, 0 5xx.
- The bidi order of `₪139.00 → ₪149.00` in Hebrew was checked from DOM positions.
- Screenshots: `wave1-recipes/price-alert-*.png` (390 and 1366, he/en) and the refreshed `recipes-*.png` and `overview-card-*.png`.

**Independent refuter** (a subagent that did not write the code) confirmed the demo alert values against the dev DB
and found:
1. A supplier switch was reported as a price rise. **Fixed** with the same-supplier `riser` and a regression test.
2. The alert was missed when the biggest-moving line was a price drop. **Fixed** with a regression test.
3. A just-over crossing rendered as "30% → 30%". **Fixed:** two decimals when the values would collide.
4. A rise that comes through a sub-recipe does not alert. This is by design: a sub-recipe has no single supplier.
5. With the flag off, `recipes.changes` gains one supplier lookup plus an additive `driver.supplier`/`riser` field, and the client
   fires `priceAlerts`, which returns `enabled:false`. The visible behaviour is unchanged.
