# RestoMatch web app: information architecture map

Source of truth read for this map (2026-10-25, repo `/home/user/restomatch`, app `apps/web`):
all 71 `app/**/page.tsx`, `app/dashboard/layout.tsx`, `app/dashboard/nav.tsx`, `app/dashboard/search.tsx` +
`searchOptions.ts`, `app/dashboard/branch-switcher.tsx`, `lib/roles.ts` (ROUTE_ROLES), `middleware.ts`,
`lib/publicPaths.ts`, `packages/api/src/lib/features.ts` (FEATURE_KEYS), `lib/landingFlags.ts`,
`lib/i18n/config.ts`, `app/(marketing)/_components/MarketingShell.tsx`, `app/showcase/layout.tsx`,
`app/admin/layout.tsx`, `public/pwa/manifest.webmanifest`, plus the lab crawl
(`scratchpad/ux/crawl-results.json`, 225 captures) for real h1s and lab IDs.

Example IDs below come from the **local lab seed** (they are regenerated on every reseed; the seed has no
fixed UUIDs). Showcase IDs (`sup-avi`, `sup-kerem`, `sup-kobi`, `sup-brans`, `sup-shegev`) are static mocks.

| Lab entity | Example id | Label |
|---|---|---|
| supplier | `4f78cb42-e227-4b54-b093-4a9149ecf3ed` | דגי הים התיכון / Mediterranean Fish Co. |
| purchase order (orders) | `f8e05686-78cd-44d2-858a-4c8f25f9b1d7` | הזמנה — משקאות שטיינברג |
| purchase order (receiving) | `e64e5181-5282-4f6f-8eaf-334723602ed1` | "צלם את החשבונית" step |
| invoice | `46372427-1e30-4f38-8d22-9c5613479f5d` | תיקון חשבונית |
| product | `43ecdb3d-4f89-4488-a60b-e5318ab8353a` | אורז יסמין / Jasmine rice |
| recipe | `c14f0e9d-3a5e-43a1-a716-cb5defa7817a` | עריכת מתכון |
| inventory count | `cd364bbd-f8ca-491c-8b70-a5ef315b1874` | ספירה מ-24 באוק׳ 2026 |

Demo users: `owner@ / manager@ / receiver@ (locale en) / bookkeeper@ / chef@kfar-hazeitim.test`
(restaurant "כפר הזיתים" + branches "— חיפה", "— ירושלים").

---

## 1. Access model: seven gates a request passes

1. **Public list** (`lib/publicPaths.ts`). Exact: `/ /pricing /about /privacy /terms /cookies /twitter-image`.
   Prefix: `/login* /reset* /showcase* /leak-check* /s/*` (+ API: showcase, leak-check, auth, trpc, healthz,
   cron, inbound, ingest, supplier-confirm). Everything else redirects anonymous users to
   `/login?callbackUrl=…` (pages) or returns JSON 401 (`/api`). `/scans`, `/admin`, `/dashboard`,
   `/set-password`, `/onboarding`, `/invite` are deliberately **not** public.
2. **Session**: `next-auth`. Edge middleware honours an emptied token; the node `jwt` callback is the real revocation gate.
3. **2FA gate**: a `twoFactorPending` session can reach only `/login*`; everything else goes to `/login/2fa?callbackUrl=`.
4. **Role gate** (`ROUTE_ROLES`, longest-prefix match in middleware): a member on a `/dashboard/*` route their
   **active** role can't see is redirected to `/dashboard`, with no message. The nav uses the same table (exact match).
5. **Page-level flag gate**: most wave-1 pages call `notFound()` (404) when their per-restaurant flag is off.
   The idea is that a disabled feature is invisible, not "locked". Exceptions: pay-run (empty state), branches (upsell).
6. **tRPC procedure roles** (`packages/api/src/trpc.ts`): owner / manager(owner+manager) / receiver(owner+manager+receiver)
   / bookkeeper(owner+bookkeeper) / chef(owner+manager+chef) / finance(owner+manager+bookkeeper) / invoiceReader /
   member / admin. Pages often hide sub-sections by role instead of whole routes.
7. **Plan entitlements** (`requireFeature`): `advanced_analytics` (leak detective table + heatmap, supplier
   scorecards, supplier-header ₪), `chain` (chain dashboard / adding branches), `accounting_export`. When an
   entitlement is closed the page renders `<EntitlementUpsell>`, not a 404.

Platform **admin** is not a tenant role: `isPlatformAdmin(userId)` gates `/admin/*` (non-admins get 404).

### Roles

