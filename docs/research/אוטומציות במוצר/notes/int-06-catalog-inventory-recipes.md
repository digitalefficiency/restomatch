# int-06 — Catalog / price lists / price alerts / contracts / inventory / food cost / recipes

Scope: supplier price-list import (catalog router + `packages/catalog` matcher + `import-catalog` job), products, SKU mapping, contracted prices, price-trend alerts (+ `price_history` / baselines), inventory counts, recipes / food cost, procurement sync (MarketMan / Zester, `sync-platforms` job) and the integrations router.

Source: `release/train-a` checkout (`c6132c0e`), paths relative to the repo root. Read-only mapping. Everything listed here also exists on `main` (`759fb554`) — the 4 wave-1 routers (`contracts`, `inventory`, `priceAlerts`, `recipes`) are present on both. One gap matters more than any branch difference: **`sync-platforms` has no producer on either branch** (see §7).

---

## 0. Cross-cutting facts

| Fact | Evidence |
|---|---|
| Feature flags live in `restaurants.settings.features` jsonb and are **OFF unless opted in**. `FEATURES_OFF` env is the global kill-switch | `packages/api/src/lib/features.ts:1-10`, `:56-71` |
| Flags in this area: `contracts`, `priceAlerts`, `recipes`, `integrations`, `dishPriceAlert`, `inventoryCount`, `orderPricesOut`, `dockPriceContext` | `packages/api/src/lib/features.ts:16-17,26-27,36-39,47` |
| Admin toggles them per tenant through `admin.setFeatures` (jsonb merge + audit) | `packages/api/src/routers/admin.ts:370-395`; UI `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx` |
| The pilot "defaults" button ticks **only `contracts`** from this area. `priceAlerts`, `recipes`, `inventoryCount`, `integrations` and `dishPriceAlert` are not pilot defaults | `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:20-31` |
| Role tiers: `managerProcedure` = owner+manager, `chefProcedure` = owner+manager+chef, `financeProcedure` = owner+manager+bookkeeper, `memberProcedure` = any member (receiver included) | `packages/api/src/trpc.ts:133,147-151,162` |
| Embeddings are **only** the hash-based `MockEmbeddingProvider`, wherever they are used (catalog import, worker import, OCR). "Semantic" matching is really token hashing | `packages/catalog/src/embeddings.ts:7,13`; `packages/api/src/routers/catalog.ts:149`; `apps/worker/src/jobs/importCatalog.ts:16`; `apps/worker/src/jobs/ocrInvoice.ts:28` |
| `price_history` is written **only** when an invoice is matched (`persist.ts` → `writePriceHistoryForInvoice`). It is not written when a price list is imported or a sync runs. Everything else here reads it: baselines, price alerts, recipe cost and inventory valuation | `packages/api/src/match/priceHistory.ts:16-38,90`; `packages/api/src/match/persist.ts:420` |

### Immutable files this area depends on (opportunities that need them are HUMAN-PR)
- `packages/db/src/schema.ts` + migrations: any new table or column (e.g. `catalog_price_changes`, a `contract_id` on `po_lines`, `procurement_connections` UI fields).
- `apps/worker/src/cron.ts`: any new schedule, including scheduling `sync-platforms`, a dish-alert sweep or a "stale price list" sweep.
- `packages/api/src/notifications/outbox.ts`: changing the outbox itself. Calling `enqueueNotification` from new code is allowed and is how `priceAlerts/sweep.ts:264` does it.
- `packages/matching/src/*` (engine/tolerances/units): any change to how contract price or baseline feeds a discrepancy.
- `packages/db/src/plans.ts`, `packages/billing/*`: putting any of these features into a plan entitlement.

---

## 1. Supplier price-list import (מחירון ספק) — manager/owner

**Screens:** `/dashboard/catalog/import` → `ImportWizard` (`apps/web/app/dashboard/catalog/import/page.tsx`, `wizard.tsx`, 1124 lines). Steps are `SUPPLIER → UPLOAD → MAP → REVIEW → DONE` (`wizard.tsx:59`, transitions `:199,239,309`).

