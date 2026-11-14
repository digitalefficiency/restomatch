# RestoMatch DS2: typeface research (fonts)

Date: 7.11.2026. Scope: research and specimens only. The repo was not edited and nothing was pushed.
Everything under `scratchpad/ds2/fonts/`.

## TL;DR

| Decision | Recommendation |
|---|---|
| **Primary UI family** | **IBM Plex Sans Hebrew** (OFL). It scores highest (92/100). It has the clearest digits at 13–16px: 1 has a foot, I has serifs, l has a tail, and 0 is distinct from O. Its ₪ is drawn to the height of the figures. Its Hebrew letters are tall (0.618 em), which helps a phone read at the dock. It was designed together with its Latin as one "engineered, trustworthy" system. |
| **Numerals strategy** | **Use the same family's figures.** Plex digits are tabular by default; keep `tabular-nums` on anyway. **Stop using `font-mono` (JetBrains Mono) for money.** JetBrains Mono has no ₪, so in the live stack every ₪ inside `font-mono` is drawn by a **system font**. This was measured: Liberation Mono painted the ₪ in Chromium/Linux, and other devices will each use their own font. If a mono face is still wanted for IDs (HK-24107, SKUs), use **IBM Plex Mono**, which contains ₪. |
| **Display face (optional)** | **Frank Ruhl Libre** 500–700, for marketing H1s and the monthly report cover only. It is never used for ₪ figures in the app. |
| Runner-up | **Noto Sans Hebrew** (variable, 85/100). It is the only candidate with a **width axis** (wdth 62.5–100), which gives condensed dense tables. It also matches the Noto Sans Arabic/Thai/Ethiopic fonts already shipped for receivers. |
| Current | Heebo scores 80/100. It is solid, but 1/l/I look the same, its Latin is generic (Roboto), and it is wide in tables. Switching costs little: the fonts are self-hosted files plus `@font-face`, and the metric fallback has to be recomputed. |

## 0. Findings about the live product (before choosing anything)

