# Proposal — Leak-engine fixes (CROWN-JEWEL · human-PR only)

> These changes touch files on the AGENTS.md **immutability list** (the ₪ math).
> Per the contract, an agent proposes and stops — a human authors/reviews the PR
> with `packages/matching/src/__tests__/leak-canary.test.ts` as the guard. This
> doc is that proposal. Nothing here was auto-applied.

Source: the 2026-06-21 audit (roadmap #12–#13). Three defects keep the marquee
₪-leak product from being trustworthy for a real pilot.

---

## 1. `price_history` has no production writer → leak-detective is permanently empty (HIGH)

`computeLeaks` / `computeBaselines` / the בלש-הדליפות heatmap all READ `price_history`,
but only `seed-demo.ts` + tests WRITE it. Real tenants accumulate nothing, so the
headline feature shows a false empty state forever.

**Fix (low-risk, NOT ₪-math — could land in `packages/api/src/match/persist.ts`,
which is not on the immutability list, but flagged here because it feeds the leak
domain):** after persisting a match run, write one `price_history` row per matched
invoice line.

```ts
// in persistMatchRun(), after the discrepancies insert, for each matched line:
await db.insert(priceHistory).values(
  matchedLines.map((l) => ({
    restaurantId,
    productId: l.productId,          // skip lines with null productId
    supplierId,                      // from the invoice
    observedAt: invoiceDate ?? new Date(),
    unitPrice: String(l.unitPriceBilled),
    qty: String(l.qtyBilled),
    sourceInvoiceId: invoiceId,
  })).filter((r) => r.productId != null),
);
```

`price_history` columns (verified): restaurantId, productId, supplierId,
observedAt (notNull), unitPrice numeric(12,4) notNull, qty numeric(12,3),
sourceInvoiceId FK. The leak-canary asserts the discrepancy total, which this does
NOT change → canary stays green. **Alternatively** (if you prefer not to feed it
for the pilot): hide/relabel the leak-detective page so its empty state stops
making a false promise.

---

## 2. Multiple partial GRs against one PO line collapse (last-wins) → false QTY_SHORT (HIGH)

In `packages/matching/src/engine.ts` (IMMUTABLE), `grByPoLineId` keeps only the
last GR line per `poLineId`. Two partial deliveries against one ordered line →
received qty is under-counted → a false `QTY_SHORT` discrepancy (manufactured leak).

**Fix:** SUM received quantities per `poLineId` instead of overwriting.

```ts
// engine.ts — where grByPoLineId is built:
// BEFORE: map.set(gl.poLineId, gl)            // last-wins
// AFTER:  accumulate qtyReceived (+ qtyRejected) across all GR lines for the poLineId,
//         keeping one merged record per poLineId.
```

Human-PR: re-run the matching suite; add a fixture with two partial GRs on one PO
line asserting NO QTY_SHORT when the sum matches the order.

---

## 3. Consolidated / late invoice fires UNORDERED_ARRIVAL on the full total (HIGH)

A `חשבונית ריכוז` (consolidated invoice) or a late invoice with no matched PO is
treated as fully unordered → the entire total is charged as leak (false alarm).
AGENTS.md design rule: **calm on pending/consolidated — never a false alarm.**

**Fix:** build the `StagedMatch` calm-pending path (matching-engine-guardian owns
the engine half; ocr-procurement-engineer owns the ingest staging). A consolidated
invoice with no 1:1 PO lands in a pending state for human linkage instead of
emitting UNORDERED_ARRIVAL on the full amount.

**Pilot interim (no code):** scope the pilot to single-delivery suppliers so the
partial/consolidated paths aren't exercised, then ship #2/#3 post-pilot.

---

### Apply order
1. (2) partial-GR sum + (3) StagedMatch — engine.ts, human-PR, matching suite green + new fixtures.
2. (1) price_history writer — persist.ts, additive, canary stays green.
3. Re-run `pnpm test` (matching + charts) and verify the leak figure is unchanged by (1) and corrected by (2)/(3).
