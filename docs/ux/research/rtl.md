# RTL / Hebrew & Accessibility Excellence — research for RestoMatch

**Author role:** senior UX researcher (RTL, Hebrew typography, a11y) · **Date:** 2026-10-25
**Scope:** `apps/web` (Next.js 15, Hebrew-first, `<html dir>` per locale) — owner, manager, bookkeeper, chef, receiver (phone at the back door).
**Output:** 23 principles, 13 patterns, reference tables, an automation checklist, and two rendered "bidi labs" that prove the bugs.

---

## 0. Method and source access (read first)

- **WebSearch worked; WebFetch and curl did not.** The egress proxy refused `www.w3.org`, `m2.material.io`, `doc.wikimedia.org` and `firefox-source-docs.mozilla.org` (`connect_rejected`). I could not open the primary pages. Rules cited to them come from search-result excerpts of those exact pages (URLs in §9). Items marked **[K]** come from my own knowledge of published design systems and were not re-checked live this session.
- **Everything about RestoMatch was checked in the repo** (`/home/user/restomatch`, file:line refs below), and **every bidi claim was rendered in headless Chromium 1194 with the app's own self-hosted Heebo fonts**:
  - Lab 1 (22 strings): `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/research/bidi-lab/bidi-lab.png` (source `…/bidi-lab/bidi-lab.html`)
  - Lab 2 (column alignment, Heebo figures, hero ₪): `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/research/bidi-lab/bidi-lab2.png`
  - Generators: `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/research/scripts/build-lab.mjs`, `build-lab2.mjs`, `zoom.mjs` (zoom dumps each line's characters in on-screen left-to-right order, so results don't depend on eyeballing).
- **he-IL Intl output was checked in Node 22.22 (ICU) down to code points** (§6).
- Contrast ratios were computed with the WCAG relative-luminance formula from the real tokens in `apps/web/app/globals.css`.

---

## 1. Executive summary: the 12 findings that matter most

RestoMatch is already more RTL-aware than most Israeli SaaS. It uses logical properties widely (`ms-/me-/ps-/pe-/text-start/text-end`), has 72 `<bdi>`, `originalProps()` for tenant data, `rtl:origin-right` on the route progress bar, a skip link, a `pointer: coarse` 44px floor and AA text tokens. The remaining problems are **systematic, not sloppy**: several reasonable local fixes contradict each other. All twelve below were checked in code or in the lab.