1. **₪ comes from a system font wherever `font-mono` is used.** In `globals.css`, JetBrains Mono is served with the *latin* range only. I checked its latin-ext file and it has no U+20AA at all. The Tailwind `mono` stack is `JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, and Heebo is not in it. CDP `getPlatformFontsForNode` on the hero, strategy A in `numerals.jpg`, reported **"Liberation Mono (SYSTEM)×1 + JetBrains Mono×6"**. The visible result is a thin, foreign ₪ with a wide gap. The pattern `className="font-mono tabular-nums"` appears 32+ times and wraps `formatIls()`, for example in the supplier portal `s/[token]/answer-form.tsx` and in `HeroMatch.tsx`.
2. **Digits come from the *latin* subset and ₪ from the *hebrew* subset**, in every Fontsource/Google family. So a Hebrew money string always needs both files. Preload both, which `layout.tsx` already does for Heebo.
3. **Right-end alignment (`text-end`) works against tabular figures** with the he-IL `formatIls()` output `‏1,267.50 ‏₪`. In RTL the ₪ is drawn on the left. A column aligned on its left edge lines up the ₪ signs, but the last digits and decimal points end up ragged. `numerals.jpg` shows both alignments side by side. There are two ways to fix this:
   - Align the digits: `text-align: right` (start) in money columns.
   - Show ₪ once in the column header.

   Either one is a proposal for `money-format-marshal` and `rtl-design-steward`. It is not something an agent should apply on its own.
4. Four Hebrew fonts draw ₪ as a wide **"ש"ח"-like ligature** (~1.1 em): **Miriam Libre, Secular One, Suez One** (and Varela Round's ₪ is wide). **Alef and Suez One use old-style figures**, where 3, 4, 5, 7 and 9 descend. These are disqualified for money.

## 1. Long list

### 1a. OFL families verified on npm (@fontsource 5.3.0, hebrew subset present)

| Family | Pkg (verified) | Variable? | Notes |
|---|---|---|---|
| Heebo *(current)* | `@fontsource-variable/heebo` | wght 100–900 | Roboto Latin |
| Assistant | `@fontsource-variable/assistant` | wght 200–800 | Source Sans Latin; **no tnum** |
| Rubik | `@fontsource-variable/rubik` | wght 300–900 | rounded; tnum opt-in |
| Noto Sans Hebrew | `@fontsource-variable/noto-sans-hebrew` | wght 100–900 **+ wdth 62.5–100** | matches the Noto receiver fonts |
| IBM Plex Sans Hebrew | `@fontsource/ibm-plex-sans-hebrew` | static 100–700 (no `-variable` pkg) | sibling Plex Sans Arabic + Thai exist on npm; no Plex Ethiopic |
| Open Sans | `@fontsource-variable/open-sans` | wght 300–800 + wdth 75–100 | heaviest files |
| Arimo | `@fontsource-variable/arimo` | wght 400–700 | Arial-metric |
| Miriam Libre | `@fontsource-variable/miriam-libre` | wght 400–700 | ₪ = ש"ח form |
| Frank Ruhl Libre | `@fontsource-variable/frank-ruhl-libre` | wght 300–900 | serif, display |
| David Libre | `@fontsource/david-libre` | 400/500/700 | serif |
| Secular One / Suez One | `@fontsource/secular-one`, `/suez-one` | 400 only | display; ₪ = ש"ח form |
| Varela Round / Alef | `@fontsource/varela-round`, `/alef` | 400 / 400+700 | Alef: old-style figures |
| Also on npm, not tested | Tinos, M PLUS 1p, Noto Serif Hebrew, Noto Rashi Hebrew, Bona Nova, Karantina, Bellefair, Cousine, Fredoka, Playpen Sans Hebrew | — | display, serif, playful or mono; outside this product's needs |

Not on Fontsource as `-variable`: IBM Plex Sans Hebrew, Alef, Varela Round, Secular/Suez One, Karantina, David Libre, Bona Nova, Tinos (`npm-availability.txt`).

### 1b. Commercial Israeli and Hebrew web fonts (found by web search; vendor pages were **blocked in this session**)

None of these prices could be checked on the vendor page. `alefalefalef.co.il`, `myfonts.com`, `fontspring.com` and `fonts.adobe.com` would not resolve here. The figures below come from search-result summaries. **Confirm every price and the web-licence tier before buying.**

| Family | Foundry | What was found | Licence / price found |
|---|---|---|---|
| **Ploni** | AlefAlefAlef (AAA) | Hebrew sans, 8 styles; "Ploni Yad" twin | FontShop: $105.62/style, 8-style pack $845. MyFonts: from $250/style, family $2,500. Store prices differ. **Web licence price not found.** AAA's EULA sells webfont/app licences separately from desktop. |
| **Almoni** | AAA | Hebrew sans, 10 styles | MyFonts: from $145/style, family $1,350 (another locale shows $250/$2,500). Web price not found. |
| Simona | (AAA?) | **No Hebrew "Simona" found.** Only an unrelated Latin freeware font turned up. | — |
| **FbReforma** | Fontbit | Listed in Fontbit's catalogue (Devroye) | **Not found.** A snippet of unclear origin says "extended webfont >1M views/month = ×4 family / ×6 single weight". Unverified. |
| **Narkiss** (Yair, Tam, Text…) | Fontef (exclusive distributor of Zvi Narkiss since 2019) | Narkiss Yair is listed on Adobe Fonts (Fontef) | Price not found. The Adobe Fonts web-use terms could not be checked here. |
| **Polin Sans** | Machalski (Hebrew by Ben Nathan) | 40 styles, Hebrew + Latin | Fontspring $39/style, "40 fonts from $390"; MyFonts family $499. A web-font option is listed; EULA not read. |
| Rag Sans | Dennis Grauel | **Latin only**; no Hebrew found | — |
| Mandatory | ? | **No Hebrew font of this name found** | — |
| Hadassah Friedlaender | Fontef revival (Iontef, 2015); bundled by Microsoft | Classic serif, 2 weights; earlier version was the subject of a rights lawsuit | No webfont licence found |

Commercial verdict: **Ploni and Almoni (AAA)** and **Polin Sans** are the only commercial options worth a quote. Polin Sans is the cheapest of the three on paper. Its Hebrew is credited to Ben Nathan in the search results, and it ships 40 styles. Neither is needed to reach the bar: IBM Plex Sans Hebrew covers the brief at zero licence risk.

## 2. Criteria (weighted for this product)

₪ glyph 15 · tabular/lining figures 15 · Hebrew legibility on a phone 15 · digit clarity at 13–16px 10 · Hebrew–Latin harmony 10 · width economy for dense tables 10 · personality ("trustworthy money command center") 10 · weight range/variable 5 · performance (woff2) 5 · licence 5. Each criterion is scored 1–5 and weighted to a total out of 100.

## 3. Measurements (fontTools on the shipped woff2; `metrics.json`)

| Family | heb KB | lat KB | ₪ in heb | figures | Hebrew height (מ, em) | Latin x/cap | Hebrew width vs Heebo | "1,267.50" width (em) |
|---|---|---|---|---|---|---|---|---|
| Heebo | 11.8 | 29.4 (var) | ✓ (0.84 em wide) | tabular default | 0.586 | 0.743 | 100% | 3.83 |
| Assistant | 7.1 | 21.6 (var) | ✓ | **proportional, no tnum** | 0.548 | 0.667 | **85%** | 3.21 |
| Rubik | 9.1 | 34.5 (var) | ✓ | proportional + tnum | 0.571 | 0.743 | 95% | 3.69 |
| Noto Sans Hebrew | 12.0 (17.3 w/ wdth) | 19.7 (34.1 w/ wdth) | ✓ | tabular default | 0.593 | 0.751 | 97% (wdth ↓62.5) | 3.82 |
| **IBM Plex Sans Hebrew** | 5.3/wt | 19.0/wt | ✓ (0.70 em tall = figure height) | tabular default | **0.618** | 0.739 | 99% | 4.14 |
| Open Sans | 16.5 | 47.2 (var) | ✓ | tabular default + tnum | **0.640** | 0.750 | 98% (wdth ↓75) | 3.95 |
| Arimo | 10.5 | 19.7 (var) | ✓ | tabular default | 0.609 | 0.768 | 103% | 3.89 |
| Miriam Libre | 9.6 | 25.7 (var) | ✓ but ש"ח form, 1.1 em | proportional + tnum | 0.589 | 0.814 | 99% | 3.60 |
| Frank Ruhl Libre | 18.3 | 43.3 (var) | ✓ | proportional + tnum | 0.586 | 0.709 | 89% | 3.73 |
| Secular One | 7.8 | 18.9 | ש"ח form | proportional, no tnum | 0.551 | 0.773 | 100% | 3.73 |
| JetBrains Mono *(live figures)* | — | 39.5 | **no ₪ anywhere** | mono | — | 0.753 | — | 4.80 |
| IBM Plex Mono | — | 14.4/wt | ✓ (latin-ext) | mono | — | 0.739 | — | 4.80 |

Payload for 3 weights (400/500/700, hebrew + latin): Plex ≈ **74.5 KB**, Heebo var 41.2 KB, Noto var 31.7 KB (51.4 KB with wdth), Rubik var 43.6 KB.

## 4. Scores (out of 100)

| Family | ₪ | fig | heb | digit | harm | width | pers | wght | perf | lic | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **IBM Plex Sans Hebrew** | 5 | 5 | 5 | 5 | 5 | 3 | 5 | 3 | 3 | 5 | **92** |
| Noto Sans Hebrew | 4 | 5 | 4 | 3 | 4 | 5 | 4 | 5 | 4 | 5 | **85** |
| Heebo *(current)* | 4 | 5 | 4 | 3 | 4 | 3 | 3 | 5 | 5 | 5 | **80** |
| Rubik | 4 | 4 | 4 | 3 | 5 | 4 | 3 | 5 | 4 | 5 | **80** |
| Open Sans | 4 | 5 | 5 | 3 | 4 | 4 | 2 | 5 | 2 | 5 | **80** |
| Arimo | 4 | 5 | 4 | 3 | 3 | 2 | 2 | 3 | 5 | 5 | **72** |
| Frank Ruhl Libre (display) | 4 | 4 | 2 | 2 | 4 | 4 | 4 | 5 | 2 | 5 | **70** |
| Assistant | 3 | 1 | 3 | 2 | 4 | 5 | 3 | 5 | 5 | 5 | **64** |
| Miriam Libre | 1 | 4 | 3 | 3 | 3 | 3 | 2 | 3 | 5 | 5 | **59** |
| Secular One (display) | 1 | 1 | 2 | 2 | 3 | 3 | 3 | 1 | 5 | 5 | **45** |

Verdicts on the compare-sheet-only families:
- **Suez One:** reject. Old-style figures and a ש"ח-form ₪.
- **Alef:** reject for money. Old-style figures, no tnum.
- **Varela Round:** single weight with no bold. Too soft for money; usable only as a warm accent.
- **David Libre:** tabular serif in 400/500/700. A possible alternative to Frank Ruhl as a display face.

What the specimens show:
- **Plex** has the only unambiguous **1 / l / I** in the set. Its ₪ top is exactly at the figure height (0.698 em; Open Sans is the only other one at figure height). So "₪ 760" reads as one unit even at 64px/700.
- **Heebo**'s ₪ is heavy, wide (0.84 em) and short (top at 0.576 em against 0.715 em digits). In the hero, the sign reads as a separate block.
- **Assistant** is visibly smaller at the same px. It needs +1px everywhere, and it has no tnum.
- **Rubik** is friendly and sturdy. Its Hebrew suits a phone well. Without `tabular-nums` its columns drift; see `numerals.jpg` E.

## 5. Recommendation

- **Primary UI:** IBM Plex Sans Hebrew. Ship 400/500/600/700. On the owner's phone, prefer 500 for dock and receiver rows of 18px and up.
- **Numerals:**
  - Use Plex's own figures and keep the `tabular-nums` utility.
  - Remove `font-mono` from every `formatIls()` call site. Point the `mono` token at **IBM Plex Mono** and use it only for invoice numbers and SKUs. Plex Mono contains ₪ and shares Plex's metrics.
- **Display (optional):** Frank Ruhl Libre 600/700, for marketing and report covers only. The leak hero stays in Plex 700. The number is the hero, not the typeface.

## 6. Three directions (one pairing each)

| | A. Calm-institutional *(recommended)* | B. Modern-precise | C. Warm-hospitality |
|---|---|---|---|
| UI text | IBM Plex Sans Hebrew 400/500/600/700 | Noto Sans Hebrew var (wght 100–900, wdth 62.5–100) | Rubik var 300–900 |
| Numerals | Plex figures (tabular default) | Noto figures (tabular default); dense tables at `font-stretch: 87.5%` | Rubik + **mandatory** `tabular-nums` (lint rule) |
| IDs / SKUs | IBM Plex Mono 400 | same family, wdth 87.5 | same family |
| Display | Frank Ruhl Libre 600–700 (marketing, report) | none; Noto 800, tight tracking | Secular One for marketing H1 only (**never ₪**) |
| Feel | bank statement / audited | Linear/Stripe-grade density | restaurant warmth, rounded |
| Payload (app) | ~100 KB (4 wts) + 14 KB mono | ~51 KB (one var file pair) | ~44 KB |
| Risk | static files (no var); slightly wide digits | neutral bordering on generic | playful drift; misaligned columns if tnum forgotten |
| Receiver locales | Plex Sans Arabic/Thai exist; keep Noto Ethiopic | **one Noto family across he/ar/th/am** | mixed |

Suggested type scale, shared by all three:
- 64/700: T1 hero
- 32/700: H1
- 24/600: H2 and T2 ₪
- 18/500: phone rows (minimum at the dock)
- 16/400: body
- 14/400: tables (tnum)
- 12/500: captions and chip meta, never below 12

## 7. Hand-off notes (if the owner picks one)

These touch the governed areas of `AGENTS.md`, so they are proposals:
- **`rtl-design-steward`:**
  - Self-host the files under `apps/web/public/fonts/<family>/` with their OFL licences.
  - Replace the `@font-face` blocks and `--font-heebo` / `--font-mono` in `apps/web/app/globals.css`.
  - Update `packages/ui-tokens` `typography.fontFamily`, the preload list in `apps/web/app/layout.tsx`, and the metric-matched `'… Fallback'` face (recompute `size-adjust` and ascent/descent for the new family).
- **`money-format-marshal`:**
  - Decide how money columns align (digit-aligned vs ₪ in the header).
  - Drop `font-mono` around `formatIls()` output.

## Files

- `specimen-<Family>.jpg` ×10 (1440w, DPR 2, JPEG q80): Heebo, Assistant, Rubik, Noto-Sans-Hebrew, IBM-Plex-Sans-Hebrew, Open-Sans, Arimo, Miriam-Libre, Frank-Ruhl-Libre, Secular-One.
- `compare.jpg`: the same 3 lines in all 14 families.
- `numerals.jpg`: 7 numeral strategies, with the CDP font-attribution line.
- `digits-13px.jpg`: 13px clarity at DPR 3.
- `metrics.json`, `render-report.json`, `npm-availability.txt`, `html/` (the specimen sources).
- Scripts: `../analyze.py`, `../render.cjs`.

## Sources (commercial section)

[FontShop Ploni](https://www.fontshop.com/families/ploni) · [FontShop Almoni](https://www.fontshop.com/families/almoni) · [MyFonts Ploni](https://www.myfonts.com/fonts/alefalefalef/ploni/) · [MyFonts Almoni](https://myfonts.com/fonts/alefalefalef/almoni) · [AAA EULA](https://alefalefalef.co.il/en/?p=271) · [Devroye: Fontbit](https://luc.devroye.org/fonts-45197.html) · [Adobe Fonts: Fontef](https://fonts.adobe.com/foundries/fontef) · [Adobe Fonts: Narkissim](https://fonts.adobe.com/fonts/narkissim) · [Fonts in Use: Narkiss Text](https://www.fontsinuse.com/typefaces/242382/narkiss-text) · [Fontspring Polin Sans](https://fontspring.com/fonts/machalski/polin-sans) · [MyFonts Polin Sans](https://myfonts.com/collections/polin-sans-font-borutta) · [Rag (BeFonts)](https://befonts.com/rag-font-family.html) · [Microsoft: Hadassah Friedlaender](https://learn.microsoft.com/en-us/typography/font-list/hadassah-friedlaender) · [Stockholm TG: Hadassah revival](https://stockholmstypografiskagille.se/typonyheter/hadassah-friedlaender/) · [Devroye: Hagilda](https://luc.devroye.org/fonts-57644.html)