**Procedures:**
- `catalog.parsePreview` (manager). Parses the CSV/XLSX, auto-detects the column mapping and VAT basis, and price-checks every row against the supplier's current list. A row is flagged when its price is 0, more than 5× the current list price or under 0.2× of it. Nothing is written (`packages/api/src/routers/catalog.ts:316-367`; thresholds `:43-45`, `priceFlag` `:118-125`; VAT rate resolution `:104-113`).
- `catalog.commitImport` (manager). Re-checks the flagged rows and refuses with `CATALOG_FLAGGED_PRICES` unless `confirmFlagged` is set (`:401-411`). It inserts a `catalog_imports` row (`:430-441`). Files over 200 rows go to the queue, and if the queue is down it commits inline instead (`:42,445-472`). Otherwise it runs `commitCatalogRows` inline (`:474-484`).
- `commitCatalogRows` (`packages/api/src/catalog/commit.ts`), per row:
  - finds the existing item by SKU, else by name (`:115-129`);
  - otherwise runs the supplier-scoped `matchProductTopN` (SKU → alias → barcode → embedding → fuzzy; `packages/catalog/src/matcher.ts:133-411`);
  - **auto-links** at confidence ≥ 0.95 when unit and pack size fit. From 0.6 to 0.95, or when unit/pack doesn't fit, the row is saved **unlinked and suggested** (`ambiguous`). Below 0.6 it creates a **new product** (`commit.ts:23,32,166-208`);
  - upserts `supplier_catalog_items` (`:211-242`);
  - learns the alias at a machine confidence of 0.999 or lower via `recordConfirmedMatch` (`:250-260`).
- Worker `import-catalog` (`apps/worker/src/jobs/importCatalog.ts:18-77`): tenant guard, idempotent (skips if already committed, `:43-45`), marks the import committed or failed. The web app also kicks the job immediately after enqueue (`apps/web/lib/jobKick.ts:31`).
- `catalog.imports` (any member) shows history plus the count of still-unlinked rows (`catalog.ts:491-530`). `catalog.items` with `importId`/`unlinkedOnly` drives the review list (`:181-234`).

**DB:** `catalog_imports`, `supplier_catalog_items`, `products`, `product_aliases`.

**Manual today:**
1. Get the price list out of the supplier, usually by email or WhatsApp. Download it and upload it (re-handling a file that already arrived digitally).
2. Pick the supplier, upload, check the auto-mapping, choose ex/inc VAT, and acknowledge the flagged prices. That is about 6–10 clicks for a clean file.
3. REVIEW step: decide each ambiguous row by accepting the suggestion, picking another product or choosing "new product" (`catalog.updateItem` with `newProductName`, `catalog.ts:59-73,607`). That is 1–3 clicks per row, and a first import from a new supplier can have dozens.
4. Single-row edits through `catalog.createItem` / `updateItem` / `setItemActive` / `deleteItem` (`:533-734`).

**Automatic today:** auto-detected mapping and VAT basis, outlier flags, queue offload for large files, the auto-link/create/alias learning above, and import progress updates (`commit.ts:262-270`).

**Not automatic:**
- Nothing tells anyone that a list price **changed** (old → new). The preview shows the current price but no diff summary is persisted.
- An import does not touch `price_history`, so price alerts and recipe costs ignore list prices until an invoice comes in.
- Nothing chases a supplier whose list is stale.
- No inbound-email route for price lists. Ingest handles invoices only (int-01).

**Flags:** none. The catalog is core and always on.

---

## 2. SKU → product mapping (מיפוי מק״טים) — manager/owner

**Screen:** `/dashboard/catalog/mapping` → `SkuMapper` (`apps/web/app/dashboard/catalog/mapping/mapper.tsx`, 336 lines).

**Procedures:**
- `mapping.unmapped` (member) lists distinct unmapped (supplier, SKU) pairs across `po_lines` and `invoice_lines`, with occurrence counts (`packages/api/src/routers/mapping.ts:121-140`).
- `mapping.searchProducts` (`:212`).
- `mapping.confirm` (manager) links the SKU to an existing or new product, learns the alias (`:386`), backfills every unmapped PO/invoice line, and re-queues `match-invoice` for the affected invoices (`requeueInvoicesForRematch`, `:52-104`). It skips approved/paid invoices, invoices with a claim on them and consolidated invoices. It supports undo (`revert`, `:244-251`).

**DB:** `product_aliases`, `po_lines`, `invoice_lines`, `products`, plus the `match-invoice` queue.

**Manual today:** one confirm per (supplier, SKU), about 3 clicks each (search, pick, confirm). The backfill and re-match afterwards are automatic.

