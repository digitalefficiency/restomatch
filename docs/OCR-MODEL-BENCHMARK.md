# OCR model choice — benchmark and decision (PR-OCR-2)

**Status:** the code default is `claude-opus-5-5` at effort `low` (PR-OCR-2). The
owner confirms or changes it with the benchmark below — run **by Rom, on his
Mac, with his own key**. No agent runs it: OPERATING.md forbids an agent
spending money, even with approval. Nothing in CI calls the API.

**Schedule:** Tue 3.11.2026 10:00 — Rom runs it · 14:00 — model decision.

## Why

Every OCR digit can become a ₪ "leak", and the read must finish inside Vercel's
function limits. Before PR-OCR-2 the reader was hard-coded to `claude-opus-4-8`
with no effort, SDK defaults of 10 min / 2 retries, and ≈ 100 s per read.

PR-OCR-2 makes a misread go to a person instead of the leak figure (arithmetic
gate, ח״פ check digit, typed reviewable failures). The benchmark now measures
that too: the **review rate** is how often the gate sends a read to a person.

## The benchmark (`packages/ocr`)

| Piece | What |
|---|---|
| `bench/invoice-1.html` → `invoice-1.png` | synthetic Hebrew tax invoice (6 lines, SKUs, 18% VAT, 9-digit allocation number, valid ח״פ). Re-render with `node packages/ocr/bench/render-fixture.mjs`. |
| `bench/invoice-1.truth.json` | its ground truth (unit-tested: internally consistent and passes the production gate) |
| `bench/truth.template.json` | template for a real document's truth file |
| `src/bench/score.ts` | grading: binary checks on supplier, number, date, allocation, every line field and the totals. **money-exact** = every line total plus subtotal/VAT/total right to the agora. |
| `src/bench/run.ts` | runs the **production** reader (`ClaudeVision`, same prompt, same defaults) and the **production** review decision (`runOcrPipeline` + gate) N times per model × effort. It prints median / p95 / max seconds, accuracy, money-exact runs, review rate, errors, and $ per document, per photo and per PDF. |

Default matrix: `claude-opus-5-5:low, claude-opus-5-5:medium, claude-sonnet-5-5:low`
(override with `BENCH_MATRIX`). Without `ANTHROPIC_API_KEY` it exits 2 and calls nothing.

### Real ציקטי documents (`BENCH_DIR`)

The synthetic invoice is the easy case: printed, flat, well lit. The decision
must rest on real documents.

1. Make a folder **outside the git checkout**, e.g. `~/restomatch-bench/tsikti`.
   The runner refuses a `BENCH_DIR` inside the repository. These are supplier
   documents: never commit them, never paste them into chat.
2. Put 5–6 real documents in it. Use phone photos as the receiver takes them
   (`.jpg`/`.png`; **not HEIC**, so set the iPhone camera to "Most Compatible").
   Add one or two PDFs if suppliers email them. Include at least one with a
   discount or a deposit (פיקדון) line, and one consolidated invoice (מרכזת) if
   you have one.
3. Next to each one, `<same name>.truth.json`, copied from
   `packages/ocr/bench/truth.template.json` and typed exactly as printed. A
   document without a truth file still counts for time, review rate, errors
   and cost, but not for accuracy or money-exact.

### The command (Rom, on the Mac)

```bash
cd ~/restomatch && git pull && pnpm install
# Key from the restomatch-bench workspace. Typed, not echoed, never saved in a file.
read -s ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
BENCH_DIR=~/restomatch-bench/tsikti BENCH_RUNS=2 \
  pnpm --filter @restomatch/ocr bench | tee ~/restomatch-bench/result-2026-11-03.md
unset ANTHROPIC_API_KEY
```

**Spend:** 3 configs × (1 synthetic + 6 real) docs × 2 runs = 42 calls, about
**$1.5–3.5** (estimates below). For a cheaper first look, `BENCH_RUNS=1` halves it.

## Decision rule

1. **Money-exact on every run** of every document that has a truth file, and
   **0 errors**. Drop every row that fails either.
2. Of the rows left, pick the **lowest p95**. **Target: p95 ≤ 45 s.**
3. If no Opus row meets the target, the owner may choose
   **`claude-sonnet-5-5:low`**, provided it passed step 1.
4. Ties: the lower review rate, then the lower $/doc.
5. Set it with `OCR_CLAUDE_MODEL` and `OCR_CLAUDE_EFFORT` on the production
   Vercel project (an owner action; no code deploy needed). Watch a week of
   real invoices (review rate, receiver corrections) before changing the code
   default.

If no row passes step 1, keep the default and send the result file to the
orchestrator. The misses column names the failing fields and the gate reasons.

## Runtime knobs (all optional)

| Env | Default | Meaning |
|---|---|---|
| `OCR_CLAUDE_MODEL` | `claude-opus-5-5` | model for invoice, PO and order-text reads |
| `OCR_CLAUDE_EFFORT` | `low` | `output_config.effort`; always sent, because Opus 5.5 would otherwise use `medium` |
| `OCR_CLAUDE_TIMEOUT_MS` | `90000` | per-request timeout; the client makes at most **1 retry**, so the worst case is about 2 × this. The calling function's max duration must allow that (owner/S13 check). |
| `OCR_FETCH_TIMEOUT_MS` | `20000` | download of a private scan before the call |

## Candidates (list prices per 1M tokens, input / output)

| Model | Price | Notes for this task |
|---|---|---|
| `claude-opus-5-5` | $4 / $20 | thinking always on; effort is the only control (default `medium`, we send `low`) |
| `claude-sonnet-5-5` | $2 / $10 | effort default `high`; `low` for extraction |

### Cost estimate per document (before measurement)

These are **estimates** until Rom's run replaces them with the measured `$/photo`
and `$/PDF` columns. Assumptions:
- system prompt ≈ 2,000 tokens (Hebrew is token-heavy);
- a phone photo ≈ 1,600–4,800 image tokens, depending on how far the API downscales it;
- a PDF page ≈ 1,500–3,000 tokens;
- the JSON answer ≈ 100 tokens per line plus 300, for 15 lines per photo and 30 for a 2-page PDF;
- thinking ≈ 300–1,500 output tokens at `low` and 1,500–4,000 at `medium`.

| Model : effort | per photo | per 2-page PDF | blended (80% photos / 20% PDFs) |
|---|---|---|---|
| `claude-opus-5-5:low` | $0.05–0.09 | $0.08–0.12 | ≈ $0.06–0.10 |
| `claude-opus-5-5:medium` | $0.08–0.14 | $0.11–0.17 | ≈ $0.09–0.15 |
| `claude-sonnet-5-5:low` | $0.03–0.045 | $0.04–0.06 | ≈ $0.03–0.05 |

At about 120 invoices a month for one restaurant, that is roughly **$7–12/month
on Opus low** and **$4–6 on Sonnet low**. A misread is caught by the gate,
not paid for twice: there is no automatic retry on a gate failure.
