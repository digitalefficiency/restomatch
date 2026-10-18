# Wave 1 — Food cost per dish (`recipes`) — S17 report

Branch `claude/wave1-recipes` → draft PR into `claude/client-ready`. Flag key `recipes` (off by default;
on for the demo tenant through `features.all`; `FEATURES_OFF=recipes` kills it).

> **לבעלים:** מסך "עלות מנה" — כמה עולה כל מנה לפי המחירים ששולמו בפועל, אחוז עלות מזון מול יעד
> (ירוק/כתום/אדום), רווח לצלחת, "מה השתנה החודש" (מה הזיז את העלות), "מה אם המחיר יעלה?"
> (עוף +12% ← אילו מנות נפגעות ובכמה), עורך מתכונים עם תתי-מתכונים, וייבוא מ-CSV. במסעדת הדמו:
> 8 מנות + 2 רטבים; הסטייק עבר מכתום לאדום החודש בגלל עליית מחיר האנטריקוט (₪139.70 ← ₪149/ק״ג).
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