| Role | Hebrew label | Who | Dashboard routes allowed (ROUTE_ROLES) |
|---|---|---|---|
| owner | בעלים | non-technical, looks at one number | everything; `/chain` and `/branches` are owner-only |
| manager | מנהל/ת | runs operations | everything except exports, chain, branches |
| bookkeeper | חשב/ת | finance, read-mostly | overview, approvals, inbox, leaks/*, recovery, contracts, exports, integrations, invoices, suppliers/ledger, settings |
| chef | שף | kitchen | overview, recipes/*, inventory/*, settings |
| receiver | מקבל סחורה | back door, phone, gloves | overview, receiving/*, invoices/*, suppliers/ledger, settings |
| admin | (platform) | RestoMatch staff | `/admin/*` |
| public | | anonymous | marketing, legal, showcase, auth recovery, leak-check, supplier portal |

### Visible nav items per role (all flags on)

| Item (href) | he label | group | owner | manager | bookkeeper | chef | receiver | extra gate |
|---|---|---|---|---|---|---|---|---|
| overview `/dashboard` | סקירה | תפעול | Y | Y | Y | Y | Y | |
| receiving | קליטת סחורה | תפעול | Y | Y | | | Y | |
| approvals | תור אישורים | תפעול | Y | Y | Y | | | |
| inbox | תיבת חשבוניות | תפעול | Y | Y | Y | | | `ingestWhatsapp` or `ingestEmail` |
| leaks | בלש דליפות | תפעול | Y | Y | Y | | | |
| chain | רשת | תפעול | Y* | | | | | owner with >1 owned branch AND chainEnabled |
| recovery | ₪ חוזר | תפעול | Y | Y | Y | | | `recovery` |
| monthlyReport `/reports/monthly` | דוח חודשי | תפעול | Y | Y | | | | `monthlyReport` |
| ask | שאלו את RestoMatch | תפעול | Y | Y | | | | `aiAssistant` (drawer-only on mobile) |
| suppliers | ספקים | רכש | Y | Y | | | | |
| catalog | קטלוג | רכש | Y | Y | | | | (also active on `/dashboard/products*`) |
| contracts | חוזים והתראות | רכש | Y | Y | Y | | | `contracts` or `priceAlerts`; red count pill = open alerts |
| orders | הזמנות | רכש | Y | Y | | | | |
| recipes | עלות מנה | רכש | Y | Y | | Y | | `recipes` |
| inventory | ספירת מלאי | רכש | Y | Y | | Y | | `inventoryCount` |
| exports | ייצוא | ניהול | Y | | Y | | | |
| team | צוות | ניהול | Y | Y | | | | |
| branches | סניפים | ניהול | Y* | | | | | shown only when chain is NOT shown |
| settings | הגדרות | ניהול | Y | Y | Y | Y | Y | |

Totals with every flag on: owner 18 tabs, manager 16, bookkeeper 8, chef 4, receiver 3.
Mobile bottom bar (first four visible items, excluding `ask`, with leaks pinned into slot 4 if it would
fall out), followed by "עוד":
- owner and manager: סקירה · קליטת סחורה · תור אישורים · בלש דליפות
- bookkeeper: סקירה · תור אישורים · תיבת חשבוניות · בלש דליפות
- chef: סקירה · עלות מנה · ספירת מלאי · הגדרות
- receiver: סקירה · קליטת סחורה · הגדרות

**Routes with no nav entry** (reachable only through in-page links): integrations (catalog header button,
exports accounting-files link), reports/digest (hero link, monthly report), leaks/breakdown|proof|report|claims,
approvals/pay-run, suppliers/ledger (supplier hub ledger tab), catalog/import|mapping, products, orders/new|capture,
contracts/import, recipes/new, inventory/count, all detail pages, `/scans/*`.

### Feature flags (per-restaurant `restaurants.settings.features`, `FEATURES_OFF` kill-switch)

| Flag | Where it surfaces |
|---|---|
| `chain` | (key exists; chain view itself is plan-entitlement `chain` + `chainEnabled`) |
| `chainAlerts` | weekly "branch to look at" card on `/dashboard/chain` |
| `priceDisparity` | cross-branch price disparity section on `/dashboard/chain` |
| `dashViews` | **defined but unused**: the view toolbar is always on |
| `contracts` / `priceAlerts` | `/dashboard/contracts` tabs (contracts / alerts+thresholds), nav entry + badge, supplier "contract" tab, over-contract badges on invoices + leaks, overview price-alert teaser, `/contracts/import` |
| `recovery` | `/dashboard/recovery` (404 off), nav item, "returned this month" tile on hero, tracker letters on claims |
| `monthlyReport` | `/dashboard/reports/monthly` (404 off), nav item, hero link |
| `monthlyDigestPreview` | `/dashboard/reports/digest` (404 off), hero link |
| `leakProof` | `/dashboard/leaks/proof` (404 off), "How did we get to ₪X?" hero link |
| `ingestWhatsapp` / `ingestEmail` | `/dashboard/inbox` (404 if both off), nav item |
| `receiverPwa` | receiving offline queue + manifest/SW + share target |
| `receiverLanguages` | six-language picker (he/en/ar/ru/th/ti) replaces עב/EN; translated receiver flow |
| `aiAssistant` | `/dashboard/ask` (404 off), nav (owner/manager) |
| `leakCheck` + env `LEAK_CHECK_PUBLIC=1` | `/leak-check*` (404 otherwise; off in the lab), marketing nav/footer link |
| `recipes` | `/dashboard/recipes*` (404 off), nav, overview food-cost card |
| `inventoryCount` | `/dashboard/inventory*` (404 off), nav, period card on recipes |
| `dishPriceAlert` | dish crossed food-cost target alert (recipes) |
| `integrations` | `/dashboard/integrations` (404 off), catalog header button |
| `payRun` | approvals header link; `/approvals/pay-run` shows a "disabled" empty state when off |
| `dockSlip` | receiving wizard signed delivery-slip step |
| `dockPriceContext` | "your usual price" hints in receiving + invoice lines |
| `consolidatedMatch` | consolidated invoice (חשבונית ריכוז) ↔ delivery-notes panel on invoice page (finance roles) |
| `growth` | referral card in settings (owner/manager) |
| `orderPricesOut` | priced supplier document toggle + preview on orders |
| `supplierConfirm` | supplier confirm card on order detail; public portal `/s/[token]` |
| `orderCapture` | `/dashboard/orders/capture` (404 off), orders header button, inbox "open as order" |
| `vatAtRisk` | VAT-at-risk card on overview + banner on invoice (non-chef) |
| `supplierLeakCard` | supplier "leak" tab + A4 print card |
| `supplierLedger` | supplier "ledger" tab + `/dashboard/suppliers/ledger` grid |

Landing flags (deploy env `LANDING_FLAGS`): `landingOrdersStory`, `landingCompare`.
Other env gates: `ANTHROPIC_API_KEY` (Zestt PO-photo import button on orders), `NEXT_PUBLIC_ENABLE_SCAN_MOCKS`.

---

## 2. Route inventory by review area

Columns: URL · file (under `apps/web/app/`) · roles · purpose · primary action · flags/gates.

### A1. Marketing + showcase (public). 16 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/` | `page.tsx` | public (signed-in member → redirect `/dashboard`) | Landing v2: hero video, 3 steps, "Receiver in English" morph, honest math (1.5% of ₪150k), pricing, FAQ, lead form | Lead form `#lead` ("start a pilot"); promo video; `/showcase` | `landingOrdersStory`, `landingCompare` |
| `/about` | `(marketing)/about/page.tsx` | public | Why we built it + full features list (`#features`) + detail sections from v1 | CTA to `/#lead`, link to `/showcase` | |
| `/pricing` | `(marketing)/pricing/page.tsx` | public | Plan cards from `PLAN_SEED` | CTA to `/#lead` | |
| `/leak-check` | `(marketing)/leak-check/page.tsx` | public | Free leak check (lead magnet): upload invoices → instant leak estimate | Submit `LeakCheckForm` | env `LEAK_CHECK_PUBLIC=1` + `leakCheck` (404 in lab) |
| `/leak-check/result?t=` | `(marketing)/leak-check/result/page.tsx` | public (signed short-lived link) | Shows the ₪ leak total from the check | Start trial with these results (claim) | same, noindex |
| `/leak-check/claim?t=` | `(marketing)/leak-check/claim/page.tsx` | owner (signed-in; else /login, no restaurant → /onboarding) | Attach a leak-check result to your restaurant (POST confirm) | Confirm claim | same |
| `/privacy` | `(marketing)/privacy/page.tsx` | public | Privacy policy (Amendment 13) | (read) | |
| `/terms` | `(marketing)/terms/page.tsx` | public | Terms of use | (read) | |
| `/cookies` | `(marketing)/cookies/page.tsx` | public | Cookie policy | (read) | |
| `/showcase` | `showcase/page.tsx` | public | Demo hub: cards to each interactive demo | Pick a demo / CTA `/#lead` | |
| `/showcase/receiver` | `showcase/receiver/page.tsx` | public | Interactive receiver wizard (select supplier → scan → processing → reconciliation → adjust → confirmed) | Photograph an invoice (real OCR via `/api/showcase/ocr`) | |
| `/showcase/dashboard` | `showcase/dashboard/page.tsx` | public | Mock owner dashboard (count-ups, heatmap, feed) | Explore → invoices / suppliers | |
| `/showcase/dashboard/invoices` | `showcase/dashboard/invoices/page.tsx` | public | Processed invoices with scan viewer + PO compare | Open an invoice / supplier | |
| `/showcase/dashboard/suppliers/sup-avi` | `showcase/dashboard/suppliers/[supplierId]/page.tsx` | public | Mock supplier profile (price trend, invoices) | Back to invoices | ids: sup-avi, sup-kerem, sup-kobi, sup-brans, sup-shegev |
| `/showcase/deliveries` | `showcase/deliveries/page.tsx` | public | Delivery tracking + late-delivery manager alerts | Call / WhatsApp the agent, mark handled | |
| `/showcase/approvals` | `showcase/approvals/page.tsx` | public | Approval rules matrix + decision logs | (explore) | |

### A2. Auth + onboarding. 7 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/login` | `login/page.tsx` | public | Sign in: password (primary) + magic link (backup), "remember me", locked email for invites | "כניסה"; secondary "שלחו לי קישור התחברות"; "שכחתם סיסמה?" → `/reset` | six-language picker when `receiverLanguages` not killed |
| `/login/check-email` | `login/check-email/page.tsx` | public | Magic link sent confirmation | Back to login | |
| `/login/2fa` | `login/2fa/page.tsx` | signed-in with 2FA pending | TOTP / recovery code step | Verify code; "switch account" | redirects if not pending |
| `/reset` | `(auth)/reset/page.tsx` | public | Request reset email, or (with `?token=`) choose new password | Send link / set password | |
| `/set-password` | `(auth)/set-password/page.tsx` | any signed-in member | Set first password or change it | Save password; back to settings | 2FA-pending → /login/2fa |
| `/invite/accept?token=` | `invite/accept/page.tsx` | signed-in invitee | Exchanges token for membership then `/api/session/refresh?next=/dashboard`; renders only on error | (auto) / back to dashboard | |
| `/onboarding` | `onboarding/page.tsx` | signed-in with no membership | Create the restaurant (you become owner) | "יצירת מסעדה והמשך" | users with memberships → `/dashboard` |

### A3. Owner command center. 4 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard` "חדר הבקרה" | `dashboard/page.tsx` | all 5 tenant roles (sections role-gated) | T1 leak hero (₪ this month, % of spend, caught before payment, last month), VAT-at-risk card, trend chart, pending-approvals + clean-match KPIs, price-alert teaser, recipes card, leak heatmap (owner), activity feed | Drill into the ₪ → `/dashboard/leaks/breakdown?<view>`; pending KPI → approvals | view toolbar (`?p ?from ?to ?cmp ?chart ?d ?tv=1` + filters for finance roles); `vatAtRisk`, `recovery`, `monthlyReport`, `monthlyDigestPreview`, `leakProof`, `recipes`, `priceAlerts`; `advanced_analytics` for heatmap |
| `/dashboard/ask` | `dashboard/ask/page.tsx` | owner, manager | AI Q&A over the restaurant's money, each answer linked to its source screen; daily quota | Ask a question | `aiAssistant` (404) |
| `/dashboard/reports/monthly` | `dashboard/reports/monthly/page.tsx` | owner, manager | Preview of the 1st-of-month "one number" report: hero, next actions, email/WhatsApp/PDF views; this/last month | Download PDF / switch email↔WhatsApp | `monthlyReport` (404) |
| `/dashboard/reports/digest` | `dashboard/reports/digest/page.tsx` | owner, manager | Read-only preview of the monthly email (one number, top-3 leaking suppliers, recovered) | CTA to full report / tracker | `monthlyDigestPreview` (404) |

### A4. Leaks. 5 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/leaks` "בלש הדליפות" | `dashboard/leaks/page.tsx` | owner, manager, bookkeeper (detective table owner-only) | Leak explorer (all finance) + over-contract card + detective: totals, heatmap, product×supplier price-creep table with sparklines | Open monthly report (gold pill) / "to breakdown" | `advanced_analytics` (upsell); non-owners see a warn-tone "owner only" card |
| `/dashboard/leaks/breakdown` | `dashboard/leaks/breakdown/page.tsx` | owner, manager, bookkeeper | Every invoice behind the hero ₪ with its discrepancy lines; pending-link invoices separate (T4); `?m=-1` or view params | Open invoice / send claim letters / CSV | view toolbar (period, compare, density, saved, 5 filters) |
| `/dashboard/leaks/proof` | `dashboard/leaks/proof/page.tsx` | owner, manager, bookkeeper | Print sheet "How did we get to ₪X?": number, % of spend, pending, top catches | Print | `leakProof` (404) |
| `/dashboard/leaks/report?month=` | `dashboard/leaks/report/page.tsx` | owner, manager (bookkeeper passes middleware but sees a role card) | A4 monthly leak report vs the 1.5% target; prev/next month; `?cmp=prev|yoy` | Print / Save as PDF | |
| `/dashboard/leaks/claims?m=` | `dashboard/leaks/claims/page.tsx` | owner, manager, bookkeeper | Credit-request letters (מכתבי דרישת זיכוי), one per supplier, plus tracker letters | Print letters | `recovery` adds tracker letters |

### A5. Approvals, invoices, inbox, scans. 5 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/approvals` | `dashboard/approvals/page.tsx` | owner, manager, bookkeeper | Queue of discrepancies blocking payment, filterable by type/severity/supplier | Approve / Reject (reason required) / Escalate to owner; CSV | `payRun` adds header link |
| `/dashboard/approvals/pay-run?m=` | `dashboard/approvals/pay-run/page.tsx` | owner, manager, bookkeeper | This/last month's unpaid checked invoices per supplier: pay (T3) / hold (T2) / claim (T2) / waiting (T4) | Export pay-run CSV; open claim letters | `payRun` (empty state, not 404) |
| `/dashboard/invoices/46372427-1e30-4f38-8d22-9c5613479f5d` | `dashboard/invoices/[invoiceId]/page.tsx` | owner, manager, bookkeeper, receiver (edit: owner/manager) | Invoice correction: lines, prices, image; consolidated cross-match panel; VAT-at-risk banner; over-contract / usual-price badges | Correct lines and save; open scan | `vatAtRisk`, `consolidatedMatch`, `contracts`, `dockPriceContext` |
| `/dashboard/inbox?filter=` | `dashboard/inbox/page.tsx` | owner, manager, bookkeeper (manage: owner/manager) | Invoices received by WhatsApp/e-mail with status/errors, secret addresses, sender allow-list | Review "needs review" docs; allow a sender; open as order | `ingestWhatsapp`/`ingestEmail` (404) |
| `/scans/46372427-1e30-4f38-8d22-9c5613479f5d` | `scans/[invoiceId]/page.tsx` | any signed-in member of the owning restaurant (not in ROUTE_ROLES, so the chef can open it too) | Full-screen scanned invoice (signed URL), outside the dashboard shell | View / open original | demo mocks in non-prod |

### A6. Receiving. 2 routes (the receiver's whole world)

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/receiving` | `dashboard/receiving/page.tsx` | owner, manager, receiver | Today's expected deliveries as cards (supplier, time, item count, receipt status) | Tap a card → "קבלת סחורה" | `receiverPwa` (install, offline queue, share target `/dashboard/receiving/share`) |
| `/dashboard/receiving/e64e5181-5282-4f6f-8eaf-334723602ed1` | `dashboard/receiving/[poId]/page.tsx` | owner, manager, receiver | Wizard: photograph invoice → OCR processing → reconciliation → adjust quantities → confirmed (+ signed slip) | "צלם את החשבונית" | `receiverPwa`, `receiverLanguages` (ar/ru/th/ti names), `dockSlip`, `dockPriceContext` |

### A7. Orders (+ supplier portal). 5 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/orders` | `dashboard/orders/page.tsx` | owner, manager | Purchase orders list; priced-document toggle | "הזמנה חדשה"; secondary: order from WhatsApp, Zestt photo import | `orderCapture`, `orderPricesOut`, env `ANTHROPIC_API_KEY` |
| `/dashboard/orders/new?supplierId=` | `dashboard/orders/new/page.tsx` | owner, manager | New-order wizard (supplier → item picker → draft) | Create draft order | |
| `/dashboard/orders/capture?text=` | `dashboard/orders/capture/page.tsx` | owner, manager | Paste/share the WhatsApp order already sent → draft PO | Parse → one-tap confirm | `orderCapture` (404) |
| `/dashboard/orders/f8e05686-78cd-44d2-858a-4c8f25f9b1d7` | `dashboard/orders/[poId]/page.tsx` | owner, manager | Order detail; supplier document preview; supplier confirmation card | Send / edit order; send confirm link | `orderPricesOut`, `supplierConfirm` |
| `/s/[token]` | `s/[token]/page.tsx` | public (72h token; supplier, no account) | Supplier portal: confirm/adjust one order's lines | Submit answer | `supplierConfirm`; rate-limited; noindex, no-referrer |

### A8. Suppliers + contracts. 6 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/suppliers?view=manage|scores` | `dashboard/suppliers/page.tsx` | owner, manager | Supplier management + scorecards ("who adds hidden costs") | "ספק חדש" | scorecards: `advanced_analytics` (upsell) |
| `/dashboard/suppliers/4f78cb42-e227-4b54-b093-4a9149ecf3ed?tab=` | `dashboard/suppliers/[id]/page.tsx` (+`layout.tsx`) | owner, manager | Supplier hub: header with real-leak ₪ (owner only) + URL tabs details / catalog / schedule / orders / contract / leak / ledger | Edit details; new order; import catalog | tabs: `contracts`, `supplierLeakCard`, `supplierLedger` |
| `/dashboard/suppliers/4f78cb42-e227-4b54-b093-4a9149ecf3ed/leak-card` | `dashboard/suppliers/[id]/leak-card/page.tsx` | owner, manager | A4 negotiation card (always Hebrew RTL) to hand to the supplier | Print | `supplierLeakCard` (404) |
| `/dashboard/suppliers/ledger` | `dashboard/suppliers/ledger/page.tsx` | owner, manager, bookkeeper, receiver | Supplier × month ledger grid (billed ₪, leak, status) + CSV | Export CSV / open cell | `supplierLedger` (FORBIDDEN → 404) |
| `/dashboard/contracts?tab=contracts|alerts|thresholds` | `dashboard/contracts/page.tsx` | owner, manager, bookkeeper (write: owner/manager) | Contract prices, price alerts (count badge), alert thresholds | Add/import contract; dismiss alert | `contracts`, `priceAlerts` (404 if both off) |
| `/dashboard/contracts/import?supplierId=` | `dashboard/contracts/import/page.tsx` | owner, manager | Contract price-list import wizard | Upload + map columns | `contracts` + canManage (404) |

### A9. Catalog + products. 5 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/catalog` | `dashboard/catalog/page.tsx` | owner, manager | Unified catalog search across suppliers ("חיפוש מאוחד בקטלוג") | "ייבוא מחירון"; secondary: SKU mapping, English names, integrations | `integrations` button |
| `/dashboard/catalog/import?supplierId=` | `dashboard/catalog/import/page.tsx` | owner, manager | Price-list import wizard | Upload + map | |
| `/dashboard/catalog/mapping` | `dashboard/catalog/mapping/page.tsx` | owner, manager | Queue of unmapped supplier SKUs (מק״ט) → link to product (backfills) | Link SKU to product | |
| `/dashboard/products` | `dashboard/products/page.tsx` | owner, manager | Bulk English-names grid (`name_en`) for English-speaking staff | Edit + save (Ctrl/Cmd+S) | |
| `/dashboard/products/43ecdb3d-4f89-4488-a60b-e5318ab8353a` | `dashboard/products/[productId]/page.tsx` | owner, manager | Product: price history, suppliers, cheapest supplier, edit | Edit product | |

### A10. Recipes + inventory. 6 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/recipes` | `dashboard/recipes/page.tsx` | owner, manager, chef (target: owner/manager) | Food cost per dish at the prices actually paid, margin, what moved; actual food-cost period card | "מנה חדשה" / "תת-מתכון חדש"; set target | `recipes` (404); `inventoryCount` card; `dishPriceAlert` |
| `/dashboard/recipes/new?sub=1` | `dashboard/recipes/new/page.tsx` | owner, manager, chef | Recipe editor (new dish / sub-recipe) | Save recipe | `recipes` |
| `/dashboard/recipes/c14f0e9d-3a5e-43a1-a716-cb5defa7817a` | `dashboard/recipes/[recipeId]/page.tsx` | owner, manager, chef | Edit recipe | Save | `recipes` |
| `/dashboard/inventory` | `dashboard/inventory/page.tsx` | owner, manager, chef | Inventory counts → stock value and actual food cost for the period | "התחלת ספירה" | `inventoryCount` (404) |
| `/dashboard/inventory/count` | `dashboard/inventory/count/page.tsx` | owner, manager, chef | Walk-in count by area (fridge, freezer, veg, dry, bar), autosave | Count + finish | `inventoryCount` |
| `/dashboard/inventory/cd364bbd-f8ca-491c-8b70-a5ef315b1874` | `dashboard/inventory/[countId]/page.tsx` | owner, manager, chef | Finished count snapshot (unit cost, value per line) | CSV; amend a line | `inventoryCount` |

### A11. Recovery, chain, branches. 3 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/recovery` "מעקב ₪ חוזר" | `dashboard/recovery/page.tsx` | owner, manager, bookkeeper | ₪-back tracker: claimed → letter → acknowledged → credit note → money back; totals (T3 gold returned), ageing, per-supplier rate, credit-line suggestions | Advance a claim's status; open letters | `recovery` (404) |
| `/dashboard/chain` "דאשבורד רשתי" | `dashboard/chain/page.tsx` | owner | Cross-branch money: KPIs, branch × month heatmap vs 1.5%, alerts, price disparity, switch branch | Switch to the branch to look at | entitlement `chain` (upsell); `chainAlerts`, `priceDisparity`; view toolbar |
| `/dashboard/branches` "ניהול סניפים" | `dashboard/branches/page.tsx` | owner | Branch list, rename, plan line, add branch (copies suppliers/products) | Add branch / switch to branch | plan `chain`; non-payer co-owner note |

### A12. Settings, team, exports, integrations, admin. 7 routes

| URL | File | Roles | Purpose | Primary action | Gates |
|---|---|---|---|---|---|
| `/dashboard/settings` | `dashboard/settings/page.tsx` | all 5 (restaurant sections: owner edit, manager/bookkeeper read-only, hidden for chef/receiver) | Account (password, devices), 2FA, business profile, matching tolerances/VAT, referral, privacy (DSR) | Save settings; enable 2FA | `growth` referral |
| `/dashboard/team` | `dashboard/team/page.tsx` | owner (manage), manager (read + set member language) | Roster, roles, invites, app language per member | Invite member | |
| `/dashboard/exports` | `dashboard/exports/page.tsx` | owner, bookkeeper | Accounting exports: CSV, uniform file (קובץ אחיד 1000) | Download file for a date range | entitlement `accounting_export` |
| `/dashboard/integrations` | `dashboard/integrations/page.tsx` | owner, manager, bookkeeper (accounting: owner+bookkeeper; POS + procurement: owner+manager) | Accounting codes mapping, POS sales import, procurement providers (MarketMan/Zester) | Map account codes / import POS / connect provider | `integrations` (404) |
| `/admin` | `admin/page.tsx` | admin | Platform console: restaurants list + KPIs (total, paying, implicit, members) | Open a restaurant | `isPlatformAdmin` (404 otherwise) |
| `/admin/leads` | `admin/leads/page.tsx` | admin | Inbound marketing leads (₪ procurement) | Erase lead (DSR) | admin |
| `/admin/restaurants/[id]` | `admin/restaurants/[id]/page.tsx` | admin | One restaurant: subscription, overrides, members | Assign plan | admin |

---

## 3. Navigation and IA today

### Four separate shells
1. **Marketing shell** (`(marketing)/_components/MarketingShell.tsx`, also wraps `/`): sticky header with logo, desktop nav
   (איך זה עובד `/#how`, פיצ׳רים `/about#features`, מחירים `/pricing`, דמו `/showcase`, אודות `/about`, plus leak check when
   public), LocaleSwitcher, "כניסה" `/login`, CTA `/#lead`. Mobile uses a native `<details>` menu with no JS. Footer has three
   columns (product / company / legal). `/` redirects signed-in members to `/dashboard`.
2. **Showcase shell** (`showcase/layout.tsx`): brand + "דמו" badge + back to site + CTA `/#lead` + tab row (receiver,
   dashboard, invoices, deliveries, approvals) + demo note. Wider max-w-7xl, with its own radial background.
3. **Dashboard shell** (`dashboard/layout.tsx`): skip-link, sticky frosted `glass` header (max-w-6xl) with a 1px
   `flow-stream` line. Start side: restaurant name, then `email · role label`. End side (lg+): BranchSwitcher, global search
   (w-72), language picker, sign-out. Below the header: `DesktopNav` (grouped tabs that **wrap to two lines** for owners).
   The main column holds WorkerStatusBanner (OCR engine down), LocaleSync, PwaSessionGuard, then the page.
   Redirects: no session → `/login`; no memberships → `/onboarding`.
4. **Admin shell** (`admin/layout.tsx`): badge + "Restaurants / Leads / back to dashboard" + LocaleSwitcher. No mobile nav.
   Auth pages (`/login*`, `/reset`, `/set-password`, `/onboarding`, `/invite/accept`) and `/s/[token]`, `/scans/[id]` are
   chrome-less centred cards (language switch in the top corner).

### Desktop nav (lg+)
Three groups separated by hairlines: **תפעול** (operations), **רכש** (purchasing), **ניהול** (admin). Active state is a
2px primary underline. The contracts tab carries a red open-alert count pill. `catalog` also lights up on `/dashboard/products*`.
Visibility = `canSeeRoute(role, href)` ∧ flags ∧ chain/branches mutual exclusion ∧ wave-1 access.

### Mobile nav (< lg)
- Menu button (start side of the header) opens a **full-height drawer** (portaled to `<body>`, 86% width, focus-trapped,
  Esc closes, scroll lock). The drawer holds restaurant/email, search, the branch switcher list (multi-membership only),
  all items grouped, the language picker, and sign-out.
- **Bottom bar** (portaled, `glass`, safe-area padding, lifted above the cookie banner via `--consent-h`): four role
  destinations plus "עוד" (opens the drawer). Labels at 11px, icons at 20px.
- The language switch also sits in the header on mobile.

### Global search (`DashboardSearch`)
WAI-ARIA combobox, 250ms debounce, 2-char minimum, `search.global` → groups **suppliers / products / invoices** (icons).
Groups the role can't open are dropped (receiver and bookkeeper get invoices only; chef gets nothing useful). In English it
shows the English name with the Hebrew original as a secondary line. Arrow keys / Enter / Esc work. There is **no
page/command search, no recent items, and no keyboard shortcut** (`/` or ⌘K) to focus it. It appears in the header
(desktop) and in the drawer (mobile).

### Branch switcher (`branch-switcher.tsx`)
Rendered only with ≥2 memberships. Desktop: a popover menu (`menuitemradio`). Mobile: an inline list in the drawer. Each
row shows store icon, name, and the role in that branch. Picking a branch calls `switchBranchAction`, then
`window.location.assign('/dashboard')`: a **full reload that always lands on the overview** and loses the current page. The
footer has links to chain/branches; if the user is owner only in another branch, those links switch to that branch first.
The chain tab shows for owners with >1 branch; single-branch owners see "סניפים" instead.

### Locale switch
Cookie `rm_locale` (1 year); `?lang=he|en|ar|ru|th|ti` on any URL sets it (shareable English links).
`LocaleSwitcher` = עב/EN toggle (marketing, auth, admin, portal, dashboard default). `PersistingLanguagePicker` = six
languages, persisted to the user's `preferred_locale`, shown in the dashboard when `receiverLanguages` is on; the login page
shows the six-language `LanguagePicker` too. Receiver locales translate only the receiver experience (receiving wizard,
invoice/PO lines, nav, login); other screens fall back to English. Formatting follows the base locale (`he-IL` or `en-GB`).
`dir` is rtl for he/ar. Tenant data inside an English UI is wrapped with `originalProps` (lang + bidi isolation).

### In-page navigation conventions (mixed)
- **URL tabs**: supplier hub `?tab=details|catalog|schedule|orders|contract|leak|ledger` (horizontally scrolling,
  active tab scrolled into view); contracts `?tab=contracts|alerts|thresholds`; suppliers `?view=manage|scores`.
- **Period switchers**: `?m=0|-1` (breakdown, claims, pay-run), `?month=YYYY-MM` (leak report with prev/next, monthly report
  and digest with this/last-month pills), monthly `?view=whatsapp`.
- **View toolbar** (`lib/components/views`): `p` period, `from/to`, `cmp` (prev|yoy), `g`, `chart`, `d` density, `tv=1`
  (wall-screen TV mode), filters `sup cat type sev st`. Saved views live in **localStorage** (per browser). CSV export.
  Used on overview, approvals, breakdown, leak report (compare only), chain, leaks explorer.
- **Breadcrumbs component** on: catalog/mapping, catalog/import, products, products/[id], orders/[poId], recipes/new|[id],
  suppliers/[id] (layout), suppliers/ledger, contracts/import.
  **"Back" links instead** on: leaks/breakdown and leaks/proof (→ overview), leaks/report (→ leaks), pay-run (→ approvals),
  receiving/[poId] (→ list), inventory/[countId] and inventory/count (→ inventory), leak-card (→ supplier leak tab).
  **Neither** on: invoices/[invoiceId], leaks/claims, recovery, reports/monthly|digest, orders/new, orders/capture, ask.
- **Print surfaces**: leaks/proof, leaks/report, leaks/claims, suppliers/[id]/leak-card (A4, always he-RTL), monthly report PDF.
- **PWA**: manifest scoped to `/dashboard/receiving` (start `?source=pwa`, portrait, share target
  `/dashboard/receiving/share`), offline photo queue, wiped on sign-out (`PwaQueueReset`, `PwaSessionGuard`).
- Global: `RouteProgress` bar, `ConsentClearance` cookie banner (`--consent-h`), toasts. `loading.tsx` exists only for
  approvals, exports, receiving, settings, suppliers; one root `error.tsx` + `not-found.tsx`.

---

## 4. IA observations to hand to the page-by-page reviewers

These are observations from code and crawl, not fixes. Severity is my estimate.

1. **Receiver and chef land on the money "control room".** Every role's home is `/dashboard`, whose hero is the leak ₪
   (`leakHero` is memberProcedure). The receiver's job is `/dashboard/receiving` and the chef's is recipes/inventory, so
   there is no role-based landing. (High)
2. **Silent role bounce.** Middleware redirects a forbidden `/dashboard/*` URL to `/dashboard` with no explanation. Shared
   links (owner → bookkeeper) just "don't work". (Medium)
3. **Owner tab row wraps to two lines (18 tabs) with no hierarchy.** Operations mixes act-now (receiving, approvals,
   inbox) with reports (monthly report, ask, recovery, chain). There is no "home → act → understand → configure" order. (High)
4. **Mobile bottom bar is mechanical.** It takes the first four items in NAV order; for owners the inbox is pushed into
   "More" and `ask` is drawer-only. There's no badge for pending approvals / alerts on the bar. (Medium)
5. **Missing h1 on several pages** (crawl h1 empty): inbox, receiving, settings, team, inventory/count start state. They use
   `SectionHeader` without `level={1}`. (Medium, a11y + hierarchy)
6. **Inconsistent wayfinding**: three patterns (Breadcrumbs, a Back link, nothing). The invoice correction page, a hub
   reached from receiving, approvals, the breakdown, search and the inbox, has neither. (Medium)
7. **Orphan / hidden routes**: integrations has no nav entry (only via the catalog header and an exports link); digest,
   proof, claims, report, pay-run and ledger are reachable only through in-page links. A bookkeeper can reach
   `/dashboard/suppliers/ledger` by role but has **no path to it** (the only link is in the supplier hub, which they can't
   open, and its breadcrumb points to `/dashboard/suppliers`, which bounces them). The same applies to receivers. (Medium)
8. **Role/route mismatches**: `/dashboard/leaks/report` is allowed for bookkeepers by middleware but renders a "role
   only" warning card. `/dashboard/leaks` shows a warn-tone "owner only" card to managers and bookkeepers, which reads as a
   false alarm and violates the T4 calm rule. The supplier header ₪ is owner-only, so managers see "no data" (misleading). (Medium)
9. **Flag-off behaviour is inconsistent**: most pages 404, but pay-run shows a "disabled" empty state, ledger/leak tabs
   silently fall back to details, and leak-check 404s in the lab while the code exists. (Low)
10. **Search is entity-only**: no pages, actions, or recent items; no shortcut. Chef and receiver have a search box that
    can't return anything they can open. (Medium)
11. **Branch switch always resets to the overview** with a full reload, so cross-branch comparison of the same page isn't
    possible. (Low/Medium)
12. **Leak domain spread over 7+ URLs** (overview hero, leaks, breakdown, proof, report, claims, recovery, monthly report,
    digest) with overlapping "the one number" views. Worth consolidating into one leak hub with tabs. (High, for the T1 story)
13. **Approvals ↔ pay run ↔ claims ↔ recovery** form one money pipeline (decide → pay/hold → claim → recover) but sit
    under different nav groups and URLs. (Medium)
14. **Saved views are per-browser (localStorage)**: an owner's saved view doesn't follow them to the phone. (Low)
15. **`dashViews` flag is dead code**: the view toolbar is always on. (Low)
16. **`/scans/[id]` sits outside the dashboard shell** (no nav, no back) and is open to the chef. (Low)
17. **Marketing → app seam**: `/login` has no link back to the site or the demo, and there is no "sign up" path. New users
    must get a magic link, then land on `/onboarding`. The lead form (`/#lead`) is the only acquisition CTA. (Medium)
18. **Loading states exist for only 5 dashboard routes**; heavy pages (overview, chain, leaks, breakdown, reports, supplier
    hub) rely on the global RouteProgress. (Medium, perceived performance)
19. **Admin console has no mobile nav** and mixes `font-mono` uppercase table headers (a dark-era style). (Low)
20. **Showcase uses its own visual system** (max-w-7xl, inline radial background, GSAP), separate from the app shell, so
    the demo doesn't look like the product the prospect will get. (Medium, GTM)
