# H-11ʰ slice c · audit of the remaining member procedures (7.11, read-only)
**One line:** which procedures outside slice a still hand ₪ to the receiver or the chef, read from `main` 4c88768. Each row has a finding and the planned strip. Brief: `docs/ux/wave4/H-11.md` (on `claude/ux-h-11-money-strip`, PR #258). Heavy work starts after Sat 14.11 06:00Z, on a base that has #219 and #258.

| Procedure (tier) | ₪ reaching receiver / chef today | Planned strip |
|---|---|---|
| `receiving.priceContext` (invoiceReader: receiver yes, chef no) | **Yes**, when the flag `dockPriceContext` is on: `lines[].billedUnitPrice`, `usualUnitPrice` (the median paid, `dockPriceContext/service.ts:26`). The receiver's dock hint renders it: `receiving/dock-price-hint.tsx:36` `formatIls(usualUnitPrice)`. After #219 the hint stops showing for the receiver, because `invoiceUnitPrice` is null (`[poId]/dock-price-context.tsx:30`), but the procedure still returns the prices. | **Decided (7.11, binding rule "the receiver sees no ₪"):** receiver gets `billedUnitPrice` and `usualUnitPrice` → null (typed `number \| null`) and **keeps the boolean `priceHigher`**, so the dock can still say "מחיר גבוה מהרגיל" without a number. The flag is not in `PILOT_DEFAULTS` (off at ציקטי), so nothing is live today. |
| `approvals.myQueue` (member) | **Data-dependent.** Rows are filtered by `requiresRole ∈ expandVisibleRoles(role)` (`lib/roles.ts:4`), and the engine never routes to receiver or chef, so the list is empty today. But a row with `requires_role = receiver/chef` would carry `deltaAmount`, `expectedValue` and `actualValue`. | Null those three for receiver and chef (defence in depth; nothing changes today). |
| `approvals.queueSummary` (member) | `claimableIls`, `duplicateIls`, `vatIls`, `toDecide.amountIls` are **₪0 numbers** (empty queue). `others` is decider-only. | null for receiver and chef, typed `number \| null` (honest: "no ₪", not "₪0"). |
| `receiving.todayExpectations` / `getReceipt` / `pendingInvoices` (member) | No ₪ column selected. | None. A test pins that no ₪ key appears for the receiver. |
| `search.global` (member) | Suppliers, products and invoice numbers only, no amounts. | None. Pin test. |
| `products.list` (member) | `total` is a row count, not ₪. | None. |
| `mapping.unmapped` / `searchProducts` (member) | No ₪ column. | None. Pin test. |
| `consolidated.coverage` (invoiceReader: receiver yes) | Delivery-note coverage for the supplier ledger. The ledger route is finance-only; the receiver can still call it. Needs a field-level read of `ledger/coverage.ts` (heavy pass). | Decide in the heavy pass; strip any ₪ for the receiver. |
| `contracts.orderPrices` (chef tier) | The chef gets contract prices for ordering: inside the orders exemption. The receiver is FORBIDDEN already. | None. |

**Attack suite:** slice c adds one appended block (add-only) for priceContext, the queueSummary nulls and myQueue. Each immutable change goes back to the owner as one Hebrew line through the orchestrator.

## Built (11.11, full mode)
| Procedure | Receiver | Chef |
|---|---|---|
| `receiving.priceContext` | `billedUnitPrice`, `usualUnitPrice` → null; keeps `priceHigher`, `pctVsUsual` (a %), `samples`. The dock hint says "מחיר גבוה מהרגיל" with no ₪, only when the % is positive. | FORBIDDEN (as before: not an invoice reader) |
| `approvals.myQueue`, `approvals.queueSummary` | FORBIDDEN (no ₪, not ₪0). No receiver/chef screen calls them: the approvals route and `loadDecide` are finance-only. | FORBIDDEN |
| `consolidated.coverage` | `receivedValueIls` → null, typed `number \| null`; the state and numbers stay. | FORBIDDEN (as before) |
| todayExpectations · pendingInvoices · search.global · products.list · mapping.unmapped/searchProducts | No ₪; pinned by test | same |

**Tests:** new `__tests__/money-strip-c.attack.test.ts`. It fails 3/4 against main's routers (the pins pass on both) and passes 4/4 with the change. Full `@restomatch/api`: 125 files, 1940 tests. The web i18n test passes, 49/49. No immutable file is touched: the attack block is a new file, so `cross-tenant.attack.test.ts` is unchanged. tenant-security-warden review: no blockers; its two SHOULDs are applied.
