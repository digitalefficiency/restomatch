# OCR model choice — benchmark and proposal

**Status: proposal for the owner.** The default model stays `claude-opus-4-8`
until someone runs the benchmark below with a real key and picks a row. Nothing
in CI calls the API.

## Why

An invoice photo takes ≈ 100 s to extract on the default model (worker logs).
That is the receiver standing at the delivery door waiting for the
discrepancy check. The extraction is a vision + structured-JSON task (Hebrew
lines, numbers, an English gloss per line), not open-ended reasoning, so a
faster/cheaper model at lower effort may be just as exact.

## The benchmark (`packages/ocr`)

| Piece | What |
|---|---|
| `bench/invoice-1.html` → `invoice-1.png` | a synthetic Hebrew tax invoice (6 lines, SKUs, 18% VAT, allocation number); `node packages/ocr/bench/render-fixture.mjs` re-renders it |
| `bench/invoice-1.truth.json` | the ground truth (unit-tested to be internally consistent) |
| `src/bench/score.ts` | grading: 39 binary checks (supplier, number, date, allocation, every line field, totals); **money-exact** = every line total + subtotal/VAT/total right to the agora — the number the leak figure is built from (unit-tested, no key) |
| `src/bench/run.ts` | runs the **production** extractor (`ClaudeVision`, same prompt) N times per model × effort; prints median/max seconds, accuracy, money-exact runs, $/invoice |

```bash
ANTHROPIC_API_KEY=… pnpm --filter @restomatch/ocr bench            # default matrix, 3 runs each
BENCH_MATRIX="claude-sonnet-5-5:low,claude-haiku-5-5:low" BENCH_RUNS=5 \
  ANTHROPIC_API_KEY=… pnpm --filter @restomatch/ocr bench
```

Default matrix: `claude-opus-4-8` (today), `claude-opus-5-5:low`,
`claude-sonnet-5-5:low`, `claude-sonnet-5-5:medium`, `claude-haiku-5-5:low`.
Cost ≈ 15 calls × a few cents. Without a key it exits 2 and calls nothing.

`ClaudeVision` gained an optional `effort` (`OCR_CLAUDE_EFFORT`, sent as
`output_config.effort`); unset = not sent, so production behaviour is unchanged.

## Candidates (list prices per 1M tokens, input / output)

| Model | Price | Notes for this task |
|---|---|---|
| `claude-opus-4-8` (default) | $5 / $25 | runs without thinking when `thinking` is omitted (as today) |
| `claude-opus-5-5` | $4 / $20 | thinking always on; effort default `medium` — use `low` |
| `claude-sonnet-5-5` | $2 / $10 | effort default `high`; `low`/`medium` for extraction |
| `claude-haiku-5-5` | $0.10 / $0.50 | cheapest; the question is Hebrew handwriting/low-light photos |

No timings are claimed here — none were measured (no key in this environment,
and AGENTS.md forbids an agent spending money).

## Proposed decision rule

1. Run the default matrix (≈ 5 minutes).
2. Keep only rows with **money-exact 3/3** and 0 errors.
3. Of those, pick the lowest median seconds; break ties on $/invoice.
4. Set it with `OCR_CLAUDE_MODEL` (+ `OCR_CLAUDE_EFFORT`) on the worker first —
   no deploy of code needed — and watch a week of real invoices
   (`needsHumanReview` rate, receiver corrections) before changing the code
   default in `claude-opus-4-8` → the winner.
5. A synthetic printed invoice is the easy case. Before switching, re-run with
   2–3 real (anonymised) phone photos added as `bench/invoice-N.*` + truth.

Expectation to verify, not a result: `claude-sonnet-5-5` at `low` is the most
likely winner (half the price of today, the strongest vision of the fast tier);
`claude-haiku-5-5` is worth it only if it stays money-exact on real photos.

## Timeouts (implemented)

- **Scan download** (`packages/ocr/src/providers/_anthropic.ts`, private bucket →
  base64): was unbounded; now an abort timer, default **20 s**
  (`OCR_FETCH_TIMEOUT_MS`), covering headers *and* body. A signed scan URL is
  valid 30 min, and a storage host that accepts the socket and never answers
  used to hold the OCR job until BullMQ's stall detection. Tested against a
  silent host and a stalled body.
- **The model call** keeps the SDK default (10 min, 2 retries). Don't lower it
  below ~3× the chosen model's max seconds from the benchmark.
