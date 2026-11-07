# int-08 · Procurement sync (MarketMan / Zester) and a feature inventory of RestoMatch today

Read-only code note, written 2026-11-07, on branch `claude/research-in-app-automation` (working tree = `origin/main` with train A merged). It **builds on** int-06 §8 (integrations), int-05 (orders), int-02 (receiving), int-07 (roles, Ask, notifications), ext-06 (MarketMan), ext-07 (Zester/Zestt) and `10-catalogue-and-impact.md` §D bug 7. It does not repeat them. It adds three things: a line-level trace of what the sync would do to the **leak figure** if it ran today, a coexistence design ("MarketMan orders, RestoMatch checks"), and one inventory table of every module, by role and status. Paths are repo-relative. "Pilot" means the `PILOT_FEATURES` set (`packages/db/scripts/pilot-config.ts:26-37`, mirrored in `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:20-31`).

---

## 0. Summary for the synthesis

1. **The MarketMan/Zester API sync is built and unit-tested against guessed API shapes, but dormant: no schedule, no way to connect an account, no credentials.** It is not a "stub": the adapters, the HTTP client, the fixtures and the worker job are real code with tests. The **Zestt PDF import is live** (where real OCR is on) and is the safe, recommended path today. Nothing produces a `sync-platforms` job (`apps/worker/src/cron.ts:9-10` promises "every 30 minutes", but `registerCronSchedules` at `:54-150` registers no such scheduler). There is also no procedure that creates a `procurement_connections` row. The only inserts are in tests. The UI is a **sample-data preview** (`packages/api/src/routers/integrations.ts:433-457`, `credentials: { mode: 'fixture' }`).
2. **Both API contracts are invented.** `adapters/marketman.ts:3-8` and `adapters/zester.ts:3-9` carry "VERIFY: pending real API contract". ext-06 finds MarketMan's Open API to be a paid add-on, and whether it works for Israeli accounts is UNVERIFIED. ext-07 finds that the public Zestt API is built for suppliers, and **no documented restaurant export**, so we start from documents. Our `ZesterAdapter` assumes a buyer API at `api.zester.co.il/v1` that the research could not find.
3. **New finding: switching the sync on today could inflate the leak.** The risk applies **only when PO discovery picks a synced PO** for an invoice: same supplier, status `sent`/`confirmed`/`partial`, expected delivery within **±7 local days** of the invoice date (`buildMatchInput.ts:40-42`, `:200-208`). Then: the job writes PO lines with `productId: null` and **no `supplierSku`** (`apps/worker/src/jobs/syncPlatforms.ts:244-255`); the engine pairs a PO line with an invoice line only by `productId`, or by `supplierSku` when `productId` is null (`packages/matching/src/engine.ts:228-233`); so no line pairs. Every invoice line becomes `UNORDERED_ITEM` (`block`, delta = whole line total, `engine.ts:377-382`), which is inside `LEAK_FILTER` (`packages/charts/src/leak-views.ts:134-136`), and every PO line becomes `MISSING_ON_INVOICE`. Net effect on that invoice: about **2× the invoice** in the leak before #211, about **1×** after #211, and the invoice is **blocked**. This breaks "one number the owner believes". Do not enable the sync for any tenant until C1 and C2 in §2 land.
4. **New finding: a re-sync cuts the line-level link.** Each sync deletes and re-inserts the PO's lines (`syncPlatforms.ts:221`). `gr_lines.po_line_id` and `discrepancies.po_line_id` are `onDelete: 'set null'` (`packages/db/src/schema.ts:784`, `:981`). After a re-sync of a received PO, the receipt lines and findings lose their PO line, so the 3-way quantity checks (`QTY_SHORT`/`QTY_OVER`) stop. The receipt itself **stays on the PO header** (`goods_receipts.po_id` is untouched). That is the 3-way match, the wedge itself. The Zestt document import already guards this case (`packages/api/src/orders/importPo.ts:186-198`: refuse a re-import once a receipt exists). The API sync does not.
5. **Coexistence is the right posture and fits the ICP.** `docs/ICP.md:27-31` and ICP §5 weight S5 = 1.0 for "MarketMan/Zester connected". §2 proposes eight steps, C1–C8. Import **orders with SKUs, the supplier list, the supplier price list (as expected price only) and, where the platform has them, receipts**. Never import par levels, inventory or recipes. Never write back.
6. **Inventory today.** About 70% of the surface listed in §3 is **flag-gated and OFF in the pilot**. That includes recipes, inventory count, price alerts, integrations, Ask, pay run, chain alerts, consolidated match and VAT at risk. The live core is: receiving, OCR intake (photo; real OCR only for allow-listed tenants), matching and the leak hero, approvals, claim letters and recovery (pilot ON), contracts (pilot ON), supplier ledger and leak card (pilot ON), and the monthly report (pilot ON).

