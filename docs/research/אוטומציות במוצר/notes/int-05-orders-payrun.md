# INT-05 · Orders and the pay run: what is manual, what is automatic, and what to automate

**Scope:** orders (chef / manager / owner ordering, "order again", capture from text, send via email or WhatsApp, send status, supplier confirmation), the cadence jobs (`order-reminders`, `supplier-delays`, `daily-expectations`), the pay run (`payRun.month`), due dates (`invoices.due_date`, `suppliers.payment_terms`), mark paid, holds, accounting exports, the month-close router, and VAT at risk (allocation numbers).

**Code read:** `release/train-a` checked out at `scratchpad/trainA` (HEAD `c6132c0e`). Every path below is relative to that checkout unless it is marked **[main]**. `/home/user/restomatch` (main, `759fb554`) is older. Two differences matter in this area. On main, chef ordering does not exist: `createDraft`, `captureFromText`, `cancelOrder` and `updateOrderLine`/`deleteOrderLine` are `managerProcedure` there. And `orders.sendStatus` / `sendStateOf` exist only in train A. `payRun.ts` differs only in the NOT-A-CREDIT list (train A adds `MISSING_ON_INVOICE` through `NEVER_CLAIMABLE_TYPES`). `close.ts`, `exports.ts`, `supplierConfirm.ts`, `consolidated.ts`, the three cadence jobs, `cron.ts` and `vatAtRisk.ts` are byte-identical on both.

**Wave-2 plan source:** `scratchpad/kit-terms-flags.diff` (the in-flight G-17 / W2-03 §10 / W2-11 §10 / G-04 §9 / README §13 addendum of 1.11) plus `docs/ux/wave2/W2-03.md` and `W2-06.md` **[main]**.

---

## 0. Summary for the synthesis

1. **Ordering is the most automated area in the product, but the automation is all *alerts to humans*. None of it prepares an action.** Three daily cron jobs watch the order cadence (`cron.ts:76-88`, `cron.ts:56-60`). Two of them send email-only reminders to owner and manager. The third (`daily-expectations`) writes an audit row that **nothing reads** (`dailyExpectations.ts:123-132`; the only grep hit for `daily_expectations.computed` is that line).
2. **The pay run is a read-only report.** No procedure in the codebase sets `invoices.status = 'paid'`. The only writer is the demo seed (`apps/worker/scripts/seed-demo.ts:762`). Nothing writes `invoices.due_date` either, apart from the seeds (`seed-demo.ts:378,571,851`). OCR doesn't read a due date: there is no `dueDate` in `packages/ocr/src/providers/claudeVision.ts`. `suppliers.payment_terms` is free text (`schema.ts:435`; `routers/suppliers.ts:52,70` `z.string().max(500)`). It is never parsed. The page ends in a CSV download (`approvals/pay-run/export-button.tsx:8-14`).
3. **`close` is an empty router** (`routers/close.ts:10`, `router({})`). There is no month-close checklist.
4. **VAT at risk is computed but never pushed.** No cron job exists for it (no `vatAtRisk` in `cron.ts` or `handlers.ts`). The owner copies a supplier request text by hand (`apps/web/lib/vat/requestText.ts:12-16`, "Nothing is sent by the system"; copy button at `apps/web/app/dashboard/vat-at-risk.tsx:182-190`).
5. **Most of this area is flag-gated and OFF in the pilot.** `PILOT_DEFAULTS` in `FeaturesPanel.tsx:20-31` include `orderCapture` but **not** `payRun`, `orderPricesOut`, `supplierConfirm`, `vatAtRisk` or `consolidatedMatch`. Flags default OFF (`lib/features.ts:7`, `featureEnabled` 62-71).
6. **Wave 2 already plans the biggest manual gaps:** W2-06 (order guide, cut-off board, send from my WhatsApp, server drafts), W2-03 (due-date buckets, `markPaid`, held-row reasons, remittance) and G-17 (OCR of printed terms, "תנאים קצרים מהמוסכם"). What wave 2 does *not* plan is the **proactive** layer: a pre-built draft at cut-off, a due-this-week digest, auto-chasing the supplier for a late delivery or a missing allocation number, and auto-ingesting the supplier's confirmation into the expectation. Those are the opportunities in §7.

