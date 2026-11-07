# RestoMatch Design System 2 · מערכת עיצוב 2

**An operations-first design system for a money product: foundations, components, operation patterns, token architecture and three directions**

- **Date:** 7.11.2026. **Base:** `origin/main` @ `4c887688` (wave 1 + train A).
- **Status:** design-lead proposal. Nothing in the repo was edited and nothing was pushed. Every repo change below is a proposal for the owning agent's PR (AGENTS.md ownership map), and a human merges.
- **Owner request (7.11):** "search for suitable fonts, raise the whole design system several levels, understand the operational processes, and from that design operations more efficiently."
- **Built from** (all in this folder): `fonts/FONTS.md` (typeface research and specimens), `PROCESSES.md` (12 jobs J1–J12, principles P1–P10, 22 component patterns), `AUDIT.md` (what ships on `main`, with counts), `BENCHMARKS.md` (outside patterns M/Q/T/F/K/R). Also `docs/ux/RUBRIC.md` (R-1…R-15), `docs/ux/sidebar/SPEC.md` and the wave-2 brief `W2-15` (DS adoption, owner of `packages/ui-tokens` during wave 2).
- **Machine-readable companion:** `directions.json`. It holds the token values, font files, density and radius for directions A, B and C.
- **Reading key:** `J#` = job (PROCESSES §3) · `P#` = principle · `#n` = component pattern (PROCESSES §6) · `M/Q/T/F/K/R#` = benchmark pattern · `R-#` = RUBRIC rule · `live/NN`, `w2/…` = screenshots from 7.11.

---

## בקצרה · For the owner

1. **לא פלטה חדשה. ארבע קפיצות מדרגה.**
   - **קול אחד למספרים:** גופן אחד לכל ₪, ספרות טבלאיות, מיושרות לימין, דיוק אחד לכל הקשר.
   - **דבר רועש אחד בכל אזור:** לכל היותר 3 תגיות אדומות או כתומות במסכי סיכום. בתורי עבודה התגית חזקה רק כשהמועד קרוב או עבר. ויש רק כפתור ראשי אחד, שזז עם הפוקוס.
   - **צפיפות לפי תפקיד ומצב שטח:** מנהלת החשבונות צפופה, הבעלים רגיל, ובדלת "מצב שטח" עם כפתור של 56 פיקסלים וניגודיות גבוהה.
   - **תבניות פעולה:** שורת החלטה, חלונית ראיות שזזה עם הפוקוס, סרגל בחירה מרוכזת, גיליון שליחה, שורת ספירה עם ✓ אחד.
2. **פונט:** ממליץ על **IBM Plex Sans Hebrew** (כיוון A). זה הגופן היחיד שבו 1, l ו-I נראים שונים, וה-₪ שלו בגובה הספרות. **בעיה שקיימת היום בכל כיוון:** בכל מקום שבו הסכום כתוב ב-`font-mono`, ה-₪ מצויר בגופן מערכת זר. זה מתוקן בכל אחד משלושת הכיוונים.
3. **יעדים במספרים:**

   | מה | היום | יעד |
   |---|---|---|
   | אישור פער | 6 קליקים | 2 |
   | שליחת 6 דרישות זיכוי | כ-25 נגיעות | 3 |
   | החלטות במסך מחשב אחד | כ-2.5 | 10 ומעלה |
   | שורות ספירה במסך טלפון | 2 | 8 |
   | סגנונות טקסט | 59 | 17 תפקידים |
   | סוגי פינות | 29 | 5 |

4. **שלושה כיוונים.** לכולם אותם עקרונות ורכיבים, ושלושתם עוברים AA.

   | כיוון | אופי | גופן |
   |---|---|---|
   | **A · מאזן** | רגוע ומוסדי, כמו דף חשבון מבוקר | IBM Plex Sans Hebrew |
   | **B · דיוק** | צפוף ומודרני, עם טבלאות מעובות | Noto Sans Hebrew |
   | **C · מטבח** | חם ומארח, פינות רכות | Rubik |

5. **ההמלצה שלי: A.** הוא מחזק בדיוק את מה שהמוצר מוכר, מספר אחד שהבעלים מאמין לו. אם הערוץ של מנהלות החשבונות הוא העדיפות, B. אם החום חשוב יותר מתחושת הביקורת, C.
6. **מה צריך ממך:**
   - לבחור כיוון;
   - לאשר שלוש החלטות קטנות (§7): ₪ בכותרת העמודה בטבלאות של מנהלת החשבונות; כפתור ראשי אחד שזז עם הפוקוס; צבע הבחירה כחול ולא ירוק.
7. **בלי לשבור את גל 2:** הטוקנים נכנסים קודם, השמות הישנים נשארים ככינויים, החלפת הפונט היא שינוי של משתנה אחד, וקודמוד (המרת קוד אוטומטית) רץ רק אחרי שהגל ממוזג.

---

## 0. What DS2 changes: four levels up, plus enforcement

`AUDIT.md` §0 found that the token foundation is good, but the product barely uses it, and the live UI is still v1. DS2 does **not** start with a new palette. It raises five things, and each one has a test.

| Level | Today on `main` (measured) | DS2 | How it is checked |
|---|---|---|---|
| **1. One money voice** | 3 numeric voices: Heebo; JetBrains Mono, whose ₪ comes from a system font (≥28 lines); and the ₪ flipping side ("152.50₪"). One leak shows as `₪760` and as `₪759.54`. `<Money>` has 1 product use against 145 `formatIls` calls | One UI family carries every figure. Every ₪ goes through `<Money>`/`MoneyCell` and the frozen `formatIls()`. Figures are tabular and physically right-aligned, with one precision per context and 4 ₪ sizes | CDP `getPlatformFontsForNode` reports one family for every ₪. A Playwright check that decimal points share one x-coordinate in `he` and `en` (M6) |
| **2. One loud thing per region** | Home: 4 CTA colours above the fold, including a red button used for navigation. Approvals: 4 green primaries and 4 secondaries per screen. 29 figures in red | A T2 budget: **≤3 bold danger/warn elements per viewport on summary surfaces**; in a work queue, a chip is bold only when its row is overdue or due within 48 h. **The primary follows focus**: one filled primary per region. Figures are never red; danger is a marker | An e2e count per role screen: bold chips ≤3 on summary surfaces, and in queues bold only on overdue or ≤48 h rows; filled primaries ≤1 per region |
| **3. Density by role and field mode** | Density tokens exist, but 0 components read them. About 2.5 decisions per 1440×900 screen; about 2 count lines per phone | `data-density` (compact/default/touch) × `data-mode` (desk/field/print), set by the shell from role and device and read by every component | ≥10 decision rows per 1440×900; ≥8 count rows per 390×844 (A). These are layout tests |
| **4. Operation patterns** | No decision row. The evidence is a page away. Statuses are set by hand. The pay run is a dead end | 12 components (§3) and 12 composed flows (§4), with the PROCESSES step counts as acceptance numbers | One e2e spec per job counts presses (`ops-J2-desk` and so on, PROCESSES §9) |
| **5. A closed type and shape system** | 59 size×weight styles, 34 sizes, 29 radius classes, 19 shadows, 688 v1 opacity tints, 134 double focus rings | **17 type roles** (14 app + 3 marketing), **5 radii**, **4 elevations + rail**, semantic tints only, one focus ring | A ratchet test fails when any legacy count in `metrics.json` goes up (§5.6) |
| **Enforcement** | W2-15 plans `warn`-level lint and `ds-check.sh` | Plus a **baseline-and-ratchet** test, codemods after wave 2, and a lint escalation in W4-01 / H-09 | CI |

**What stays exactly as it is** (`AUDIT.md` §2):
- the generated token pipeline, its drift test and its contrast test (≥4.6:1);
- the six status families;
- `moneyStates`;
- T1–T4;
- the global focus outline;
- reduced-motion and `prefers-contrast` handling;
- the 44 px coarse-pointer floor;
- self-hosted fonts with metric fallbacks;
- keys bound by `KeyboardEvent.code`;
- the receiver's ₪-free screens;
- the 10 s undo;
- the blind spot check.

---

## 1. Principles: an operations-first money product

The first ten principles come from the jobs (`PROCESSES.md` §5), compressed here to a rule and a test. The last three are design-system principles taken from the audit. Every component in §3 cites the principles it serves.

| # | Principle | Rule (short) | Test |
|---|---|---|---|
| **P1** | **Every task is a sentence: ₪ + verb + due** · כל משימה היא משפט | An actionable item reads "דרשו ₪38.70 מירקות השרון · לתשלום עד 14.11". Only act-now items get T2; waiting on someone else is T4 | Every actionable row has exactly 1 primary verb, its ₪ (if the role may see it) and a due or age chip |
| **P2** | **The evidence comes to the decision** · הראיה באה אל ההחלטה | הוזמן · התקבל · חויב, the price source and date, the photo, the driver and the supplier's reply sit inline or in a peek that **follows focus** | 0 navigations to decide a gap; the peek renders from cache in ≤150 ms |
| **P3** | **A notification lands on the decision** | One ₪, one verb, a deep link to the exact card. Quiet hours, Shabbat, at most 6 per person per day | From push to done in ≤2 taps |
| **P4** | **Default the usual, spot-check it, make exceptions cheap** | The common case is 1 tap ("הכל הגיע כמו בהזמנה"), honest through a blind check. An exception takes ≤4 taps. The system does the arithmetic | The §4 tap budgets are pinned in e2e; no field asks for a value the system already knows |
| **P5** | **Undo, don't ask** | Reversible actions are optimistic with a 10 s undo. Anything that goes out to a supplier gets a literal preview and a deferred send. A confirm dialog is only for a write-off, a delete or a release above a limit, and it names the ₪ and the party | 0 `window.confirm()`; confirm dialogs appear only for those 3 kinds |
| **P6** | **Nothing typed is ever lost** | Save per line, a visible outbox, resume at the same line, close offline | An airplane-mode e2e test: 20 lines, reload, reconnect, 0 lost |
| **P7** | **Batch at the desk, one at a time on the phone** | Desk: select, then the bulk bar with Σ₪ and the caps. Phone: one card and one thumb verb | ≥10 decision rows on 1440×900; the bulk bar says why a row cannot join |
| **P8** | **Statuses move themselves; people only decide** | Sent, answered, credited and paid come from events. Every object shows its document chain | The count of hand-set status controls falls to 0 by wave 3 |
| **P9** | **Two instruments, one language** | Field mode and desk mode share tokens, tiers and `<Money>`; only the mode re-binds sizes and contrast | Field routes pass the glove-and-sun spec; desk routes pass a keyboard-only run of J2, J8, J10, J12 |
| **P10** | **Money by capability, not hidden by CSS** | One `<Money>` path decides from the capability. The receiver sees no ₪, not even in notifications | A role-matrix e2e checks the DOM and the tRPC JSON |
| **D1** | **One loud thing per region** (new) | Only tier tokens may fill a surface with danger or warn. Buttons take `action.*`, never status colours. One filled primary per region; in a list it **follows focus** | e2e counts (§0 level 2) |
| **D2** | **Money is a type, not a colour** (new) | Font = the numeric role, colour = `moneyStates`, size = one of 4 money roles, format = `formatIls()`. A figure is never red | Lint: `text-danger` on a `<Money>`/`MoneyCell` is an error once the ratchet reaches 0 |
| **D3** | **Ratchet, not rewrite** (new) | New names are added beside the old ones, the old names become aliases, a count is only allowed to go down, and codemods run after the in-flight work merges | `ratchet.test.ts` (§5.6) |

---

## 2. Foundations

### 2.1 Typography

#### 2.1.1 Font roles

Each role is a token, and a direction (§6) fills the roles with families. Components and pages only ever name the role.

| Role | Token | Used for | A · מאזן | B · דיוק | C · מטבח |
|---|---|---|---|---|---|
| `ui` | `--font-ui` | All Hebrew and Latin interface text | IBM Plex Sans Hebrew | Noto Sans Hebrew (var) | Rubik (var) |
| `num` | `--font-num` | Every ₪, quantity, %, count and date. **Always the same family as `ui`** | = ui (tabular by default) | = ui (tabular by default) | = ui + **mandatory** `tnum` |
| `id` | `--font-id` | Invoice, PO, SKU, ח״פ and allocation numbers, LTR-isolated. Never money | IBM Plex Mono | Noto Sans Hebrew at `wdth 87.5` + `tnum` | Rubik 500 + `tnum` |
| `display` | `--font-display` | Marketing H1 and the monthly report cover. **Never ₪, never in the app shell** | Frank Ruhl Libre 600–700 | none (Noto 800) | Secular One 400 |
| `script` | `--font-script-{ar,th,ti,am}` | Receiver languages, loaded by `unicode-range` only when the glyphs appear | Noto (as today) | Noto (the same family as `ui`) | Noto (as today) |

**Loading rules** (they hold in every direction; owner: `rtl-design-steward`)
1. **Self-host.** Each family lives under `apps/web/public/fonts/<family>/` with its OFL licence file, as Heebo does today. The build never fetches Google Fonts.
2. **Preload both subsets.** Digits live in the *latin* subset and ₪ (U+20AA) in the *hebrew* subset, in every Fontsource family (`FONTS.md` §0.2). So one Hebrew money string needs both files. Preload hebrew + latin for the two app weights used above the fold (400 and 700). Other weights load on demand.
3. **Never synthesise.** Set `font-synthesis: none`, so a missing weight shows as the nearest real weight and never as a fake bold.
4. **Recompute the fallback.** Each family gets a metric-matched `'<Family> Fallback'` face (`size-adjust`, `ascent-override`, `descent-override`). The aim is CLS ≤0.01; today it is 0.0003 with Heebo.
5. **Features come from tokens.** `--font-features-ui` and `--font-features-num`. **Delete** `font-feature-settings: 'cv02','cv03','cv04','cv11'` from `globals.css:227`: those are Inter's features, and none of the candidates has them (`AUDIT.md` §3.2).
6. **Mono is only for IDs.** In direction A, `--font-mono` becomes `'IBM Plex Mono', var(--font-ui)`. In B and C there is no separate mono: `--font-mono` resolves to `--font-id`. W2-15's safety net, Heebo right after JetBrains Mono, stays until the swap.

#### 2.1.2 Type scale (base)

The scale is closed: **14 app roles + 3 marketing roles replace the 59 live size×weight styles.** The sizes below are the base. Each direction adjusts weights and a few line-heights (§6), but never adds a role.
- Sizes are rem, so they follow the browser's font size (a11y-16).
- Line-heights are absolute, which makes rows predictable.
- Density changes only the starred roles (★). Layout spacing never changes with density.

