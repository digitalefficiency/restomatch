# Baseline scan: a day-1 ₪ number from past invoices

**Who runs it:** Rom, on his own Mac, with the `restomatch-bench` Anthropic key. Agents never run it against Claude.
**What it does:** it reads a restaurant's supplier invoices from the last 1–3 months **from a local folder** and finds overcharges that are visible on the invoice itself. It then writes a CSV and a Hebrew report **to a local folder**.
**What it never does:** it never writes to a database, never uploads to storage, never touches the live tenant and never changes the dashboard leak hero. It also never calls Claude without `--i-approved-spend`.

> **Label:** ממצאים מחשבוניות בלבד (אוגוסט–אוקטובר) — ללא בדיקת קבלת סחורה
> These are findings from invoices alone. There is no order and no goods-receipt check. **Never compare this number to, or add it to, the dashboard leak number.**

Why the scan runs outside the tenant: uploading three months of history into the pilot tenant would turn every old invoice into an `UNORDERED_ARRIVAL` block, because those invoices have no orders. It would also use up the scan quota.

## 1. Folder layout

Keep the folder **outside the repository** (for example `~/pilot/tziki/invoices`). Never commit real invoices.

```
invoices/
  <supplier name>/            ← one folder per supplier; the folder name is the supplier
    2026-08-03.jpg            ← invoices: .pdf, .jpg, .jpeg, .png (any file names)
    2026-09-07.pdf
    contract.csv              ← optional: contract prices (one CSV per supplier)
    supplier.json             ← optional: {"zeroVat": true} for a 0%-VAT produce supplier
  <next supplier>/
    …
```

- **Every file in a supplier folder is treated as that supplier.** It doesn't matter what name is printed on the invoice: price creep is compared within the folder.
- Other files (`.txt`, `.xlsx`, …) are ignored.
- **`supplier.json` with `{"zeroVat": true}`:** for fresh fruit and vegetables, which carry 0% VAT. Any VAT billed by that supplier is counted as a finding.

### Contract CSV (optional)

These headers, in this order:

```csv
מק״ט,תיאור,יחידה,מחיר חוזה לפני מע״מ,בתוקף מתאריך,בתוקף עד
1234,חזה עוף טרי,ק"ג,48.50,01/08/2026,31/10/2026
```

- **Price** is per unit, before VAT, in shekels.
- **Dates** can be `DD/MM/YYYY` or `YYYY-MM-DD`. An empty "בתוקף עד" means the price is still valid.
- **Which row applies:** the one whose dates cover the invoice date. For an invoice with no readable date, only rows with no dates apply.
- **Matching:** when the invoice prints a מק״ט that is in the contract, the line is matched by it. Otherwise it is matched by description and unit. If the units differ (box vs ק"ג), there is no match and no finding.

## 2. Commands

Run these from the repository root on the Mac. Node 22 and `pnpm install` must be done first.

**Step 1: count and estimate.** This makes no Claude call and costs nothing.

```bash
pnpm --filter @restomatch/api baseline:scan -- --dir ~/pilot/tziki/invoices --estimate
```

It prints the number of suppliers, documents, photos and PDF pages, and the **estimated $**. The estimate assumes Opus 5.5 at low effort: about $0.055 per photo and $0.12 per 2-page PDF.

**Step 2: run, after approving the estimate.**

```bash
export ANTHROPIC_API_KEY=…            # the restomatch-bench key; never paste it into chat or git
export OCR_CLAUDE_MODEL=…             # the production OCR model id
export OCR_CLAUDE_EFFORT=low
pnpm --filter @restomatch/api baseline:scan -- \
  --dir ~/pilot/tziki/invoices --max-docs 250 --i-approved-spend
```

| Flag | Meaning |
|---|---|
| `--dir <folder>` | The invoices folder (required). Relative paths resolve from where you run the command. |
| `--estimate` | Count and price only; no Claude call. |
| `--max-docs N` | Hard cap, default **50**. If the folder holds more documents, **nothing** is sent. Set it to the count that `--estimate` printed. |
| `--i-approved-spend` | Required for any Claude call. Without it the script stops. |
| `--out <folder>` | Where to write the report. Default: next to `--dir`, named `<dir>-baseline`. |

Each document costs **one** Claude call: the same production extractor (`ClaudeVision`) reads the whole document, including every page of a PDF. A document that can't be read is listed in the report and not counted, and the run continues.

## 3. Reading the report

The output folder contains two files.

- **`baseline-report.md`**, the Hebrew RTL report. It opens with **the 10 biggest findings in ₪**, then a summary per supplier, then every finding per supplier, notes (not counted), unread files and the method.
- **`baseline-findings.csv`**, one row per finding. It opens in Excel with Hebrew intact. The columns include `amount_agorot`, which is the exact integer, and `amount_ils`, which is the display value.

Every finding names the **file**, the **pages** and the **line**:

- **pages:** `1` for a photo, `1–N` for an N-page PDF. The extractor reads a PDF as one document, so a line's exact page isn't known.
- **line:** the position of the line in the invoice's line table, in reading order. On a multi-page PDF, count down the rows across the pages.
- **No line number:** the finding is about the whole invoice (VAT or total).

**Before showing a number to the owner**, check the top-10 findings one by one against the paper invoice. An OCR misread looks exactly like an overcharge. Drop any finding the paper does not confirm, and lower the total by the same amount.

### What is counted (overcharges only)

| Finding | Meaning |
|---|---|
| מע״מ מעל 18% | The VAT billed is above 18% of the subtotal. |
| מע״מ על ספק פטור (0%) | Any VAT billed by a supplier marked `zeroVat`. |
| שורה: סכום מעל מחיר × כמות | The printed line total is above unit price × quantity. |
| סה״כ מעל סכום ביניים + מע״מ | The printed total is above subtotal + VAT. |
| מחיר מעל החוזה | The unit price is above the contract price valid on the invoice date (amount = difference × quantity). |
| עליית מחיר אצל אותו ספק | The same item (same description and unit) costs more than 2% above the first price this supplier billed in the sample. It isn't counted on lines the contract covers, because the contract is the reference there. |

**Not counted, shown as notes:**
- errors in the restaurant's favour;
- a possible duplicate invoice (same number twice);
- the same file twice;
- a subtotal above the sum of the lines (usually a delivery fee);
- any gap of ₪1 or less.

**Money:** everything is computed in integer agorot, using the same pure analysis as the public leak check (`packages/api/src/leakCheck/analyze.ts`). Every total equals the sum of its rows exactly.

## 4. After the run

- Keep the invoices and the output **off git and off chat**. They are customer data.
- Share only the checked top findings and the label above with the owner.
- Delete the local copies when the pilot no longer needs them.