---

## 1. Roles and permission gates in this area

| Role | Orders | Pay run | Exports | VAT at risk |
|---|---|---|---|---|
| owner (בעלים) | all (`chefProcedure`/`managerProcedure`) | `financeProcedure` | `bookkeeperProcedure` | `invoiceReaderProcedure` |
| manager (מנהל) | all; `importPo`, `setDocumentSettings`, `supplierConfirm.createLink` are manager-only | yes | **no**: `bookkeeperProcedure` = owner+bookkeeper (`trpc.ts:150`) | yes |
| chef (שף) | draft/edit/send/cancel (`chefProcedure` = owner/manager/chef, `trpc.ts:151`); route `roles: ['owner','manager','chef']` (`apps/web/lib/nav/routes/orders.ts:10`) | no (route roles `apps/web/lib/nav/routes/approvals.ts:11`) | no | no |
| receiver (מקבל) | no route, **but** `orders.list` / `orders.get` are `memberProcedure` (`orders.ts:337,390`) and return `totalEstimated`: a server-side ₪ exposure that breaks the "receiver sees no ₪" rule. W2-06 AC4 plans `redactPrices` (W2-06.md:137 **[main]**) | no | no | yes (reader) |
| bookkeeper (מנהלת חשבונות) | read via `memberProcedure` | yes | yes (`exports.ts:23`, `integrations.ts:62`) | yes |

Entitlement gates (plan, `requireFeature`/`getEntitlements`, `trpc.ts:219-235`): `whatsapp_alerts` gates WhatsApp sending of a PO (`orders.ts:921-931`); `accounting_export` gates both export routers (`exports.ts:23`, `integrations.ts:62-63`); `advanced_analytics` gates the order-time price guardrail (`orders.ts:1127-1128`). The **בסיס** plan has `features: []` (`packages/db/src/plans.ts:36-42`), so a basic-plan restaurant can't WhatsApp a PO, can't export, and gets no guardrail.

---

## 2. Workflow A: placing an order (chef / manager / owner)

**Screens:** `/dashboard/orders` (list, `apps/web/app/dashboard/orders/page.tsx:37` → `orders.list`), `/dashboard/orders/new` (4-step wizard `SUPPLIER → BUILD → REVIEW → SENT`, `new/wizard.tsx:82,164`), `/dashboard/orders/[poId]` (detail), `/dashboard/orders/capture` (paste text).
**Tables:** `purchase_orders`, `po_lines`, `supplier_catalog_items`, `contracts` (via `contractPricesForOrder`), `notifications_outbox`, `supplier_confirm_links`, `restaurants.settings`.

### A1. What is manual today

| Step | Code | Taps (approx.) | Re-typing / copying |
|---|---|---|---|
| Pick a supplier (or arrive from the reminder deep link `?supplierId=`) | `wizard.tsx:164`; reminder URL `orderReminders.ts:38-40` | 1–2 | — |
| Build lines: search the catalog per item, type qty | `trpc.catalog.items` `wizard.tsx:330`; cart saved to localStorage (`new/draft-store.ts:1-7`) | ~3–4 per line → **~30–40 for a 10-line order** (W2-06 finding orders-01 "about 40 taps", W2-06.md:89 **[main]**) | The chef re-types the same weekly list. There is no order guide or par level: no `template`/`guide`/`par` in `schema.ts` |
| "Order again" from a past PO (`?from=<poId>`) | `new/page.tsx:7`; button `[poId]/detail-client.tsx:374`; `reorderLines` with contract/catalog/last price (`wizard.tsx:386-463`) | ~3 + edits | This is the only reuse mechanism, and it copies one PO wholesale |
| Confirm the delivery date | Derived from `suppliers.order_schedule` (`orders.ts:177-197`, `createDraft` 481-494); default tomorrow skipping Fri/Sat (`orders.ts:228-237`) | 1 | — |
| Unit prices | Auto-prefilled: explicit > contract (flag `contracts`) > catalog list (`orders.ts:496-538`) | 0 | — |
| Review, then send (channel email / whatsapp / none) | `placeOrder` `orders.ts:878-1020`; channel select `wizard.tsx:1268-1293` | 2–3 | — |
| Send failed / no provider → "copy order text" | `send-status.tsx:84-96` (clipboard of `supplierMessagePreview`) | 3+, outside the app | **Copy-paste into the user's own WhatsApp** |
| Cancel a sent order → notice to the supplier | `detail-client.tsx:154-186`: opens `wa.me`/`mailto` from the manager's own app; "nothing is queued by us" | 3 | Notice pre-written, sent by hand |
| Order placed outside RestoMatch (phone/WhatsApp) | `orders/capture` → `captureFromText` (flag `orderCapture`, `orders.ts:744-769`), or forward to the ingest WhatsApp number (`ingest/pipeline.ts:390-412`) | paste + confirm | The owner pastes the WhatsApp text they already sent |
| Zestt PO document import | `importPo` (`orders.ts:694-735`), needs `ANTHROPIC_API_KEY` (708-714) | upload | — |