**Opportunity hook:** the matcher already computes ranked candidates (`matchProductTopN`). Pre-filling the top suggestion with its confidence, and adding a "confirm all ≥ X" bulk action, would turn N×3 clicks into a single review pass. A person still confirms, because a wrong link creates a phantom leak.

---

## 3. Products (מוצרים) — manager/owner edit, any member reads

**Screens:** `/dashboard/products` (`NamesGrid`, a bulk English-name grid) and `/dashboard/products/[productId]`.

**Procedures:** `products.list` (member), `setNamesEn` (bulk, capped per screen), `update` and `delete` (manager) (`packages/api/src/routers/products.ts:28-37,90,129,181`). `catalog.productDetail` (member) returns every supplier price, the cheapest comparable unit price and 24 `price_history` points (`catalog.ts:237-306`).

**Manual:** typing English names (for receivers working in English) and categories one product at a time. Category matters for alert thresholds (§5) and for inventory storage areas (§6), so a missing category degrades both.

**Policy observation:** `catalog.items` and `catalog.productDetail` are `memberProcedure`, so they return `listPrice` and the price history to a **receiver** at API level (`catalog.ts:181,223,237`). Owner rule: receiver sees NO ₪. The only ₪-stripping comment in `trpc.ts` refers to invoices, "H-11" (`packages/api/src/trpc.ts:154-158`). This is a security finding, not an automation one. It belongs to `tenant-security-warden` / `web-feature-engineer`.

---

## 4. Contracted prices (מחירי חוזה) — flag `contracts`

**Screens:** `/dashboard/contracts` has tabs for contracts, alerts, thresholds and the over-contract card (`apps/web/app/dashboard/contracts/page.tsx:8-13`). The import screen is `/dashboard/contracts/import`.

**Procedures** (`packages/api/src/routers/contracts.ts`):
- `access` (member) never throws and reports flags only to finance roles (`:111-133`).
- `list` / `productOptions` (finance) (`:135,169`).
- `create` / `update` / `delete` (manager) (`:192,237,279`).
- `importPreview` / `importCommit` (manager) upsert on (supplier, product, valid_from) (`:292,308`; `packages/api/src/contracts/import.ts:151-237`).
- `overContractForInvoice` / `overContract` (finance) are a **read-only overlay**. They scan up to 5000 invoice lines, compare the billed price with the contract in force, and exclude duplicate invoices (`contracts.ts:343-368`; `packages/api/src/contracts/overContract.ts:23,76-82`).
- `orderPrices` (chef+): contract prices for the new-order wizard, following the owner decision of 31.10 that the chef orders at contract price (`contracts.ts:370-398`).

**DB:** `supplier_contract_prices`. It is read by `overContract.ts`, `load.ts` and `orderPrices.ts` only.

**Manual today:**
- The contract sheet is typed in or uploaded. A sheet can also be built from the catalog list, since the contract import reads `supplierCatalogItems` (`contracts/import.ts`).
- Someone has to open the contracts tab to see over-contract lines. They are **not discrepancies**: not in the leak figure, not in approvals, not claimable. To turn one into a credit request, the user goes to the invoice and acts on the engine's own price discrepancy if one exists.
- Contract expiry (`valid_to`) raises no alert.

**Automatic today:** contract prices pre-fill orders, so the PO carries `unitPriceExpected` and the engine compares against it (`buildMatchInput.ts:290-300`). The over-contract badge on the invoice view.

**Flag:** `contracts` is OFF by default (`features.ts:69`) and is in the pilot defaults (`FeaturesPanel.tsx:21`).

**Seam:** recipe costing says contract prices "would be preferred here once they exist; this function is the single seam" (`packages/api/src/recipes/data.ts:180-186`). That has not been done yet.

---

## 5. Price-trend alerts + baselines — flag `priceAlerts`