| # | Finding (verified) | Where | Severity |
|---|---|---|---|
| F1 | **Wrapping a he-IL ₪ string in `dir="ltr"` moves ₪ to the right of the number and drops the space**: it renders `1,234₪` where it should show `₪ 1,234` (lab 1 #2). | ~60 `<bdi dir="ltr">`, many around `formatIls`/`ils()`/`money()`: `inventory/count/count-screen.tsx:341,409,546`, `inventory/period-card.tsx:117,174,235,266`, `receiving/[poId]/dock-slip.tsx:161,244`, `invoices/[invoiceId]/correction-client.tsx:350,357`, `orders/new/wizard.tsx:557`, `orders/[poId]/supplier-confirm-card.tsx:85`, `recipes/recipes-home.tsx:610`, `s/[token]/answer-form.tsx:135` | **High.** It garbles the money number on the receiver's dock slip and in the supplier portal. |
| F2 | **Signs glued onto ₪ strings land in the wrong place.** `"+" + formatIls()` in RTL renders `1,234+` (lab 1 #5a). Inside `bdi dir=ltr` it renders `+ 1,234₪` (#5b). `signDisplay:'exceptZero'` renders it correctly (#5c). | `recipes/recipe-ui.ts:21-25` (`ilsDelta`), `recipes/price-alert.tsx:73`, `contracts/over-contract.tsx:84,172`, `inventory/period-card.tsx:220,225` | **High.** T2 "over contract" amounts read wrong. |
| F3 | **One feature shows the same price change in two opposite visual orders.** `recipes/he.ts:116,129,130` and `contracts/he.ts:173` use RTL `{before} ← {after}`. `recipes-home.tsx:198` and `price-alert.tsx:17` force LTR `{from} → {to}`. The old price appears on opposite sides depending on the card (lab 1 #12 vs #13). | recipes, contracts, ask | Medium-high |
| F4 | **Charts follow two opposite time-axis rules.** `BreakdownChart.tsx:181` mirrors in RTL ("time runs right → left"). `Sparkline.tsx` and the recipes `Arrow` keep time left → right. | leaks/breakdown, suppliers, recipes | Medium |
| F5 | **Hebrew is letter-spaced in 72 places.** `tracking-wide/wider/widest/[0.xem]` without an `ltr:` gate is applied to Hebrew eyebrows and table headers: `dashboard/page.tsx:400` (leak-hero eyebrow), `orders/orders-table.tsx:67`, `leaks/page.tsx:183`, `catalog/browser.tsx:358`, `nav.tsx:364`, `approvals/list.tsx:289`, and more. | everywhere | Medium (polish) |
| F6 | **Numeric columns are aligned so place values don't line up.** 78 numeric cells use `text-end`, which in RTL means physically left. With LTR digits the ones and decimal digits no longer line up (lab 2 §A). | `recipes/recipes-home.tsx:272-277`, `catalog/browser.tsx:514`, `(marketing)/leak-check/result/page.tsx:155,168`, … | Medium-high for a money product |
| F7 | **The focus ring fails 3:1.** `focus-visible:ring-primary/60` measures **2.73:1 on `bg` and 2.81:1 on `surface`**. The ghost button's `ring-line` measures **1.39:1**. WCAG 1.4.11 does not round, so 2.99 fails. | `Button.tsx` base, `Input.tsx` fieldBase, `nav.tsx:165` `focusRing`, 86 `ring-primary/60`, 21 `ring-line` | **High (a11y conformance)** |
| F8 | **Nothing keeps a focused element clear of the sticky chrome (WCAG 2.4.11).** There are 0 `scroll-padding` rules, while the page has a sticky two-row header, a fixed bottom bar and the cookie banner. | `dashboard/layout.tsx` header, `nav.tsx:421` bottom bar | High on mobile |
| F9 | **The product has no accessibility statement (הצהרת נגישות).** No route or message mentions נגישות. Israeli service-accessibility regulations require one. | marketing footer, settings | **High (legal exposure in Israel)** |
| F10 | **Hebrew text is too small in places.** 45 × `text-[10px]` and 52 × `text-[11px]`, including the mobile bottom-bar labels (`nav.tsx:432,450`, 11px and truncated) and the nav badge (`nav.tsx:159`, 10px). | mobile nav, hints, dock slip | Medium |
| F11 | **The hero ₪ number mixes two fonts.** Digits use JetBrains Mono, but that font's subset has no U+20AA, so ₪ falls back to Heebo at full size. The mono comma also adds a wide gap (`48 , 270`). Heebo's own figures are already tabular: 1111 and 8888 both measure 71.9px (lab 2 §B–C). | `dashboard/page.tsx:410` | Medium (T1 hero polish) |
| F12 | **Icon mirroring is done three different ways, and one icon is wrong.** The idioms are `ArrowLeft + ltr:-scale-x-100`, `ArrowRight + fwd`, and `ChevronRight + rtl:-scale-x-100`. `Play` in `invoices/[invoiceId]/correction-client.tsx:251` is flipped in **LTR** (so it points left in English) and lacks `aria-hidden`. `Undo2` is never mirrored. `ArrowUpRight` is mirrored in 2 of 3 uses. | icons | Low-medium |

Also verified and worth fixing: `<html>` sets `dir`/`lang` correctly. **`role="alert"` appears 40 times**, including banners that are present on page load (`recipes/price-alert.tsx:53`), so screen readers interrupt the user when the page loads. There are **27 × `type="number"`** fields for money or quantity (a scroll wheel changes the value, and the decimal comma is rejected). The he-IL compact currency format renders **`₪1.2M`** with a Latin M and the ₪ glued in front (lab 1 #14), so it must never be used.

---

## 2. What the lab proves (on-screen order, left → right as rendered by Chromium + Heebo)

Hebrew letters show reversed below because the dump lists characters in on-screen left-to-right order. `·` is NBSP.

| Case | On screen (L→R) | Verdict |
|---|---|---|
| 1 he-IL ₪ in RTL paragraph | `₪·1,234 :שדוחה הפילדה` | ✅ ₪ sits left of the digits with a NBSP gap. Read right to left: "1,234 ₪". |
| 2 same string in `dir="ltr"` | `·1,234₪` | ❌ ₪ is glued on the right and the gap moves to the outer edge (F1) |
| 3 same string in `<bdi>` (no dir) | `₪·1,234` | ✅ isolated without forcing a direction |
| 4 negative via Intl | `₪·-1,234` | ✅ Intl inserts LRM before the minus |
| 5a `"+" + str` in RTL | `₪·1,234+` | ❌ the plus lands on the wrong side |
| 5b `"+" + str` in `bdi dir=ltr` (price-alert) | `+·1,234₪` | ❌ two errors at once |
| 5c `signDisplay:'exceptZero'` | `₪·+1,234` | ✅ |
| 6 range `10–12 ₪` in RTL | `₪ 12–10` | ⚠️ the algorithm reverses the visual order. Avoid symbol ranges for money. |
| 7 `INV-2026/045` mid-sentence | intact | ✅ |
| 8 `Coca-Cola Ltd.` at end of sentence | `.Coca-Cola Ltd` | ❌ the period jumps to the far side |
| 8b same in `<bdi>` | `Coca-Cola Ltd.` | ✅ |
| 11 `המשך לאישור →` | arrow points right, back into the text | ❌ |
| 11b `המשך לאישור ←` | arrow points in the reading direction | ✅ |
| 12 contracts `{from} ← {to}` | `₪ 14.50 ← ₪ 12.00` | ✅ RTL order |
| 13 recipes `bdi dir=ltr {from} → {to}` | `₪ 12.00 → ₪ 14.50` | ⚠️ correct in isolation, but the opposite of #12 (F3) |
| 14 he-IL `notation:'compact'` | `₪1.2M` | ❌ Latin "M", prefix ₪, no space |
| 16 `dir=auto` value that starts with Latin | turns the whole block LTR | ⚠️ alignment and truncation flip |
| 17 `פריט SKU-88 × 2 ק״ג` | `ג״ק SKU-88 × 2 טירפ` | ❌ the quantity "2" is absorbed into the LTR run and pulled away from its unit ק״ג |
| Lab 2 §A, numeric column `text-align:left` in RTL | ₪ signs line up, digits ragged | ❌ place values misaligned (F6) |
| Lab 2 §A, numeric column `text-align:right` in RTL | ones and decimal digits aligned | ✅ |

---

## 3. Principles (23)

Each principle has the **rule** (checkable), its **source**, the **RestoMatch evidence or target**, and a **check**.

### A. Direction and mirroring

**P1 — Set direction once at the root, and lay out only with logical properties.**
- *Rule:* `<html lang dir>` is the only global direction source. No `direction:` in CSS. In `apps/web/app/**`, zero `ml-/mr-/pl-/pr-/left-N/right-N/text-left/text-right/rounded-l*/rounded-r*/border-l/border-r` outside an allowlist (paper-invoice replicas, symmetric decorations, and the numeric-alignment exception in P9).
- *Source:* W3C i18n tutorial "Creating HTML pages in RTL scripts": put `dir` on `<html>`; "avoid using CSS or Unicode control codes for managing direction where you can use markup". Apple archive, "Supporting RTL": leading/trailing (not left/right) layout makes UI mirror automatically.
- *RestoMatch:* the root is already correct (`app/layout.tsx`, comment in `globals.css:"A CSS direction: rtl here overrode dir=ltr"`). Remaining physical classes: `text-right` ×9 (`showcase/dashboard/_components/InvoicePaperShared.tsx`, a paper replica, so allowlist it), `pl-N` ×12, `mr-N` ×2, `left-/right-N` ×8 (`HeroVideo.tsx:107` `left-3` must become `start-3`).
- *Check:* `grep -rE '\b(ml|mr|pl|pr)-[0-9]|\btext-(left|right)\b|\b(left|right)-[0-9]' apps/web/app apps/web/lib` returns only allowlisted files.

**P2 — Mirror only icons that carry direction, through one icon primitive.**
- *Rule:* mirror back/forward arrows, chevrons in rows and breadcrumbs, "send", sign-in/sign-out, undo/redo, list and indent icons, and text-alignment icons. **Never** mirror: check marks, X, plus/minus, media play/pause, clocks, refresh circles, search (magnifier), logos, icons containing letters or digits, the help "?" (Hebrew is an explicit exception where "?" is *not* flipped), or chart-trend icons (see P8).
- *Source:* Material M2 bidirectionality (back/forward mirror; media controls, numbers and untranslated text are not mirrored). Firefox RTL guidelines (do not mirror: checkmarks, video/audio controls, product logos, symmetric icons such as X and the star, icons with text or numbers; mirror: back/forward, progress, twisties). Wikimedia Codex icon contributor docs (auto-flip only when the RTL icon is a perfect mirror; `shouldFlipExceptions`: "?" flips in most RTL languages **but not in Hebrew and Yiddish**). Angular CDK `mat-icon-rtl-mirror` (mirroring is opt-in per icon).
- *RestoMatch:* three idioms are in use today (F12). `Play` in `correction-client.tsx:251` points left in English. `Undo2` (`chain/page.tsx:588`) is not mirrored. Create `lib/components/DirIcon.tsx`: `<DirIcon kind="forward|back|next|prev|send|logout|undo|redo" />`, which applies `rtl:-scale-x-100` internally. Lint-ban direct `ArrowLeft/ArrowRight/ChevronLeft/ChevronRight` imports outside that file.
- *Check:* `grep -rE "<(ArrowLeft|ArrowRight|ChevronLeft|ChevronRight)\b" apps/web --include=*.tsx | grep -v DirIcon` returns 0.

**P3 — Never hard-code "→" in Hebrew copy. In RTL, forward is "←".**
- *Rule:* Unicode arrows are `Bidi_Mirrored=No` and do not flip, so a `→` in a Hebrew CTA points back into the text. In `he.ts` strings, "next / continue / see more" uses `←` (Israeli convention "לכל הפרטים ←"), or better an inline `<DirIcon kind="forward">` that is `aria-hidden`.
- *Source:* Unicode mailing list (arrows are consistently non-mirrored by design), the Discourse RTL arrow bug ("there is no bidi-flipping arrow character"), lab 1 #11/#11b.
- *RestoMatch:* `he.ts` strings currently use `←` correctly (`catalog/he.ts:128`, `recipes/he.ts:116,129,130`, `contracts/he.ts:173`). Components bypass that with `→` (`recipes-home.tsx:198`, `price-alert.tsx:17`).
- *Check:* `grep -rn "→" apps/web/lib/i18n/messages/**/he.ts` (code comments excluded) returns 0, and no JSX text node in a Hebrew render contains `→`.

**P4 — Isolate every interpolated value whose direction may differ from the sentence.**
- *Rule:* supplier names, product names (OCR), SKUs, invoice numbers, allocation numbers, emails, URLs and phone numbers are rendered inside `<bdi>`, or with `originalProps()` on an inline element. Never concatenate raw values next to punctuation or numbers in a `t()` string.
- *Source:* W3C "Inline markup and bidirectional text in HTML": wrap opposite-direction phrases "tightly in markup that sets their base direction", and use `bdi` or `dir=auto` for text "inserted into the page… when the base direction is unknown". Lab 1 #8 vs #8b, #17.
- *RestoMatch:* suppliers list and detail (`Coca-Cola Ltd.` style names), catalog mapping (`"{raw}" ← {product}`), invoice detail, scans, receiving lines (`SKU-88 × 2 ק״ג` splits quantity from unit), ask/AI answers (`priceItem` mixes product, supplier, two ₪ values and a %).
- *Check:* the bidi-torture fixture tenant (P23) renders the end-of-sentence period, SKU+quantity, and parentheses correctly in the screenshots.

**P5 — Isolate ₪ strings; never force `dir="ltr"` around a he-IL currency string.**
- *Rule:* he-IL `formatIls` output already contains RLM marks (§6), and they only work in an RTL or auto context. Wrap money in a plain `<bdi>` (auto), or in nothing. Use `dir="ltr"` only for pure-ASCII tokens: email, phone, SKU, IBAN, URL, invoice number.
- *Source:* lab 1 #1–#3. The LibreOffice ₪ bidi bug (fdo#46807) shows the same class of error: a mark was needed to keep ₪ on the correct side.
- *RestoMatch:* F1 sites (~60 `<bdi dir="ltr">`). Fix with one `<Money value opts>` component that renders `<bdi className="tabular-nums">{formatIls(...)}</bdi>`.
- *Check:* `grep -rnE '<bdi dir="ltr"[^>]*>\s*\{?(formatIls|ils|money|ilsDelta)' apps/web` returns 0. A Playwright test asserts that in `he`, the ₪ glyph's `getBoundingClientRect().right` is less than the first digit's `left`.

**P6 — Signs (+ / − / ±) come from Intl, never from string concatenation.**
- *Rule:* use `formatIls(v, { signDisplay: 'exceptZero' })`. In he-IL it emits `RLM LRM + digits NBSP RLM ₪` (verified). Ban `` `${sign}${ils(...)}` `` and `+{formatIls(...)}`.
- *Source:* lab 1 #5a/#5b/#5c, Node code-point dump (§6).
- *RestoMatch:* `recipe-ui.ts:21-25` `ilsDelta`, `price-alert.tsx:73`, `over-contract.tsx:84,172`, `period-card.tsx:220,225`. **Governance:** `formatIls()` is on the AGENTS.md immutability list. Adding `signDisplay` to its options is an additive change that only a human PR can make (owner: `money-format-marshal`). This research proposes it and does not edit it.
- *Check:* `grep -rnE "['\`]\+['\`]?\s*\+?\s*\$?\{?(formatIls|ils)\(|\+\{(formatIls|ils)\(" apps/web` returns 0.

**P7 — There is one ₪ display spec, and compact notation is banned.**
- *Rule:* in Hebrew, ₪ appears to the **left** of the digits with one NBSP gap: logical `1,234 ₪`, read right to left. In English the format is `₪1,234` with no gap. Headline and T1/T2 amounts have **0 decimals**. Line-level tables (unit price, line total, VAT) have **exactly 2**. Never mix decimal counts in one column. Thousands separator is `,`, decimal is `.`. Never use `notation:'compact'` for ₪ (it gives `₪1.2M`). For large numbers write `1.2 מיליון ₪` with a dedicated helper, or the full digits.
- *Source:* Node he-IL ICU output (§6), lab 1 #14, and the existing `money.ts` doc comment (0 vs 2 decimal drift).
- *RestoMatch:* dashboard hero, KpiCard, chain view (multi-branch totals are the likely place someone reaches for compact), monthly report, OG images (`app/og`).
- *Check:* `grep -rn "notation: *'compact'" apps/web` returns 0 for currency, and each money column has a single `maximumFractionDigits`.

### B. Numbers, sequences, tables, charts

**P8 — Charts follow one time-axis rule: time runs LTR, and only the chrome mirrors.**
- *Rule:* in every chart and sparkline, time runs **left = oldest → right = newest**. Only the chrome is mirrored: title and legend are right-aligned, legend order starts on the right, tooltips anchor to the start side. Put the value axis and the "current value" label on the **right** edge. In RTL that is the reading start, so the newest ₪ is the first thing the eye lands on. Trend icons (`TrendingUp`, `ArrowUpRight` meaning "price up") are not mirrored.
- *Source:* Apple archive "Supporting RTL": video timelines, clocks and graphs are on the do-not-flip list, and x/y axes keep their orientation. Material M2: charts and graphs are not mirrored. Material M1 says time is depicted RTL in RTL languages, so the sources conflict. **This is a decision; we recommend LTR** because the digits on the axis are LTR, Sparkline and recipes already use LTR, and two systems (Apple, M2) prescribe it. Israeli statistical publishing (CBS, Bank of Israel) uses LTR time axes **[K]**.
- *RestoMatch:* remove `rtl:-scale-x-100` from `BreakdownChart.tsx:181` (and the counter-flip on its `<text>`), and move the y-labels and the last-point label to the right. Keep `Sparkline.tsx`. Pick a rule for the `LeakHeatmap.tsx:94` legend: it is a value scale, not time, so it may mirror, but its min/max labels must follow it.
- *Check:* on `/dashboard/leaks/breakdown` in `he`, the x position of the last month's point is greater than the first month's.

**P9 — Align numeric columns on place value: physically right in both directions.**
- *Rule:* numeric and money cells, and their header, use `text-align: right` in both LTR and RTL, with `tabular-nums` and a fixed fraction length. This is the one deliberate exception to P1. Implement it as a `.num` / `<NumCell>` utility (`ltr:text-end rtl:text-start`) so nobody "fixes" it back to `text-end`. In dense tables, put "₪" in the column header (`סכום (₪)`) and render bare numbers. That halves the visual noise and removes ragged ₪ glyphs.
- *Source:* lab 2 §A (rendered). Universal tabular-figure practice: place values align only when the units digit aligns **[K]**.
- *RestoMatch:* 78 numeric `text-end` cells (F6). Priority screens: approvals/pay-run (₪ to pay), invoice correction lines, recipes table, catalog prices, suppliers ledger, leak-check result.
- *Check:* in a `he` screenshot, each column's decimal points share one x coordinate (±1px).

**P10 — Progress, steppers and sliders fill in the reading direction.**
- *Rule:* progress bars grow from the right in RTL. Step 1 of a wizard is on the right. In RTL, "back" sits on the right (start) and "next / continue" on the left (end), and the start/end glyphs swap.
- *Source:* Apple HIG RTL (flip sliders and progress indicators, swap start/end glyphs; reverse numerals that show progress or counting order, but never the digit glyphs). Material M2 (progress follows reading direction). Firefox RTL (progress bars mirror).
- *RestoMatch:* `RouteProgress.tsx` is already correct (`origin-left rtl:origin-right`). Audit `orders/new/wizard.tsx`, `catalog/import/wizard.tsx`, `contracts/import/wizard.tsx`, `receiving/[poId]/wizard.tsx` step indicators, the inventory count progress (`count-screen.tsx:421`), and `FlowBar.tsx`. The `.rm-draw` connector already has an RTL origin (`globals.css`).
- *Check:* in `he`, step 1's x position is greater than step 3's. A partially filled progress bar's filled part touches the right edge.

**P11 — Sequences and ranges have exactly one component and one visual order.**
- *Rule:* `<PriceMove from to delta?>` renders the old value at the **start**, `←` (a mirrored `DirIcon`), then the new value at the **end** (RTL in Hebrew, LTR in English), followed by a delta chip such as `+2.50 ₪ (+20.8%)` built with `signDisplay`. Money ranges are written in words (`בין 10 ל־12 ₪`), never as `10–12 ₪`.
- *Source:* Material M1/M2 ("icons that depict a sequence of events follow the reading direction"). Lab 1 #6, #12, #13.
- *RestoMatch:* replace both local `Arrow` components (`recipes-home.tsx:198`, `price-alert.tsx:17`), the `overview-card.tsx:82` `→`, and the string templates `priceMove`, `driverProduct`, `rowLine`, `priceItem`.
- *Check:* across recipes, contracts and ask, the old price sits on the same side.

### C. Hebrew typography

**P12 — No letter-spacing and no "uppercase emphasis" on Hebrew. Emphasize with weight, size and colour.**
- *Rule:* `tracking-*` greater than 0 and `uppercase` only behind `ltr:` or `[lang=en]`. Hebrew has no case, so `uppercase` does nothing, while tracking breaks the tight clusters and word shapes that the final letters (ך ם ן ף ץ) create. A Hebrew eyebrow is `text-xs`→`text-sm`, `font-semibold`, `text-muted`, `tracking-normal`.
- *Source:* Hebrew-RTL best-practice catalogs ("keep letter-spacing normal"). The repo already does this correctly in marketing (`MarketingShell.tsx:148` uses `ltr:tracking-[0.18em]`; `detail-sections.tsx:48` uses `rtl:tracking-normal`).
- *RestoMatch:* 72 ungated sites (F5), starting with the leak-hero eyebrow `dashboard/page.tsx:400`, the table headers in orders, leaks, catalog and invoices, and the nav group labels.
- *Check:* `grep -rnE "(^|[ \"'\`])tracking-(wide|wider|widest|\[[0-9.]+em\])" apps/web --include=*.tsx` returns 0 (the `ltr:` prefixed forms are allowed).

**P13 — Set a Hebrew type-size floor and line heights that fit Heebo's metrics.**
- *Rule:* nothing below **12px**. Meta, captions and table cells **≥ 13–14px**. Body and **every input ≥ 16px** (iOS Safari auto-zooms on focus below 16px **[K]**). Body line-height **1.5–1.6** (WCAG 1.4.12 must survive 1.5× line height and 0.12em letter-spacing without clipping). Display numbers 1.05–1.15. Never `leading-none` together with `overflow:hidden` or `truncate` on Hebrew: Heebo's content box is **1.47em** (ascent 104.9% + descent 42.14%, taken from the repo's own `Heebo Fallback` overrides in `globals.css`), so the ascender of ל and the descenders of ק ך ן ף ץ get clipped below that.
- *Source:* repo font metrics. WCAG 1.4.12 Text Spacing **[K]**. Hebrew practice cites body ~1.6–1.7.
- *RestoMatch:* `text-[10px]` ×45, `text-[11px]` ×52. Fix first: bottom-bar labels `nav.tsx:432,450` (11px → 12px, and remove `truncate` by writing ≤7-character labels: בית · חריגות · אישורים · קבלה · עוד), the nav badge `nav.tsx:159` (10px → 11px bold minimum inside a 20px pill), the KPI hint `dashboard/page.tsx:556`, and the dock slip `dock-slip.tsx:270`.
- *Check:* `grep -rnE "text-\[(8|9|10|11)px\]" apps/web --include=*.tsx` returns 0 in `app/dashboard` and `app/s`.

**P14 — Money numbers are set in Heebo, and ₪ is a subordinate glyph.**
- *Rule:* drop JetBrains Mono for ₪ amounts. Heebo's default figures are already tabular (measured: `1111` and `8888` are both 71.9px at 32px). On T1/T2 hero numbers: Heebo **800**, `tabular-nums`, the ₪ glyph in its own span at **0.55em**, weight **600**, `text-muted`, with a **0.12em** gap. Hide decimals at headline size. Keep mono only for machine tokens (SKU, invoice number, allocation number, email).
- *Source:* lab 2 §B–C. Fintech hero-balance convention (Revolut, One Zero, Bit balance headers: large figure, smaller currency mark) **[K]**.
- *RestoMatch:* `dashboard/page.tsx:410` (hero), `KpiCard.tsx`, `StatCard.tsx`, the chain totals, `LeakHeatmap.tsx:78`. Today ₪ renders in Heebo at full 56–60px next to mono digits, with a ~0.6em mono comma gap. The split-span version must keep one accessible string: `aria-label="48,270 ₪"` on the wrapper, with children `aria-hidden`, so screen readers hear one number.
- *Check:* the hero shows no comma gap, and ₪ height is ≤ 0.6× the digit cap height.

**P15 — Use Hebrew punctuation correctly in UI copy.**
- *Rule:* abbreviations use gershayim **״ (U+05F4)** and geresh **׳ (U+05F3)**, not ASCII `"`/`'`: ק״ג, מע״מ, ח״פ, ע״מ, בע״מ, ש״ח, יום א׳. Number prefixes use the maqaf, `ב־25.10` and `מ־12 ₪` (U+05BE, or the hyphen-minus the codebase already uses, but one of them consistently). Search and matching normalise both forms. In receiver-critical spots, abbreviations get a spoken alternative (`<span aria-hidden>ק״ג</span><span class="sr-only">קילוגרם</span>`).
- *Source:* he-IL Intl itself emits U+05F4 (`2.5 ק״ג`) and U+05F3 (`יום א׳`), verified. The repo mixes ASCII `ק"ג`-style quotes in places **[K: verify per string]**.
- *RestoMatch:* `UnitText.tsx`, receiving lines, dock slip, invoice VAT labels.
- *Check:* `grep -rnP '[\x{05D0}-\x{05EA}]"[\x{05D0}-\x{05EA}]' apps/web/lib/i18n/messages` returns 0.

### D. Formatting conventions (dates, weeks, input)

**P16 — Use Israeli date, time and week conventions.**
- *Rule:* short date `25.10.2026` (he-IL Intl output, dot separators). Medium date `25 באוק׳ 2026`. Long date `יום ראשון, 25 באוקטובר`. **24-hour** time `14:30`. **The week starts on Sunday** and the **weekend is Friday–Saturday** (Intl `weekInfo`: `firstDay:7, weekend:[5,6]`, verified). Relative dates use Intl's Hebrew dual forms: `אתמול`, `שלשום`, `לפני שבועיים`, `מחרתיים` (verified). Never write `לפני 2 ימים`. All dates are in `Asia/Jerusalem` (already the default in `lib/i18n/format.ts`).
- *Source:* Node ICU output (§6).
- *RestoMatch:* approvals/pay-run due dates, delivery calendars (orders, receiving), digest, the inventory count period, export filenames (use ISO `2026-10-25` in machine contexts only).
- *Check:* any date picker's first column is א׳. No `MM/DD` appears anywhere.

**P17 — Number entry is LTR, right-aligned, and forgiving.**
- *Rule:* money and quantity fields use `type="text" inputMode="decimal"` (not `type="number"`: a scroll wheel changes values and the locale decimal comma is rejected), plus `dir="ltr"`, `rtl:text-right`, `autocomplete="off"`, and font ≥ 16px. Accept `7,5` and `7.5` (the parser already exists in `s/[token]/answer-form.tsx:24`). Format with thousands separators **on blur, not while typing**. The unit or ₪ adornment sits outside the value, at the field's visual **left** (end) in RTL. Error text is in Hebrew under the field and linked via `aria-describedby`.
- *Source:* lab conventions. ILS currency-input practice of formatting on commit rather than mid-typing (Bubble ILS input plugin). Bit/PayBox amount screens: large LTR amount, ₪ mark, numeric keypad **[K]**.
- *RestoMatch:* 27 `type="number"`, including `catalog/browser.tsx:412,517,689`, `recipes/recipe-editor.tsx:477`, `recipes-home.tsx:114` and `RoiCalculator.tsx:45`. The inventory count (`count-screen.tsx:362`) already uses `inputMode="decimal"`; make it the model.
- *Check:* `grep -rn 'type="number"' apps/web --include=*.tsx` returns 0 for money and quantity fields.

**P18 — Free-text fields take `dir="auto"`; displayed data is isolated inline, never with `dir=auto` on block or flex items.**
- *Rule:* inputs and textareas where users may type English (supplier name, product search, notes, CSV paste) get `dir="auto"` **plus** a fixed alignment (`rtl:text-right ltr:text-left`) so the caret side doesn't jump as the first strong character changes. When displaying data, put `dir=auto` or `<bdi>` on an **inline** element inside a block whose direction stays the page's. With `dir=auto` on a `<p>`, `<td>` or flex item, a value that starts with Latin ("Heinz קטשופ") turns the whole block LTR, which moves the alignment and the ellipsis to the wrong side (lab 1 #16).
- *Source:* W3C ("dir=auto for form fields… or text inserted into the page"; the first strong character decides, with "corner cases where this may not give the desired outcome").
- *RestoMatch:* risky block-level uses at `exports/accounting-files.tsx:84` (`<p dir="auto">`) and `catalog/import-history.tsx:54` (`flex-1 truncate` span, which is blockified as a flex item). `originalProps()` is good on inline spans; document that it is "inline only".
- *Check:* a lint rule finds `dir="auto"` co-located with `flex-1|block|truncate|<p|<td|<div`.

### E. Accessibility (WCAG 2.2 AA and Israeli law)

**P19 — Target WCAG 2.2 AA as the bar, and satisfy the Israeli legal layer explicitly.**
- *Rule:* conform to **WCAG 2.2 AA**. It is a superset of whichever WCAG base IS 5568 is read against: sources conflict between 2.0 and 2.1 for the current edition, and there is no primary text available. Publish a **הצהרת נגישות** reachable from every page footer and from Settings. It must state the standard and level (ת״י 5568, AA, plus WCAG 2.2 AA), the date of the last audit, the tools and screen readers tested, known gaps, and the name, phone and email of the accessibility coordinator, with a response SLA. **Do not install an accessibility overlay widget** (they are ubiquitous on Israeli sites). They don't fix the source, and conformance is judged on the underlying page **[K]**.
- *Source:* Equal Rights for Persons with Disabilities (Service Accessibility Adjustments) Regulations 5773-2013, reg. 35 (cited in Israeli accessibility statements, e.g. SII, Kol Zchut, TAU). IS 5568 summaries (clym.io, user-a.co.il). Typical statement contents: level, test method (e.g. NVDA), known gaps, contact, last-updated date (TAU, IDI statements). Statutory damages without proof of harm are commonly cited for violations **[K: confirm amount with counsel]**.
- *RestoMatch:* F9. Add `app/(marketing)/accessibility/page.tsx` with he/en messages, link it in the marketing footer, the dashboard settings and the `/s/[token]` supplier portal footer.
- *Check:* `/accessibility` returns 200 in `he` and appears in `sitemap.ts`.

**P20 — Focus indicators reach ≥3:1 and are never hidden by sticky chrome.**
- *Rule:* one `focusRing` token: **2px solid `primary` (#066B4A: 6.54:1 on surface, 6.13:1 on bg, 5.83:1 on surface-2) plus a 2px offset** on all interactive elements. Never use an opacity-reduced ring: `ring-primary/60` is 2.73–2.81:1. Never use `ring-line` (1.39:1). Add `html { scroll-padding-top: var(--rm-header-h); scroll-padding-bottom: calc(var(--rm-bottomnav-h) + var(--consent-h, 0px) + 8px) }`, with the header height measured into a CSS variable by a `ResizeObserver` (the header is 1 row below lg and 2 rows at lg+).
- *Source:* WCAG 2.2 Understanding 1.4.11 (3:1 against adjacent colours; "computed ratios are not to be rounded… 2.999:1 would not meet"). Understanding 2.4.11 Focus Not Obscured (Minimum), AA: focus may not be entirely hidden by author-created content. Scroll-padding/scroll-margin is the recommended remedy for sticky headers. 2.4.13 Focus Appearance (AAA) is the aspiration: a 2px perimeter and 3:1 change.
- *RestoMatch:* F7 and F8. Central fixes go in `Button.tsx`, `Input.tsx` and `nav.tsx:165`, then a codemod for the 86 `ring-primary/60` and 21 `ring-line` uses.
- *Check:* tab through `/dashboard/approvals` at 390×844 and at 1280×800, both directions. Every focused element is ≥ 50% visible, and the ring contrast measured in the screenshot is ≥ 3:1.

**P21 — Size targets by role: 24px is the floor, 44px for touch, 56px at the back door.**
- *Rule:* desktop (fine pointer): every target ≥ **24×24 CSS px** or meets the 24px-circle spacing test (WCAG 2.5.8 AA). Touch: ≥ **44×44** (already in `globals.css` for `pointer: coarse`; Apple HIG 44pt; Material 48dp **[K]**). Receiver and dock flows (gloves, wet hands, one hand holding a box): primary actions ≥ **56px tall and full width** in the bottom thumb zone, steppers ≥ **48×48** with ≥ **8px** gaps, and no destructive action adjacent to the primary one. Drag and drop always has a button alternative (WCAG 2.5.7): the import wizards' file drop needs an "בחר קובץ" button.
- *Source:* WCAG 2.2 Understanding 2.5.8 (24×24, or a 24px-diameter circle centred on the target that doesn't intersect other targets or circles; five exceptions). The W3C notes 2.5.5 (44×44, AAA) for important controls.
- *RestoMatch:* the receiving wizard uses `min-h-11` (44) and `min-h-12` (48). Raise the "confirm received" and "photograph invoice" CTAs to 56. Check the inventory count steppers. Icon-only buttons at `h-6 w-6` pass 2.5.8 only with spacing, so verify the row actions in approvals and invoices.
- *Check:* an automated `boundingClientRect` scan of all `button,a,[role=button],input,select` gives width and height ≥ 24 on desktop and ≥ 44 under `pointer: coarse`, with an explicit allowlist for inline text links.

**P22 — Screen-reader experience in Hebrew: names, order, live regions, language of parts.**
- *Rule:*
  1. Every icon-only control has a **Hebrew** accessible name from i18n, never an English literal.
  2. DOM order equals visual order. Never fix RTL with `flex-row-reverse`, `order-*` or `direction` tricks (WCAG 1.3.2 meaningful sequence, 2.4.3 focus order).
  3. `role="alert"` and `aria-live="assertive"` are only for messages injected after a user action (save failed, payment blocked). Persistent banners on load use no role or `role="status"`. Toasts are `aria-live="polite"`, stay ≥ 6s, and pause on hover or focus (WCAG 2.2.1, 4.1.3).
  4. `lang="en"` on English *phrases* inside Hebrew pages (WCAG 3.1.2). Proper names (Coca-Cola, Heinz) are exempt.
  5. Composite money displays expose one accessible string (P14).
  6. Test with **NVDA + Chrome/Firefox (Windows: owner, bookkeeper)** and **VoiceOver + iOS Safari (receiver)** with Hebrew voices **[K]**.
- *RestoMatch:* `role="alert"` ×40 (29 in `/dashboard`), for example `recipes/price-alert.tsx:53` on a banner rendered at load. `aria-label=` ×163: audit for English literals. Skip links exist in the dashboard (`layout.tsx`, `skipToContent`) and marketing (`MarketingShell.tsx:63`) but not in `/s/[token]` or the receiver PWA screens.
- *Check:* axe-core with `wcag22aa` tags passes on each route in `he`. A manual NVDA script reads the hero as "דליפה החודש, 48,270 שקלים" (or similar), not as "שקל … ארבעים ושמונה".

### F. Process

**P23 — Make RTL quality mechanical: lint, a bidi-torture tenant, and paired he/en visual runs.**
- *Rule:* (a) grep or ESLint gates for P1, P2, P3, P5, P6, P7, P12, P13 and P17 (§8). (b) A seed tenant whose data is hostile to bidi: supplier `Coca-Cola Ltd.`, product `Heinz קטשופ 2 ק״ג`, SKU `SKU-88`, invoice `INV-2026/045`, negative credits, a 9-digit allocation number, an English contact `Dana 050-123-4567`, a 60-character Hebrew product name. (c) Playwright screenshots of every dashboard route in `he` and `en` at 390px and 1280px, plus axe. (d) A "force RTL on English" pseudo-locale run to catch physical CSS.
- *Source:* Firefox RTL guidelines (test by forcing RTL; pseudo-locales) **[K]**. The repo's own `e2e/i18n-sweep.spec.ts` precedent.
- *RestoMatch:* owner `test-sentinel` (e2e config), with the seed via `ocr-procurement-engineer` / `web-feature-engineer` fixtures. Note that **CI workflows are immutable**, so the human adds the gate step.
- *Check:* the gate runs in CI and fails on any new violation.

---

## 4. Patterns (13)

Each pattern gives the exemplar, the exact behaviour, and where it goes in RestoMatch.

**PT1 — "Hero money number" (T1).**
*Exemplar:* fintech balance headers (Revolut, One Zero, Bit). Stripe's "Gross volume" tile **[K]**.
*Spec (he):* an eyebrow label (14px/600 muted, no tracking), then the number in Heebo 800 at 56–60px, `tabular-nums`, 0 decimals, with ₪ at 0.55em/600 muted on the visual left. Under it, a delta chip (`+12% מהחודש שעבר`, built with `signDisplay`, colour by tier) and one line of context (`1.6% מהוצאות המזון · יעד ≤1.5%`). The wrapper's `aria-label` carries the full sentence.
*RestoMatch:* `/dashboard` leak hero (`page.tsx:386-425`), the chain page totals, `/dashboard/leaks` header, OG images.

**PT2 — `<Money>` / `<Token>` isolation primitives.**
*Exemplar:* W3C `bdi`. Gmail/Workspace in Hebrew isolates addresses and IDs **[K]**.
*Spec:* `<Money value decimals sign?>` renders `<bdi className="tabular-nums">` with no forced direction. `<Token kind="sku|invoice|allocation|phone|email|url">` renders `<bdi dir="ltr" className="font-mono">`, plus an optional copy button (≥24px, accessible name `העתק מספר חשבונית`, toast `הועתק`).
*RestoMatch:* replaces ~60 `bdi dir="ltr"` and all ad-hoc `money()`/`ils()` helpers. Use on invoice detail, scans, approvals, receiving, the supplier portal and exports.

**PT3 — `<PriceMove>` and delta chip.**
*Exemplar:* bank and market apps that show "was → now" with a coloured delta **[K]**. Material's sequence rule.
*Spec:* in RTL, `[old] ← [new]  [+2.50 ₪ · +20.8%]`. The delta chip has a solid background only for T2 (above the contract price). In English, `[old] → [new]`. Old values may be struck through (`<s>` with sr text `היה`).
*RestoMatch:* contracts over-contract, recipes cost alerts, the suppliers price trend, ask answers, dock price hint (`receiving/dock-price-hint.tsx`).

**PT4 — `<DirIcon>` direction-aware icon.**
*Exemplar:* Angular CDK `mat-icon-rtl-mirror`, Codex auto-flip and exceptions list, SF Symbols' automatic RTL variants (Apple) **[K]**.
*Spec:* a fixed map of semantic kinds to Lucide glyphs, with mirroring decided once (table §5.1). Always `aria-hidden` unless standalone.
*RestoMatch:* every CTA chevron and arrow, breadcrumbs (`Breadcrumbs.tsx:36`), the orders table row chevron (`orders-table.tsx:132`), wizards.

**PT5 — RTL data table for money.**
*Exemplar:* monday.com Hebrew boards, Google Sheets in RTL (column 1 on the right) **[K]**.
*Spec:* column order mirrors (identity column at the right/start). Text columns use `text-start`. Numeric columns use `.num` (physically right, P9) with ₪ in the header. The sticky first column is on the right (`sticky start-0`). Sort carets are not mirrored (up/down only). Row chevron is `DirIcon kind="next"` (points left in RTL). Totals row is bold with a top border, never coloured red unless it is T2. Long Hebrew names truncate at the end (left in RTL) with the full text in `title` and in the accessible name.
*RestoMatch:* approvals list and pay-run, invoice correction lines, orders, suppliers ledger, catalog browser, recipes table, leaks detective table.

**PT6 — Amount entry (₪) field.**
*Exemplar:* Bit/PayBox amount screen (large LTR amount, ₪ mark, numeric pad) **[K]**. The Bubble ILS input plugin (format on commit).
*Spec:* label above (Hebrew). Input `type=text inputMode=decimal dir=ltr`, `rtl:text-right`, 16–18px. ₪ adornment as a non-editable span at the visual left inside the field chrome. Format on blur. Accept `,` and `.`. Validation messages like `נא להזין סכום חיובי` are linked via `aria-describedby`. Paste is allowed.
*RestoMatch:* contract price form (`contracts/contract-form.tsx`), catalog price edit, the supplier portal answer form, invoice correction, recipe menu price.

**PT7 — Wizard and stepper in RTL.**
*Exemplar:* Material steppers and gov.il multi-step forms (step 1 on the right) **[K]**. Apple (progress flips).
*Spec:* step indicator runs right → left with the current step bold and `aria-current="step"`, plus a text counter `שלב 2 מתוך 4`. Footer: `→ חזרה` (secondary, start/right) and `המשך ←` (primary, end/left). On mobile the primary is full-width at the bottom and "back" is a text link above it. Never reorder via CSS; reorder in the DOM.
*RestoMatch:* new order, catalog import, contracts import, receiving wizard, onboarding.

**PT8 — Mobile bottom navigation (owner and receiver on phone).**
*Exemplar:* Material 3 navigation bar (80dp tall, 64×32dp active-indicator pill, 24dp icon, 12sp label) and iOS tab bar (49pt) **[K]**.
*Spec:* first item (home) at the right. Labels 12px, ≤7 Hebrew characters, never truncated. The active state uses a filled pill behind the icon plus weight 600 plus `aria-current="page"`, not colour alone. Height ≥ 64px plus `env(safe-area-inset-bottom)`. Feeds `--rm-bottomnav-h` for scroll padding.
*RestoMatch:* `nav.tsx:417-460` (`MobileNav`).

**PT9 — Act-now card (T2).**
*Exemplar:* Ramp/Brex approval cards, one primary action each **[K]**.
*Spec:* in RTL reading order: danger/warn badge (start) → title → ₪ amount (Heebo 700, `<Money>`) → one primary CTA at the end (`אשר תשלום ←`). Secondary actions sit in a "⋯" menu. The whole card is not a link, so there are no nested interactive elements. The badge text is a word, not only colour (`חוסם תשלום`).
*RestoMatch:* `/dashboard/approvals`, the dashboard "act now" strip, the receiving mismatch banner, claims to send (`leaks/claims`).

**PT10 — Status messages and toasts in Hebrew.**
*Exemplar:* gov.il form feedback. WAI live-region guidance **[K]**.
*Spec:* toast at the bottom start (right in RTL), above the bottom bar, 6s, pauses on hover or focus, close button `סגור`. Polite for success (`החשבונית נשמרה`), assertive only for blocking errors. One toast at a time. The focus stays where it was.
*RestoMatch:* `Toast.tsx`, `ToastProvider` in the dashboard layout. Audit `role="alert"` ×40.

**PT11 — Skip link, landmarks and headings in Hebrew.**
*Exemplar:* gov.il "דלג לתוכן המרכזי" **[K]**.
*Spec:* the first focusable element is `דלג לתוכן הראשי`, shown at the start corner. Use `<header> <nav aria-label="ניווט ראשי"> <main id> <footer>`. One `<h1>` per page that matches the tab title. The `nav aria-label` values differ from each other (`ניווט ראשי` vs `ניווט תחתון`).
*RestoMatch:* present in the dashboard and marketing. Add to `/s/[token]`, `/scans/[invoiceId]`, the login and 2FA pages, the showcase receiver, and `/invite/accept`.

**PT12 — Accessibility statement page.**
*Exemplar:* statements by SII, Kol Zchut, TAU and IDI (standard and level, test method, known gaps, contact, date).
*Spec:* `/accessibility` (he default, en available). Sections: מחויבות · רמת התאמה (ת״י 5568 AA / WCAG 2.2 AA) · דפדפנים וקוראי מסך שנבדקו · הסדרי נגישות (keyboard, contrast, text resize to 200%, receiver languages) · חריגים ידועים · פרטי רכז/ת נגישות (name, phone, email, response within N business days) · תאריך עדכון.
*RestoMatch:* new marketing route plus footer links in all shells.

**PT13 — Calendar and delivery scheduling for Israel.**
*Exemplar:* Israeli bank and payroll apps: Sunday-first weeks, Friday short day, holiday awareness **[K]**.
*Spec:* weeks start א׳ with columns right → left. Fri and Sat are tinted as weekend. Jewish holidays and ערב חג are marked as "no delivery / short day". Week numbering is off. Day names are short (`א׳ ב׳ ג׳`). The date-range input reads `מ־25.10 עד 31.10`.
*RestoMatch:* order delivery dates, the expected-deliveries view (`showcase/deliveries` → real), pay-run due dates, digest scheduling.

---

## 5. Reference tables

### 5.1 Mirror / don't-mirror decision for the Lucide icons RestoMatch actually uses

Usage counts are from `grep` across `apps/web`.

| Mirror in RTL (via `DirIcon`) | Do NOT mirror |
|---|---|
| ArrowLeft/ArrowRight as "back/next" (25), ChevronRight in rows/breadcrumbs (2), Send (2: already done), LogOut (3: 2 done), Undo2 (1: **not done**), ListChecks (1), ExternalLink (4: optional; pick once), ArrowUpRight only when it means "open / drill in" (showcase ×2) | Check/CheckCircle2/CircleCheck (38), X/XCircle (15), Plus/Minus (21), Search/SearchCheck (8), Play/Pause/PlayCircle (media, 8; **fix `correction-client.tsx:251`**), Clock/Hourglass/History/CalendarClock, RefreshCw/RotateCcw (circular), TrendingUp/TrendingDown and ArrowUpRight/ArrowDownRight meaning "price up/down" (time is LTR, P8), Percent, Sigma, Calculator, Languages, logos, AlertTriangle/Info/ShieldCheck, Truck (direction-neutral by choice: keep facing right **[decision]**), Receipt/FileText (document glyphs; text lines are symbolic) |

### 5.2 Mixed-direction string cookbook

| Data | Display markup | Notes |
|---|---|---|
| ₪ amount | `<Money>` → `<bdi class="tabular-nums">{formatIls(v)}</bdi>` | never `dir="ltr"` (F1) |
| ₪ delta | `formatIls(v,{signDisplay:'exceptZero'})` inside `<bdi>` | needs the additive human PR on `formatIls` (P6) |
| % | `formatPercent` → `1.5%` (he-IL keeps % on the right) | safe in RTL; isolate if next to ₪ |
| Invoice number `INV-2026/045`, `45/2026` | `<Token kind="invoice">` = `<bdi dir="ltr" class="font-mono">` | slashes are fine inside the number run, but isolate anyway because of the neighbours |
| SKU `SKU-88` + qty | `<Token kind="sku">SKU-88</Token> × <Money…>` or `2 ק״ג` as its own `<bdi>` | lab 1 #17 |
| Supplier or product name (any script) | `<span {...originalProps(name)}>` or `<bdi>` (inline only) | lab 1 #8 |
| Phone `050-123-4567` | `<Token kind="phone">` + `<a href="tel:+972501234567">` | input: `type=tel dir=ltr autocomplete=tel` |
| Email | `<Token kind="email">` | already `font-mono` in the header |
| Date | `formatDate` → `25.10.2026` | safe; ranges in words: `מ־1.10 עד 15.10` |
| Money range | words: `בין 10 ל־12 ₪` | lab 1 #6 |
| Price move | `<PriceMove>` | lab 1 #12 vs #13 |
| Unit | `UnitText` with gershayim `ק״ג` and an sr-only full word in receiver flows | P15 |

### 5.3 he-IL Intl output (Node 22.22, ICU), code points

```
currency 1234.5   → U+200F 1,234.50 U+00A0 U+200F ₪            "‏1,234.50 ‏₪"
currency -1234.5  → U+200F U+200E -1,234.50 U+00A0 U+200F ₪
signDisplay +     → U+200F U+200E +1,234.50 U+00A0 U+200F ₪
compact 1234567   → ₪ 1.2M U+200F                               (banned)
percent 0.0153    → 1.5%
date short        → 25.10.2026         medium → 25 באוק׳ 2026
long weekday      → יום ראשון, 25 באוקטובר     time → 14:30
relative          → אתמול · שלשום · לפני 3 ימים · לפני שבועיים · מחרתיים · החודש שעבר
list              → תנובה, שטראוס ויכין
plural categories → one / two / other   (Hebrew has a dual: use ICU "two" forms)
unit kg 2.5       → 2.5 ק״ג (U+05E7 U+05F4 U+05D2)
weekInfo          → firstDay 7 (Sunday), weekend [5,6] (Fri, Sat)
ar-IL number      → ١٬٢٣٤٫٥ (Arabic-Indic!) → if ar ever maps to ar-IL, use "ar-IL-u-nu-latn"
```

`intlLocaleOf()` currently maps every non-`he` locale to `en-GB` (`lib/i18n/config.ts:73`), so the Arabic receiver locale gets Western digits today. Keep it that way deliberately: invoices and the dock use Western digits.

### 5.4 Token contrast (computed from `globals.css`)

| Pair | Ratio | Verdict |
|---|---|---|
| subtle #5A6A62 on surface-2 #EEF3F0 (worst text pair) | 5.10 | AA ✅ |
| gold #755C00 on bg | 5.99 | ✅ |
| warn on surface-2 / danger on surface-2 | 5.69 / 5.96 | ✅ |
| danger text on danger/8 tint | 5.82 | ✅ |
| white on primary / gold / warn / danger | 6.54 / 6.39 / 6.39 / 6.69 | ✅ |
| line-strong #7A8B82 on surface (control borders) | 3.59 | ✅ (1.4.11) |
| line #D3DDD7 on surface / bg | 1.39 / 1.30 | decorative only: never a control boundary or focus ring |
| **focus ring primary/60 on bg / surface** | **2.73 / 2.81** | ❌ 1.4.11 |
| **ghost focus ring `ring-line`** | **1.39** | ❌ |

### 5.5 Target sizes by context

| Context | Minimum | RestoMatch today |
|---|---|---|
| Desktop, fine pointer | 24×24 or the 24px-circle spacing test (2.5.8 AA) | Button sm ≈ 28px tall ✅; icon buttons `h-6 w-6` need the spacing check |
| Touch (`pointer: coarse`) | 44×44 (Apple 44pt; Material 48dp **[K]**) | global rule in `globals.css` ✅ |
| Receiver/dock (gloves) | primary 56px tall, full width, bottom; steppers 48×48, gap ≥ 8px | `min-h-11`/`min-h-12` → raise primary CTAs to 56 |

---

## 6. Owner-level design decisions this research asks for

1. **Chart time axis:** LTR everywhere (recommended, P8), or mirrored everywhere. Today both are in use.
2. **Price-move order:** RTL `old ← new` in Hebrew (recommended, P11, matching the existing he.ts strings), versus the LTR island used by the recipes components.
3. **Numeric column alignment:** physically right in both directions (recommended, P9; place values line up), versus `text-end`.
4. **Money font:** Heebo tabular for ₪ (recommended, P14), versus JetBrains Mono for everything.
5. **Accessibility coordinator:** who is named in the הצהרת נגישות (P19). This needs a human.

## 7. Governance notes (AGENTS.md)

- `formatIls()` and the agorot↔display boundary are **immutable**. The `signDisplay` option (P6) and any `<Money>` that wraps it must be a **human-authored PR** (owner `money-format-marshal`). Agents may build `<Money>` as a thin wrapper that calls the existing util unchanged.
- Tokens and focus-ring tokens: `rtl-design-steward` (`packages/ui-tokens`, `globals.css`, `tailwind.config.ts`).
- Lint and e2e gates: `test-sentinel`. CI workflow edits are human-only.
- The accessibility statement page (marketing): `growth-pmm-engineer`. The legal text and the coordinator's name come from the owner.

## 8. Automation checklist (grep or ESLint; all were run once for this report)

| Rule | Command / predicate | Count today |
|---|---|---|
| P1 physical classes | `\b(ml|mr|pl|pr)-[0-9]|\btext-(left|right)\b|\b(left|right)-[0-9]` | 9 + 12 + 2 + 8 |
| P2 raw direction icons | `<(ArrowLeft|ArrowRight|ChevronLeft|ChevronRight)\b` outside DirIcon | 41 |
| P3 `→` in Hebrew UI | in `he.ts` (non-comment) and JSX text | 0 in he.ts; 2 components |
| P5 money in forced LTR | `<bdi dir="ltr"[^>]*>\s*\{?(formatIls|ils|money)` | ~20 direct, 60 `bdi dir=ltr` total |
| P6 concatenated signs | `[+−-]\{(formatIls|ils)\(` (3) plus template-literal signs such as `ilsDelta` and the period-card `+ {ils}` / `− {ils}` (3) | 6 sites |
| P7 compact currency | `notation:\s*'compact'` with ILS | 0 (keep it 0) |
| P9 numeric `text-end` | `text-end` + `tabular|font-mono` on one line | 78 |
| P12 tracking on Hebrew | ungated `tracking-(wide|wider|widest|[..em])` | 72 |
| P13 tiny text | `text-\[(10|11)px\]` | 97 |
| P17 number inputs | `type="number"` | 27 |
| P20 weak focus rings | `ring-primary/60`, `ring-line` | 86 / 21 |
| P20 scroll padding | `scroll-padding` in globals.css | 0 (needs 1) |
| P22 alert misuse | `role="alert"` on load-time content | 40 to triage |

---

## 9. Sources

Pages cited came from search-result excerpts, because direct fetch was blocked. [K] = knowledge, not re-verified live.

- Material Design M2, Bidirectionality — https://m2.material.io/design/usability/bidirectionality.html (redirect: https://m2.material.io/go/design-bidirectionality); M1 — https://m1.material.io/usability/bidirectionality.html
- Apple HIG, Right to left — https://developer.apple.com/design/human-interface-guidelines/right-to-left (mirror seen at developer-rno.apple.com); Apple archive "Supporting Right-to-Left Languages" — https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPInternational/SupportingRight-To-LeftLanguages/SupportingRight-To-LeftLanguages.html; WWDC22 "Get it right (to left)" — https://developer.apple.com/videos/play/wwdc2022/10107/
- W3C i18n, Inline markup and bidirectional text in HTML — https://www.w3.org/International/articles/inline-bidi-markup/ ; examples — https://www.w3.org/International/articles/inline-bidi-markup/bidi_examples.html ; tutorial "Creating HTML Pages in Arabic, Hebrew and Other RTL Scripts" — https://www.w3.org/International/tutorials/bidi-xhtml/
- Mozilla Firefox RTL Guidelines — https://firefox-source-docs.mozilla.org/code-quality/coding-style/rtl_guidelines.html
- Wikimedia Codex, contributing icons (auto-flip and the Hebrew "?" exception) — https://doc.wikimedia.org/codex/latest/contributing/contributing-icons.html ; bidirectionality style guide — https://doc.wikimedia.org/codex/main/style-guide/bidirectionality.html
- Angular CDK bidi / `mat-icon-rtl-mirror` — https://v5.material.angular.io/cdk/bidi
- Unicode list: arrows are not bidi-mirrored — https://unicode.org/mail-arch/unicode-ml/y2011-m06/0020.html ; Discourse RTL arrow bug — https://meta.discourse.org/t/wrong-arrow-direction-in-rtl-text-contexts/360760
- WCAG 2.2 Understanding: 2.5.8 Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html ; 2.4.11 Focus Not Obscured — https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured ; 1.4.11 Non-text Contrast — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
- IS 5568 and the 2013 regulations (secondary): https://www.clym.io/regulations/israeli-standard-5568-is-5568 · https://user-a.co.il/en/standards/israeli-accessibility-standards-vs-wcag · SII statement https://www.sii.org.il/he/accessibility-statement/ · Kol Zchut statement https://www.kolzchut.org.il/he/כל_שירות:נגישות · TAU statement https://elrom.sites.tau.ac.il/en/accessibility · IDI https://www.idi.org.il/about/acceciblity/
- ₪ bidi precedent (LibreOffice fdo#46807) — https://bugs.freedesktop.org/show_bug.cgi?id=46807 ; ICU he_IL locale data — https://www.localeplanet.com/icu/he-IL/index.html
- Bit in payment flows (ILS only, ₪5,000 cap) — https://developers.hyp.co.il/pay/common-use-cases/digital-wallets ; ILS input formatting on commit — https://bubble.io/plugin/ils-currency-input-1756725811556x919602168476991500
- monday.com Vibe — https://developer.monday.com/apps/docs/vibe-design-system ; community RTL request — https://community.monday.com/t/feature-request-better-support-for-rtl-languages/120487
- Hebrew typography and IGDS mentions (secondary catalogs) — https://claudeskills.info/skills/skills-il/localization/hebrew-rtl-best-practices/ · https://claudeskills.info/skills/skills-il/localization/israeli-ui-design-system/
- [K] Material 3 navigation bar metrics; Apple 44pt / Material 48dp targets; iOS Safari input zoom below 16px; NVDA/VoiceOver Hebrew testing; accessibility overlays don't create conformance; Israeli CBS/BoI chart conventions; fintech balance-header conventions; Gov.il IGDS (Figma community file, unverified live).