### A2. What already runs automatically
- **Outbox send.** `placeOrder` inserts one `notifications_outbox` row with `dedupeKey po:<id>:placed` (`orders.ts:995-1010`). `outbox-dispatch` drains it every 60 s (`cron.ts:69-74`; `outboxDispatch.ts:105-135`). With no provider configured, the row is marked `failed` + `SKIPPED_NO_PROVIDER` (`outboxDispatch.ts:124-130`), never "sent".
- **Live send status.** `orders.sendStatus` (`orders.ts:1032-1071`, train A only) is polled by the PO page until `final` (`send-status.tsx:20-26`).
- **Rich order document** (flag `orderPricesOut`): SKU + agreed prices + PDF attachment on email (`orders.ts:945-976`). With flag `supplierConfirm` as well, it carries a fresh 72 h confirmation link (`supplierConfirm/documentExtension.ts:5-13`; `ORDER_DOCUMENT_EXTENSIONS` `orders/document/index.ts:31`).
- **Order-time leak guardrail** (`advanced_analytics`): flags lines priced over the 90-day median by max(5%, price tolerance) (`orders.ts:59-70,1127-1143`).
- **WhatsApp ingest → draft PO** (flag `orderCapture`): a text-only WhatsApp from an allow-listed sender becomes a DRAFT PO (`ingest/pipeline.ts:390-412`). Confirming it is still a human tap (`placeOrder {channel:'none'}`, `orders.ts:738-742`).

### A3. Stubs / mocks
- `MockWhatsAppNotifier` is used unless `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` are set (`notifications/factory.ts:42,63-73`). Push is always `MockPushNotifier` (`factory.ts:15,78`).
- `StubOrderTextParser` is used for capture when `ANTHROPIC_API_KEY` is absent or `ORDER_CAPTURE_PARSER=stub`, and as the fallback when Claude fails (`packages/ocr/src/providers/orderText.ts:232-243`).

### A4. Flag summary for ordering
`contracts` (pilot ON), `orderCapture` (pilot ON), `orderPricesOut` (pilot OFF), `supplierConfirm` (pilot OFF). Plan entitlement `whatsapp_alerts` (off on בסיס) and `advanced_analytics` (off on בסיס). Kill switch: `FEATURES_OFF` env (`lib/features.ts:56-59`).

---

## 3. Workflow B: supplier confirmation (supplier → restaurant)