**Pipeline:**
1. **Writer:** every match writes `price_history` for mapped invoice lines, normalized to the product unit. Duplicates are skipped and the write is idempotent per invoice (`match/priceHistory.ts:16-38`; `match/persist.ts:420`). There is a backfill script at `packages/api/scripts/backfill-price-history.ts`.
2. **Baselines job:** cron at **02:00 IL** daily (`apps/worker/src/cron.ts:62-67`). `computeBaselines` takes p50/p90/mean/stddev over 90 days with at least 3 samples per (product, supplier) and upserts `price_baselines` (`packages/charts/src/baselines.ts:27-70`; job `apps/worker/src/jobs/baselines.ts:21-43`). `buildMatchInput` passes the baselines into the engine (`packages/api/src/match/buildMatchInput.ts:400-405`). There is **no flag**: it runs for every restaurant.
3. **Price-alerts job:** cron at **07:00 IL** (`cron.ts:97-102`). For each restaurant it calls `runPriceAlertSweep` (`apps/worker/src/jobs/priceAlerts.ts:26-52`). Restaurants with the flag off are skipped (`packages/api/src/priceAlerts/sweep.ts:74-75`). Detection works on one point per local day with at least 3 observations. The baseline is the median of the earlier half of the window. An alert fires when the later-half mean is at least the baseline × (1 + threshold) and the price stayed up. The default is +10% over 21 days (`priceAlerts/detect.ts:1-19`). Alerts are deduped per product, supplier and day (`sweep.ts:143,221`). New alerts send **one email per owner/manager** through `enqueueNotification`, deduped per alert and recipient, with a link to `/dashboard/contracts?tab=alerts` (`sweep.ts:236-281`; recipients default to owner+manager, `packages/api/src/notifications/recipients.ts:30-38`). Delivery happens in `outbox-dispatch` every 60 s (`cron.ts:69-74`).

**Procedures** (`packages/api/src/routers/priceAlerts.ts`): `list` / `thresholds` / `openCount` (finance) (`:27,58,145`); `dismiss` / `refresh` (in-app re-run, no email) / `setThreshold` / `deleteThreshold` (manager) (`:35,50,88,131`). Thresholds can be set per supplier and/or category, from 0–500% and over 7–120 days.

**DB:** `price_history`, `price_baselines`, `price_alerts`, `price_alert_thresholds`, `notifications_outbox`.

**Manual today:**
- Read the email, open the alerts tab, and either dismiss the alert or act on it **outside the product**: call the supplier, switch supplier, update the contract. There is no "do something" CTA. The email includes a cheaper supplier when one exists (`sweep.ts:259-261`), but nothing links it to orders or contracts.
- Thresholds are set by hand.

**Flag:** `priceAlerts` is OFF by default and **not** a pilot default. On a pilot tenant the 07:00 job does nothing.

---

## 6. Inventory count (ספירת מלאי) — flag `inventoryCount`

**Screens:** `/dashboard/inventory` (`InventoryHome`), `/dashboard/inventory/count` (`CountScreen`, 592 lines) and `/dashboard/inventory/[countId]`. The nav item only shows with the flag on (`apps/web/app/dashboard/layout.tsx:128`).

**Procedures** (`packages/api/src/routers/inventory.ts`; the chef tier is used and ₪ fields are stripped server-side for the chef, `:39-48`):
- `start` pre-fills **every food product bought in the last 60 days**, grouped by storage area. Areas come from the previous count if there was one, otherwise they are guessed from the category (`:304-331`; `packages/api/src/inventory/data.ts:122-128`).
- `saveLines` autosaves each line (`:338`).
- `searchProducts` / `setMeta`.
- `complete` is **owner/manager only** (`CLOSERS`, `:97`). It snapshots the paid unit cost per line as of the count date from `price_history`, values the count in agorot, refuses blank lines unless `acceptUncounted` is set, requires the count to be later than the last closed one, and writes an audit entry (`:430-490`).
- `amendLine` is owner-only, with a reason (`:496`).
- `exportCsv`, `discard`, `history`.
- `period`: actual food cost per closed-count period (`:610`).

**DB:** `inventory_counts`, `inventory_count_lines`, `price_history` (read), `audit_log`.

**Manual today:**
- The count itself: one qty entry per product. That is the core physical work and can't be removed, only sped up.
- Closing the count: 1–2 clicks.
- Remembering to count at all. There is **no reminder job**: no count-day schedule and no outbox notification.
- Exporting the CSV to the bookkeeper by hand.

**Automatic:** the product list pre-fill, remembered storage areas, valuation at paid prices, and the period food cost.

---

## 7. Recipes / food cost per dish — flags `recipes` (+ `dishPriceAlert`, + `integrations` for POS)

**Screens:** `/dashboard/recipes` (`RecipesHome`, 720 lines, plus `overview-card.tsx` and `price-alert.tsx`), `/dashboard/recipes/new` and `/dashboard/recipes/[recipeId]` (`recipe-editor.tsx`).