---

## 1. What the MarketMan / Zester sync does today

### 1.1 Components

| Piece | Where | What it does | Real or stub |
|---|---|---|---|
| Adapter interface | `packages/procurement/src/types.ts:47-70` | `listOrders(since)`, `listDeliveriesScheduled(date)`, `getOrder`, `listSuppliers`, `listProducts`, optional `handleWebhook`, optional `parseDocument` | Contract only |
| Platform enum | `types.ts:3-11`; DB `procurement_platform` `schema.ts:103-112` | marketman, zester, zestt, tabit, yarpa, nash, restigo, restomatch | Only 2 have API adapters |
| Registry | `packages/procurement/src/registry.ts:5-8` | Map with `marketman` and `zester`. **`zestt` is not registered.** | Real |
| MarketMan adapter | `adapters/marketman.ts:80-161` | `X-API-Key` header, base `https://api.marketman.com/v3`, cursor paging `/orders?since&limit=100&cursor`, `/orders/deliveries?date`, `/suppliers`, `/products` | **Invented contract** (`:3-8` VERIFY) |
| Zester adapter | `adapters/zester.ts:59-145` | `Authorization: Bearer`, base `https://api.zester.co.il/v1`, page paging `/purchase-orders?updated_since`, `/vendors`, `/items`; state map draft/submitted/approved/partially_received/received/canceled → our `po_status` (`:47-54`) | **Invented contract** (`:3-9` VERIFY) |
| Zestt adapter | `adapters/zestt.ts:18-47` | Document only. `parseDocument` delegates to an injected PO parser. Every API method throws `DOCUMENT_ONLY` | Real for documents (see 1.5) |
| HTTP client | `packages/procurement/src/http.ts:31-120` | fetch with 30 s timeout. Retries on 5xx/429 with exponential backoff (200 ms × 2ⁿ, 3 retries). No retry on other 4xx | Real |
| Offline transport | `transport.ts:20-41`, `fixtures/marketman.ts`, `fixtures/zester.ts` | `credentials.mode === 'fixture'` serves recorded responses with the same normalizers | Real (synthetic data) |
| Worker job | `apps/worker/src/jobs/syncPlatforms.ts:29-99` | Load the connection, then credentials, then `listSuppliers`, then `syncSuppliers`, then `listOrders(since)`, then `syncOrders`, then set `last_sync_at` | Real code, unit-tested, **dormant** (never triggered) |
| Handler map | `apps/worker/src/handlers.ts:33` | `'sync-platforms': processSyncPlatforms`, so the serverless runner (`/api/cron/jobs`, `vercel.json`) would run it **if a job row existed** | Real |
| Schedule | `apps/worker/src/cron.ts:9-10` (comment) vs `:54-150` (code) | Comment claims every 30 min. **No scheduler is registered.** `healthDigest.ts:55` lists the queue for monitoring | **Not scheduled** |
| Connection table | `procurement_connections` `schema.ts:1287-1304` | `credentials_vault_ref`, `config` jsonb, `last_sync_at`, `sync_cursor` (**never written**), `enabled`, unique (restaurant, platform) | Schema real, no writer |
| Credentials | `syncPlatforms.ts:265-283` `loadCredentials` | `fixture:*` gives the offline fixture (refused in production). `env:VAR` gives `{ apiKey: process.env[VAR] }`. Anything else throws. "Vault integration comes later" (`:262-264`) | Stub vault |
| tRPC | `routers/integrations.ts:404-457` | `procurementProviders` (manager/owner; connected? sample or live? last sync) and `procurementPreview` (**fixture only**, nothing saved) | Real, read-only |
| UI | `apps/web/app/dashboard/integrations/procurement.tsx:15-107`, page `page.tsx:32` | Two cards with a "Not connected / Sample / Live" badge and a "preview" list of sample orders with `formatIls` totals. Footer text says how to activate | Real, sample only |
| Tests | `packages/procurement/src/__tests__/marketman.test.ts` (paging, retries, 401/400 no-retry, auth, line fallback), `zester-and-fixtures.test.ts:24-111`; `packages/api/src/__tests__/integrations.test.ts:300-340` (provider state, cross-tenant); `apps/worker/scripts/smoke-all-jobs.ts:131-132` (the sync **must fail** without credentials) | — | Green |