- **Manual mint.** A manager taps "send link" → `supplierConfirm.createLink` (`routers/supplierConfirm.ts:25-36`, managerProcedure, flag `supplierConfirm`). The UI builds a `wa.me/?text=` share (`[poId]/supplier-link-button.tsx:30`). The chef can place orders but **cannot** mint the link.
- **Automatic mint.** With `orderPricesOut` + `supplierConfirm` on, the link is embedded in the sent document (`documentExtension.ts`).
- **The supplier answers** on the public `/s/[token]` page (rate-limited route `apps/web/app/api/supplier-confirm/[token]`). `submitSupplierAnswer` stores a `supplier_responses` row. The code says it "**Never touches purchase_orders / po_lines**" (`supplierConfirm/service.ts:296-301`).
- **Gap: nobody is told.** The supplier-confirm service and route never call the outbox (grep for `enqueue|outbox|notification` in `supplierConfirm/**` and `api/supplier-confirm/**` finds nothing). The PO never moves to `confirmed`: there is no `status: 'confirmed'` write for `purchase_orders` anywhere in `packages/api/src`. The diff is visible only if someone opens the PO (`supplierConfirm.responses`, `routers/supplierConfirm.ts:39-46`; `supplier-confirm-card.tsx`).

---

## 4. Workflow C: cadence jobs (automatic, owner + manager)

| Job | Schedule (IL) | What it does | Channel / recipients | Dedupe | Gaps |
|---|---|---|---|---|---|
| `order-reminders` | 09:00 daily (`cron.ts:76-81`) | For each active supplier whose `order_schedule` has today as an order day and that has **no PO created today**: "לא בוצעה הזמנה" (`orderReminders.ts:65-126`) | email only (`channel: 'email'`, 115), owner+manager (`recipients.ts:28,38`) | `supplier:<id>:order-reminder:<day>:<email>` (122) | (1) A **draft** counts as "ordered": the filter is only `ne(status,'cancelled')` (`orderReminders.ts:85-90`), so an unsent draft silences the reminder. (2) A single 09:00 run, regardless of the supplier's cut-off time (`window.cutoff` is only printed, 109). (3) The chef, who now orders, is not a recipient. (4) No WhatsApp/push. |
| `supplier-delays` | 10:00 daily (`cron.ts:83-88`) | Open PO (`sent`/`confirmed`) with **no goods receipt** and `deliveryState === 'late'`, chased on days 1/3/7 only, 14-day lookback (`supplierDelays.ts:49-54,82-118`) | email, owner+manager (144-156) | `po:<id>:late:d<N>:<email>` (155) | Alerts the restaurant, not the supplier. It links to `/dashboard/receiving/<poId>` (141); there's no "message the supplier" or "cancel/reschedule" action |
| `daily-expectations` | 06:00 daily (`cron.ts:55-60`) | Today's expected deliveries per restaurant (`dailyExpectations.ts:69-121`) | **none**: writes one `audit_log` row `daily_expectations.computed` (123-132) | — | **Dead output.** No reader of the audit action exists, and the receiver isn't told "3 deliveries expected today" |

All three run in the BullMQ worker and in the serverless runner (`apps/worker/src/handlers.ts:32-50`; Vercel cron `/api/cron/jobs` every minute, `apps/web/vercel.json:9-12`). None is flag-gated. All are in `cron.ts`, which is **immutable**, so changing a schedule or adding a job is a HUMAN-PR.

---

## 5. Workflow D: pay run, due dates, mark paid, holds (bookkeeper / owner / manager)

**Screen:** `/dashboard/approvals/pay-run` (`apps/web/app/dashboard/approvals/pay-run/page.tsx`, flag `payRun`; route `features: ['payRun']`, `routes/approvals.ts:22-27`). **Procedure:** `payRun.month` (`routers/payRun.ts:166-343`) + `payRun.enabled` (164). **Tables read:** `invoices`, `suppliers`, `match_runs`, `discrepancies`, plus `computeLeakHero`/`computeLeakBreakdown` (`@restomatch/charts`).

### D1. What it computes automatically
- Invoices of **this or last invoice-month** (`monthOffset 0|-1`, 167) with `status <> 'paid'` and `<> 'ocr_pending'` (231-237), grouped by supplier.
- Each row gets a status from `payRunStatusOf` (116-155):
  - `pay`;
  - `hold`: an open/escalated leak finding with Δ>0, a duplicate copy, a pending PO link, or a scan awaiting its count (149-153, 246-262);
  - `claim`: accepted credit only.