**Procedures** (`packages/api/src/routers/recipes.ts`; chef+, `:105-112`, which matches the owner rule that the chef sees ₪ on recipes):
- `list` / `get` / `save` / `delete` / `searchProducts` / `subRecipes` (`:413-512`).
- `impact`: what-if on an ingredient's price move (`:524-563`).
- `changes`: start of month vs now, with the ingredient that drove the move (`:566`).
- `priceAlerts`: dishes that **crossed** the food-cost target because a same-supplier paid price rose. Flag `dishPriceAlert` (`:575-578`; rules in `packages/api/src/recipes/alerts.ts:1-16`).
- `posVsTheory`: theoretical vs actual cost from POS sales. Needs the `integrations` flag and returns `available:false` without it (`:588-602`).
- `setTarget` (manager) (`:617`).
- `importCsv` with a dry-run default (`:638-660`).

**Price source:** the latest **paid** price from `price_history` (`recipes/data.ts:180-200`). Not the list price, not the contract price.

**Manual today:**
- Building recipes: one line per ingredient with qty and unit, or a CSV import that has to be prepared by hand.
- Menu prices typed in per dish.
- Opening the recipes page to discover dish alerts. `dishPriceAlerts` is a **pull-only query**: no job, no outbox, no email.
- Uploading the POS export file by hand (§8).

---

## 8. Integrations: POS import, accounting export, procurement — flag `integrations`

**Screen:** `/dashboard/integrations` contains `AccountingMapping`, `PosImport` and `ProcurementProviders` (`apps/web/app/dashboard/integrations/page.tsx:7-9`).

**Procedures** (`packages/api/src/routers/integrations.ts`):
- `posPreview` / `posImport` (manager): **file upload**. The import replaces the rows for exactly the days the file covers (`:305-353`). `posImports` (`:356`), `posSummary` (chef+, `:380`).
- `accountingConfig` / `setAccountingConfig` / `accountingExport` (bookkeeper/owner, plan feature `accounting_export` + flag) (`:61-67,177-303`). Covered in int-05.
- `procurementProviders` (manager) shows MarketMan/Zester, their connected state and the sample-vs-live mode (`:404-426`).
- `procurementPreview` (manager) runs **only on the recorded fixture**: `credentials: { mode: 'fixture' }` (`:433-457`). The header says outright: "No credentials: every provider here is file-based or an offline fixture" (`:35-41`).

**Procurement sync (`sync-platforms`):**
- Job: `apps/worker/src/jobs/syncPlatforms.ts:29-99`. It syncs suppliers (by external ref, then by name, otherwise insert; `:111-168`) and orders. PO lines are deleted and re-inserted, with `productId: null` "resolved via catalog matcher when invoice comes in" (`:174-260`, `:249`). It does **not** call `adapter.listProducts`, so platform price lists never reach `supplier_catalog_items`, even though both adapters implement `listProducts` (`packages/procurement/src/adapters/marketman.ts:148`, `zester.ts:133`).
- Credentials: `vaultRef` takes the form `env:VAR` or `fixture:`, and `fixture:` is refused in production (`syncPlatforms.ts:267-283`). There is **no** procedure that creates a `procurement_connections` row. The only inserts are in tests and fixtures (grep of `insert(procurementConnections)`).
- **Dead path:** the cron header promises "sync-platforms — every 30 minutes" (`apps/worker/src/cron.ts:9-10`), but `registerCronSchedules` registers **no** such scheduler (`cron.ts:54-150`). No router, web route or worker enqueues `sync-platforms`. The job is reachable only through `JOB_HANDLERS` (`apps/worker/src/handlers.ts:33`) and the smoke script, which expects it to **fail** without credentials (`apps/worker/scripts/smoke-all-jobs.ts:131-132`). The same is true on `main`.
- `ZesttAdapter` throws `DOCUMENT_ONLY` on every API method and is not registered (`packages/procurement/src/adapters/zestt.ts:18,35-47`; `registry.ts:5-8`).

**Manual today:** for a MarketMan/Zester tenant, orders are effectively **re-typed** in RestoMatch, or never reach the PO side, so matching runs without a PO. POS sales are exported from the POS and uploaded as a file each time.

**Flag:** `integrations` is OFF and not a pilot default.

---

## 9. Summary table