### 1.2 Data flows (all one-way: platform → RestoMatch)

| Entity | Adapter method | Persisted by the job? | Where it lands | Notes |
|---|---|---|---|---|
| Suppliers | `listSuppliers` | **Yes** | `suppliers` (`external_ref`, `source_platform`) | Match by external ref, then by lower-case name (and backfill the ref), else insert (`syncPlatforms.ts:111-168`). The name fallback means a platform supplier called "תנובה" silently adopts an existing manual "תנובה" row. Usually right. Never confirmed by a human |
| Purchase orders | `listOrders(since)` | **Yes** | `purchase_orders` (`source='platform'`), upsert on (restaurant, platform, ref) (`:190-243`) | Status is overwritten from the platform on each sync (`:208-221`). `vat_rate`, `customer_ref` and `buyer_name` are never set. `totalEstimated` is a float turned into a string |
| PO lines | inside orders | **Yes, delete + re-insert** (`:221`, `:244-255`) | `po_lines` | `productId: null`, **`supplierSku` not set**, `productHint` (the platform product id) dropped, `unitPriceExpected` is a float turned into a string |
| Products / price list | `listProducts` | **No**: never called by the job | — | Both adapters implement it (`marketman.ts:148-160`, `zester.ts:133-145`). Only the preview counts them |
| Scheduled deliveries | `listDeliveriesScheduled` | **No** | — | Would feed `receiving.todayExpectations`, but the job does not call it |
| Single order | `getOrder` | **No** | — | Webhook-style refresh. `handleWebhook` is implemented by neither adapter |
| Receipts (goods received in the platform) | — | **No method exists** | — | MarketMan and Zester both receive goods in-app (ext-06, ext-07 §2.3) |
| Invoices / AP documents | — | **No method exists** | — | MarketMan AP stores invoice photos and OCR (ext-06) |
| Write-back (approvals, claims, prices) | — | — | — | None, by design. Correct under "nothing sent automatically" |

### 1.3 How the engine would see a synced order (the leak trace)

1. A supplier invoice arrives (photo, email or WhatsApp). `buildMatchInput` picks the nearest eligible PO for that supplier in the ±7 local-day window (`packages/api/src/match/buildMatchInput.ts:42`, `:200-208`, `:243-271`). Eligible means `sent | confirmed | partial` (`:40`). A synced PO qualifies by status. **Everything below applies only when that pick is a synced PO.** An invoice whose discovery picks a manual or Zestt-imported PO, or no PO, is unaffected.
2. It loads that PO's lines with `productId` and `supplierSku` (`:283-301`). For a synced PO **both are null**.
3. The engine tries `productId` and then `supplierSku` (`engine.ts:228-233`). Neither exists, so `inv` stays undefined for every PO line.
4. Result per line: PO line → `MISSING_ON_INVOICE` (`warn`, delta = expected qty × price, `engine.ts:359-365`). Invoice line → `UNORDERED_ITEM` (`block`, delta = billed line total, `:377-382`).
5. `LEAK_FILTER` counts `warn`/`block` except `PRICE_LOWER` and `UNORDERED_ARRIVAL` (`leak-views.ts:134-136`). So **the whole invoice plus the whole PO** land in the leak until #211 merges (about 2× the invoice), and the whole invoice still does afterwards (about 1×). The invoice is also **blocked** for payment.
6. Recovery: the mapping screen backfills `po_lines.product_id` only where `supplierSku` matches (`routers/mapping.ts:385-400`). Synced lines have no SKU, so mapping cannot fix them. And the next sync deletes the lines and re-inserts them with nulls again (`syncPlatforms.ts:221`).

