# Wave-1 integrations — S5 report (MASTER-PLAN §3 #9)

Branch `claude/client-ready-ops-ui` · flag **`integrations`** · migration **0058** (`when` 1782130000000).

> **תקציר לבעלים**
> - ייצוא חשבוניות **בקבצי קליטה אמיתיים** לחשבשבת, פריוריטי וריווחית (בדף הייצואים), עם כרטיסי חשבון שמגדירים פעם אחת.
> - **MarketMan ו-Zester**: מתאמים מוכנים מאחורי ממשק אחד, עם נתוני דוגמה שעובדים בלי חשבון. חיבור אמיתי = פרטי גישה ממך (למטה).
> - **מכירות מהקופה**: ייבוא CSV של "מכירות לפי פריט" (עברית/אנגלית) — הבסיס לעלות מנה (S17).
> - הכל מאחורי הדגל `integrations`: דלוק במסעדת הדמו, כבוי אצל כולם. אין חשבונות אמיתיים, אין סיסמאות, אין כתיבה לפרודקשן.

## What's built

| Area | Where | What |
|---|---|---|
| Accounting files | `packages/api/src/integrations/accounting/*`, `integrations.accountingExport` | Hashavshevet / Priority / Rivhit renderers on the **same invoice set** as the CSV + uniform-1000 exports (checked statuses, Israel calendar days, flagged duplicates excluded — `fetchInvoices`). Integer agorot end to end; each file balances to the agora. |
| Account codes | `integrations.accountingConfig` / `setAccountingConfig` | Purchases account, input-VAT account, Hashavshevet movement type, per-supplier card codes (default = the supplier's company number). Stored in `restaurants.settings.integrations.accounting` (no schema change). Owner edits; bookkeeper reads. |
| Procurement | `packages/procurement` | `JsonTransport` seam; **ZesterAdapter** (new) next to MarketMan; recorded fixtures for both served when `credentials.mode = 'fixture'`; the worker's `sync-platforms` job accepts `fixture:` vault refs **outside production only**. `integrations.procurementProviders` / `procurementPreview` (sample data, nothing saved). |
| POS sales | `packages/api/src/integrations/pos/*`, `pos_sales*` (0058) | `PosSalesProvider` interface + generic **CSV adapter**. `integrations.posPreview` / `posImport` / `posImports` / `posSummary`. |
| UI | `/dashboard/integrations`, exports page, catalog header | Hub page (404 when the flag is off); 3 download cards on the exports page; "Integrations" button on the catalog header. Hebrew + English (`integrations` namespace). |

Flag behaviour: off → every `integrations.*` procedure except `status` is `FORBIDDEN` with message `FEATURE_DISABLED:integrations`; the hub 404s; the exports page and catalog header show nothing. `FEATURES_OFF=integrations` (or `all`) wins over the per-restaurant flag (tested).

## Accounting file formats + the accountant's import steps

All three are generated from the same rows. ⚠️ Each package lets the accountant define the import layout, and I could not test against live installs (no accounts). **First import into a test company / temporary batch** and check one invoice by hand.

### Hashavshevet (חשבשבת) — journal-movement import
- File `restomatch-hashavshevet-<from>-to-<to>.txt`: **tab-separated, CRLF, Windows-1255 (Hebrew ANSI), no header row**. One balanced movement per invoice: Dr purchases (excl. VAT) + Dr input VAT = Cr supplier card (incl. VAT).
- Column order (the import definition / קובץ הגדרות `.prm`):

| # | Field | Example | Notes |
|---|---|---|---|
| 1 | סוג תנועה | `חס` | movement type defined for supplier invoices (setting) |
| 2 | אסמכתא | `24118` | digits of the invoice number, last 9 |
| 3 | אסמכתא 2 | `BR-24118` | full invoice number (≤20) |
| 4 | תאריך אסמכתא | `01/10/2026` | DD/MM/YYYY, Israel day |
| 5 | תאריך ערך | `01/10/2026` | = invoice date |
| 6 | פרטים | `מאפיית ברנר` | supplier name (≤50) |
| 7 | חשבון חובה 1 | `6000` | purchases account |
| 8 | חשבון חובה 2 | `3700` | input-VAT account |
| 9 | חשבון זכות 1 | `514200103` | supplier card |
| 10 | סכום חובה 1 | `524.14` | excl. VAT |
| 11 | סכום חובה 2 | `94.35` | VAT |
| 12 | סכום זכות 1 | `618.49` | incl. VAT |

- Accountant: Hashavshevet → קליטת נתונים / קליטת תנועות מקובץ → new definition "RestoMatch" (delimited, TAB, the 12 fields above, date format DD/MM/YYYY) → import into a **temporary batch (מנה זמנית)** → review the trial balance → post the batch. The supplier cards (col. 9) must exist; map them once under "Account codes".

### Priority (פריוריטי) — form-load interface
- File `restomatch-priority-…txt`: **tab-delimited Unicode text (UTF-16LE with BOM, what Excel's "Unicode Text" writes), CRLF**. Records typed by column 1:
  - `1` header: SUPNAME (supplier code) · BOOKNUM (supplier invoice no.) · IVDATE (DD/MM/YY) · DETAILS (supplier name) · TOTPRICE (incl. VAT, for checking)
  - `2` line: ACCNAME (purchases account) · DETAILS · QPRICE (excl. VAT) · VAT
- Accountant / Priority admin: System Management → Database Interface → Form Load (ממשק לטעינת מסך): new interface, file "tab-delimited, Unicode"; record type 1 → the supplier-invoice form the company uses (e.g. financial supplier invoices), record type 2 → its lines sub-form; map the columns above. Run the load, then check the interface's error log; finalize the invoices in Priority as usual. Priority computes VAT from the supplier's VAT code. Compare it with our VAT column (the header's TOTPRICE).

### Rivhit (ריווחית) — spreadsheet import
- File `restomatch-rivhit-….csv`: **UTF-8 with BOM, comma, CRLF, header row** `תאריך מסמך, מספר מסמך, שם ספק, מספר עוסק, כרטיס ספק, סכום לפני מע״מ, מע״מ, סכום כולל מע״מ, כרטיס הוצאה`. Dates DD/MM/YYYY; company number digits only.
- Accountant: Rivhit → import documents/expenses from Excel → pick the file → match each column by its header (once; Rivhit remembers the mapping) → document type "supplier invoice / expense" → import → review the expense report for the month.

Golden files (byte-exact, CRLF, `binary` in `.gitattributes`): `packages/api/src/integrations/accounting/__tests__/golden/{hashavshevet.txt,priority.txt,rivhit.csv}`. To change a format deliberately: `UPDATE_GOLDEN=1 pnpm --filter @restomatch/api exec vitest run accounting-formats`, then review the diff.

## Procurement (MarketMan / Zester)
- One interface (`ProcurementAdapter`); real calls go through `HttpClient` with retries; offline the **same normalizers** run on recorded fixtures (`packages/procurement/src/fixtures/*`). The fixtures follow each adapter's documented contract; MarketMan's and Zester's real contracts are still `VERIFY` until docs and keys arrive.
- Zester: bearer token, `/vendors`, `/items`, `/purchase-orders` (paginated, `updated_since` / `delivery_date`), state mapping draft/submitted/approved/partially_received/received/canceled → our PO statuses.
- **Owner activation (Phase-6, human-only):**
  1. Get an API key (MarketMan) / API token (Zester) for the restaurant's account.
  2. Put it in the worker's environment, e.g. `MARKETMAN_KEY_<restaurant>`.
  3. Insert `procurement_connections (restaurant_id, platform, credentials_vault_ref = 'env:<VAR>')`.
  4. Enqueue `sync-platforms`.
  5. Validate the `VERIFY` endpoint/shape notes against the vendor docs on the first real response.
- Demo: insert a connection with `credentials_vault_ref = 'fixture:demo'`. The hub shows "connected to sample data" and the worker syncs the sample orders. This is refused when `NODE_ENV=production`.

## POS sales (the hook for S17's food cost per dish)
- **Interface**: `PosSalesProvider.parse({ filename, bytes }) → { rows, issues, columns }`. Each row is `{ soldOn (YYYY-MM-DD), itemRef, itemName, qtyMilli (int), netAgorot (int) }`. API providers (Tabit, Beecomm…) register in `POS_PROVIDERS`.
- **CSV adapter**: any "sales by item" export.
  - Headers are detected in Hebrew and English: date / item code / item name / qty / net sales.
  - Encoding: strict UTF-8 first, then Windows-1255.
  - Dates are day-first (`DD/MM/YYYY`, `D.M.YY`), or ISO.
  - Money and qty are parsed exactly: ₪, thousands separators, and a decimal comma are all accepted.
  - Per-ticket rows for the same day + item are summed.
  - Bad lines are reported by line number.
- **Storage (0058)**: `pos_sales_imports` (one per file) and `pos_sales` (one row per restaurant · day · item, `NUMERIC` shekels / qty).
  - An import **replaces the restaurant's rows for the days the file covers**, so re-importing a corrected file never double-counts.
- **S17 reads** `integrations.posSummary({ from, to })`, which returns per item: itemRef, itemName, qty, netAmount, days. It's chef/manager/owner, or a direct query on `pos_sales` inside `withRestaurant`.

## Security
- Every new procedure is RLS-wrapped through `memberProcedure`-based role procedures, plus the flag check.
  - Accounting: bookkeeper/owner, plus the plan feature `accounting_export`; owner-only to save the mapping.
  - POS and procurement: manager/owner. POS summary: chef/manager/owner.
- **COVERAGE**: 10 new entries, added only (no existing entry or assertion changed). They point at `integrations.test.ts`, which covers:
  - foreign supplier ids in the mapping → NOT_FOUND, nothing saved;
  - A's file never carries B's invoices or mapping;
  - A's POS re-import never deletes B's rows for the same days;
  - B's procurement connection never shows as A's.
- **RLS for the new tables**: `rls/0002`'s allowlist is closed to wave-1 sessions, and its final guard refuses any `restaurant_id` table without row security.
  - So 0058 enables RLS and creates `pos_sales_tenant` / `pos_sales_imports_tenant` itself, inlining the body of `app.current_restaurant_id()` (that function only exists once rls/0002 has run).
  - `pos-rls.attack.test.ts` checks this on the **real app role**:
    - an unfiltered select sees only the GUC restaurant;
    - nothing is visible without a GUC;
    - a forged cross-tenant insert is refused;
    - a cross-tenant delete is a no-op.
  - A fresh DB (`migrate` → `provision-rls`) is green.
  - **Proposal for the orchestrator:** at integration, add `pos_sales_imports`, `pos_sales` to rls/0002's list (the inline policies are identical, and `drop policy if exists` keeps either order idempotent). Other wave-1 sessions adding tenant tables will hit the same guard.
- Uploads are limited to 5 MB and 50,000 lines. Account codes are restricted to `[\p{L}\p{N}._-]{1,15}`, so a tab or newline can never break a delimited record. No tenant id is ever taken from the client.

## Verification (2 layers)

**Layer 1 — full gate (final code):**
- `pnpm --filter @restomatch/web lint`: 0 errors (6 pre-existing warnings).
- `pnpm -r typecheck` and web `tsc --noEmit`: 0 errors.
- `DATABASE_URL_TEST=… pnpm test`: **13/13 tasks** (api 573, web 254, db 68, matching 86 incl. leak-canary, procurement 24, worker 14).
- `supabase-sync --check`: up to date.
- `pnpm --filter @restomatch/web build`: green.
- Fresh DB: `migrate` → `provision-rls` green, RLS on both POS tables.

**Layer 2a — production build** (`next build && next start`, placeholder email/Supabase keys, nothing sent), Playwright driver:
- **Coverage:** 4 runs (he/en × 1440/390) × roles owner / bookkeeper / manager / receiver / chef, plus flag-off. All PASS on the final build.
- **Owner:**
  - The hub renders 3 sections with the right `dir` and no overflow.
  - Double-clicking Save writes the supplier card once (checked in the DB).
  - POS preview shows ₪1,361.50 and 3 skipped lines; import → re-import replaces (4 rows → 4 rows).
  - A bad file names the missing columns.
  - The Zester sample preview lists both orders.
- **Exports:** for each of the 3 packages, the file has the same 24 invoices as the CSV. Every Hashavshevet line balances to the agora, and Σ excl. VAT is ₪28,388.97, equal to the hero's ₪28,389. Priority has 48 typed records with a UTF-16LE BOM; Rivhit has 24 rows.
- **Bookkeeper:** account codes read-only, no POS section, downloads work.
- **Manager:** POS + procurement, no account codes, catalog button present, exports redirects.
- **Receiver / chef:** hub redirects.
- **Flag off on every branch:** not-found page on the hub, no package cards, no catalog button. It's a soft 404: HTTP 200 with the not-found UI, because Next streams the dashboard shell first.
- No console, page or 5xx errors besides the expected 400 from the deliberate bad-file preview.

**Layer 2b — independent refuter subagent:** 11 findings. Fixed with tests (`e11439d`):
- **HIGH:** a POS re-import wiped the whole min..max date span. It now replaces only the file's days; future dates are a line issue.
- **MED:** invoices whose stored totals don't add up are skipped, never posted unbalanced.
- **MED:** Rivhit formula injection is guarded.
- **MED:** POS column detection no longer takes discount/VAT/"updated" columns; refunds net out.
- **LOW:** number formats (`0,500`, `1.234,50`, `50-`, `(50)`) parse; split rows are BAD_ROW.
- **LOW:** values that would overflow NUMERIC are line issues, not a 500.
- **LOW:** import history marks replaced imports.

Also fixed from my own run: a POS preview dropped when a file was picked while the last import settled.

Not fixed (low, noted):
- US month-first dates whose days are all ≤ 12 import as day-first. The format is documented as day-first.
- A Hashavshevet אסמכתא is empty when the invoice number has no digits; אסמכתא 2 still carries the full number.
- Two concurrent imports of the same file create two import records (the rows are not double-counted; the UI guards double-clicks).

Could not refute: the role matrix, the flag-off FORBIDDEN on all 9 gated procedures, tenant isolation (incl. RLS on the app role), exact rounding, Windows-1255/UTF-16 encoding robustness, fixture refs refused in production, and the UI in he/en at 390/1440.

## Immutable files touched (additive only)
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: +10 COVERAGE entries (integrations.*), no assertion changed.
- `packages/db/src/schema.ts`: + `date` import, + `posSalesImports` / `posSales` tables.
- `packages/db/drizzle/meta/_journal.json`: + the 0058 entry (appended).
- No changes to: the matching engine, rls/*.sql, rls.ts, plans/billing, leads, outbox, cron, or the workflows.

## Proposals / not done
1. **Seed demo data (S1):** a `fixture:demo` Zester connection and one POS import for the demo tenant, so the hub has something to show without clicking.
2. **appCode `feature.disabled`:** the plan asks for appCode `FEATURE_DISABLED`. I used the message token `FEATURE_DISABLED:integrations` to avoid every wave-1 session editing S4's `APP_ERROR_CODES`. A shared `requireFlag(key)` middleware in `trpc.ts` plus one appCode would serve all wave-1 features.
3. **Uniform-1000 encoding:** the existing C100 file is written as UTF-8. Tax software reads ISO-8859-8 / Windows-1255 + CRLF. `encodeWindows1255` now exists in `integrations/accounting/encoding.ts`, so this is a one-line fix for whoever owns that format.
4. **Real POS APIs** (Tabit / Beecomm) behind `PosSalesProvider` once an account exists.