| Workflow | Role | Manual today | Automatic today | Flag (default) |
|---|---|---|---|---|
| Price-list import | manager/owner | download → upload → map → confirm flags → review ambiguous rows | mapping/VAT detect, outlier flag, queue >200 rows, auto-link ≥0.95, create new products, alias learning | none (core) |
| SKU mapping | manager/owner | 3 clicks per SKU | backfill + re-match + undo | none |
| Product data | manager/owner | EN names, categories by hand | — | none |
| Contracts | manager writes, finance reads | upload/type the contract; read the over-contract tab; nothing claimable from it | order pre-fill, invoice badge | `contracts` OFF (pilot default ON) |
| Price alerts | owner/manager email; finance reads | dismiss / act outside the product; set thresholds | baselines 02:00, sweep 07:00, outbox email | `priceAlerts` OFF (not pilot) |
| Inventory count | chef counts (no ₪); owner/manager close | count, remember to count, export CSV | pre-fill, valuation, period food cost | `inventoryCount` OFF |
| Recipes / food cost | chef+ (₪ allowed) | build recipes, menu prices, check alerts by visiting the page | cost, what-if, monthly change, dish alert (pull only) | `recipes` + `dishPriceAlert` OFF |
| POS import | manager | upload file each period | day-replace idempotency | `integrations` OFF |
| Procurement sync | — | (re-type orders) | **none: job unscheduled, no producer, no connect UI** | `integrations` OFF |

---

## 10. Automation opportunities

Format: trigger → action → what the human confirms → data needed → building blocks reused → immutable touch.

1. **Price-list change digest on import**
   - Trigger: `commitCatalogRows` finishes, inline or in the worker.
   - Action: compute old→new list price per row (the old price is already read in `currentPrices`, `catalog.ts:128-147`), persist a summary on the import, and enqueue one owner/manager email ("12 prices up, avg +6%, top 3 …") through `enqueueNotification`.
   - Human: nothing to confirm (information only). Any follow-up action (dispute, switch) stays human.
   - Reuses: outbox, `recipientsForRestaurant`, the `priceAlerts/email.ts` template.
   - Immutable: storing the diff in a new column is HUMAN-PR (schema); computing it on the fly from `price_history` / a jsonb field on `catalog_imports.column_mapping` is not. Email only, no ₪ to the receiver.
2. **Bulk-accept high-confidence import/mapping suggestions**
   - Trigger: the REVIEW step or `/catalog/mapping` has more than N rows.
   - Action: pre-select the matcher's top candidate and offer "accept all ≥ 0.85 with unit fit".
   - Human: one review-and-confirm instead of N×3 clicks.
   - Reuses: `matchProductTopN`, `recordConfirmedMatch`, `mapping.confirm` incl. re-match + `revert`.
   - Immutable: none.
3. **Schedule procurement sync + connect UI + catalog pull**
   - Trigger: every 30 min, as the cron header already documents, for each enabled `procurement_connections` row.
   - Action: enqueue `sync-platforms`. Also call `adapter.listProducts` → `commitCatalogRows`, so platform prices become catalog list prices and POs carry `unitPriceExpected` automatically.
   - Human: the owner connects the account. Credential intake is Phase-6, human-only.
   - Reuses: the existing job, adapters and `commitCatalogRows`.
   - Immutable: **HUMAN-PR** (`cron.ts`). A connect procedure is a new tRPC route and needs a coverage entry in the cross-tenant attack manifest (agents may add, not remove).
4. **Price alert → action CTA**
   - Trigger: an open `price_alerts` row with a `cheaperSupplierName`.
   - Action: one-click "draft an order from the cheaper supplier" or "open the contract for this product", pre-filled.
   - Human: confirms the order or contract. Money action, owner rule.
   - Reuses: `orders.createDraft`, `contracts.create`, `loadAlertDetails`.
   - Immutable: none.
5. **Turn price alerts on for pilot tenants / add to pilot defaults**
   - Trigger: admin go-live.
   - Action: include `priceAlerts` (and possibly `dishPriceAlert`) in `PILOT_DEFAULTS`.
   - Human: admin confirms. This is the cheapest "automation", because the 02:00/07:00 pipeline already runs and the sweep is a no-op only because the flag is off.
   - Reuses: FeaturesPanel / `setFeatures`.
   - Immutable: none (`FeaturesPanel.tsx` is web).