- A safety-net SQL beyond the 200-row breakdown window (184-228).
- Suppliers are sorted by held ₪, then credit, then payable (320-326).
- The duplicate rule ("don't pay this copy", never a credit, 138-142) and the never-claimable types (`NEVER_CLAIMABLE_TYPES = PRICE_LOWER, UNORDERED_ARRIVAL, MISSING_ON_INVOICE`, `lib/claims.ts:22`) are already enforced. This matches the owner rule that MISSING_ON_INVOICE is out of the leak and not claimable.

### D2. What is manual / missing
| Need | State today | Evidence |
|---|---|---|
| Due date per invoice | **Not computed.** `invoices.due_date` exists (`schema.ts:813`) but only seeds write it. The pay run filters by invoice month, not due date | `payRun.ts:233-234`; W2-03 finding approvals-22 "MF-24950 hidden" (W2-03.md:2 **[main]**) |
| Supplier terms | Free text, typed in the supplier form (`suppliers/manager.tsx:427-433`, `form-logic.ts:95,114`), never parsed | `routers/suppliers.ts:52,70,196,242` |
| Mark paid | **Impossible in the app.** "the app has no payment rail; the UI says 'not marked as paid'" | `payRun.ts:25-26`; no `status:'paid'` writer outside `seed-demo.ts:762` |
| Act on a hold | Every held row links to the generic `/dashboard/approvals` (`page.tsx:268-270`), with no "waiting for whom" and no ₪-in-dispute share | W2-03 approvals-23/24 |
| Handing to the bookkeeper/bank | `PayRunExport` CSV built client-side (`export-button.tsx:8-14`, columns `page.tsx:92-101`); typed again into the bank / accounting package | — |
| Missing allocation number | **Not a hold.** The pay run ignores `vatAtRisk` (W2-03 §1.6, "payRun ignores it today" **[main]**) | an invoice without מספר הקצאה reads "ניתן לשלם" (functional-flows-17) |
| Approvals priority by due date | `approvals.ts:146-157` sorts by `invoices.due_date`, which is always NULL in production, so that key is dead | `approvals.ts:155,162,226` |

### D3. Flags
`payRun` is pilot **OFF** (`FeaturesPanel.tsx:20-31`). `vatAtRisk` is pilot OFF. There are no entitlement gates on the pay run.

---

## 6. Workflow E: exports, month close, VAT at risk

- **Accounting exports** (bookkeeper/owner, `accounting_export` entitlement):
  - `exports.invoicesCsv` and `exports.uniform1000` (C100 only) (`routers/exports.ts:23,43,75`);
  - the Hashavshevet / Priority / Rivhit files via `integrations.accountingExport` (`integrations.ts:61-63`; `packages/api/src/integrations/accounting/{hashavshevet,priority,rivhit}.ts`), which also needs the `integrations` flag. The owner-only mapping is in `setAccountingConfig` (`integrations.ts:195`).
  - Statuses: `matched, disputed, approved, paid` (`exports/period.ts:15`).
  - **Fully manual:** pick a range (`exports/range.ts`), click download (`accounting-files.tsx:33-58`), upload into the accounting package. No schedule, no email to the bookkeeper. The manager can't export.