| Role | Desk · default | Desk · compact | Field (phone at the dock, count, supplier link) | Weight | Tracking | Use | Replaces (codemod hint) |
|---|---|---|---|---|---|---|---|
| `caption` | 12/16 · 0.75/1rem | 12/16 | **14/20** · 0.875/1.25rem | 400 · label 600 | 0 | meta, column heads, chips, timestamps | `text-xs`, `text-[9–11px]` |
| `cell` ★ | 14/20 · 0.875/1.25rem | **13/18** · 0.8125/1.125rem | 16/24 · 1/1.5rem | 400 | 0 | table cells, including numbers | `text-sm` inside `<td>` |
| `body-sm` | 14/20 | 14/20 | 16/24 | 400 · 600 | 0 | dense UI, helper text | `text-sm` |
| `body` | 16/24 · 1/1.5rem | 16/24 | 16/24 | 400 · 600 | 0 | reading text; **every input** (no iOS zoom) | `text-base` |
| `title-sm` | 16/24 | 16/24 | 18/26 · 1.125/1.625rem | 600 | 0 | card, row and sheet titles | `text-base/lg font-semibold/bold` |
| `title-md` | 20/28 · 1.25/1.75rem | 20/28 | 20/28 | 700 | 0 | section h2 | `text-xl/2xl` on h2 |
| `title-lg` | 24/32 · 1.5/2rem | 24/32 | 22/30 · 1.375/1.875rem | 700 | 0 | **page h1** (today 36/800, which competes with the hero) | `Heading level=1`, `text-3xl/4xl` |
| `money-dense` ★ | 14/20 | **13/18** | 16/24 | 400 (totals 600) | 0 | ₪ in table cells (`MoneyCell`) | `font-mono tabular-nums` money |
| `money-row` ★ | 16/24 | 14/20 | 18/26 | 600 | 0 | ₪ in decision rows, task rows, totals, inline | `font-semibold tabular-nums` |
| `money-card` | 28/36 · 1.75/2.25rem | 24/32 | 28/36 | 700 | −0.01em | KPI tiles, T2 amount, phone decision card | `text-2xl/3xl` money |
| `money-hero` | 56/60 · 3.5/3.75rem (≥md) · 40/44 (<md) | same | 40/44 · 2.5/2.75rem | 700–800 | −0.02em | **T1 only, one per screen** | hero |
| `qty-field` | — | — | 20/28 · 1.25/1.75rem | 700 | 0 | the ordered quantity on a count row (never ₪) | `text-xl font-bold` qty |
| `id` ★ | 13/20 · 0.8125/1.25rem | 12/16 | 14/20 | 500 | 0 | `<Token>`: HK-24107, SKU-0042/B | `font-mono` on identifiers |
| `kbd` | 12/16 | 12/16 | — | 500 | 0 | `<Kbd>` hints ("J / ח") | new |
| `display-sm` (marketing) | 36/44 | — | 32/40 | 700–800 | −0.02em | landing sections | `text-4xl` |
| `display-md` (marketing) | 48/56 | — | 40/48 | 700–800 | −0.02em | landing H1 | `text-5xl` |
| `display-lg` (marketing) | 64/72 | — | 44/52 | 700–800 | −0.02em | hero, report cover | `text-6xl` |

**Rules**
1. **Floors.** 12 px on the desk (R-13) and 14 px in field mode. Anything below 12 is a lint error (38 sites today).
2. **Line-height.** At least 1.15 at 24 px and up, and at least 1.4 for Hebrew body text. `leading-none` is banned on Hebrew; Heebo's typo line already spans 1.47 em.
3. **Emphasis.** Weight and size only. Hebrew is never tracked, uppercased or italicised (32 tracked and 38 uppercase sites today). Negative tracking is allowed only on `money-*` roles of 24 px and up.
4. **Weights in the app.** 400, 600 and 700, plus 500 for `id`/`kbd` and 800 only for `money-hero` where the family has it. Plex ships 100–700, so in A the hero is 700.
5. **One page title per screen,** set as `title-lg`. The T1 figure is the only thing on a screen bigger than 28 px.
6. **Prose** is capped at 70ch (`container.prose`).

#### 2.1.3 Numerals and ₪: the rules every direction keeps

The test strings (PROCESSES §8):
- "₪38.70"
- "9.5 ק״ג"
- "−₪1,123"
- "1.8%"
- "HK-24107"

These are set inside a Hebrew sentence and in a table column, at 13, 16, 28 and 56 px.

| # | Rule | Why / evidence |
|---|---|---|
| **N1** | **One numeric family = the UI family.** Every number is `tabular-nums lining-nums`, set by the `cell`, `money-*`, `qty-field` and `id` roles and by `.num`. | Today `.num` is a no-op: Heebo has no `tnum`, and its digits only happen to be equal width. Plex and Noto are tabular by default. Rubik is proportional by default and needs `tnum` (present in its GSUB); otherwise its columns drift (`numerals.jpg` E). |
| **N2** | **Never mono for money.** The `id` role is only for identifiers. | JetBrains Mono has no U+20AA, so every ₪ inside `font-mono` is drawn by a system font. Chromium on Linux reported "Liberation Mono (SYSTEM)×1 + JetBrains Mono×6" (`FONTS.md` §0.1). |
| **N3** | **Every ₪ comes from `<Money>`/`MoneyCell` → `formatIls()`.** No hand-built "₪" + number, and no typed `+` or `−`. | `formatIls()` is frozen (money-format-marshal); `<Money>` wraps it. 30 local wrappers each pick their own decimals today. |
| **N4** | **₪ position comes from Intl, never from layout.** In he, the output is `‏1,267.50 ‏₪`: the number, a no-break space, then ₪, with RLM marks. **It renders with ₪ to the left of the digits.** In en, `₪1,267.50` puts ₪ first with no space. Never wrap a Hebrew ₪ string in `dir="ltr"`. Inside a Hebrew sentence, `<Money>` isolates itself with `<bdi>`. | `dir="ltr"` around he output is what produced "152.50₪" (`live/10`); there are 162 `dir="ltr"` sites. |
| **N5** | **Money and quantity columns align to the physical right, in both locales.** Use `NUM_ALIGN = 'text-right'` (owner decision, R-1); never `text-end`, and never an `align` prop on a money column. | `text-end` resolves to the **left** in RTL. The ₪ signs then line up, but the last digits and the decimal points go ragged. With right alignment the digits line up and the ₪ signs sit ragged on the left, which is accepted (`numerals.jpg` C; M6). Today the split is 37 `text-end` / 38 `text-right`. |
| **N6** | **Option for dense ledgers: ₪ once, in the column header** ("סה״כ (₪)"), with cells printed without the symbol, so they read as a clean column. **Bookkeeper compact tables only. Owner screens always print ₪.** | This needs a no-symbol output with the same precision rules. `formatIls()` is frozen, so this is a **proposal to `money-format-marshal`**, for example `<Money symbol="header">` backed by the marshal's util. **Owner decision O1** (§7). |
| **N7** | **Signs.** In he, a negative renders `‏‎-1,123.00 ‏₪`, which displays as "₪ -1,123.00": the hyphen-minus sits between ₪ and the digits.<br>(a) A credit is a **word**, not a sign: "זיכוי ₪84.96" (`<Money>` already does this).<br>(b) A delta is **▲/▼ + the absolute value** (`DeltaCell`).<br>(c) Where a balance must carry a sign (the ledger), the sign comes from `formatIls`/H-01 `signDisplay`, and the column header says what "+" means.<br>(d) **Proposal to money-format-marshal:** emit U+2212 (−) instead of U+002D at the display boundary. All three candidate families contain U+2212. | Measured with fontTools: U+002D is narrower than a digit (Plex 0.399 em against 0.600; Noto 0.322 against 0.570; Rubik 0.487 against 0.616) and sits below the figure centre. A signed column only aligns because of N5. |
| **N8** | **One precision per context** (`MONEY_DECIMALS`): hero, tile and inline at 0 dp, line at 2, unit at 4. **One figure has one precision on a screen.** The exact value lives in `title`/`aria-label` and in the drill table. Every visible total equals its visible rows. | The same leak shows as ₪760 on home and ₪759.54 on the breakdown (`live/01`, `live/03`). |
| **N9** | **Four ₪ sizes and no more:** `money-hero`, `money-card`, `money-row`, `money-dense`. | PROCESSES §8.2; Atlassian `font.metric.*` [pkg]. |
| **N10** | **Formats:** % from Intl ("1.8%"); a quantity always carries its unit through `UnitText` ("9.5 ק״ג"); dates `dd.MM` or `dd.MM.yyyy` through `DateField`/`DateTime`, never the native `type="date"` (15 sites); times are 24 h ("10:12"). An old → new price reads "₪139.00 ← ₪149.00" in he and "₪139.00 → ₪149.00" in en, with the arrow **outside** the number runs (M3). | Browser-locale dates show mm/dd today. |
| **N11** | **Never animate a ₪ value.** No count-up. A changed figure shows a 1 s `selected`-tint background fade. | Owner trust: a number that moves looks invented. |
| **N12** | **₪ by capability.** The receiver sees no ₪ anywhere, including notifications. The chef sees ₪ only on orders and recipes. For a role without ₪, `MoneyCell` **removes the column**; it never blanks the cell. | P10, H-11. |

### 2.2 Colour

**Keep:**
- the light "command center for money" canvas;
- the six status families (`primary`, `danger`, `warn`, `gold`, `info`, `neutral`), each with the same role set;
- `moneyStates`;
- the single focus blue `#1A5BC7`;
- the contrast test (≥4.6:1 for every text/background pair).

**Change:**