6. **Dish price alert push**
   - Trigger: after the 07:00 price-alerts sweep, or chained inside it.
   - Action: run `computeChanges` + `dishPriceAlerts` per restaurant with `dishPriceAlert` on, and enqueue an email to owner/manager (and chef, since the chef may see ₪ on recipes) for dishes that newly crossed the target.
   - Human: none (info). Re-pricing the menu stays human.
   - Reuses: the pure `recipes/alerts.ts` and outbox dedupe keys.
   - Immutable: chaining it inside the existing `priceAlerts.ts` job avoids touching `cron.ts`. A separate schedule is HUMAN-PR.
7. **Inventory-count reminder**
   - Trigger: a configurable count day (e.g. the last day of the month) with no draft or completed count in the period.
   - Action: outbox email/push to manager + chef, with "start count" deep-linked to `inventory.start`.
   - Human: does the count; owner/manager close it.
   - Reuses: outbox, the `order-reminders` job pattern.
   - Immutable: piggy-backing on an existing daily job avoids a cron edit; a new schedule is HUMAN-PR.
8. **Auto-send closed count to bookkeeper**
   - Trigger: `inventory.complete`.
   - Action: enqueue an email with the `exportCsv` output (or a link) to bookkeeper members.
   - Human: the owner opts in once.
   - Reuses: `recipientsForRestaurant(db, rid, ['bookkeeper'])`, the outbox.
   - Immutable: none.
9. **Contract expiry + over-contract digest**
   - Triggers: a contract with `valid_to` within 14 days; or a weekly over-contract total above ₪X.
   - Action: email the owner/manager "renew X" or "₪Y billed above contract this week" with a link to the invoices.
   - Human: renewing or disputing. Over-contract lines are not claimable automatically, and turning them into discrepancies/claims would change the engine.
   - Reuses: `overContract.ts`, `contracts/load.ts`, the outbox.
   - Immutable: the digest itself touches none. Making over-contract count toward the leak or claims is **HUMAN-PR** (`packages/matching/*`, the DiscrepancyType union).
10. **Contract price as recipe/inventory price source**
    - Trigger: none (it's a data seam).
    - Action: prefer the contract price in force over the last paid price in `latestPrices` (`recipes/data.ts:180-186`).
    - Human: none.
    - Immutable: none, but it's a ₪-semantics change. It needs leak-economist/owner sign-off because it changes the food-cost numbers.
11. **POS sales pull instead of upload**
    - Trigger: nightly.
    - Action: fetch from the POS provider API, then `posImport`'s day-replace logic.
    - Human: credentials (Phase-6).
    - Reuses: `POS_PROVIDERS` parsers, `posSales` day-replace.
    - Immutable: a new schedule is HUMAN-PR. Blocked on a credential either way.
12. **Price lists by email**
    - Trigger: an inbound email from a known supplier address with a CSV/XLSX attachment.
    - Action: auto-run `parsePreview` with the saved mapping from the last `catalog_imports.column_mapping` for that supplier, and stage it as a pending import.
    - Human: the manager confirms the flagged prices and commits. Not auto-committed, because prices drive the PO's expected price.
    - Reuses: the ingest email path (int-01), `autoDetectMapping`, the stored mapping.
    - Immutable: none (if the staging uses the existing `catalog_imports.status='pending'`).

---

## 11. Stubs / dead code / surprises

- `sync-platforms`: documented as every 30 min in `cron.ts:9-10`, never registered, no producer, no connect UI. It only runs from the smoke script, where it is expected to fail.
- `adapter.listProducts` is implemented for MarketMan/Zester but never called by the sync. `procurementPreview` only ever uses fixtures.
- `ZesttAdapter` is a document-only stub and isn't registered.
- `MockEmbeddingProvider` (hash tokens) is the only embedder in production paths.
- A price-list import never writes `price_history`. So price alerts, recipe cost and inventory valuation only "see" prices once invoices are matched, and a new tenant has empty food-cost and alert screens until about 3 invoices per product exist (`MIN_OBSERVATIONS = 3`).
- `catalog.items` / `productDetail` return ₪ to the receiver role (`memberProcedure`), against the "receiver sees no ₪" rule.
- The baselines job has no flag and computes for every tenant at 02:00. The price-alerts sweep at 07:00 loops over all tenants but no-ops when the flag is off, which is the case for all pilot tenants.
- Dish price alerts and over-contract lines are pull-only: no job and no notification.