Compare the **Zestt document import**, which does the right thing. It resolves the supplier and per-line SKU, checks the printed totals (a failed checksum becomes a `draft` PO, which is not eligible), writes `vat_rate`, `customer_ref` and `buyer_name`, upserts lines **in place** (`importPo.ts:226`), and refuses re-import once the PO is closed, cancelled or received against (`:186-198`). The API sync should reuse `importPurchaseOrder` instead of its own `syncOrders`.

### 1.4 Other gaps between "built" and "running"

- **Status authority.** The platform state overwrites ours on every sync. When MarketMan marks an order `closed` after its own receiving, our PO leaves `ELIGIBLE_PO_STATUSES`, and the invoice then matches **no PO**. G-04 ("closed synced POs still discovered", int-00 row G-04) is the planned fix. It is not merged.
- **Receiver ₪.** Synced POs carry `totalEstimated`. `orders.list` and `orders.get` are `memberProcedure` and return it to the receiver (int-05 §1). W2-06 AC4 `redactPrices` and #219 partly close this. The sync makes the exposure wider.
- **No cursor or error surface.** `sync_cursor` is never written. Orders whose supplier is not in the map are skipped with a `console.warn` only (`syncPlatforms.ts:182-188`). Nothing reaches the owner, so "last sync OK" can hide dropped orders.
- **Credentials.** `env:VAR` needs a deploy-time env var per tenant. This is Phase-6, human only (`docs/PRODUCTION-UNBLOCK.md`). No UI collects a key, which is correct under the contract. W3-07a gives MarketMan/Zester "a real contact path" only (`docs/ux/IMPLEMENTATION-PLAN.md:562`).
- **Schedule.** `cron.ts` is on the immutability list, so registering the scheduler is a **human-authored PR**. `10-catalogue` §D bug 7 routes it to an **H-05 addendum**.

---

## 2. Coexistence path: "MarketMan orders, RestoMatch checks"

**Principle.** The ICP wedge is the dock and the 3-way match (`docs/ICP.md:29-31`). A MarketMan or Zester restaurant already types its orders, and often its receipts, into that tool. Retyping them into RestoMatch is the main reason such a lead would not adopt. So the job is: **pull their orders (and receipts where available) read-only, make the engine pair them line by line, and show the leak ₪ on the first matched invoice.** Ordering, par levels, counts and recipes stay in their tool. ICP §5 marks par/forecast as "later, borderline anti-ICP", and cross-supplier price comparison (`product_group_id`) as "later, locked". We do not import or rebuild either.

