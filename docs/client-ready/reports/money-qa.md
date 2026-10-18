# ₪ consistency QA — merged `claude/client-ready` @ f171425 (S3)

Method:
- Fresh reseed (S1 demo), owner session, he + en, desktop + 390px.
- Every money figure the demo shows was compared two ways: through the same tRPC procedures the
  screens use (scripted, owner caller, against `restomatch_dev`) and visually.

Branch: `claude/client-ready-money-engine` (my designated push branch). This is a fresh round on
top of f171425; the orchestrator suggested `-money-qa`, but my session may only push to its assigned
branch.

## Verdict for the demo

The headline story is consistent. Every figure below matches **to the agora** across the dashboard
hero, the drill-down, the monthly report, the approvals queue, invoice detail and the September
accounting CSV.

| Figure (Oct 2026) | Hero | Drill-down | Monthly report | Approvals / KPIs | Invoice detail |
|---|---|---|---|---|---|
| Leaked this month | ₪489.82 | Σ invoices ₪489.82 | ₪489.82; Σ suppliers ₪489.82 | — | totals match per invoice (3 checked) |
| % of spend | 1.6% of ₪30,837 | 1.6% | 1.6%; Σ supplier spend ₪30,837.36 | — | — |
| Caught before payment | ₪331 | — | ₪331 | queue Σ ₪331 (6 items); KPI 6 · ₪331 | — |
| Claimed from suppliers | ₪158.82 | — | ₪158.82 | — | — |
| Pending PO link | 2 · ₪2,775.31 | listed | 2 · ₪2,775.31 | — | — |
| **Sept 2026** leak / spend | ₪38.52 / ₪62,530.14 | ₪38.52 | ₪38.52 / ₪62,530.14 | — | CSV ₪62,530.14 (52 rows) ✓ |

## Fixed in this round (my boundary)

1. **Leak detective ₪ was a projection presented as money lost.**
   - Problem: `monthExcessIls` = (latest price − median) × all 30-day quantity. It re-prices
     purchases already made at the old price.
   - Effect: the leaks page said **₪1,061** next to a hero of **₪490**. That's the first thing a
     client would question.
   - Fix: added `paidExcessIls` = Σ max(0, price − median) × qty over the last 30 days' actual
     purchases (`packages/charts/src/leaks.ts`). The leaks page total, its table and both heatmaps
     now show it: **₪357**, in line with the report's ₪366 of "price above expected".
   - Labels: "Paid above median (30 days)".
   - `monthExcessIls` is kept (additive change) because S5's supplier header uses it.
   - Test: `leaks.test.ts` asserts the paid figure (₪53 vs the projection's ₪60).
2. **The monthly report's price-creep "This month" price (₪147, an average) looked like it
   contradicted the product page and detective (₪149, the latest).** Relabelled "Avg. this month",
   with a hint that the latest price is on the product page.

## Still inconsistent — other areas (file:line + proposed fix)

1. **S5 — supplier header "Estimated monthly leak" uses the projection.**
   - Where: `apps/web/app/dashboard/suppliers/[id]/layout.tsx:51` sums `l.monthExcessIls`.
   - Effect: HaKerem shows **₪328** and Steinberg **₪495**. For the same month the report and
     drill-down say ₪153.52 and ₪104.80; the paid excess is ₪144.15 and ₪110.
   - **Fix:** sum `l.paidExcessIls` instead (one token) and relabel `suppliers.detail.leakLabel` to
     "Paid above median (30 days)" / "שולם מעל המחיר החציוני (30 יום)". Better still: show the
     supplier's row from the hero rules (`owner.leakReport` bySupplier, manager+) as "Leaked this
     month".
2. **S5 — accounting CSV doesn't match the month's spend in October (24 rows / ₪26,638 vs 29
   invoices / ₪30,837 checked spend).**
   - Where: `packages/api/src/routers/exports.ts:113`, which keeps only `status IN
     (matched, approved, paid)`. It drops 3 `disputed` invoices (blocked by a discrepancy) and the 2
     `parsed` consolidated invoices.
   - Day bounds are UTC (`:88-89`); the hero uses the Israel-time month, so an invoice dated
     00:00–03:00 IL on the 1st lands in a different month.
   - **Fix:** include `disputed` (it's a real purchase, just under dispute; a status column is
     already exported) or note in the UI that disputed invoices are excluded. Use
     `startOfDayInTz`/`endOfDayInTz` from `packages/api/src/lib/time.ts` with the restaurant tz.
   - September matches exactly (no disputed invoices).
3. **S2 — invoice correction screen**
   (`apps/web/app/dashboard/invoices/[invoiceId]/correction-client.tsx`):
   - the whole UI is Hebrew in English mode;
   - ₪ is formatted without the locale at `:173`, `:247`, `:254` (`formatIls(v, { maximumFractionDigits: 2 })`
     → add `locale` from `useLocale()`), which renders `88.56₪` (Hebrew format) on English pages.
4. **S5 — supplier detail "Details" tab never leaves "Loading supplier…"**
   (`apps/web/app/dashboard/suppliers/[id]/tab-details.tsx:39`). `suppliers.get` returns 200
   (4× in the server log), but `supplier.isLoading` stays true after 4s+. That points to a client
   deserialization error or retry loop. Reproduce: `/dashboard/suppliers/<HaKerem id>?lang=en`.
5. **S6 — showcase pages format ₪ inline with raw `toFixed`/`toLocaleString('he-IL')`.** These are
   mock data, so there's no consistency risk, but English shows Hebrew number formatting. Examples:
   `app/showcase/receiver/_steps/Reconciliation.tsx:94,186,194,204`,
   `SupplierSelect.tsx:92`, `Confirmed.tsx:87`, `showcase/dashboard/_components/InvoicePoCompareViewer.tsx:276,511,515,644`.
   **Fix:** `formatIls(v, { locale, maximumFractionDigits: 2 })`.
6. **S1 — seed narrative:** September's leak is ₪38.52 (0.06%) against October's 1.6%. The hero's
   "Last month: ₪39" invites "why so low?". Seeding September nearer 1.2–1.5% would read as a
   believable trend.
7. **S6 landing claim, minor:** "minor gaps (up to 2%) are approved automatically"
   (`lib/i18n/messages/landing/*:116,129`). In practice, gaps inside the 2% price tolerance never
   become discrepancies at all, and `info`-level ones are auto-approved. Fine for marketing. The
   other claims match the engine: ₪5,000 with no order goes to the owner, ₪50–₪300 goes to the
   manager, and the 1.5% target sits next to the demo's 1.6%.
8. **Data, not code:** supplier payment terms are seeded in Hebrew ("30 + שוטף") and appear in
   English UIs.

## Format consistency (my screens)

- Headline/hero figures use whole shekels; line items and tables use agorot. Everything goes
  through `formatIls(v, { locale })`: `₪1,234` in English, `‏1,234 ₪` in Hebrew.
- Percentages use `formatPercent(v, locale, 1)`.
- Dates use `formatDate(…, locale)` in Israel time.
- No raw `toFixed` / `toLocaleString` remains in S3 files.

## Gate

`pnpm test` 12/12 (charts 33, api 446, web 182, matching 86) · web `tsc` 0 errors · `pnpm build` green — on f171425 + this round.
