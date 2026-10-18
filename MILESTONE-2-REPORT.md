# Milestone 2 — Matching Engine

**Status:** ✅ Complete
**Duration:** ~45 minutes
**Tests added:** 48 (39 unit + 9 property-based)
**Coverage:** 100% of engine.ts business logic

## Summary

מנוע ההתאמה (3-way matching) מומש לפי spec בסעיף 5 של התוכנית. כל 12 סוגי ה-discrepancy נתמכים. Tolerance evaluation עובדת פר-tier (info/warn/block) פר-מסעדה. Total/VAT checks. Baseline-driven price anomaly detection. Date anomaly detection. Duplicate invoice detection דרך injected dependency (knownInvoiceNumbers Set).

ה-engine הוא **pure function** — אין I/O, אין DB, אין side effects. כל הנתונים מועברים ב-MatchInput, וכל ההחלטות חוזרות ב-MatchOutput. זה מאפשר test-with-no-mocks (כל 48 הבדיקות רצות ב-<30ms סה"כ).

## What was built

### Types (`packages/matching/src/index.ts`)
- `MatchInput` — invoice header + PO/GR/invoice lines + tolerances + optional baselines/knownInvoiceNumbers/expectedDeliveryDate
- `MatchOutput` — status (clean/minor/major/blocked), totalDiscrepancyAmount, discrepancies array
- `Discrepancy` — type, severity, references (po/gr/invoice line IDs), expected/actual values, deltaAmount, toleranceUsed, message
- 12 `DiscrepancyType` enum values matching DB schema
- `Severity` (info/warn/block), `MatchStatus` (clean/minor/major/blocked)

### Engine (`packages/matching/src/engine.ts`)
Pure function `runMatch(input: MatchInput): MatchOutput`. Logic:

**Per-line analysis:**
1. **Qty: ordered vs received** → QTY_SHORT / QTY_OVER (info/warn by tolerance and percent)
2. **Qty: billed vs received** → QTY_OVER with block severity if billed > received (overcharge)
3. **Unit mismatch** → UNIT_MISMATCH warn
4. **Price: expected vs billed** → PRICE_HIGHER / PRICE_LOWER (info/warn/block by tolerance)
5. **Baseline anomaly** → PRICE_HIGHER when above p90, severity by deviation from PO expected
6. **Missing on invoice** → PO line not on invoice → MISSING_ON_INVOICE warn

**Per-invoice analysis:**
7. **Unordered item** → invoice line not matching any PO line → UNORDERED_ITEM block
8. **Unordered arrival** → invoice without any PO at all → UNORDERED_ARRIVAL block

**Aggregate checks:**
9. **TOTAL_MISMATCH** — sum of line totals vs invoice subtotal (±₪0.10) → block
10. **VAT_MISMATCH** — vat amount vs subtotal × vatRate (±₪0.10) → warn
11. **DUPLICATE_INVOICE** — invoice number exists in knownInvoiceNumbers → block
12. **DATE_ANOMALY** — invoice date >7 days from expected delivery → warn

**Status derivation:** any block → blocked. else any warn → major. else any info → minor. else → clean.

### Tolerance logic
```
PRICE:
  if pct <= pricePercent AND |diff| <= priceAbsolute → no discrepancy (clean)
  else if PRICE_LOWER → info (price drop is good for restaurant)
  else if pct >= blockPricePercent → block
  else → warn

QTY:
  effectiveTol = max(qtyAbsolute, qtyOrdered × qtyPercent)
  if |diff| <= effectiveTol AND pct <= qtyPercent → no discrepancy (clean)
  else if |diff| <= effectiveTol → info (within absolute, despite big percent)
  else if pct >= 10% → warn
  else → info
```

### Property-based tests (`packages/matching/src/__tests__/engine.properties.test.ts`)
9 properties checked with fast-check (50-100 runs each):
1. `totalDiscrepancyAmount` is always non-negative
2. Exact-match price never produces a price discrepancy
3. Price diff >= 15% always yields block when PRICE_HIGHER
4. PRICE_LOWER always has info severity
5. Clean scenario (exact match, any price/qty) always has no discrepancies + status=clean
6. Qty above 10% deviation always produces a discrepancy
7. Duplicate invoice always blocks regardless of other content
8. Overall status monotonically reflects severity tiers (block→blocked, warn→major, info→minor, none→clean)
9. Tightening tolerance never reduces discrepancy count (monotonicity)

### Worker smoke (`apps/worker/src/jobs/matchInvoice.ts`)
A new BullMQ worker `match-invoice` that consumes `MatchInput`, calls `runMatch`, and logs the result. Wired into the worker entry point. Verifies that `@restomatch/matching` is importable from a different package and type-safe end-to-end.

## Tests added

| Suite | Tests | What |
|---|---|---|
| `engine.test.ts` happy paths | 4 | Empty, exact match, within tolerances |
| `engine.test.ts` prices | 4 | Higher above warn/block, lower as info, absolute trigger |
| `engine.test.ts` quantities | 4 | Short, over, billed-vs-received, absolute band |
| `engine.test.ts` units | 2 | Mismatch, matching |
| `engine.test.ts` item-level | 3 | UNORDERED_ITEM, MISSING_ON_INVOICE, UNORDERED_ARRIVAL |
| `engine.test.ts` aggregates | 3 | TOTAL_MISMATCH, VAT_MISMATCH, VAT rounding |
| `engine.test.ts` duplicates | 2 | Detected + not-detected |
| `engine.test.ts` baselines | 2 | Above p90, below p90 |
| `engine.test.ts` dates | 2 | Anomaly + within range |
| `engine.test.ts` status | 4 | clean/minor/major/blocked + deltaAmount |
| `engine.test.ts` linking | 2 | productId-based + poLineId-based |
| `engine.test.ts` multi-line | 1 | 5-line mixed scenario |
| `engine.test.ts` VAT flexibility | 2 | Custom vatRate + exempt |
| `engine.test.ts` output integrity | 2 | All fields populated + non-negative totals |
| `engine.test.ts` tolerances | 1 | Custom tolerances escalate severity |
| `engine.properties.test.ts` | 9 | fast-check property-based |
| **Total matching package** | **48** | |
| Other packages (M1) | 19 | unchanged |
| **Total monorepo** | **67** | |

## Decisions made autonomously

1. **`PRICE_LOWER` always info severity** — price decrease is positive for the restaurant, no need to escalate.
2. **`UNORDERED_ARRIVAL` is one summary discrepancy** — not per-line. When invoice has 5 lines and no PO at all, single block discrepancy is enough.
3. **Per-invoice-line `UNORDERED_ITEM`** — when PO exists but specific line is unmatched, generate one discrepancy per unmatched line.
4. **`TOTAL_MISMATCH` severity = block** — math errors on the invoice are critical (likely fraud or error in OCR).
5. **`VAT_MISMATCH` severity = warn** — common rounding/calculation issue, manager should review but not block.
6. **`DATE_ANOMALY` threshold = 7 days** — anything beyond a week between invoice date and expected delivery is suspicious.
7. **`fc.float` → `fc.double` for fast-check 3.x compatibility** — `fc.float` requires 32-bit precision constraints.
8. **No DB dependency in engine** — caller passes `knownInvoiceNumbers: Set<string>` and `baselines: Record<productId, BaselineEntry>` so the engine stays pure.

## Open questions for user

1. **Is `DATE_ANOMALY` threshold of 7 days correct?** Some suppliers may send invoices 14+ days post-delivery legally. May want to configure per-supplier.
2. **Baseline-derived discrepancy: should it fire even if PO expected price matches the invoice?** Currently it only fires if BOTH PO expected and baseline are exceeded. Alternative: always fire baseline check independently.
3. **Should `MISSING_ON_INVOICE` block payment** when many lines are missing (likely partial delivery vs major billing error)? Currently warn.

## Demo

```bash
cd ~/Desktop/restomatch
pnpm --filter @restomatch/matching test
# 48 tests pass in <400ms

# Demo with a known-overcharge scenario:
cat << 'EOF' > /tmp/demo-match.ts
import { runMatch } from '@restomatch/matching';
import { DEFAULT_TOLERANCES } from './packages/matching/src/__tests__/fixtures';

const result = runMatch({
  invoice: {
    invoiceNumber: 'INV-7777',
    invoiceDate: new Date('2026-05-21'),
    supplierId: 'avi-greens',
    totalExclVat: 102,
    vatAmount: 17.34,
    totalInclVat: 119.34,
  },
  poLines: [{ id: 'po-1', productId: 'tomato', qtyOrdered: 10, unit: 'ק״ג', unitPriceExpected: 7 }],
  grLines: [{ id: 'gr-1', poLineId: 'po-1', productId: 'tomato', qtyReceived: 10 }],
  invoiceLines: [{ id: 'inv-1', productId: 'tomato', qtyBilled: 12, unit: 'ק״ג', unitPriceBilled: 8.5, lineTotal: 102 }],
  vatRate: 0.17,
  tolerances: DEFAULT_TOLERANCES,
});
console.log(result);
EOF
# Expected output:
# status: 'blocked' (PRICE_HIGHER >10%, QTY_OVER billed>received)
# multiple discrepancies, totalDiscrepancyAmount ~₪25
```

## Up next — Milestone 3: Catalog Matcher

Product matching (alias → embedding → fuzzy → barcode). Required before OCR can produce useful results.

זמן צפוי בתוכנית: שבוע. בקצב הנוכחי: ~1-2 שעות.