| # | Change | Detail |
|---|---|---|
| **C1** | **Semantic names v2, with the v1 names kept as aliases** | `text.primary/secondary/tertiary/disabled/link` (from `ink/muted/subtle`), `border.subtle/rule/control/field/focus` (from `line/line-strong/line-field`), `surface.canvas/surface/sunken/raised/overlay/selected/scrim`. No v1 CSS variable is renamed or removed until the ratchet reaches 0 (§5.6). |
| **C2** | **Action colours are separate from status colours** | `action.primary.{bg,bgHover,fg}` (green), `action.secondary.{border,bgHover,fg}` (outline), `action.quiet.*` (ghost), `action.danger.*` (**destructive only**: write-off, delete, a hard hold). A navigation CTA is never red: the hero's "לחשבוניות שמאחורי ₪760" becomes secondary (`AUDIT.md` §3.8). |
| **C3** | **Selection is a UI state, so it is blue, not green** | `surface.selected` = `#EBF2FD` (today's `info-subtle`; ink on it is 15.2:1). Green stays a money meaning: claimed, credited, and the primary verb. **Owner decision O3.** |
| **C4** | **Figures are never red** | Danger appears only as the T1 rail, a T2 bold chip, a marker dot, a destructive button and the leak series in charts. There are 29 red figures today. |
| **C5** | **A T2 budget** | **Summary surfaces** (home, tiles, the nav, digests): at most **3 bold danger/warn elements per viewport** and at most 1 per row, because five equal T2 tiles say nothing (PROCESSES §8.4). **Work queues** (approvals, claims, the pay run): every row is already a task, so its severity chip renders **subtle** (icon + word + tint) and turns **bold only when the row is overdue or due within 48 h**. This is PROCESSES P1's test: T2 badges ≤ items inside their window. |
| **C6** | **A field palette** | Under `data-mode="field"`: `text.secondary` becomes a darker field grey (≥8.2:1 on every surface; A `#3B4B43`, B `#36453F`, C `#463F36`). `text.tertiary` is not allowed. `border.control` becomes `border.field` (≥4.8:1). Surfaces are opaque and the focus ring is 3 px. |
| **C7** | **v1 tints retire** | The 688 `bg/border/ring-{status}/N` tints move to the `-subtle` roles, which are in the contrast test. A `/N` tint never is. |
| **C8** | **Print colours are generated from the tokens** | Ink on white; a marker prints as ink + icon. This replaces the stale `#b4123a`. |

#### 2.2.1 The emphasis tiers (unchanged meaning, now enforced)

| Tier | Meaning | Allowed treatment | Tokens | Budget | Examples |
|---|---|---|---|---|---|
| **T1** | The leak: the hero number | `money-hero` figure in **ink**, a 4 px danger rail on the start side, overlay radius. The CTA is secondary (navigation) | `emphasis.t1.rail`, `money.figure.leak` = ink | **1 per screen** | "דליפת החודש ₪760" |
| **T2** | Act now: ₪ awaiting approval, a blocking gap, a receiving mismatch, a claim to send, a due date inside its window | A **solid** danger/warn `StatusChip` + an ink ₪ + **one** primary verb (green `action.primary`) | `emphasis.t2.chip` (bold), `emphasis.t2.rail` (optional, rows only) | **Summary surfaces: ≤3 bold per viewport, ≤1 per row. Queues: bold only when overdue or due ≤48 h; otherwise a subtle chip with an icon** | "חוסם · ₪296" + "דרשו ₪38.70" |
| **T3** | Good news: caught, claimed, credited, returned, price drops | A gold or primary **figure**, a subtle chip, a ✓ icon. No rail, no filled button | `money.figure.{caught,returned}` = gold, `{claimed,credited}` = primary | No limit; calm | "הוחזר ₪1,267" |
| **T4** | Pending: waiting on someone else, a consolidated invoice (חשבוניות ריכוז), inside tolerance, snoozed | A **muted** figure + a clock icon + a neutral subtle chip. Never red or orange, never a button colour | `money.figure.pending` = muted | No limit | "ממתין לשיוך · חשבונית ריכוז" |

#### 2.2.2 Palette refinement (primitives → semantic)

- **Primitive ramps** are 11 steps (25…950), OKLCH-interpolated from today's anchors: green `#066B4A`, red `#B80F2A`, orange `#A63D00`, gold `#755C00`, blue `#1A5BC7`, and a green-tinted neutral running `#FFFFFF … #0F1F17` (values in `AUDIT.md` §7.2). Primitives are **private** to `ui-tokens`, and only semantic roles reach components.
- **Neutrals** are where the directions differ (§6):
  - A keeps today's green-grey;
  - B moves to a cooler, slightly darker slate;
  - C moves to a warm paper.

  All three keep every text pair ≥5.1:1 (Appendix A).
- **Status families stay.** C warms them slightly, at the same lightness, and still passes 5.5:1.

#### 2.2.3 Data-viz palette

| Role | Value | Contrast on white | Rule |
|---|---|---|---|
| Categorical 1–6 (suppliers, categories) | `#1A5BC7` blue · `#007A85` teal (darkened from today's `#00838F`, which is 4.52:1) · `#8A4FBF` violet · `#755C00` ochre · `#4A5D53` slate · `#9C3D7A` plum | 6.24 · 5.09 · 5.31 · 6.39 · 7.04 · 6.25 | **No green, red or orange in the categorical set.** Those three keep their money meanings (today viz-1 is the primary green and viz-6 is warn orange). Each series is ≥4.6:1 on white (the repo's test margin), so it also works as a text label. Pair each with a shape or pattern. Above 6 series, group into "אחר" |
| Sequential: price creep | `creep-1…5` (as today: `#FDF0E7 → #7A2D00`, each with its text colour) | — | **One ramp.** `LeakHeatmap` drops its private `#FDF0E8→#6E2800` copy |
| Diverging: price movers | rises `#B4531A` (creep-4) · drops `#066B4A` · no change: a neutral line | 5.01 · 6.54 | Drops are **T3 good news**, never alarming (M4) |
| The leak series | `#B80F2A` | 6.69 | The only danger in a chart. Never "a supplier exists" (the `live/10` red bars) |
| Previous period | `#7A8B82` | 3.59 | A thin bar or a 1.5 px line |
| Target / tolerance | text.secondary, 1 px dashed | — | |
| Grid | `#D3DDD7` (border.subtle) | 1.39 | Decorative only |

**Chart rules:**
- Bars compare; a line shows a trend; a heatmap is used only for weekday × supplier creep. **Never a pie or donut for money.**
- ₪ labels are 0 dp through `formatIls`. Compact thousands ("12.4 אלף ₪") need a money-layer format, because Intl `he-IL` compact returns "12.4K", so this is a proposal to `money-format-marshal`.
- Bars sort descending from the start edge. The time axis runs oldest on the left (`rtl.md` P8).
- A sparkline is a 1.5 px line with no axes and a dot on the last point.
- Every chart has a table fallback, and colour is never the only channel.

### 2.3 Spacing

- **Base 4 px. Steps:** `0 · 2* · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64` (*2 only inside chips, icons and badges). 90% of today's spacing is already on the grid; the off-grid steps `0.5/1.5/2.5/3.5/7/9/11` are lint-banned in layout classes outside `lib/components`.
- **Semantic aliases** (Tailwind `spacing.extend`):

  | Alias | Value |
  |---|---|
  | `inset-chip` | 8 |
  | `inset-control` | 12 desk / 16 field |
  | `inset-cell` | `var(--cell-px)` |
  | `inset-card` | 16 (C: 20) |
  | `stack-xs` · `stack-sm` · `stack-md` · `stack-lg` · `stack-xl` · `stack-2xl` | 4 · 8 · 12 · 16 · 24 · 32 |
  | `gutter-page` | 16 / 24 / 32 by breakpoint |

- **Density re-binds only** `--row-h`, `--control-h`, `--cell-px`, `--chip-h` and the ★ type roles. Page layout stays put when the density toggle flips.

### 2.4 Radius

| Role | Base | Use |
|---|---|---|
| `xs` | 4 | checkbox, `kbd`, a chip inside a table cell, an inline token |
| `control` | 8 | buttons, inputs, selects, segmented control, menu items |
| `card` | 12 | **every** card, tile and list group (`Card` moves from 16 to 12) |
| `overlay` | 16 | dialog, the top of a sheet, popovers ≥320 px, the T1 hero |
| `pill` | 9999 | status chips, count badges, avatars, filter chips |
| marketing `xl` | 24 | landing only |

There are 29 radius classes today; DS2 has **5 roles plus 1 marketing role**. Each direction re-binds the values (§6: A tighter, B near-square, C softer) without changing the roles.

### 2.5 Elevation

| Level | Visual | Use |
|---|---|---|
| `e0` | 1 px `border.subtle`, no shadow | **the default**: every card, tile, table and list |
| `e1` | today's card shadow | sticky bars **once scrolled**, a dragged row. In C only, also the hero and the phone decision card |
| `e2` | popover shadow | menus, popovers, toasts, the peek on overlap |
| `e3` | modal shadow + `scrim` | dialogs, sheets |
| `rail` | 3–4 px bar on the inline-start side | **T1 and T2 only**, one per item |
| `ring.selected` | 2 px inset `action.primary` | the selected row or card |

**Deleted from the app:**
- `shadow-glow-*` (33), `glow-*-blob` (21), `flow-stream`/`FlowAccent`/`FlowBar` (43) and `leak-gradient` (6);
- `.glass` on the chrome;
- inset-shadow "borders";
- `shadow-card` on list cards (109).

One brand accent may remain in marketing.

### 2.6 Motion

| Token | ms | Easing | Use |
|---|---|---|---|
| `micro` | 100 | standard | hover, press, colour state layers, checkbox |
| `short` | 150 | standard | chip toggle, chevron, **a decided row collapsing**, the tab indicator |
| `medium` | 240 | enter | toast, popover, sheet enter, peek open |
| `long` | 400 | enter | a full-screen sheet; a chart drawing once |
| exits | 0.6 × entrance | exit | every overlay |

**Rules:**
- Transition named properties only; `transition-all` is lint-banned (36 sites).
- No hover lift or scale on data (`LeakHeatmap` `hover:scale-[1.03]`).
- No infinite animation except the spinner, the skeleton shimmer and the undo countdown ring.
- Never animate a ₪ (N11).
- Reduced motion collapses everything; this exists today.
- The peek must render in ≤150 ms from cache, and a key response in ≤100 ms (Superhuman's 100 ms rule, Q9).

### 2.7 Iconography

- **One library:** lucide, only through `<Icon>` and `<DirIcon>`. There are 746 direct imports today; codemod them to `<Icon>`.
- **Sizes:** 14 / 16 / 20 / 24 (`--icon-sm/md/lg/xl`). There are 7 sizes today.
- **Stroke:** 1.75 on the desk and 2 in field mode. `strokeWidth={3}` is banned.
- **A registry by meaning.** One glyph per concept, in `lib/components/icons.ts`:
  - warning `TriangleAlert`
  - success `CircleCheck`
  - pending `Clock`
  - blocked `OctagonX`
  - credit `ReceiptText`
  - photo `Camera`
  - offline `CloudOff`
  - outbox `RefreshCw`
  - supplier `Truck`
  - invoice `FileText`
  - claim `Send`
  - undo `Undo2`

  `AlertTriangle` and `CheckCircle2` become aliases and are then removed.
- **Direction:**
  - Only directional glyphs mirror (back, forward, chevrons, "next"), through `<DirIcon>`, replacing 65 manual `ltr:/rtl:` flips.
  - **Never mirrored:** ✓, the clock, ▲/▼ trend glyphs, media controls, numbers and charts' time axes (R1).
- **Status always pairs icon + word + colour.** An icon alone is never a status (`live/03` has an ⓘ-only row).
- **An icon-only button** needs `aria-label` and a tooltip. Decorative icon chips (the pink bell tile) are removed.

### 2.8 Density and modes

The density and mode axes are independent. The **shell** sets them on `<main>` from role × device × the saved-view override. Components read only variables, and the per-page `compact ?` booleans are deleted.

| Axis | Value | Default for | Re-binds |
|---|---|---|---|
| `data-density` | `compact` | the bookkeeper; ledgers, exports, the catalog (desk) | `--row-h`, `--control-h`, `--cell-px`, `--chip-h`, `--decision-row-h`, ★ type roles, `--icon-md` 14 |
| | `default` | owner and manager (desk) | base values |
| | `touch` | any coarse pointer (the floor) and the supplier portal | row 56, control 48, chip 28, hit area ≥44 |
| `data-mode` | `desk` | fine pointer at `lg` and up | — |
| | `field` | the receiver (always), the chef on a phone in count and receiving, the supplier link, capture | caption 14/20, field text colours (C6), `border.field`, focus 3 px, control 48, primary **56** full width, one primary per screen, count row height, no hover-only or gesture-only actions, opaque surfaces, the bottom bar hidden inside a task flow |
| | `print` | `@media print` + `data-print-root` | ink on white, no rails or shadows, colours generated from tokens |
| pointer | `coarse` | automatic | the 44 px floor (exists) |

Base heights (A values; B and C in §6):

| Token | compact | default | touch | field |
|---|---|---|---|---|
| `--row-h` (table row) | 32 | 44 | 56 | 56 |
| `--decision-row-h` (2-line DecisionRow) | 52 | 64 | — (card) | — (card) |
| `--control-h` | 32 | 40 | 48 | 48 |
| `--btn-h-primary` | 32 | 40 | 48 | **56** |
| `--chip-h` | 20 | 24 | 28 | 28 |
| `--cell-px` | 8 | 12 | 16 | 16 |
| `--count-row-h` | — | — | — | 72 |
| `--nav-item-h` | 32 | 36 | 44 | — |

**Dock contrast (F6).** Field mode is a token layer, not a component fork. It works like Atlassian's increased-contrast theme:
- text ≥7:1 (ink ≥15:1, secondary ≥8.2:1);
- borders ≥3:1;
- an optional `--type-scale` multiplier (1.0 by default, 1.125 for "dock large") applied to every `--fs-*` in field mode.

---

## 3. The component layer

Each spec below has the same parts: purpose · anatomy · sizes by density/mode · states · rules · keys and a11y · what it builds on and its status · component tokens.
- Sizes use direction A's values. B and C re-bind them through the component tokens (§6, `directions.json`).
- Every component reads **only component or semantic tokens**.
- **Status** means where the work stands: main = on `main`; W2 = built in a wave-2 draft PR; new = proposed here.

### 3.1 `MoneyCell` (and `<Money>`)

**Purpose.** The only way a ₪ reaches the screen. It serves P10, N1–N12 and M1.

**Anatomy.**
- The `formatIls()` output, split by `splitGlyph`. The hero renders the glyph smaller; cells don't.
- An optional state marker: a 6 px dot or the row's rail, **never a figure colour**.
- An optional drill affordance (underline on hover or focus).
- The exact figure in `title` and `aria-label` whenever the shown figure is rounded.

**Props:**
- `value | agorot`;
- `context` (`hero | tile | line | unit | inline`, which sets precision);
- `state` (a `MoneyState`, which sets the figure colour);
- `role` (taken from the capability);
- `drill` (rows that sum to it to the agora);
- `symbol` (`inline` by default; `header` is a proposal, N6).

**Sizes:**

| Where | compact | default | field |
|---|---|---|---|
| table | `money-dense` 13/18 | 14/20 | 16/24 |
| row | `money-row` 14/20 | 16/24 | 18/26 |

`money-card` and `money-hero` are context sizes and the same in every density.

**States:**

| State | Treatment |
|---|---|
| default | ink figure |
| `pending` | muted figure + `Clock` 14 |
| `caught` / `returned` | gold figure |
| `claimed` / `credited` | primary figure (+ ✓ when credited) |
| `zero` | muted "₪0" |
| `unavailable` | "—" with sr-only "לא זמין". Never ₪0 |
| `changed` | a 1 s fade of `surface.selected` behind the figure |
| `focused` (drill) | focus outline on the figure |
| total row | weight 600, with a 1 px `border.control` rule above |
| no ₪ capability | the column is **absent**, not blank |

**Rules.**
- Physically right-aligned (N5) and tabular (N1); never mono (N2), never red (C4).
- Column width is set in `ch` from the largest value on the page, so the column does not jump as rows load.
- A column of mixed contexts is not allowed. A table column is `line` (2 dp) or `tile` (0 dp), never both.

**Keys / a11y.**
- With drill: Enter opens the rows that sum to it.
- The `aria-label` speaks the full figure and its state ("₪759.54, דליפה").

**Builds on** `money/Money.tsx`, `format.ts` (`NUM_ALIGN`, `MONEY_DECIMALS`, `splitGlyph`, `stateClass`). **Status:** main (1 product use) → DS2: the only renderer. The 30 local wrappers retire.

**Tokens:** `--money-font: var(--font-num)` · `--money-features: var(--font-features-num)` · `--money-marker-size: 6px`.

### 3.2 `DeltaCell` (and `PriceMove`)

**Purpose.** A change in price or in a period: one glyph and one value. Serves M3, M4 and R1.

**Anatomy:** ▲ or ▼ (a text glyph, not mirrored) + the absolute value ("7.9%" or "₪153/חודש"), with an optional second line for the ₪ impact. For a price change, the PriceMove variant reads old ← new.

| Direction of the change | Colour | Hidden word (screen reader) |
|---|---|---|
| Cost rose | `warn.text` | "עלייה" |
| Cost fell | `primary.text` (T3, calm) | "ירידה" |
| No change | `text.secondary` "ללא שינוי" | — |

**Rules.**
- **One signal + colour.** Never an icon + a glyph + a word + a colour together; `DeltaBadge` draws all four today (`live/10`).
- The sign comes from the glyph, so the number is shown absolute (`signDisplay: 'never'` once H-01 merges).
- Rank movers by ₪ impact, with an "השפעה ב-₪ / מחיר ליחידה" toggle, and show drops as well as rises (M4).
- An old → new price: "₪139.00 ← ₪149.00 · ▲7.2% · מחשבונית HK-24108 · 18.10" (M3). The arrow is `←` in he and `→` in en, always outside the number runs.

**Sizes:** follows the cell or row role. In a chip-like pill form it uses `--chip-h`.

**Builds on** `money/Delta.tsx` (v2, 0 uses) and `PriceMove`. `views/DeltaBadge.tsx` retires onto it. **Status:** main → DS2: the only delta.

### 3.3 `StatusChip` and the status registry

**Purpose.** One renderer for every state, so every state reads as "icon + word + colour". Serves P1, P8 and D1.

**Anatomy:** an icon (14) + a word (≤2 words, `caption` 600) + an optional ₪ for T2 ("חוסם · ₪296"). One line, never wrapping.

**Variants:**
- `subtle`: the default, for T3, T4 and info;
- `bold`: **T2 only**;
- `outline`: the B tag style.

**Sizes:**

| | compact | default | field / touch | inside a table cell |
|---|---|---|---|---|
| height | 20 | 24 | 28 | 20, radius `xs` |

The standalone chip uses radius `pill` (B: 4).

**States:**
- static (most chips);
- interactive (FilterChip: `aria-pressed`, hover `-subtle-hover`, focus outline).

The count badge (`CountBadge`) is a neutral pill. It turns bold only in the "לטיפולי" T2 nav item.

**The registry** (`lib/components/status/registry.ts`, new) maps each domain object to `state → {tone, icon, labelKey, tier}`. **Only `StatusChip` renders it.** It replaces 9 product-local chip functions, 10 showcase ones and 19 inline pills. A first cut:

| Object | States (he label → tier) |
|---|---|
| Invoice | לבדיקה (T4) · הותאמה (T3) · פער פתוח (T2 warn) · חוסם (T2 danger) · מאושרת לתשלום (T3) · שוחררה לתשלום (T3, Q4) · שולמה (T3) · חשבונית ריכוז · ממתינה לשיוך (T4) |
| Gap / approval | אזהרה (T2 warn) · חוסם (T2 danger) · בתוך הסף (T4, never a task) · נדחה לשיחה · יחזור 12.11 (T4, Q5) · הוחלט ע״י מיכל (T4) |
| Claim | טיוטה (T4) · מוכנה לשליחה (T2 warn) · נשלחה (T4) · ממתינה מעל 7 ימים (T2 warn) · נענתה (T4) · זוכתה (T3) · הוחזרה (T3) |
| Delivery | צפוי 10:00 (T4) · באיחור (T2 warn) · בקבלה (info) · התקבל (T3) · התקבל עם חריגות (T2 warn, **no ₪** for the receiver) · ספק בלי הזמנה (T2 warn) |
| Purchase order | טיוטה (T4) · נשלחה (T4) · אושרה ע״י הספק (T3) · שונתה ע״י הספק (T2 warn) · נסגרה (T4) |
| Line (field) | הגיע ✓ (T3) · חסר 0.5 (T2 warn) · פגום · תחליף · מחיר על התעודה (T2 warn) · ממתין לשליחה ⟳ (T4) |

**Rules.**
- `bold` is allowed only when the registry says T2.
- An e2e check counts bold chips: ≤3 per viewport on summary surfaces, and in queues bold only on overdue or ≤48 h rows (C5).
- A label longer than 16 characters fails the registry test.

**Status:** main (`StatusChip` exists, 0 uses) → DS2: the registry is new.

### 3.4 `DecisionCard` / `DecisionRow`

**Purpose.** Approve, claim, pay as billed or dispute, as one sentence with its evidence one key away. Serves P1, P2, P5, P7, D1, Q2, Q6 and Q9. Jobs: J2, J5, J7 (a supplier change), J8 (a consolidated invoice) and J11 (holds).

**Desk row** (`DecisionRow`, 2 lines, `--decision-row-h` 64 default / 52 compact):

```
RTL · start = right                                                       end = left
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ☐ [חוסם] חיוב על יותר ממה שהתקבל · עגבניות שרי · ירקות השרון · SH-24121    ₪38.70 │
│    חויבו 9.5 ק״ג · התקבלו 6.5 → ₪38.70 · מומלץ לדרוש   ממתין 10 ימים · עד 14.11      │
│                                            [ דרשו ₪38.70  1 ] [ שלמו  2 ] [ ⋯ ]    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

At 1440 the verbs sit on line 1, at the end side; below `xl` they move into line 2 as shown. The ₪ in the row (`money-row`) sits **next to the title**, at the physical right of its own block (Q1: the eye does not cross the screen).

**Phone card** (`DecisionCard`):
1. chip + title;
2. **₪ at `money-card` 28/36**;
3. the WhyLine math;
4. the due chip and the age;
5. **[ דרשו ₪38.70 מהספק ]** 56 px, full width;
6. [ שלמו כפי שחויב ] 48 px;
7. "הצג ראיות" → `EvidenceDrawer` as a sheet.

**The primary follows focus (D1).** In a desk list, every row's verbs render `quiet`. **Only the focused row** renders its recommended verb as a filled `action.primary`. The peek never repeats it. One filled primary per viewport replaces 4 today (`live/05`) and the duplicate in W2-04's peek.

**States:**

| State | Treatment |
|---|---|
| default | quiet verbs |
| hover | `surface` → `sunken`, 100 ms |
| focused | 2 px focus outline inset; verbs promote; the peek follows in ≤150 ms |
| selected | `ring.selected` + `surface.selected`; the checkbox is ticked |
| deciding | inline spinner in the pressed button; the row keeps its height |
| decided | the row collapses in 150 ms; an `ActionToast` reads "נדרשו ₪38.70 מירקות השרון · ביטול" |
| undone | the row returns in place with a 1 s highlight |
| locked by someone else (Q6) | a T4 chip "מיכל פתחה לפני 2 דק׳"; verbs disabled with `disabledReason` |
| decided elsewhere | "הוחלט ע״י מיכל · 09:12" replaces the verbs |
| error | inline `InlineMessage`; the row stays focused and selected |
| suggested (Q2) | the recommended verb is the default primary, and the WhyLine adds "מומלץ: …" with a one-line reason |

**Rules.**
- Exactly 1 primary + 1 secondary + overflow ("העבירו לבעלים", "ויתור עם סיבה", history).
- "שלמו כפי שחויב" opens reason chips (exists).
- A waive above ₪500 opens a `ConfirmDialog` that names the ₪ and the supplier (P5).
- A blocking gap never joins a bulk selection; the checkbox is disabled, and its tooltip gives the reason.

**Keys** (bound by `code`): J/K focus · X select · Shift+X range · `1` primary · `2` secondary · `3` pass on or later · Enter pins the peek · O opens the full page · Z undoes · `?` opens the key map.

**A11y.**
- The rows form a `role="grid"`, and each row has `aria-describedby` pointing at its WhyLine.
- Each verb button names its ₪ ("דרשו ₪38.70").
- Live region: "נדרש · ₪38.70 · ביטול זמין 10 שניות".

**Builds on** `Badge`, `WhyLine`, `Button`, `desk/keys.ts`, W2-04 (grouped by invoice, caps, keys). **Status:** main (cards) → W2-04 (desk) → DS2 (row height, primary follows focus, presence, suggestion).

**Tokens:** `--decision-row-h`, `--decision-gap`, `--decision-verb-h: var(--control-h)`, `--rail-w`.

### 3.5 `EvidenceDrawer` (EvidencePeek)

**Purpose.** Bring the proof to the decision: 0 page changes (P2, T4, M3). Jobs: J2, J5, J10 and J12.

**Placement.**
- **Desk:** a side pane on the **end** side (left in RTL), 400–480 px, resizable with a drag handle or the arrow keys. `[` / `]` move between panes (K4: never H/L or ←/→). The split ratio is saved per user in `localStorage`, inside try/catch.
- **Phone:** a bottom `Sheet` with detents at 50% and 92%.

**Sections, in a fixed order:**
1. `ThreeWayRow`: **הוזמן 9.5 · התקבל 6.5 · חויב 9.5**, unit-aware, the same component used in the order, the invoice and the claim letter.
2. A crop of the document with the line highlighted, or the T4 text "אין צילום לחשבונית הזו".
3. The receiver's line photos (1–3), each stamped "10:12 · רמי", plus the driver's name or signature (F5).
4. The price source and its date: "מחיר מההזמנה 19.10" / "חוזה" (M3).
5. The supplier's reply, if any.
6. History: who decided what, and when.

**States:**
- loading (a skeleton of the final boxes);
- cached + stale (a T4 "עודכן לפני 4 דק׳");
- empty (a T4 sentence per missing item);
- error (what failed, plus "נסו שוב"; never closes by itself).

**Rules.**
- **It follows focus.** There is nothing to open or close.
- **It never repeats the primary.** It may hold one quiet "פתחו חשבונית (O)".
- A photo opens a lightbox (an e3 overlay) with pinch-zoom on the phone.

**Builds on** `desk/Peek`, `desk/SplitPane`, `overlay/Sheet`. **Status:** W2-04 → DS2 (fixed order, never the primary, stale state).

**Tokens:** `--peek-w: 440px` (`min 360 / max 560`), `--peek-section-gap: 16px`.

### 3.6 `BulkActionBar`

**Purpose.** Batch at the desk (P7, Q7, Q8, T2). Jobs: J2, J4, J8 and J11.

**Anatomy.** It replaces the toolbar **in place, at the same height** (Carbon), so nothing below it jumps. From the start side:
1. "**6 נבחרו · ₪152.50**" (`money-row`);
2. the scope line: "נבחרו 6 בעמוד הזה · בחרו את כל 23 התואמים לסינון";
3. **one** verb: the policy-safe default, as a filled primary ("דרשו 6 זיכויים");
4. the exclusion note: "2 לא יכולים להצטרף · פער חוסם" → filter to them;
5. the caps line: "עד ₪200 לחשבונית במרוכז";
6. Clear (Esc).

**Sizes:** the toolbar height (48 default / 40 compact). **Hidden below 490 px**; the phone works one card at a time.

**States:**
- idle (hidden);
- active;
- working (the verb shows progress; the selection is locked);
- partial failure: "**2 מתוך 6 לא נשלחו · נסו שוב**". The 2 stay selected and the 4 leave the list.
- success: an `ActionToast` with undo.

**Rules.**
- Only the default verb is offered in bulk; the rarer or riskier verb stays per item (Q8).
- Σ₪ always shows.
- **The selection survives a failure** and clears only on success or explicit cancel (T2, Polaris).
- Changing a filter keeps the selection and says so ("6 נבחרו, 2 מוסתרים בסינון").

**Keys:** X / Shift+X · Ctrl/⌘+A selects within the stated scope · Esc clears.

**Builds on** `table/BatchBar`, `selection`. **Status:** main (0 uses) → W2-04 → DS2 (in-place, scope, failure rules).

### 3.7 `WorkQueueTable` (DataTable with typed columns + `WorkQueueTabs`)

**Purpose.** One table system for every queue and ledger: approvals, register, pay run, claims, inbox, ledger and exports. Serves M1, M6, T1, T3, T5, T6, P7 and P10. It replaces 42 hand-rolled tables in 33 files.

**Column kinds** (a column declares `kind`; the table formats, aligns and picks the font):

| `kind` | Renders through | Align | Font / role | Notes |
|---|---|---|---|---|
| `text` | plain text, never truncated beyond 2 lines | start | `cell` | the identity column is sticky |
| `id` | `<Token>` | start, LTR-isolated | `id` | "HK-24107" with `dir="ltr"` + `unicode-bidi: isolate` |
| `money` | `MoneyCell` | **physical right; no `align` prop** | `money-dense` | totals footer; the column drops out without the ₪ capability |
| `qty` | `UnitText` | physical right | `cell` + tnum | the unit always shows |
| `date` | `DateTime` | start | `cell` + tnum | `dd.MM` within the current year, else `dd.MM.yy` |
| `status` | `StatusChip` (registry) | start | chip 20 | in a table, chips use radius `xs` |
| `delta` | `DeltaCell` | physical right | `cell` | |
| `ageing` | "10 ימים" + tone from `deadlineTone` | start | `cell` | neutral ≤3 days, warn ≤7, danger only when late |
| `actions` | `RowActions` | end | quiet buttons | the primary follows focus (D1) |
| `select` | checkbox | start | 16 px box, 44 px hit area | |

**Structure:**
- `WorkQueueTabs` above, with counts ("דורש טיפול 4 · מגיע היום 3 · באיחור 1 · טיוטות 2");
- a sticky header **at row height**;
- group headers (by supplier, invoice or due date) with Σ₪ at the physical right;
- a totals footer that equals the visible rows;
- the caption "1–25 מתוך 63";
- saved views and a columns menu (exist);
- expandable rows (the ledger).

**Row states:**

| State | Treatment |
|---|---|
| default | — |
| hover | `sunken` |
| focused | focus outline inset |
| selected | `ring.selected` + `surface.selected` |
| flagged | T2: the start rail, `--rail-w` |
| resolved | `text.secondary` for 150 ms, then removed or muted |
| changed | 1 s highlight |
| disabled | reason in the tooltip |
| loading | skeleton rows at the final height |

**Headers:** `caption` 600, sentence case, **never uppercase or tracked, never wrapping**. A long header is shortened, and the full text sits in `title` (today "שווי תעודות (לפני מע״מ)" wraps, `live/07`). Units go in the header: "(לפני מע״מ)", "(₪)" (N6).

**Empty, error, offline:** one sentence + one CTA (T5); the forms are listed in §3.10.

**Responsive.** Below `md`, the same column definitions render `MobileCardList`: the identity, then ₪, then the status, then one verb. **One tree, no `md:hidden` twin**; there are 70 such pairs today.

**Density:** row 32 / 44 / 56; cell padding 8 / 12 / 16 px (Primer condensed / normal / spacious).

**Builds on** `table/DataTable` (lab), `ViewTabs`, `ColumnsMenu`, `useTableUrlState`. **Status:** main (lab only; `DataTable.tsx:72-74` reads unset variables) → DS2: fix the variables (§5), add the kinds, adopt it area by area.

### 3.8 `FieldCountRow` (+ `ExceptionSheet`, `QtyKeypad`, `OutboxChip`)

**Purpose.** Count a delivery at the back door with one thumb, in gloves, in sunlight, offline (P4, P6, P9, F2, F5, F8). Jobs: J3 and the inventory count. **No ₪ anywhere.**

**Anatomy** (field mode):

```
RTL · start = right (thumb)
┌──────────────────────────────────────────────┐
│ פלפל אדום                        הוזמן 9 ק״ג │  name title-sm 18/26 · ordered qty-field 20/28 700
│ [ ✓ הגיע ]  56×56, start edge        [ ✗ ] 48│  ● saved   or   ⟳ ממתין
└──────────────────────────────────────────────┘
```

**Sizes:** `--count-row-h` 72 (A) / 64 (B) / 80 (C). The ✓ target is 56×56 and ✗ is 48×48, with ≥8 px between targets. That gives **8 rows per 390×844 viewport** (A, measured), against about 2 today (each line is ≈143 px with two equal 48 px buttons, `live/13`).

**States:**

| State | Treatment |
|---|---|
| to count | — |
| arrived | ✓ filled `primary-subtle`, check icon |
| exception | `warn-subtle` + a reason chip + "6.5 מתוך 9.5 ק״ג" |
| saved | a dot |
| queued offline | "⟳ ממתין". Never shown as "unfinished" (F5) |
| photo attached | a 24 px thumbnail |
| error | what failed + a retry; the line is kept |

**ExceptionSheet.** ✗ → reason chips (חסר · חלקי · פגום · תחליף · מחיר על התעודה) → `QtyKeypad` (big digits, decimal point, the unit shown) → 📷 → "שמרו". **≤4 taps.**

**Sticky action bar.** Primary "**הכל הגיע כמו בהזמנה (11)**", 56 px, full width, ≥16 px above the safe area. The secondary "צלמו תעודה" (48) **moves from the top-left corner to the bottom bar** (PROCESSES §7.2). There is never a third button.

**OutboxChip.** "⟳ 3 ממתינים" is always visible in the header; it opens the outbox sheet with "שלחו עכשיו".

**Rules.**
- Field mode only (C6, 3 px focus).
- The blind spot check stays: 2 random lines, numbers only.
- No gestures: swipe is never the only way to act (F1, F8).
- Every line saves on tap, and the screen resumes at the same line (P6).

**Builds on** `AdjustQuantities` row (W1-06), `overlay/QtyKeypad`, `form/FilterChip`, `lib/pwa/lineOutbox`. **Status:** main (2 equal buttons) → W2-05 (outbox, photo per line) → DS2 (one ✓, row height, camera position).

### 3.9 `ActionToast` (undo)

**Purpose.** "Undo, don't ask" (P5, Q10).

**Anatomy:**
- a past-tense sentence with the ₪ and the party ("נדרשו ₪38.70 מירקות השרון");
- a "ביטול" button with its key hint (Z);
- a countdown ring, which is the one looping motion allowed.

The send variant reads "**נשלח · בטל שליחה (10)**". It is a deferred send: nothing leaves until the countdown ends.

**Placement:** bottom-start, which is bottom-right in RTL, 400 px wide on the desk. On the phone it sits above the bottom bar or action bar. At most 3 stack.

**Timing:**
- a success with undo stays 10 s, pausing on hover or focus;
- plain info stays 5 s;
- **an error never closes by itself.** It says what failed, what was kept and what to do next.

**A11y:** `aria-live="polite"` (errors use `assertive`); the action is reachable by keyboard (Z, or Tab into the toast).

**Rules.**
- Money is never shown as *sent* or *paid* before the server confirms (Q10). The toast reads "נשלח" only after the outbox acknowledges; until then it reads "שולח…".

**Builds on** `Toast` v2, `orders/undo-bar`. **Status:** main → DS2: one component, send variant.

### 3.10 Empty states

One sentence + one CTA, with an optional 24 px icon. No illustrations inside the app.

| Kind | When | Copy pattern (he) | CTA | Tier |
|---|---|---|---|---|
| `all-done` | the queue is empty because the work is done | "הכל טופל · ההחלטה הבאה תגיע כשתיכנס חשבונית" | "לדוח הדליפה" (quiet) | T3 calm |
| `first-use` | no data yet | "עוד לא נקלטו חשבוניות · צלמו את הראשונה או העבירו מייל" | "צלמו חשבונית" (primary) | T4 |
| `filtered` | filters hide everything | "אין תוצאות לסינון הזה" | "נקו סינון" | T4 |
| `no-access` | role or capability | "המסך הזה זמין לבעלים ולמנהל" | — | T4 |
| `error` | load failed | "לא הצלחנו לטעון · הנתונים שנשמרו לא אבדו" | "נסו שוב" | T2 only if blocking |
| `offline` | no signal | "אין קליטה · מציג נתונים מ-10:12 · מה שתסמנו יישלח לבד" | — | T4 |

Builds on `EmptyState` (36 uses). DS2 fixes the kinds and the copy pattern.

### 3.11 Navigation: sidebar (desk) + bottom bar (phone) + palette

**Sidebar** (per `docs/ux/sidebar/SPEC.md`; W1-03):
- **Width:** 248 expanded / 64 rail (`chrome.sidebar-w`, `rail-w`); Ctrl/⌘+B collapses it (exists).
- **Groups:** grouped IA, with an active bar on the start side, 3 px, `action.primary`. Item height `--nav-item-h` is 36 default / 32 compact.
- **Count badges** are neutral pills. Only "לטיפולי" (W2-08) may show a **bold T2 badge with ₪**, and it is the single loud item in the nav.
- **At the top:** the restaurant switcher, then "חיפוש ופעולות ⌘K".
- **Keys:** G-chords ("G then A" approvals, "G then I" invoices, "G then R" receiving), bound by `code`, with `<Kbd>` hints in tooltips ("G · א").

**Bottom bar** (phone):
- 64 px + the safe area, at most 5 items, set per role. The active item shows a pill tint (as today, `live/11`).

| Role | Items |
|---|---|
| owner | בית · לטיפולי · חשבוניות · ספקים · עוד |
| manager | בית · לטיפולי · הזמנות · קבלה · עוד |
| receiver | היום · קבלה · עוד (no ₪ items) |
| chef | הזמנות · ספירה · מתכונים · עוד |

- **Field mode hides it inside a task flow** (count, capture); it shows on the field home.

**CommandPalette** (#19). Ctrl/⌘K anywhere opens screens · records · actions · "שאלו את RestoMatch" · recent items. A result row shows: number · date · ₪ · status. Enter opens the record's working view (the invoice cockpit), never an edit form.

**KeyHints** (#22). `?` opens a sheet of the keys, with the Hebrew keycap shown next to the Latin one ("J / ח"). Single-key shortcuts have a saved off switch. They are on by default for the bookkeeper (Q6 default).

**Header:**
- 56 px (`chrome.header-h`; it replaces `h-[55px]`);
- **one** breadcrumb trail, removing the duplicate (`live/07`);
- the language picker as a quiet 40 px control, not the heaviest thing in the header (`live/12`).

### 3.12 Supporting components (short specs)

| Component | Spec |
|---|---|
| **TaskRow** (#1) | **₪ · what · one verb · due chip**, 56 px (default). Rows of one kind collapse into one ("6 דרישות · ₪450.88"). Groups: באיחור / היום / השבוע (Q1). T2 only inside its window; waiting on someone else is T4 |
| **LeakHero / MetricTile** | **T1 hero:** `money-hero`, ink; one context line ("1.8% מתוך ₪42,263 קניות לפני מע״מ"); "איך חישבנו?"; **a secondary CTA, never red**. On the phone, on mornings with tasks, it is a **compact hero** (40/44, one line) with the top 3 TaskRows above the fold (Q3 default).<br>**Tiles:** `money-card` 28/36 + `caption` label (2 lines allowed, never truncated) + optional `DeltaCell` + sparkline. `KpiCard` and `StatCard` render through `MetricTile` (W2-15) |
| **DueChip / CutoffChip** (#14) | "נסגר ב-14:00 · עוד 47 דק׳" / "נותרו 41 שעות לדרישה · עד ג׳ 10:00" (F3). T4 → T2 only inside its window. For the receiver it shows time only, never ₪ |
| **SendSheet** (#8) | Title "שליחת דרישות זיכוי · 6 ספקים · ₪450.88". One row per recipient: name · ₪ · lines · channel icon · ▾ the literal message · an exclude toggle. One primary "שלחו 6 דרישות", then a deferred-send toast; statuses come from the outbox. Interim (before H-06): per-row wa.me, and the row is marked sent on return, with undo |
| **DocumentFlow** (#15) | Order → supplier answer → receipt → invoice → claim → credit → paid (+ "תשלום שוחרר", Q4). Each node is a link + a `StatusChip`; a missing node is T4. A horizontal strip on the desk (right → left); a vertical stepper on the phone |
| **ThreeWayRow** (#4) | הוזמן · התקבל · חויב + the ₪ gap, unit-aware. **Identical** in the order, invoice, approval, peek and claim letter |
| **Button** | Variants `primary · secondary · quiet · danger` (C2). Sizes from `--btn-h-*`. Loading keeps its width; `disabledReason` is wired to `aria-describedby`; disabled is drawn by tokens, never by opacity. **One filled primary per region** |
| **ChecklistStep** (#18) | A row that checks itself: state icon · count · ₪ · one verb · who holds it ("הזכירו ל‹מנהל›"); the verb opens a sheet in place (J8) |

---

## 4. Operation patterns per job (target step counts)

Each job is a **composition** of the components in §3. The step counts are the acceptance numbers from `PROCESSES.md` §3. The "trip removed" column names which of the five big taps-sinks (PROCESSES §4.1) the pattern closes:
- walking to the evidence;
- switching apps;
- setting a status by hand;
- hunting for the record;
- arithmetic the system could do.

| Job | Role · device | Pattern (components) | Today on `main` | **DS2 target** | Trip removed |
|---|---|---|---|---|---|
| **J1** Morning: what waits for me | Owner · phone first | 07:30 brief push → **לטיפולי**: TaskRows grouped באיחור/היום/השבוע; a compact hero + the top 3 tasks above the fold | Open the app, 2 scrolls to see 3 of 5 tiles; labels cut off | **≤2 taps, ≤10 s** to the first decision; 0 scrolls for the top 3 | hunting; equal weight |
| **J2** Approve a gap | Owner, manager · desk + phone | **Desk:** WorkQueueTabs + DecisionRow + EvidenceDrawer that follows focus + BulkActionBar; keys J/K, 1/2/3, X, Z. **Phone:** push → DecisionCard sheet | 6 clicks, 3 screens; phone 3 taps + a scroll, no document | **Desk 2 clicks or 1 key, 1 screen; phone 2 taps.** ≥10 rows per 1440×900; 10 decisions in ≤60 s | walking to the evidence |
| **J3** Receive a delivery | Receiver · phone, field | FieldCountRow ×N + sticky "הכל הגיע (N)" + spot check; ExceptionSheet; OutboxChip; walk-in flow | Clean: 3 taps + 2 numbers (keep). Short line: 6–7 taps, no photo. Walk-in: blocked | **Clean ≤3 taps + 2 numbers, ≤90 s. Exception ≤4 taps with a photo. Walk-in ≤6 taps, 0 waiting. 0 lost offline** | waiting; lost entries |
| **J4** Send claims to 6 suppliers | Owner, manager · desk | SendSheet (literal preview per row, exclude) → one primary → deferred-send toast → statuses from the outbox | ≈25 taps, 12 app switches, 6 hand-set statuses | **3 taps + a 10 s undo; 0 switches; 0 hand-set statuses** (interim: 2 taps per supplier) | app switches; statuses |
| **J5** Record a credit note | Bookkeeper · desk | A task "זיכוי ₪84.96 · מכסה BR-24099 · אשרו שיוך" → Enter; manual: amount "as printed" + a VAT-basis toggle | ≈7 clicks + 3 fields + ÷1.18 in her head | **1 click.** Manual ≤4 clicks + 2 fields, **0 arithmetic** | arithmetic; statuses |
| **J6** Regular order | Manager, chef · phone | A prepared-draft push → review sheet (each line with its reason + agreed price + the literal text) → "שלחו" + deferred send; manual: the order guide + `QtyKeypad` + a sticky Σ bar with the cutoff chip | 8–14 taps (≈40 with no past order) | **2 taps from a draft; manual ≤9 taps, ≤45 s, no keyboard** | app switches; ± per unit |
| **J7** Supplier changes an order | Supplier → manager · phone | Supplier link (touch + field): as-is in 2 taps. Restaurant: push → diff sheet → "קבלו שינוי" → the dock's expected quantity updates | Supplier 2 taps (keep); the answer never reaches the dock | **Supplier ≤10 s; restaurant 1 tap; the dock updates by itself** | silent hand-off |
| **J8** Month close | Bookkeeper · desk | One "סגירת חודש · אוקטובר" page: 6 ChecklistSteps that check themselves; each verb opens a sheet in place; the export locks the month | ≥6 screens, ≥25 clicks, 2 dead ends | **1 screen; ≤10 clicks when clean; every blocker ≤2 clicks** | hunting; statuses |
| **J9** Check one supplier | Owner · desk/phone | Palette → **SupplierSnapshot**: "מה עכשיו" (4 answers, each with a verb) + call/WhatsApp tokens + 6 months billed vs agreed | ≈7 clicks; opens on an edit form | **2 clicks + typing; 0 tab hunting; call in 1 tap** | hunting |
| **J10** Find an invoice | Bookkeeper · desk | Ctrl/⌘K → "שטיינברג 104" → result row (number · date · ₪ · status) → Enter → invoice cockpit with DocumentFlow | 5–7 clicks, 3 screens; lands on a form | **≤5 s: 1 shortcut + typing + Enter, 1 screen** | hunting |
| **J11** Pay run | Owner, bookkeeper · desk | WorkQueueTable grouped by due date, net of claims; holds inline with a reason + verb; a **live before/after footer** (F9); "אשרו לתשלום ₪12,400 · 6 ספקים"; **release** as a second gate (Q4); "סמנו כשולם" → claims become "הוחזר" by themselves | A dead end: "paid" cannot be recorded | **3 clicks per batch; 0 hand updates to claims** | statuses; arithmetic |
| **J12** Fix an OCR misread | Manager, bookkeeper · desk | DocReviewSplit (lines on the start side, scan on the end side, a draggable divider); Tab/Shift+Tab move between **flagged** cells only; a totals check turns ✓; Ctrl/⌘+Enter saves and re-matches and shows the ₪ effect | 2 screens, ≥5 clicks + manual re-match; manager only | **1 screen, 0 clicks (keyboard only), ≤60 s; bookkeeper allowed (Q5)** | walking to the evidence |

### 4.1 Four flows that carry the most ₪

The ₪ figures in these flows are illustrative. They follow the demo restaurant's numbers where they exist.

**J2 at the desk: 10 gaps in a minute**
1. `G` then `A` → approvals. The first row has focus and the peek shows its ThreeWayRow, photo and price source.
2. Read the WhyLine "חויבו 9.5 · התקבלו 6.5 → ₪38.70 · מומלץ לדרוש", then press `1`. The row collapses in 150 ms, the toast reads "נדרשו ₪38.70 · ביטול (Z)", and focus moves to the next row.
3. For small `warn` gaps from one supplier: `X` ×4, then the BulkActionBar shows "4 נבחרו · ₪96.20 · דרשו 4". Press Enter.
4. A blocking ₪104.80 gap: its checkbox is disabled ("פער חוסם לא מאושר במרוכז"). Decide it alone with `1` or `2`.

The sequence has 0 page changes and 1 filled primary on screen at any time.

**J3 at the dock: an 11-line delivery with one short line**
1. The 06:30 push "3 משלוחים היום · ראשון: ירקות השרון 10:00" opens today's trucks. Tap "התחלת קבלה".
2. Tap ✓ on 10 rows with the right thumb (rows 72 px, 8 per screen), or tap "הכל הגיע כמו בהזמנה (11)" and correct one.
3. On the short line: ✗, then "חסר", then the keypad 6.5, then 📷, then "שמרו". That is 4 taps.
4. The spot check (2 numbers), then close. Offline, it reads "נסגר בטלפון · יישלח לבד".
5. The manager gets a push: "חסרים 3 ק״ג עגבניות שרי · ₪38.70 · הנהג חתם". The receiver never sees ₪.

**J4: claims to 6 suppliers**
1. The 16:00 push "6 דרישות זיכוי מוכנות · ₪450.88" opens the SendSheet.
2. Expand one row to read the literal WhatsApp text. Exclude one supplier, and the primary updates to "שלחו 5 דרישות · ₪391.40".
3. Tap the primary. The toast reads "שולח… · בטל שליחה (10)", then "נשלח". Each claim shows "נשלחה" from the outbox.

**J11: the pay run**
1. "לתשלום השבוע", grouped by due date. The footer reads "נבחרו 6 · ₪5,901 · אחרי קיזוז זיכויים ₪5,450 · מוחזק ₪296 (פער פתוח)".
2. Toggle Steinberg out. The footer updates live (F9).
3. "אשרו לתשלום ₪5,153 · 5 ספקים", then the owner releases it (Q4). The bank file is created outside the app.
4. "סמנו כשולם · היום". The netted claims become "הוחזר", and DocumentFlow gains its "שולם" node.
5. A hard hold, "פרטי בנק השתנו", can be released only by the owner, through a ConfirmDialog that names the ₪ and the supplier.

### 4.2 Interaction rules all patterns share

- **Keyboard** (bound by `KeyboardEvent.code`, so it works on a Hebrew layout):
  - global: Ctrl/⌘K, Ctrl/⌘B, `?`, G-chords;
  - queues: J/K, X, Shift+X, `1`/`2`/`3`, Enter, O, Esc, Z, H (snooze, Q5);
  - document review: Tab/Shift+Tab between flagged cells, Ctrl/⌘+Enter, `[`/`]`.
  
  **Never H/L or ←/→ for panes** (K4). Queue keys work only while the list has focus, never inside an input (WCAG 2.1.4).
- **Thumb** (390×844, RTL, one hand):
  - the row's action sits on the **start edge** (right);
  - one 56 px full-width primary at the bottom, with at most one 48 px secondary;
  - a destructive action never sits next to the primary;
  - nothing important in the top-left corner;
  - no edge swipes (F8).
- **Notifications:** one ₪ (if the role may see it) + one verb + a deep link to the exact card. On Android the verbs appear inline; on iOS web push the notification opens the sheet. Quiet 23:00–06:00 and on Shabbat; at most 6 per person per day. The full catalogue is in PROCESSES §7.3.
- **Undo, confirm and offline:** the table in PROCESSES §7.4 is normative. A reversible action gets a 10 s undo; an outbound one gets a deferred send; a write-off, a delete or a release above a limit gets a confirm dialog that names the ₪ and the party; field entry saves per line with the outbox shown; an error never closes by itself.
- **Presence (Q6):** a T4 chip "מיכל פתחה לפני 2 דק׳" on DecisionRow and SendSheet. The server answers a second decision with "הוחלט ע״י מיכל · 09:12", never a generic error. The data needs a human PR (§8).

---

## 5. Token architecture v2

### 5.1 Three tiers, plus modes

| Tier | What it holds | Who may read it | Emitted as |
|---|---|---|---|
| **0 · Primitives** (`primitives.ts`, new, **private**) | Colour ramps (green, red, orange, gold, blue, a neutral for each direction), the raw scales for space, radius, font size, weight and duration, the shadows, and font families per direction | Only `ui-tokens` itself. Never re-exported from `index.ts` | Nothing. They feed tier 1 |
| **1 · Semantic** (`semantic.ts`, `scale.ts`, extended) | Meaning: surface, text, border, action, status families, emphasis T1–T4, money figure and marker, data-viz, type roles, space roles, radius roles, elevation, motion, layers, layout and chrome | Components **and** page code, through Tailwind utilities | `--c-*` as RGB channels (as today, so `/alpha` keeps working for v1), plus `--font-*`, `--fs-*`, `--lh-*`, `--fw-*`, `--ls-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--dur-*`, `--ease-*`, `--z-*`, `--container-*`, `--chrome-*` |
| **2 · Component** (`components.ts`, new) | Each component's dials: `--btn-*`, `--chip-*`, `--row-h`, `--cell-px`, `--decision-row-h`, `--count-row-h`, `--peek-w`, `--toast-w`, `--nav-item-h`, `--icon-*`, `--rail-w`, `--focus-width` | **Only** components in `lib/components/**` | CSS variables that the modes re-bind |
| **Modes** (`modes.ts`, new; moved out of `build.ts`) | `[data-density=compact\|default\|touch]`, `[data-mode=desk\|field\|print]`, `@media (pointer: coarse)`, `@media (prefers-contrast: more)`, `@media print`, and **`[data-ds-direction=A\|B\|C]` (lab preview only)** | — | Override blocks inside the generated `@tokens` region |

**Naming rules**
- CSS variables are kebab-case: group, then role, then state (`--c-action-primary-bg-hover`).
- Tailwind keys **never collide with v1 meanings.** `text-primary` already means the green family (5,293 colour uses), so the v2 text roles are `fg`, `fg-secondary` and `fg-tertiary` (`text-fg`), while the CSS variables are `--c-text-primary/secondary/tertiary`.
- A direction is a **set of tier-0 values plus a few tier-1/tier-2 overrides**. It never adds a role. Choosing a direction is a one-line change in `directions.ts` (`export const ACTIVE = 'A'`).

### 5.2 Files (plugs into today's pipeline)

```
packages/ui-tokens/src/
  primitives.ts   NEW     ramps + raw scales (private)
  directions.ts   NEW     A/B/C value sets (directions.json is the source); ACTIVE = owner's choice
  semantic.ts     EXTEND  text.*, border.*, action.*, emphasis.*, surface.selected/raised/overlay, money.figure/marker, viz v2; v1 names kept as aliases
  scale.ts        EXTEND  type roles v2 (title-*, cell, money-*, qty-field, id, kbd, display-*), space roles, radius.xs, chrome sizes
  components.ts   NEW     component variables per density × mode
  modes.ts        NEW     the override blocks (density, mode, coarse, contrast, print, lab direction preview)
  fonts.ts        NEW     web font stacks, per-family features, fallback metric overrides, preload list
  build.ts        EXTEND  emits all of the above into the marked block; the preset adds v2 keys; legacy* keys stay until the ratchet reaches 0
  __tests__/contrast.test.ts  EXTEND  every semantic and component text/bg pair, in every mode and every direction (field body ≥7:1)
  __tests__/ratchet.test.ts   NEW     reads ds-baseline.json (from metrics.json); REPORT-ONLY in wave 2, failing from phase 5
```

**Trap: `typography` in `index.ts` is the frozen v1 export that `apps/mobile` still consumes** (owner decision 12). The web font stacks therefore move to `fonts.ts`, and `tailwind.config.ts` reads them from there. `typography.fontFamily` stays untouched. W2-15 plans to edit `typography.fontFamily.mono`, so it should check `apps/mobile` first.

### 5.3 Variable catalogue: v1 → v2 mapping

| Today (kept as an alias until phase 5) | DS2 semantic variable | Tailwind (v1 → v2) | Note |
|---|---|---|---|
| `--c-bg` | `--c-surface-canvas` | `bg-bg` → `bg-canvas` | |
| `--c-surface` | `--c-surface-default` | `bg-surface` (kept) | |
| `--c-surface-2`, `--c-surface-sunken` | `--c-surface-sunken` | `bg-surface-2` → `bg-surface-sunken` | |
| — | `--c-surface-selected` (`#EBF2FD`), `--c-surface-raised`, `--c-surface-overlay` | `bg-surface-selected` … | C3 |
| `--c-ink` | `--c-text-primary` | `text-ink` → `text-fg` | |
| `--c-muted` | `--c-text-secondary` | `text-muted` → `text-fg-secondary` | |
| `--c-subtle` | `--c-text-tertiary` (re-bound to secondary in field mode) | `text-subtle` → `text-fg-tertiary` | |
| `--c-line` | `--c-border-subtle` | `border-line` (kept) | decorative |
| — | `--c-border-rule` | `border-line-rule` | ruled tables (A, C) |
| `--c-line-strong` | `--c-border-control` | `border-line-strong` (kept) | ≥3:1 |
| `--c-line-field` | `--c-border-field` | `border-line-field` (kept) | ≥4.8:1 |
| `--c-focus` | `--c-border-focus` | `outline-focus` | one ring; the 134 `ring-2` sites are removed |
| `--c-primary-bold(-hover)`, `--c-on-primary` | `--c-action-primary-bg(-hover)`, `--c-action-primary-fg` | `bg-primary-bold` → `bg-action` | **Buttons read `action`, never a status family** |
| — | `--c-action-secondary-border/-bg-hover/-fg`, `--c-action-quiet-bg-hover`, `--c-action-danger-bg(-hover)` | `border-action-secondary` … | C2 |
| `--c-{family}-*` (6 × 7) | unchanged | unchanged | `/N` tints retire (C7) |
| — | `--c-emphasis-t1-rail`, `--c-emphasis-t2-rail` | `border-s-t1` … | the only route to a danger/warn rail |
| — | `--c-viz-cat-1…6`, `--c-viz-up`, `--c-viz-down`, `--c-viz-prev`, `--c-viz-leak`, `--c-viz-grid` | `fill-viz-*` | `--c-viz-1…6` stays as an alias of today's set until the charts move (W2-09) |
| `--row-h`, `--control-h`, `--cell-inline` | `--row-h`, `--control-h`, **`--cell-px`** (`--cell-inline` becomes an alias) | `h-row`, `h-control`, `px-cell` | + `--row-compact/--row-default/--row-touch` constants, so `DataTable.tsx:72-74` works without an edit |
| `--fs-caption`, `--fs-metric-hero` (+ `--lh-*`) | `--fs-{role}`, `--lh-{role}`, `--fw-{role}`, `--ls-{role}` for all 17 roles | `text-caption` … `text-money-hero` | `heading-*` and `metric-*` keep their **old values** as aliases; new code uses `title-*` and `money-*` |
| `--font-heebo`, `--font-mono` (hand-written in `@layer base`) | `--font-ui`, `--font-num`, `--font-id`, `--font-display`, `--font-features-ui`, `--font-features-num` (generated) | `font-sans` (kept: `--font-heebo` → `var(--font-ui)`), `font-mono` → `var(--font-id)`, new `font-display` | §5.6 phase 2 |
| `--radius-control/card/overlay/pill` | + `--radius-xs`, `--radius-chip` | `rounded-xs`, `rounded-chip` | values re-bound per direction in phase 3 |
| `--shadow-e0…e3` | + `--rail-w`, `--ring-selected` | `shadow-e0` … | glow keys retire |
| — | `--chrome-header-h: 56px`, `--chrome-sidebar-w: 248px`, `--chrome-rail-w: 64px`, `--chrome-bottombar-h: 64px` | `h-header`, `w-sidebar` | replaces `h-[55px]`, `max-w-[1600px]` |

### 5.4 Tailwind mapping

- **Added** (phase 1):
  - `colors`: `canvas`, `fg`, `fg-secondary`, `fg-tertiary`, `surface-selected`, `surface-raised`, `action.*`, `line-rule`, `viz-cat-*`, `viz-up`, `viz-down`, `viz-prev`.
  - `fontSize`: the 17 roles.
  - `spacing.extend`: `inset-chip`, `inset-control`, `inset-cell`, `inset-card`, `stack-*`, `gutter-page`.
  - `height`: `row`, `control`, `decision-row`, `count-row`, `header`.
  - `borderRadius`: `xs`, `chip`.
  - `fontFamily`: `display`.
- **Untouched until phase 5:** every v1 key (`legacyFontSize`, `legacyRadius`, `legacyShadow`, `legacyDuration`, `legacyEasing`, the opacity keys `8`/`12`) and every v1 colour.
- **Removed in phase 5,** each one only when its count in `ds-baseline.json` is 0.

### 5.5 Modes in CSS (shape of the generated block)

```css
/* tier 1 + tier 2 defaults (desk · default density) — values from directions.ts[ACTIVE] */
:root {
  --font-ui: 'IBM Plex Sans Hebrew', 'IBM Plex Sans Hebrew Fallback', system-ui, sans-serif;
  --font-num: var(--font-ui);
  --font-features-num: 'tnum' 1, 'lnum' 1;
  --c-text-primary: 15 31 23;  --c-text-secondary: 74 93 83;  --c-surface-selected: 235 242 253;
  --fs-cell: 0.875rem; --lh-cell: 1.375rem;
  --row-h: 44px; --decision-row-h: 64px; --control-h: 40px; --cell-px: 12px; --chip-h: 24px;
  --row-compact: 32px; --row-default: 44px; --row-touch: 56px;   /* DataTable fix, no edit */
}
[data-density='compact'] { --row-h: 32px; --decision-row-h: 52px; --control-h: 32px; --cell-px: 8px;
                           --chip-h: 20px; --fs-cell: 0.8125rem; --lh-cell: 1.25rem; }
[data-density='touch'] { --row-h: 56px; --control-h: 48px; --chip-h: 28px; --cell-px: 16px; }
@media (pointer: coarse) { :root, [data-density] { --row-h: 56px; --control-h: 48px; } }   /* the floor */
[data-mode='field'] { --fs-caption: 0.875rem; --lh-caption: 1.25rem; --fs-cell: 1rem; --lh-cell: 1.5rem;
                      --c-text-secondary: 59 75 67; --c-text-tertiary: var(--c-text-secondary);
                      --c-border-control: var(--c-border-field); --focus-width: 3px;
                      --btn-h-primary: 56px; --control-h: 48px; --row-h: 56px; --count-row-h: 72px; }
/* lab only: compare directions on the same screen */
[data-ds-direction='B'] { --font-ui: 'Noto Sans Hebrew', …; --row-h: 40px; --radius-card: 6px; … }
[data-ds-direction='C'] { --font-ui: 'Rubik', …; --row-h: 48px; --radius-card: 16px; … }
```

The shell sets `data-density` and `data-mode` on `<main>` (role × device × the saved-view override). `ViewToolbar`'s "מרווח / צפוף" toggle writes the override, and the per-page `compact` booleans (`approvals/list.tsx:90`, `leaks/breakdown/page.tsx:71`) are deleted in phase 4.

### 5.6 Migration path that does not break wave 2

Wave 2 is in flight. The briefs W2-02/04/05/06/10 are built as draft PRs. W2-15 owns `packages/ui-tokens`, `globals.css` and `tailwind.config.ts` for the window 08.11–05.12. Its drafts PR must merge by 14.11, and its final PR merges **last**. DS2 therefore enters as **tokens first, additive, aliased**, through W2-15's primitive-fix lane and `rtl-design-steward`'s PRs.

| Phase | When | What lands | Who | Risk to in-flight PRs | Gate |
|---|---|---|---|---|---|
| **0 · Choose** | 7–10.11 | The owner picks A, B or C. The lab renders the 4 reference screens in each direction (§6.5). No repo change | Orchestrator, owner | none | the owner's answer |
| **1 · Tokens, additive** | After the W2-15 drafts PR (from 14.11) | `primitives.ts`, `directions.ts`, the v2 semantic roles **with v1 aliases**, `components.ts`, `modes.ts`, `fonts.ts` (stacks only), the `--row-compact/default/touch` constants, the lab `[data-ds-direction]` preview, the contrast test over every mode × direction, and `ratchet.test.ts` in **report-only** mode | `rtl-design-steward` (W2-15 primitive-fix PR) | **None.** No v1 variable or Tailwind key is renamed, removed or re-valued; the generated block only grows. A conflict in the block resolves by rebasing and re-running `tokens:css` | drift + contrast tests; lab screenshots in he and en |
| **2 · Font + money voice** | Right after the owner's choice (wave 2 is fine: it is behind variables) | Self-hosted woff2 + OFL files, `@font-face`, a recomputed fallback face, the preload list (`layout.tsx`), `--font-heebo: var(--font-ui)` (so `font-sans` keeps working), `--font-mono` → Plex Mono (A) or `var(--font-id)` (B/C), the Inter `cv*` features deleted, `--font-features-num` | `rtl-design-steward`; `money-format-marshal` reviews N5–N7 | Every page changes typeface **without a call-site change**. Visual diffs are expected and are signed per role | CDP: one family for every ₪ on the lab + 4 role screens; CLS ≤0.01; demo ₪ invariants unchanged; before/after for owner home, approvals, pay run, dock count, supplier link |
| **3 · Primitives read component tokens** | Wave 2, W2-15 primitive-fix PRs (≤2 days each) | `Button`, `StatusChip` + registry, `DataTable` (column kinds), `MetricTile` (KpiCard/StatCard retire onto it, W2-15), `Money`/`MoneyCell`, `DeltaCell`, `Toast`, `Sheet`, `Card` (radius → card role, e0), `Heading` (title-lg; the `flow-stream` bar removed); the shell sets density and mode by role; the A/B/C radius and row values become active | `rtl-design-steward` (W2-15 lane) | Visible only through shared primitives, each change signed in the PR. **No page file changes** | unit tests per primitive; lab baselines; axe |
| **4 · Adoption by area** | Wave 3, per area package | `DecisionRow` (primary follows focus, presence), `EvidenceDrawer` order, `BulkActionBar` rules, `SendSheet`, `FieldCountRow`, `WorkQueueTable` in every queue and ledger; local `ils`/`money` wrappers → `MoneyCell`; per-page density booleans deleted | `web-feature-engineer` per area (W3 briefs) | Each area migrates its own files only after its wave-2 PR has merged | ops-J* e2e step counts (PROCESSES §9); role-matrix; decimal-alignment check |
| **5 · Codemods + delete legacy** | After W2-15's final PR (≈05.12), area by area, never on a branch with an open PR on the same files | Codemods (below); legacy preset keys removed when each count reaches 0; the ratchet becomes **failing**; lint `warn` → `error` in W4-01, blocking in H-09 | `rtl-design-steward` + `test-sentinel` | Scheduled between trains | `ratchet.test.ts`; full screenshot diff |

**Codemods** (phase 5; each one reversible and run per area):

| From | To |
|---|---|
| `text-xs` | `text-caption` |
| `text-sm` in `<td>` | `text-cell` |
| `text-sm` | `text-body-sm` |
| `Heading level=1` / `text-3xl font-extrabold` on h1 | `text-title-lg` |
| `font-mono` around `formatIls`/`<Money>` | removed |
| `<td className="… text-end">` with money | `MoneyCell` |
| Card `rounded-2xl` | `rounded-card` |
| `shadow-card` on list cards | `shadow-e0` |
| `bg-{status}/12`, `border-{status}/40` | `-subtle` roles |
| `focus-visible:ring-2 ring-primary/60` | removed |
| `transition-all` | `transition-colors` |
| `AlertTriangle` | `TriangleAlert` |
| `CheckCircle2` | `CircleCheck` |
| `type="date"` | `DateField` |
| `h-[55px]` | `h-header` |
| `max-w-[1600px]` | `max-w-app` |

**The contract with every wave-2 PR in flight**
1. Before phase 5, nothing renames, removes or re-values an existing CSS variable or Tailwind key. The exception is the phase-3 shared primitives, and each of their visual changes is signed.
2. The generated token block only grows. A conflict resolves by regenerating it, never by hand-editing inside the markers.
3. Lint stays `warn`, and no PR runs `--max-warnings`. The ratchet test is **report-only** until phase 5, so a wave-2 PR that adds a legacy class is reported but never blocked.
4. New wave-2 code may use v2 names as soon as phase 1 lands. The v1 names keep rendering.
5. The font changes in one place (`--font-ui`). No call site changes.
6. `formatIls()` is frozen. N5 is already the owner rule (`NUM_ALIGN`). N6, N7 and compact thousands are **proposals** to `money-format-marshal`, and changing the frozen util takes a human-authored PR.
7. Rollback:
   - Phase 1 is additive; revert the PR.
   - Phase 2: set `--font-ui` back to Heebo; the Heebo files stay in `public/fonts` until phase 5.
   - Phase 3: revert per primitive.

**Ratchet baseline** (`ds-baseline.json`, from `metrics.json` @ `4c887688`; recompute when phase 1 merges):

| Metric | Baseline |
|---|---|
| `font_mono_total` | 236 |
| `mono_money_lines_min` | 28 |
| `dir_ltr` | 162 |
| `red_money_lines` | 29 |
| `numeric_td_text_end` | 37 |
| `v1_opacity_tints` | 688 |
| `hex_in_tsx` | 66 |
| `legacy_focus_visible_ring2` | 134 |
| `transition_all` | 36 |
| `sub12px_text` | 38 |
| `bare_tracking_on_hebrew` | 32 |
| `files_with_raw_table` | 33 |
| `product_local_chip_fns` | 9 |
| `dual_render_pairs` | 70 |
| `native_date_inputs` | 15 |
| `shadow_card` | 109 |
| `glow_rings` | 33 |
| `glow_blobs` | 21 |
| `flow_stream_accents` | 43 |
| `Card_rounded_2xl_uses` | 158 |
| `size_x_weight_styles` | 59 |
| `radius distinct` | 29 |

---

## 6. Three directions

### 6.0 What all three share (not up for choice)

All three directions share:
- the principles (§1);
- the components and their states (§3);
- the operation patterns and step counts (§4);
- the token architecture (§5);
- T1–T4 and the T2 budget;
- WCAG AA, with every text pair ≥5.1:1 and field body ≥7:1;
- ₪ only through `formatIls()`/`<Money>`;
- tabular figures, physically right-aligned;
- a receiver with no ₪;
- the green brand primary and the focus blue;
- the ≥10 decisions per 1440×900 floor.

They differ in **typeface pairing, density, tone, neutrals, radius and elevation**. Every direction is a token set (`directions.json`), so picking one is a configuration choice. It is not a rebuild.

### 6.1 A · מאזן (Ledger) · calm-institutional · **recommended**

- **Mood:** רגוע, מבוקר, אמין. כמו דף חשבון של בנק טוב: קווים דקים, מספרים חדים, שום קישוט. The number looks **audited**.
- **Fonts:**

  | Role | Family | Licence | Files (`ds2/fonts/x/…/files/`) |
  |---|---|---|---|
  | ui + num | **IBM Plex Sans Hebrew** 400/500/600/700 (static) | SIL OFL 1.1, © 2019 IBM Corp. | `ibm-plex-sans-hebrew-{hebrew,latin}-{400,500,600,700}-normal.woff2` |
  | id | **IBM Plex Mono** 400/500 | SIL OFL 1.1, © 2017 IBM Corp. | `ibm-plex-mono-latin-{400,500}-normal.woff2` |
  | display (marketing, report cover) | **Frank Ruhl Libre** var 600–700 | SIL OFL 1.1, © 2015 The Frank Ruhl Libre Project Authors | `frank-ruhl-libre-{hebrew,latin}-wght-normal.woff2` |

  **Payload** for the app: 4 weights × (5.3 + 19.0 KB) ≈ **97 KB**, of which the preload (400 + 700) is ≈49 KB. Plex Mono adds 14.4 KB on demand. Heebo today is 41.2 KB. Frank Ruhl loads on marketing routes only.
- **Why Plex** (FONTS.md, 92/100):
  - the only candidate with distinct **1 / l / I** and **0 / O** at 13–16 px;
  - **its ₪ is the height of the figures** (0.698 em), so "₪ 760" reads as one unit;
  - the tallest Hebrew (מ = 0.618 em), which helps a phone at the dock;
  - Hebrew and Latin designed as one system.
- **Type scale:**

  | Role | Desk default | Compact | Field | Weight |
  |---|---|---|---|---|
  | caption | 12/18 | 12/16 | 14/20 | 400, label 500 |
  | cell / money-dense | 14/22 | 13/20 | 16/24 | 400 (totals 600) |
  | body | 16/26 | 16/26 | 16/26 | 400 |
  | title-sm / md / lg | 16/24 · 20/28 · 24/32 | same | 18/26 · 20/28 · 22/30 | **600** (calm heads; ₪ carries the weight) |
  | money-row | 16/24 | 14/20 | 18/26 | 600 |
  | money-card | 28/36 | 24/32 | 28/36 | 700 |
  | money-hero | 56/64 (phone 40/48) | — | 40/48 | **700** (Plex has no 800), −0.01em |
  | id | 13/20 Plex Mono | 12/16 | 14/20 | 400 (field 500) |
  | display | Frank Ruhl Libre 36/44 · 48/56 · 64/72 | — | 32/40 · 40/48 · 44/52 | 600–700 |

  Line-heights run one step looser than the base because Plex's Hebrew is tall.
- **Palette:** **today's semantic colours, unchanged** (minimum text pair 5.10:1). Additions:
  - `border.rule` `#E4EBE7` for ruled tables;
  - `surface.selected` `#EBF2FD`;
  - field secondary text `#3B4B43` (≥8.2:1);
  - categorical viz v2.
  
  The look comes from removing tints, not from adding hue.
- **Radius:** xs 2 · control 6 · card 8 · overlay 12 · pill. Crisp, like a statement.
- **Elevation:**
  - flat e0 everywhere;
  - **ruled tables**: horizontal hairlines in `border.rule`, no zebra, no vertical rules;
  - on single-block pages, a section is a title plus a rule, not a boxed card;
  - e1 only on sticky bars once scrolled;
  - a 4 px rail for T1/T2.
- **Density:**

  | Default rows | Decision row | Compact rows | Count row | Controls (compact/default/touch) |
  |---|---|---|---|---|
  | 44 | 64 | 32 | 72 | 32 / 40 / 48 |

  That gives **11 decisions per 1440×900** (measured), **≈21 ledger rows** (compact) and **8 count rows per 390×844** (measured).
- **Signature screens:**
  - **Hero:** "₪760" in Plex 700, a quiet secondary "לחשבוניות שמאחורי ₪760 ←", and the context line "1.8% מתוך ₪42,263".
  - **Approvals:** a ruled list where only the focused row's verb is green.
  - **Ledger:** ₪ in the column header (O1).
- **Rationale.** The North Star is a ₪ figure **one owner believes**. Every choice in A makes the number look checked rather than marketed:
  - Plex's engineered digits and figure-height ₪;
  - semibold calm headings that leave the weight to the money;
  - hairline rules instead of floating cards;
  - a palette that is already AA-tested and is only being disciplined.

  It also costs the least to adopt, because the colours do not move. That leaves wave 2 and the pilot alone. The bookkeeper sees a ledger she recognises from her own tools; the owner sees one hero number with nothing competing.
- **Risks and mitigations:**

  | Risk | Mitigation |
  |---|---|
  | Static files (no variable axis): 8 woff2 files and about +56 KB over Heebo | Preload 400 + 700 only; 500 and 600 load on demand |
  | Plex digits are about 8% wider ("1,267.50" is 4.14 em against Heebo's 3.83) | Size columns in `ch`; check the pay run and the ledger at 1280 px |
  | No 800 weight | The hero at 700 is enough; tested at 64 px in the specimen |
  | It can read "corporate IBM" | Warmth comes from the copy and the green brand |
  | No Plex Ethiopic | Amharic and Tigrinya keep Noto. Those receiver screens show no ₪, so a mixed family there is harmless. Plex Sans Arabic and Thai exist on npm for a later switch |
- **Choose A if** the first pilot impression and the owner's belief in the number come first.

### 6.2 B · דיוק (Precision) · modern-precise

- **Mood:** צפוף, מהיר, מדויק. כלי עבודה של מקצוענים: הרבה שורות במסך, מקלדת, אפס קישוט. It feels like Linear or Stripe.
- **Fonts:**

  | Role | Family | Licence | Files |
  |---|---|---|---|
  | ui + num + id | **Noto Sans Hebrew** variable, `wght` 100–900 + **`wdth` 62.5–100** | SIL OFL 1.1, © 2024 The Noto Project Authors | `noto-sans-hebrew-{hebrew,latin}-wdth-normal.woff2` (both axes; verified with fontTools) |
  | display | none: Noto 800, −0.02em | — | — |
  | script (receivers) | the same Noto family for ar, th and am | OFL | already shipped |

  **Payload:** one file pair, 17.3 + 34.1 = **51.4 KB** for every weight and width. **Ids:** Noto at `font-stretch: 87.5%` + `tnum`, weight 500. There is no mono.
- **Why Noto** (85/100):
  - the only candidate with a **width axis**, so dense tables condense to 87.5% without changing family;
  - tabular by default;
  - one family across Hebrew, Arabic, Thai and Amharic, which means one design voice for the receivers.
- **Type scale:**

  | Role | Desk default | Compact | Field | Weight / width |
  |---|---|---|---|---|
  | caption | 12/16 | 12/16 | 14/20 | 400 · label 650 |
  | cell / money-dense | 14/20 (wdth 100) | **13/18 (wdth 87.5)** | 16/24 (wdth 100, never condensed) | 400 (totals 650) |
  | body | 16/24 | 16/24 | 16/24 | 400 |
  | title-sm / md / lg | 15/20 · 18/24 · 22/28 | same | 18/26 · 20/28 · 22/30 | 650 · 650 · 700 |
  | money-row | 15/20 | 13/18 | 18/26 | 650 |
  | money-card | 24/30 | 22/28 | 28/36 | 700 |
  | money-hero | 56/60 (phone 40/44) | — | 40/44 | **800**, −0.025em |
  | id | 13/18 (wdth 87.5) | 12/16 | 14/20 (wdth 100) | 500 |

  The variable axis allows **650** for titles (Atlassian's metric weight is 653).
- **Palette:** **cooler, slightly darker slate neutrals** (minimum text pair 5.48:1):

  | Role | Value | Contrast |
  |---|---|---|
  | canvas | `#F5F7F7` | — |
  | sunken | `#EDF1F0` | — |
  | border subtle | `#D5DCDA` | — |
  | border control | `#77857F` | 3.86 |
  | border field | `#62706A` | 5.19 |
  | ink | `#0D1A15` | — |
  | secondary | `#45554E` | 6.9–7.9 |
  | tertiary | `#55645D` | — |
  | field secondary | `#36453F` | ≥8.8 |

  The status families are unchanged. **Colour appears only in chips, rails and the one primary.** No tinted cards, no tinted tiles.
- **Radius:**
  - xs 2 · control 4 · card 6 · overlay 8;
  - **chips are rectangular tags** (radius 4, `outline` variant);
  - pill only for count badges and avatars.
- **Elevation:**
  - **panes, not cards**: on the desk, sidebar | list | peek are separated by 1 px `border.subtle`, flush to the header;
  - lists have no card boxes;
  - e0 everywhere, e2/e3 only for overlays;
  - the selected row gets a 2 px inset ring;
  - the rail is 3 px.
- **Density:**

  | Default rows | Decision row | Compact rows | Count row | Controls | Chips | Cell padding |
  |---|---|---|---|---|---|---|
  | 40 | 56 | **28** | 64 | 28 / 36 / 48 | 18 / 22 / 28 | 6 / 10 / 16 |

  That gives **12 decisions per 1440×900** (measured), **≈25 ledger rows** and **9 count rows per phone** (measured; the coarse-pointer floor still applies).
- **Signature screens:**
  - **Approvals:** a three-pane desk with the list, the peek and keys everywhere.
  - **Hero:** a single number at the head of a flat strip of four `money-card` tiles separated by hairlines.
  - **Ledger:** condensed to 87.5% so 9 columns fit at 1280 px.
- **Rationale.** The jobs that repeat most at the desk (J2, J8, J10, J11, J12) are throughput jobs, and the bookkeeper is the channel to 10–30 restaurants. B gives her MarketMan-grade density, which is the one place BENCHMARKS §6 says we are behind, without giving up the T1 hero. The width axis is the lever: the owner's screens stay at full width, and only compact tables condense. Noto everywhere also unifies the receivers' languages under one design.
- **Risks and mitigations:**

  | Risk | Mitigation |
  |---|---|
  | Closest to generic SaaS. Noto shares DNA with Android's system font, so owners may read it as "default" | The brand has to come from the green, the copy and the T1 hero |
  | Condensed 13 px Hebrew is the hardest to read for owners over 50 | Condense **only** in `compact`; never in default or field |
  | Weaker digit clarity (1/l/I close; digit score 3/5) | Hurts SKUs with l/I. Keep IDs in the `id` role at 500 |
  | Noto's ₪ sits slightly below the figure height | Shows mostly at hero size; tested in the specimen |
  | 28 px rows are hard with a mouse | That density is for keyboard users only; the owner default stays 40 |
- **Choose B if** bookkeeper throughput and the bookkeeper channel are the growth priority, and the desk is where RestoMatch must win.

### 6.3 C · מטבח (Kitchen) · warm-hospitality

- **Mood:** חם, מזמין, אנושי. כמו פנקס של מסעדה טובה: פינות רכות, נייר חם, מספרים ברורים וגדולים. It is "of the restaurant", not of the bank.
- **Fonts:**

  | Role | Family | Licence | Files |
  |---|---|---|---|
  | ui + num + id | **Rubik** variable, `wght` 300–900, with **mandatory `tnum`** (GSUB has `tnum`; the roles set it, and lint bans a money/cell element without it) | SIL OFL 1.1, © 2015 The Rubik Project Authors | `rubik-{hebrew,latin}-wght-normal.woff2` |
  | display (marketing H1 only, **never ₪**: its ₪ is the ש״ח form) | **Secular One** 400 | SIL OFL 1.1, © 2016 The Secular One Project Authors | `secular-one-{hebrew,latin}-400-normal.woff2` |

  **Payload:** 9.1 + 34.5 = **43.6 KB**, the same as Heebo today. Secular One (26.7 KB) loads on marketing routes only.
- **Why Rubik** (80/100):
  - friendly, sturdy Hebrew that holds up at the dock;
  - the best Hebrew–Latin harmony score (5/5);
  - a variable font in one small file.
- **Type scale:** Rubik's Hebrew runs small (מ = 0.571 em against Plex's 0.618), so the small roles get **+1 px**.

  | Role | Desk default | Compact | Field | Weight |
  |---|---|---|---|---|
  | caption | **13/18** | 12/16 | **15/22** | 400 · label 500 |
  | cell / money-dense | **15/22** | 14/20 | **17/26** | 400 (totals 600) |
  | body | 16/26 | 16/26 | 17/26 (inputs stay 16) | 400 |
  | title-sm / md / lg | 17/24 · 20/28 · 26/34 | same | 18/26 · 20/28 · 22/30 | **500 · 600 · 600** (Rubik bold reads heavy) |
  | money-row | 16/24 | 14/20 | 18/26 | 500 |
  | money-card | 28/36 | 24/32 | 28/36 | 600 |
  | money-hero | 56/64 (phone 40/48) | — | 40/48 | 700, −0.01em |
  | qty-field | — | — | 22/30 | 600 |
  | id | 13/20 Rubik + tnum | 12/16 | 14/20 | 500 |
- **Palette:** **warm paper neutrals and slightly warmed status colours** at the same lightness (minimum text pair 5.54:1):

  | Role | Value | Contrast |
  |---|---|---|
  | canvas | `#F8F6F1` | — |
  | sunken | `#F2EEE6` | — |
  | border subtle | `#E2DACD` | — |
  | border rule | `#ECE6DC` | — |
  | border control | `#857A6B` | 4.21 |
  | border field | `#6B6255` | 5.99 |
  | ink | `#1D1A14` | — |
  | secondary | `#574F45` | 6.9–8.1 |
  | tertiary | `#635A50` | — |
  | field secondary | `#463F36` | ≥8.9 |
  | primary | `#0B6A48` (hover `#08573B`, subtle `#E9F3EC`) | — |
  | danger | `#B3122E` (`#940E25` / `#FCEDEF`) | — |
  | warn | `#A33F05` (`#863304` / `#FCEFE6`) | — |
  | gold | `#7A5A00` (`#614800` / `#F9F1DC`) | — |

  Info is unchanged. The selected surface is `#EBF2FD`.
- **Radius:** xs 4 · control 10 · card 16 · overlay 20 · pill.
- **Elevation:**
  - tables stay e0;
  - **a soft warm e1** (`0 1px 2px rgba(29,26,20,.06), 0 6px 20px -10px rgba(29,26,20,.14)`) on the hero, the tiles and the phone decision cards;
  - T4 sits in sunken wells;
  - the 4 px rail has rounded ends;
  - card inset 20.
- **Density:**

  | Default rows | Decision row | Compact rows | Count row | Controls | Chips | Cell padding |
  |---|---|---|---|---|---|---|
  | 48 | 64 (held by the ≥10 floor) | 36 | **80** | 36 / 44 / 52 | 22 / 26 / 30 | 10 / 14 / 16 |

  That gives **11 decisions per 1440×900** (measured; 9–10 once grouped by invoice), **≈19 ledger rows** and **7 count rows per phone** (measured).
- **Signature screens:**
  - **Owner phone home:** a warm hero card, with the top 3 tasks as rounded TaskRows.
  - **Dock:** large rows and big quantities.
  - **Chef order guide:** feels like a notepad.
- **Rationale.** Most of RestoMatch's daily users are not accountants. The owner is on a phone between services; the manager and the chef order at the pass; the receiver counts at the door. Zestt wins the **daily habit** (BENCHMARKS §6.2). C borrows that warmth so that opening RestoMatch every morning feels like part of running the restaurant, not like opening a bank portal. The T1–T4 discipline and the tabular, right-aligned ₪ stay intact, so the number keeps its authority inside a friendlier frame.
- **Risks and mitigations:**

  | Risk | Mitigation |
  |---|---|
  | **`tnum` must never be forgotten.** Rubik is proportional by default, and a raw class silently misaligns a column (`numerals.jpg` E) | Roles + lint + the decimal-alignment e2e |
  | Softness may undercut "an audited number" for the North Star figure | The hero stays ink, flat-figured, with no rounded container on the desk |
  | On warm paper, gold T3 and the sunken T4 wells sit closer in hue | T3 must also carry the figure colour + the ✓ icon |
  | The lowest desk density, and the ≥10 decisions floor is tight once groups are shown | Owner may need compact density on approvals |
  | Rubik's 1/l/I are close (digit score 3/5) | Same as B: keep IDs in the `id` role at 500 |
  | Secular One cannot carry ₪ | Marketing headlines only |
- **Choose C if** owner-phone, manager and chef adoption, the daily habit, matter more than desk throughput, and the brand should feel like hospitality.

### 6.4 Side by side

| | **A · מאזן** | **B · דיוק** | **C · מטבח** |
|---|---|---|---|
| Mood | calm, audited | dense, fast | warm, welcoming |
| UI + numerals | IBM Plex Sans Hebrew (static 400–700) | Noto Sans Hebrew (var wght + wdth) | Rubik (var wght) + mandatory tnum |
| IDs | IBM Plex Mono | Noto at wdth 87.5 | Rubik 500 + tnum |
| Display | Frank Ruhl Libre (marketing, report) | none | Secular One (marketing only) |
| Licence | OFL 1.1 (all) | OFL 1.1 | OFL 1.1 (all) |
| App payload | ≈97 KB (preload ≈49) | 51.4 KB | 43.6 KB |
| ₪ glyph / digit clarity (FONTS) | 5 / 5 | 4 / 3 | 4 / 3 |
| Neutrals | today's green-grey | cool slate | warm paper |
| Minimum text contrast | 5.10 | 5.48 | 5.54 |
| Radius (control / card / overlay) | 6 / 8 / 12 | 4 / 6 / 8 | 10 / 16 / 20 |
| Chips | pill | rectangular tag | pill |
| Elevation | flat, ruled tables | panes, no cards | soft e1 on key cards |
| Rows: default / compact | 44 / 32 | 40 / 28 | 48 / 36 |
| Decision row · count row | 64 · 72 | 56 · 64 | 64 · 80 |
| Decisions per 1440×900 | 11 (measured) | 12 (measured) | 11 measured; 9–10 grouped |
| Ledger rows (compact) | ≈21 | ≈25 | ≈19 |
| Count rows per 390×844 | 8 (measured) | 9 (measured) | 7 (measured) |
| Adoption cost | lowest (colours unchanged) | medium (neutrals, chips, panes) | medium (neutrals, warmed status colours, radius, shadow) |
| Main risk | file weight; slightly wide digits | generic; condensed text for older owners | forgotten tnum; softness against the North Star |
| Best for | the owner's belief in the number; the pilot | the bookkeeper channel; desk throughput | the daily habit on phones |

**Measured, not only estimated.** `scripts/preview.cjs` renders an approvals desk at 1440×900 and a dock count at 390×844 straight from `directions.json`. It counts the rows that are fully visible and asks Chromium (CDP `getPlatformFontsForNode`) which family paints the ₪. Results are in `preview/report.json`:

| Direction | Decision rows | Count rows | Family that paints ₪ 760 |
|---|---|---|---|
| A | **11** | **8** | IBM Plex Sans Hebrew |
| B | **12** | **9** | Noto Sans Hebrew (variable) |
| C | **11** | **7** | Rubik (variable) |

No direction falls back to a system font for ₪. Group headers by invoice take about one row away. The `preview/*.jpg` files are verification renders, not designs.

### 6.5 Recommendation and how to choose

- **Recommendation: A · מאזן.** It serves the North Star most directly: a ₪ figure that looks audited, the clearest digits, and a ₪ the height of the figures. It is also the cheapest and safest to adopt during wave 2 and the pilot, because the colours don't move. Two ideas from the other directions are already part of the shared spec, so A gets them anyway:
  - B's dense-table idea (N6, ₪ in the header) for the bookkeeper's compact tables;
  - C's warmth through copy, the compact phone hero and calm T3.
- **How the owner chooses** (phase 0):
  1. Render the **same 4 screens** in each direction with real demo strings:
     - owner home on the phone (J1: compact hero + 3 tasks);
     - approvals on the desk (J2: decision rows + peek + bulk bar);
     - the dock count on the phone (J3: field mode);
     - the supplier ledger on the desk (bookkeeper compact, ₪ in the header).
  2. Show them side by side at real size. The owner picks one.
  3. Run PROCESSES §9's five-owner check on the chosen direction in the lab (J1, J2, J6 on their own phones; ≥4 of 5 finish unaided).

  The token values for those renders are in `directions.json`.

---

## 7. Decisions for the owner

| # | Decision | Recommended default | Why |
|---|---|---|---|
| **O0** | Direction A, B or C | **A** | §6.5 |
| **O1** | In the bookkeeper's compact tables, print ₪ **once in the column header** and leave the cells without the symbol (N6) | **Yes, bookkeeper compact only.** Owner screens always print ₪ | Cleaner columns. Needs a proposal to `money-format-marshal` |
| **O2** | **The primary follows focus:** in desk lists, only the focused row's verb is filled green (D1) | **Yes** | It replaces 4 equal primaries per screen with 1, and the peek stops repeating it |
| **O3** | The selected-row colour is **blue** (`#EBF2FD`), not green | **Yes** | Green keeps its money meaning (claimed, credited, the primary verb) |
| **O4** | The hero's "לחשבוניות שמאחורי ₪760" becomes a **secondary** button, so there is no red navigation button | **Yes** | Red is for act-now items only |
| **O5** | A display face for marketing and the monthly report cover (A: Frank Ruhl Libre) | **Optional; yes for the report cover** | It gives the printed report a distinct voice without touching ₪ |
| Q1–Q6 | The open questions in PROCESSES §10 (one batch tap per send; holding alerts during service; a compact phone hero; walk-in before approval; the bookkeeper may correct; single keys on for the bookkeeper) | The defaults there | Unchanged by DS2 |

---

## 8. Handoff (proposals only; owning agent opens a PR, a human merges)

| Item | Owning agent | Files | Gate / immutability |
|---|---|---|---|
| Tokens v2: primitives, semantic, components, modes, fonts, directions, the lab preview | `rtl-design-steward` (W2-15 lane in wave 2) | `packages/ui-tokens/**`, `apps/web/app/globals.css` (generated block + `@font-face`), `apps/web/tailwind.config.ts` | Drift + contrast tests in every mode × direction; he/en screenshots |
| The font swap | `rtl-design-steward` | `apps/web/public/fonts/<family>/` + OFL files, `layout.tsx` preload, the fallback face | CDP font attribution; CLS ≤0.01; demo invariants |
| N5 alignment rule (already `NUM_ALIGN`), N6 ₪ in the header, N7 U+2212, compact thousands ("12.4 אלף ₪") | `money-format-marshal` | The money-format util layer | **`formatIls()` and the agorot↔display boundary are on the immutability list, so changing them is a human-authored PR.** Until then `<Money>` changes only presentation |
| `MoneyCell`, `DeltaCell`, `StatusChip` + registry, `DataTable` column kinds, `BulkActionBar`, `ActionToast`, `Button` variants, `MetricTile` retirement | `rtl-design-steward` via W2-15 in wave 2; `web-feature-engineer` afterwards | `apps/web/lib/components/**` | Unit tests; lab baselines; axe |
| `DecisionRow`/`Card`, `EvidenceDrawer`, `SendSheet`, pay run (F9), month close, palette, `SupplierSnapshot` | `web-feature-engineer` (area packages W2-04, W2-10, W2-03, W2-11, W3) | Area routes under `apps/web/app/dashboard/**` | ops-J* e2e step counts |
| `FieldCountRow`, `ExceptionSheet`, `OutboxChip`, the camera position | `web-feature-engineer` (W2-05) with `ocr-procurement-engineer` (ingest staging) | `receiving/**`, `lib/pwa/**` | Airplane-mode e2e; role matrix (no ₪) |
| `ratchet.test.ts`, ops-J* specs, the decimal-alignment check (M6), the T2-budget count, font attribution | `test-sentinel` | `__tests__/**`, `e2e/**` | Report-only until phase 5 |
| **Human PR (schema / immutable):** presence (Q6), the release gate (Q4: `released_*`), the per-supplier claim window (F3), snooze (Q5) | proposal → human | `packages/db/src/schema.ts` (+ RLS through `tenant-security-warden`) | Immutable: a human-authored PR. The rules in `approvals/engine.ts` are untouched |
| **Human PR:** the 07:30 brief and the 16:00 claim batch (J1, J4) | proposal → human | `packages/api/src/notifications/outbox.ts`, `apps/worker/src/cron.ts` | Immutable delivery files |
| **Note:** the `rtl-design-steward` mission line in `AGENTS.md` still says "Guard the dark RTL design" | human | `AGENTS.md` | Governing file: human only |

---

## Appendix A · Contrast (WCAG 2.x, computed with `scripts/palettes.py`)

| Pair | Today / A | B | C |
|---|---|---|---|
| text.primary on canvas · surface · sunken | 16.0 · 17.1 · 15.2 | 16.6 · 17.9 · 15.7 | 16.1 · 17.4 · 15.0 |
| text.secondary on canvas · surface · sunken | 6.60 · 7.04 · 6.28 | 7.34 · 7.89 · 6.93 | 7.45 · 8.05 · 6.95 |
| text.tertiary on canvas · surface · sunken | 5.36 · 5.72 · **5.10** | 5.80 · 6.24 · **5.48** | 6.25 · 6.75 · **5.84** |
| field secondary on surface · canvas · sunken | 9.24 · 8.66 · 8.23 (`#3B4B43`) | 10.1 · 9.39 · 8.87 (`#36453F`) | 10.4 · 9.60 · 8.96 (`#463F36`) |
| border.control on surface (≥3) | 3.59 | 3.86 | 4.21 |
| border.field on surface (≥4.5 field) | 4.85 | 5.19 | 5.99 |
| status text on its subtle fill (min of 6) | 5.54 (info) | 5.54 | 5.54 |
| white on a bold fill (min of 6) | 6.24 (info) | 6.24 | 6.24 |
| ink on surface.selected `#EBF2FD` | 15.2 | 15.2 | 15.4 |
| focus `#1A5BC7` on canvas | 5.85 | 5.80 | 5.78 |
| Categorical viz on white (min) | 5.09 (teal `#007A85`) | same | same |

Every text pair clears the repo's 4.6:1 test, and the lowest is today's `subtle` on `sunken` at 5.10.

## Appendix B · Files and sources

- **This folder:**
  - `DS2-SPEC.md` (this file) and `directions.json` (tokens, fonts, density and radius for A, B and C);
  - `scripts/palettes.py` (the contrast computations);
  - `scripts/make_directions.py`, which generates `directions.json` and fails if a font file is missing, a text pair is below 4.5:1 or field secondary text is below 7:1;
  - `scripts/preview.cjs` with `preview/{A,B,C}-{desk,phone}.{html,jpg}` and `preview/report.json` (the measured row counts and ₪ font attribution);
  - inputs `fonts/FONTS.md` (+ `compare.jpg`, `numerals.jpg`, `specimen-*.jpg`), `PROCESSES.md`, `AUDIT.md` (+ `metrics.json`, `scan.json`) and `BENCHMARKS.md`.
- **Font files** (extracted from the `@fontsource` 5.3.0 tarballs in `fonts/pkgs/`; each package keeps its `LICENSE`): `fonts/x/fontsource-ibm-plex-sans-hebrew`, `fontsource-ibm-plex-mono`, `fontsource-variable-frank-ruhl-libre`, `fontsource-variable-noto-sans-hebrew`, `fontsource-variable-rubik` and `fontsource-secular-one`.
- **Measured in this pass with fontTools:**
  - the Noto `wdth-normal` files carry both axes (wght 100–900, wdth 62.5–100);
  - the ₪ coverage per file;
  - the hyphen-minus and plus advance and position against the digits (N7);
  - Rubik's GSUB has `tnum`.
- **`he-IL` output measured with Node 22 `Intl`:**
  - `‏1,267.50 ‏₪`
  - `‏‎-1,123.00 ‏₪`
  - `‏‎+3.41 ‏₪` (with `signDisplay`)
  - en `₪1,267.50` / `-₪1,123.00`
  - compact `12.4K‏` (not Hebrew, hence the proposal)
- **Repo** (read-only snapshot at `ds2/main/`): `packages/ui-tokens/src/{semantic,scale,build,index}.ts`, `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/lib/money.ts`, `apps/web/lib/components/money/format.ts`. The W2-15 brief was read with `git show origin/claude/wave2-kit-addendum-0711:docs/ux/wave2/W2-15.md`.