| # | Step | Why (₪ link) | Owner / gate |
|---|---|---|---|
| **C1** | **Pair-ready lines.** Map the platform product to `po_lines.supplier_sku` from `listProducts` (the product's `sku`) or keep the platform product id as a per-supplier key. Run the catalog `decideLink` (G-08) for `productId`, auto only on sku/alias. | Without it the leak is inflated (§1.3). | ocr-procurement-engineer (`apps/worker`, `packages/procurement`, `packages/catalog`). No immutable file |
| **C2** | **Upsert lines in place; never rewrite a received PO.** Reuse `importPurchaseOrder`'s rules (`importPo.ts:160-310`): key the lines by platform line id (`po_lines` has no external id column, so this needs a new column, H-04/H-03 schema batch, **human PR**). Until then, skip lines for any PO with a goods receipt. | Keeps `gr_lines.po_line_id`, which keeps QTY_SHORT/QTY_OVER (the wedge). | Interim: worker only. Durable: schema human-PR |
| **C3** | **Our status wins after the dock.** Sync may move `draft → sent → confirmed` and set `cancelled`. It never moves a PO that has a receipt or a matched invoice. "closed" from the platform is stored as metadata and does not drive eligibility. | An invoice must still find its PO (G-04). | worker; G-04 consulted (matching-engine-guardian) |
| **C4** | **Price list as expected price only.** Call `listProducts` into `supplier_catalog_items` through the existing price-list import path (int-06 §1), with "מה ישתנה" review (W3-10). It feeds `resolveExpectedPrice` (W2-06) and the order guardrail. It is never a contract unless the owner locks it (W2-12 `lockCurrentPrices`). | PRICE_HIGHER against a known list, without the owner uploading a sheet. | ocr-procurement-engineer; leak-economist signs the "list ≠ contract" label |
| **C5** | **Import platform receipts as dock evidence, labelled.** Where the platform exposes received qty (Zester `partially_received`/`received`, MarketMan receiving), write a `goods_receipts` row with a source label "נקלט ב-MarketMan". Never overwrite a receipt made in our app. | The 3-way match runs for restaurants that receive in the other tool. Without it, those invoices are only PO-vs-invoice. | Needs a GR `source` column (schema human-PR, H-04). The engine is unchanged |
| **C6** | **Schedule plus a health line.** Register `sync-platforms` per enabled connection (H-05 addendum, `cron.ts`, **human PR**). Write `sync_cursor`. Surface "N orders skipped: supplier not linked" in the W3-07a hub with one fix CTA. | Silent drops mean silent missing POs, so false UNORDERED. | Human PR for the scheduler; hub = W3-07a |
| **C7** | **Credentials (Phase-6, human only).** Owner obtains the MarketMan Open API add-on, or a Zester **buyer** export. A human stores it (env or vault). Until then, offer the **document path** that already works: forward the PO PDF/email to the ingest address, and `importPo` handles it (today Zestt only; extend the parser to MarketMan PO PDFs). | Gives the coexistence value with zero credentials. | Docs + growth-pmm (pilot ops); parser = ocr-procurement-engineer |
| **C8** | **Verify the contracts before first live call.** Replace the VERIFY shapes with real ones and record one sanitized fixture per platform. | Both adapters are guesses (§0.2). | Human obtains the docs; agent updates the adapter |

**What stays out (and why).** Write-back of any kind: no "approved" status pushed to MarketMan, no claim pushed to a supplier through their network. This follows "nothing sent to suppliers automatically". Inventory and par import is anti-ICP. Recipe import is anti-ICP as a core feature; recipes are already ours behind a flag and are not a sales lever. Cross-supplier price comparison is ICP "later, locked".

**Value, stated as assumptions (no new ₪ claimed here).** For a MarketMan/Zester tenant the gain is (a) **time-₪**: no retyping of orders. Sizing belongs in the catalogue under the hours formula and must not be summed with money-₪. And (b) **money-₪**: the PRICE_HIGHER, QTY_SHORT and QTY_OVER findings that already exist for manual-PO tenants become possible for them at all. Without POs those invoices yield only DUPLICATE, VAT and TOTAL checks. The money-₪ is the existing engine's figure on a larger base, not a new leak type. No figure is given until a pilot tenant on one of these platforms exists. That is an **assumption to verify**, not a claim.

**Suggested catalogue entry.** "A27 (candidate): coexistence import" = C1+C2+C3 (agent, no immutable file except the C2 column) → C4 → C6 and C7 (human PRs or credentials) → C5 (schema). Hard prerequisite: G-04 merged. Leak-canary unaffected (engine unchanged).

---

## 3. Feature inventory: RestoMatch today, by module and role

**Scope of "today".** `origin/main` with train A merged, plus the open pilot PRs from the session's PR status file. #232/#224 (OCR recognises real consolidated invoices, train B), #211 (MISSING_ON_INVOICE leaves the leak, owner-approved 31.10) and #219 (no ₪ to receiver/chef on activity, receiving reads and owner aggregates) are **open, not merged**. They are marked "PR".

**Legend.** Status: **live** = on for every tenant · **flag:x (P)** = flag x, in the pilot set · **flag:x (–)** = flag x, not in pilot · **stub** = code exists, no real effect · **planned** = wave-2/3/4 or AU id. Roles: O owner, M manager, C chef, R receiver, B bookkeeper. "₪" = money shown to that role. Route roles are from `apps/web/lib/nav/routes/*.ts`. Flags are from `packages/api/src/lib/features.ts:11-49`.

### 3.1 Ordering

| Feature | Roles | Status | Notes / planned |
|---|---|---|---|
| Order list, 4-step wizard, PO detail, send by email/WhatsApp | O M C (route `orders.ts:10`; chef added 31.10) | **live**. WhatsApp send needs plan feature `whatsapp_alerts` | Chef sees ₪ on orders (owner rule allows). R has no route, but `orders.list`/`get` leak `totalEstimated` (int-05). Fix: W2-06 AC4 `redactPrices` |
| Order capture from pasted/shared text | O M C | **flag:orderCapture (P)** | WhatsApp producer needs `ingestWhatsapp` (–), so that path is dead in the pilot (int-01) |
| Zestt PO document import | O M | **live** (needs OCR key) | `orders.importPo` (`routers/orders.ts:694-730`) |
| MarketMan/Zester sync | O M (preview) | **flag:integrations (–)**, **stub** (fixture preview; job never runs) | §1–§2; H-05 add., W3-07a hub |
| Prices out to supplier on PO | O M C | **flag:orderPricesOut (–)** | — |
| Supplier confirm link `/s/<token>` | O M | **flag:supplierConfirm (–)** | The answer never reaches the dock (int-02). G-10, W3-09 portal 2.0 |
| Order reminders / supplier delays / daily expectations jobs | O M (email) | **live** (cron) | `daily-expectations` writes an unread audit row (int-05). AU-04, AU-11 cut-off drafts |
| Order guide, cut-off board, server drafts | O M C | **planned** W2-06 (#184 draft), AU-11 | Recurring orders = ICP "later" |

### 3.2 Receiving (dock)

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Today board, receiving wizard, per-line count, reject reasons, photos, signature | O M R | **live** | Receiver must see **no ₪**. #219 (PR) removes ₪ from receiving reads |
| Dock slip (delivery-note photo first) | O M R | **flag:dockSlip (P)** | — |
| Receiver PWA, offline photo queue | R | **flag:receiverPwa (P)** | Full outbox = W2-05 (#189/#202) |
| Receiver languages | R | **flag:receiverLanguages (–)** | — |
| "Usual price" at the dock | O M (B) | **flag:dockPriceContext (–)** | Must stay hidden from R |
| Walk-in / multi-page / exceptions desk | O M R | **planned** W2-05, G-09 (#190) | — |

### 3.3 Invoices, AP and OCR

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Camera invoice at the dock leads to OCR | R (upload) → O M B (read) | **live** pipeline. Real OCR only for `OCR_REAL_RESTAURANT_IDS` with a key (int-01) | Invoice page closed to R (nav test) |
| Email / WhatsApp intake, inbox | O M B | **flag:ingestEmail / ingestWhatsapp (–)** | — |
| Consolidated invoices (חשבוניות ריכוז) | O M B | **flag:consolidatedMatch (–)**. OCR recognition: **PR** #232/#224 | AU-09 proposes the delivery-note set |
| Manual invoice lines when OCR fails, OCR retries | O M | **PR** #216, #223, #222 | — |
| Invoice register / cockpit | O M B | **planned** W2-02 (#217) | — |
| Due dates, printed terms | O B | **planned** W2-03, G-17 | — |

### 3.4 Matching and leak

| Feature | Roles | Status | Notes |
|---|---|---|---|
| 12-type engine, auto re-match on receipt/mapping | system | **live** | Immutable (`packages/matching`) |
| Leak hero, breakdown, printable report | O M B (₪) | **live** | MISSING_ON_INVOICE still inside `LEAK_FILTER` until **PR** #211 |
| "How did we get to ₪X" proof | O M B | **flag:leakProof (P)** | — |
| Supplier leak card | O M | **flag:supplierLeakCard (P)** | — |
| VAT at risk card | O M B (R reader per int-05) | **flag:vatAtRisk (–)** | AU-08 |
| Leak drill / drivers | O M B | **planned** W2-09 (#183/#191/#196) | — |
| Coverage line ("checked 78% of spend") | O | **planned** W3-09 | Synced POs (§2) raise it |

### 3.5 Approvals

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Approval rules (auto/queue/block), per-discrepancy decisions | O M B | **live** | Immutable `approvals/engine.ts` |
| Bulk, keys, invoice-level desk | O M B | **planned** W2-04 (#209) | Bulk cap ₪200, never bulk `block` |
| Earned autonomy (rule grants) | O | **planned** AU-16 / H-12 / H-13 | Every money action human-confirmed unless an owner rule says otherwise |

### 3.6 Claims and recovery

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Credit-request letters per supplier (copy / wa.me / mailto, human sends) | O M B | **live** (letters) | Nothing sent by the system. Letterhead **PR** #213 |
| Recovery desk: sent → acknowledged → credited → returned, credit note entry | O M B | **flag:recovery (P)** | MISSING_ON_INVOICE, PRICE_LOWER and UNORDERED_ARRIVAL are never claimable (`lib/claims.ts`) |
| Overdue after 7 days, daily email chase (08:30) | O M | **flag:recovery (P)** | Web vs email count mismatch (int-04). AU-03 |
| Supplier claim portal, server send | — | **planned** H-06; AU-17 (owner-tap send) | — |
| Credit-note OCR routing | — | **planned** W3-11 | OCR already classifies `credit_note`. No consumer |

### 3.7 Pay run

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Month pay-run report, CSV | O M B | **flag:payRun (–)** | Read-only, no `markPaid` (int-05) |
| Due buckets, mark paid, holds, remittance | O B | **planned** W2-03, AU-14 | Masav file = AU-19 |

### 3.8 Catalog, price lists, price alerts, contracts

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Price-list import, SKU mapping, products | O M | **live** | Core, no flag (int-06) |
| Contracts, over-contract tab, contract price in matching | O M B | **flag:contracts (P)** | Route also lists `priceAlerts` |
| Price baselines (02:00) | system | **live** | — |
| Price alerts sweep (07:00) | O M | **flag:priceAlerts (–)** | Sweep no-ops for pilot tenants. A1/AU-01, AU-13, W2-12 |
| Cross-branch price disparity | O | **flag:priceDisparity (–)** | ICP "later" for cross-supplier comparison. This is same supplier, cross-branch |
| Price-list inbox, item master | O M | **planned** W3-10 | — |

### 3.9 Inventory

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Inventory count (walk-in, storage areas), valuation at last paid price, CSV export, history | O M C | **flag:inventoryCount (–)** | `routers/inventory.ts:293-640`, `inventory/valuation.ts` (integer agorot, half-up per line) |
| Actual food cost for a period = opening + purchases − closing over sales | O M (C sees ₪? see note) | **flag:inventoryCount (–)** | `inventory.period`. Purchases come from invoices. Chef ₪ outside orders/recipes is an **owner-rule question**: count values are ₪ |
| Count as a field instrument, offline, fat-finger guard | O M C | **planned** W2-07 | — |
| Par levels, forecast, stock-on-hand | — | **not built. ICP anti-ICP / later** | Coexistence: leave to MarketMan/Zester |

### 3.10 Recipes and food cost

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Recipes, sub-recipes, plate cost, target %, change history, CSV import | O M C (₪ allowed on recipes) | **flag:recipes (–)** | — |
| Dish price alert (food cost crosses target after a supplier price rise) | O M C | **flag:dishPriceAlert (–)** | — |
| POS vs theory (theoretical vs actual food cost per dish) | O M C | **flag:recipes + integrations (–)** | `recipes/pos.ts:1-30`, `routers/recipes.ts:588` |
| Recipe workbench, food-cost control room | O M C | **planned** W3-02 | — |

### 3.11 Reports, Ask AI, notifications

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Reports page; monthly "one number" report and email | O M | **flag:monthlyReport (P)**, digest preview **flag:monthlyDigestPreview (P)** | One report with tabs = W3-08 |
| End-of-day report, health digest | O M / admin | **live** (cron) | AU-04/AU-12 |
| Ask RestoMatch (read-only tools, offline fallback, grounding) | O M | **flag:aiAssistant (–)** | B excluded. AU-06, W3-04 drafts |
| Notifications: email outbox live; WhatsApp `role:` targets undeliverable; push mock | all | **live / stub** (int-07) | G-06 (#199), H-05; quiet hours **PR** #173; dedupe **PR** #230; retry log **PR** #231 |
| Task spine "מחכה לך", bell | all | **planned** W2-08 | — |

### 3.12 Integrations and exports

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Accounting export (Hashavshevet / Priority / Rivhit), account mapping | O B | **flag:integrations (–)** + plan `accounting_export` | — |
| Generic exports page | O B | **live** (plan-gated) | W2-14 honest exports, W3-05 month close |
| POS sales file import | O M | **flag:integrations (–)** | File per upload. No API |
| Procurement sync | O M | **stub** (§1) | §2 C1–C8 |

### 3.13 Multi-branch

| Feature | Roles | Status | Notes |
|---|---|---|---|
| Branch switcher, add/rename branch, branches page | O | **live** (`routers/chain.ts:310-470`) | — |
| Chain overview / dashboard views / chain alerts | O | **flag:chain, dashViews, chainAlerts (–)** | W3-01 roll-up matrix |

### 3.14 Per-role view (what each role actually has in the pilot)

- **Owner (איתן):** everything live, plus the pilot flags: leak hero and proof, approvals, letters and recovery, contracts, supplier ledger and leak card, monthly report. **Missing in the pilot:** price alerts, Ask, pay run, VAT at risk, integrations.
- **Manager:** as owner, minus chain/branches, accounting edit and exports (exports are `bookkeeperProcedure`).
- **Chef:** home, orders (₪ allowed), settings. Recipes and inventory are routed to the chef but **both flags are OFF in the pilot**, so the chef's kitchen area is empty. Inventory ₪ needs an owner decision (§3.9).
- **Receiver (רמי):** home, receiving, settings. Owner rule = no ₪. Open exposures: `orders.list`/`get` totals (int-05), supplier ledger via `invoiceReaderProcedure` (int-04 §8). #219 is partial. The receiving reads are fixed in the PR, not on main.
- **Bookkeeper (מיכל):** approvals, leaks, recovery, contracts, ledger, exports, invoices. No Ask, no integrations-procurement section (`page.tsx:26-34`), and pay run only when `payRun` is on (OFF in the pilot).

---

## 4. Open questions for humans

1. **MarketMan Open API for Israeli accounts.** Is it available, what does it cost (ext-06: $25–$99/month add-on), and does it expose POs, products and receipts? Phase-6, owner.
2. **Zester buyer-side export.** ext-07 found the supplier API only. Ask Zester whether a restaurant can export its orders and receipts. If not, the document path (C7) is the coexistence route, and the `ZesterAdapter` API code should be marked as speculative in STATE.md.
3. **Schema.** An external line id on `po_lines` and a source label on `goods_receipts` (C2, C5) go into H-04 schema batch B as a proposal. Human-authored.
4. **Scheduler.** Register `sync-platforms` or delete the comment. `cron.ts` is a human PR (H-05 addendum). Until C1–C3 land, **do not register it**: §1.3 shows that switching it on corrupts the leak figure.
5. **Chef and inventory ₪.** Count valuation and "actual food cost" are ₪ outside orders and recipes. The owner rule needs an explicit yes or no before `inventoryCount` reaches a chef in the pilot.