- **Month close:** `closeRouter = router({})` (`routers/close.ts:3-10`, "later wave"). Wave 2 doesn't fill it either. W2-02's register mentions "month-close hours" only as motivation (W2-02.md:2 **[main]**).
- **VAT at risk** (flag `vatAtRisk`, `owner.vatAtRisk` `routers/owner.ts:93-111`):
  - pure computation over `invoices.allocation_number` (OCR'd by Claude Vision, `claudeVision.ts:93,112`; reconciled `reconciler.ts:59-65`; persisted `ocrInvoice.ts:283`);
  - thresholds by date (`vat/vatAtRisk.ts:22-28`), 9-digit format check only (39-43), 6-month deduction deadline (31, 46-52), days left (55-57);
  - it is a **separate figure, never in the leak** (13-15);
  - home card (`dashboard/home/data.ts:24-25`);
  - per-supplier Hebrew request text that the owner **copies** (`vat-at-risk.tsx:182-190`; `lib/vat/requestText.ts`);
  - no job, no deadline reminder, no outbox. No router lets a human type a corrected allocation number: `allocation` appears only in `owner.ts` among routers.

---

## 7. Automation opportunities (trigger → action → human confirms → data → reuse → immutability)

Owner rules applied throughout: every money action stays human-confirmed. The receiver never gets ₪. The chef gets ₪ only on orders. MISSING_ON_INVOICE stays out. Approval routing (manager ₪50–300 / 2–5%, owner above + every blocking gap) is untouched.

| # | Opportunity | Trigger | Action | Human confirms | Data | Reuse | Immutable? |
|---|---|---|---|---|---|---|---|
| O1 | **Draft-at-cut-off** ("ההזמנה מוכנה, רק לאשר") | An order day per `order_schedule`, N hours before `cutoff` | Pre-build a DRAFT PO from the order guide (median of the last 4 POs, W2-06 AC1), with expected prices via `resolveExpectedPrice`; push "טיוטה מוכנה · 9 פריטים" to the chef/manager | Chef/manager reviews qty and taps send (`placeOrder`) | `order_schedule`, the last 8 POs, contracts | `createDraft` logic, W2-06 `orderGuide`, `captureOrderDraft` idempotency, outbox | A new cron entry needs **`cron.ts` → HUMAN-PR**. As an interim, piggy-back on the existing 09:00 `order-reminders` job, which already loops suppliers due today (`orderReminders.ts:94-97`), editing the job file only |
| O2 | **Fix the reminder semantics** | 09:00 job | Treat a `draft` as *not* ordered; include the chef; send at cut-off minus X; WhatsApp/push when available | none (alert) | same | `orderReminders.ts`, `recipientsForRestaurant(db, rid, roles)` | Schedule change = `cron.ts` HUMAN-PR; filter/recipients = job file only |
| O3 | **Morning delivery brief for the receiver** (reuse the dead `daily-expectations` output) | 06:00 job (already runs) | Enqueue "היום צפויות 3 משלוחים: …" to the receiver(s): supplier names + line counts, **no ₪** | none | the `expectations` array already computed (`dailyExpectations.ts:114-121`) | `enqueueNotification`, `recipientsForRestaurant(..., ['receiver'])` | job file only. The job is already scheduled |
| O4 | **Supplier-facing late-delivery chase** | `supplier-delays` day-1 step | Pre-write "ההזמנה #X מ-dd.MM לא הגיעה" to the supplier (wa.me/email) and offer cancel/reschedule | Manager taps send (it's a message to a third party) | PO, supplier contact | `supplierDelayEmail`, the `cancelNoticeText` pattern (`detail-client.tsx:164`), outbox | job file + web only |
| O5 | **Supplier answered → tell the orderer, update the expectation** | `submitSupplierAnswer` inserts a row | Notify the PO creator ("הספק אישר" / "הספק שינה 2 שורות"); on "confirmed", move the PO to `confirmed`; on changes, offer "accept into the order" | Manager accepts changed qty/price (₪) | `supplier_responses`, `supplierResponseDiff` | outbox `enqueueNotification`; W2-06 AC5 diff view | Service file only (not immutable). Accepting changes into the expectation is H-04/H-08 (a schema batch) → HUMAN-PR |
| O6 | **Auto-retry / fallback for failed sends** | Outbox row `failed` / `SKIPPED_NO_PROVIDER` for `relatedEntityType='purchase_order'` | Push to the orderer within minutes, with a one-tap "send from my WhatsApp" (W2-06 `markSentManually`) | The tap itself | outbox row | `sendStateOf` (`orders.ts:324-334`), W2-06 AC3 | `outbox.ts` and `outboxDispatch` retry policy: `outbox.ts` is immutable → read-only consumer only |
| O7 | **Due-date desk + weekly "לתשלום השבוע" digest** | Monday 08:xx, or open of the pay run | List invoices due this week (W2-03 `computeDueDate`), held ones with reason and ₪ in dispute; email the bookkeeper/owner | The bookkeeper marks paid (W2-03 `markPaid`, behind `PAY_RUN_MARK_PAID`) | `due_date`, `payment_terms`, `printedDueDate` (G-17) | W2-03 `lib/dueDate.ts`, `payRun.month`, outbox | New cron = `cron.ts` HUMAN-PR. `markPaid` needs H-03 `paid_at` columns = schema/migration **HUMAN-PR** |
| O8 | **Missing allocation number = automatic hold + supplier request** | OCR stores an invoice above the threshold without a valid 9-digit number | Pay-run hold "חסר מספר הקצאה · ₪VAT" (W2-03 AC6); pre-fill the supplier request; remind at 30/7 days before the 6-month deadline | Owner/bookkeeper sends the request (third-party message); a human types the corrected number | `vatAtRisk()` rows, `deductionDeadline` | `vatAtRisk.ts`, `supplierRequestText`, outbox | A new job needs a `cron.ts` entry → HUMAN-PR. Editing `allocation_number` uses an existing column (no schema change) |
| O9 | **Terms shorter than agreed** (G-17) | OCR reads printed terms / due date | Warn chip in the pay run; sort by the *agreed* date | none: never moves the payment earlier, never ₪ | `raw.printedTerms`, `raw.printedDueDate`, canonical `payment_terms` | G-17 `termsCheck`, W2-11 picker | not immutable (no schema change, no `DiscrepancyType`) |
| O10 | **Scheduled accounting export** | Month end + N days, or "all invoices of the month checked" | Generate the Hashavshevet/Priority/Rivhit file and email it to the bookkeeper (attachment) | The bookkeeper imports it | export functions | `integrations.accountingExport` core, outbox `__attachments` (as used in `orders.ts:961-968`) | cron = HUMAN-PR; an email with an export attachment is a data-egress decision for the owner |
| O11 | **Month-close checklist** in the empty `close` router | 1st of the month (after `monthly-report` 07:45) | A checklist: unmatched invoices, open holds, VAT at risk, unexported invoices, unanswered supplier confirmations, overdue claims (>7 days) | The bookkeeper ticks "closed" | existing read models | `closeRouter` stub (needs COVERAGE + attack test, `close.ts:6-8`) | A COVERAGE entry may be **added** (allowed); a new cron = HUMAN-PR |
| O12 | **Ask tools for orders and pay run** | the user asks | "מה צריך לשלם השבוע?", "מה הוזמן מ-X?" | none (read) | `payRun.month`, `orders.list` | `ask/tools.ts` today has only leak tools (`tools.ts:180-204`) | not immutable; role redaction must hold (no ₪ for receiver) |
| O13 | **Server-side ₪ redaction for the receiver on orders** (a prerequisite for any receiver automation) | — | `redactPrices` on `orders.list/get` | — | — | W2-06 AC4 | not immutable |

---

## 8. Immutable-list touchpoints in this area

- `apps/worker/src/cron.ts`: every new schedule (O1 timing, O7, O8, O10, O11) is HUMAN-PR. Opportunities that reuse an **already scheduled** job (O2 filter, O3, O4) can stay inside the job file.
- `packages/api/src/notifications/outbox.ts`: `orders.ts` imports `DEDUPE_INDEX_PREDICATE` from it (`orders.ts:38`). Consume it, never edit it.
- `packages/db/src/schema.ts` + migrations: `due_date` (813), `payment_terms` (435), `invoice_status` (64-71). `paid_at`/`payment_method` (H-03), `payment_deductions` (G-03) and `po_lines.price_source` (W2-06 proposal) are schema batches, so HUMAN-PR.
- `packages/db/src/plans.ts` / `packages/billing/*`: moving `whatsapp_alerts` or `accounting_export` to בסיס is HUMAN-PR.
- `packages/matching/**`: "note billed twice" never becomes a `DiscrepancyType` (README §13). Leak math is untouched by everything here.
- `packages/api/src/approvals/engine.ts`: any "auto-approve for payment" (G-15, wave 3) is HUMAN-PR. W2-03 says don't build `approve_for_payment` (W2-03.md:196 **[main]**).
- `cross-tenant.attack.test.ts`: new procedures (`close.*`, `payRun.markPaid`, …) add COVERAGE entries only.
- `apps/web/app/api/trpc/[trpc]/route.ts`, `rateLimit.ts`: the public supplier-confirm route is a public attack surface. O5 must not widen it.

---

## 9. What wave 2 already plans here (from `kit-terms-flags.diff` + W2-03 / W2-06)

**Payment terms, all in wave 2** (owner decision 31.10; README §13 in the diff):
1. **W2-11 §10:** a terms picker writes canonical strings "מזומן" / "שוטף" / "שוטף+N" (N ∈ 0/30/45/60/90 or typed) into the existing `suppliers.payment_terms`, with no schema change. Legacy free text shows "לא מוכר · בחרו תנאי תשלום". The vendor table shows the canonical label or nothing.
2. **W2-03:**
   - `lib/dueDate.ts` `computeDueDate(invoiceDate, terms, explicitDueDate?)`. "שוטף+N" = end of the invoice month + N days. "מזומן" = invoice date. Unparsed = `unknown`. A law-cap warn uses `PAYMENT_LAW_MAX_DAYS_AFTER_EOM` (proposed 45).
   - **Precedence (§10 addendum):** human-entered due date > agreed terms > OCR-printed due date (the last only when no agreed terms exist).
   - Due-date buckets באיחור / השבוע / שבוע הבא / מאוחר יותר; a DataTable with BatchBar.
   - `markPaid`/`unmarkPaid` behind the server env flag `PAY_RUN_MARK_PAID`, default off until H-03 deploys. Until G-14 it refuses an invoice with capped leak > 0.
   - A paid invoice keeps its claims (`claimableLines` stops returning `[]` for paid, `lib/claims.ts:74`).
   - Held rows say "ממתין להחלטת: בעלים · 4 ימים · ₪100.00 במחלוקת מתוך ₪4,513.15", with a one-click in-app reminder.
   - A missing allocation number is a hold.
   - A remittance print view per supplier; short-pay into `payment_deductions` only after G-03.
3. **G-17 (new, ocr-procurement-engineer):** OCR extracts `paymentTermsText` and `dueDate` into `ocr_payload.raw.printedTerms` / `printedDueDate` and **never** writes `invoices.due_date`. A pure `termsCheck(agreedTerms, invoiceDate, printedTerms, printedDueDate) → ok | shorter | unknown` drives a warn chip "תנאים קצרים מהמוסכם · בחשבונית dd.MM · מוסכם dd.MM" in the pay run. No ₪ anywhere; `unknown` is neutral. It starts after train B is on main.

**Consolidated invoices (G-04 §9 addendum)** build on train B's `raw.kind/periodStart/periodEnd/deliveryNotes[]`:
- `note_other_month`: T4 when the gap is one day at the edge, else warn;
- `note_not_in_system`: warn, blocks "תואמת";
- `note_billed_twice`: T2 "אפשר שחויב פעמיים · ₪X", never in the leak hero; it becomes a W2-03 pay-run hold with the ₪ "במחלוקת".

**Orders (W2-06):**
- an order guide from the last 8 POs (≤9 taps / ≤45 s for 10 lines);
- a supplier board sorted by next cut-off with countdown chips;
- `markSentManually` "send from my WhatsApp" (no outbox row; the default when the plan lacks `whatsapp_alerts`);
- chef ordering without approval (already on train A);
- server drafts `saveDraft`/`openDraft`; `resolveExpectedPrice` (contract > own last price > list, never the invoice);
- `sendMany` bulk send; `amendSent` before cut-off;
- the supplier-answer diff on the detail page;
- `placeOrder` refuses a PO with a goods receipt;
- `redactPrices` for the receiver.

**Not planned in wave 2 (gaps for this research):** proactive draft-at-cut-off (O1), the receiver morning brief from `daily-expectations` (O3), a supplier-facing late chase (O4), notifying on the supplier's answer (O5), a weekly due digest (O7), automatic allocation-number reminders (O8), a scheduled export (O10), and month close (O11). The `close` router stays empty.
