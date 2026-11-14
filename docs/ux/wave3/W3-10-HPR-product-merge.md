# HUMAN-PR proposal (W3-10): applying a product merge

**Status:** draft proposal only. No code, no PR until the orchestrator calls it (decision 14.11). It is queued after the schema train and is signed by the owner from the Hebrew summary below.
**Today on main:** `products.mergePreview` (read-only, #333) shows what a merge would move. Nothing applies a merge.

## תקציר לבעלים (לחתימה)
- **מה זה:** כשאותו מוצר נוצר פעמיים בקטלוג (למשל "עגבניה" ו"עגבניה שרי"), אפשר יהיה למזג אותם למוצר אחד. אחרי המיזוג כל החשבוניות, ההזמנות, המתכונים ומחירי החוזה של המוצר הכפול ישויכו למוצר שנשאר.
- **מה לא משתנה:** סכום הדליפה של החודש. בדיקה אוטומטית משווה אותו לפני ואחרי. אם הוא זז אפילו באגורה אחת, המיזוג מתבטל ולא נשמר כלום.
- **מה כן משתנה:** היסטוריית המחירים של שני המוצרים מתאחדת, ולכן התראות מחיר עתידיות יחושבו על ההיסטוריה המשותפת. הדוח שמוצג לפני האישור מפרט את זה.
- **מי יכול:** רק בעלים. מוצר אחד בכל פעם, אחרי תצוגה מקדימה של אותם שני מוצרים. אם משהו השתנה מאז התצוגה, צריך לראות אותה שוב.
- **ביטול:** כל מיזוג נשמר עם מפה מלאה של מה עבר, ואפשר לבטל אותו. כל מיזוג נרשם ביומן הפעולות.

## 1. Scope
- New `products.merge` (**ownerProcedure**), one merge per call, never automatic, no batch.
- New `products.unmerge` (ownerProcedure) that replays a stored merge map in reverse.
- Files: `packages/api/src/routers/products.ts`, new `packages/api/src/catalog/mergeApply.ts`, tests, `coverage/W3-10.ts` (add-only), the product page panel (an apply button behind the preview).
- **Immutable files touched:** none expected. Audit goes through the existing append-only `audit_log` path (`0003_audit_immutable.sql` is only used, never changed). If the merge map must be stored outside `audit_log.after`, that would be a schema change, i.e. an H-04-style human PR. The default below avoids it.

## 2. Preconditions (refuse otherwise)
1. The caller passes the `previewToken` that `mergePreview` returned: an HMAC over `{rid, fromId, intoId, counts, issuedAt}`. Refuse when it is older than **N = 10 minutes**, or when the recomputed counts differ (`PRECONDITION_FAILED`, appCode `merge.previewStale`).
2. Both products belong to the caller's restaurant. This is checked under the RLS transaction (`withRls`), not only by a `where restaurant_id` filter.
3. No open conflicts unless each one carries an explicit choice in the input: `unit` (keep into / keep from), per supplier `catalogRow` (keep / drop), per supplier `contract` (keep / drop).
4. `fromId !== intoId`; neither product is mid-merge (an advisory lock on both ids).

## 3. The transaction
In one RLS transaction, `serializable`:
1. **Before snapshot:** for every month that has findings on `fromId` or `intoId`, compute the month's leak total Σ|deltaAmount| in integer agorot using the charts definition (no new ₪ math), plus the hero for the current month.
2. Repoint `product_id` from `fromId` to `intoId`, collecting the moved row ids per table: `supplier_catalog_items`, `product_aliases`, `po_lines`, `invoice_lines`, `goods_receipt_lines`, `discrepancies`, `recipe_items`, `inventory_count_lines`, `supplier_contract_prices`, `price_alerts`, `price_history`. For `price_baselines`, combine rather than repoint: recompute `intoId`'s baseline from the merged history with the existing baseline function.
3. Add `fromId`'s names as aliases of `intoId` (confidence 1.000, a person's decision). Mark `fromId` merged (`products.merged_into` if the schema train adds it; otherwise soft-delete through the existing delete path once nothing references it).
4. **After snapshot:** the same totals. **Assert they are identical per month and for the hero; otherwise throw and roll back** (`INTERNAL`, appCode `merge.leakMoved`, which logs the diff).
5. Write one `audit_log` row: `action 'products.merged'`, entity `product` / `intoId`. `after` holds `{ fromId, intoId, map: { table: [rowIds] }, baselinesBefore, baselinesAfter, choices, leakTotals }`. That row is the un-merge map.

## 4. The ₪ report (shown before approval, stored after)
- Per month: leak total before = after, asserted.
- What changes: the combined price baseline per supplier (old A, old B → new), and the open price alerts that would re-evaluate.
- Counts moved per table (the preview's counts plus the evidence counts).

## 5. Un-merge
`products.unmerge({ auditId })`, owner-only, takes an RLS transaction and the same leak-total assertion. It moves exactly the stored row ids back, when they still point at `intoId`; rows changed since are listed, not moved. It restores the baselines from `baselinesBefore` and un-marks `fromId`. It writes `action 'products.unmerged'`.

## 6. Tests (add-only)
- `catalog-merge.attack.test.ts`:
  - B's product on either side → NOT_FOUND, nothing written;
  - a stale or forged previewToken → refused;
  - every non-owner role → FORBIDDEN.
- `catalog-merge.test.ts`:
  - the leak total is equal before and after on a seeded month with findings on both products;
  - a forced mismatch rolls back;
  - un-merge restores every moved row;
  - the conflict choices are honoured.
- A COVERAGE fragment entry per new procedure (add-only). The leak canary stays green.

## 7. Open points for the owner
- N (preview freshness): 10 minutes proposed.
- Whether a merge may span products with different units at all, or must be refused.
