# RestoMatch promo — storyboard / סטוריבורד

60 s · 1920×1080 · 30 fps · silent (music slot — see README). Hebrew master (`locale=he`), English from
the same composition (`locale=en`). Timeline source of truth: `src/Root.tsx` (`TIMELINE`), copy:
`src/copy.ts`.

**Layout rule (owner, v2):** captions, headlines and callouts live only in a fixed **caption safe-zone** —
the right 38% of the frame in Hebrew (left in English; a top band in the vertical cut). Devices,
screenshots and every camera move live only in the **device zone**, rendered inside a clip of that rect,
so the two can never overlap (`src/layout.ts`; `scripts/check-layout.mjs` asserts ∅ intersection).

**Stage (owner, 2026-10-24): LIGHT**, matching the product. A soft light stage (`#F6F8F7`), a silver
laptop and phone, the app's light screens, and a light-fog spotlight (outside blurred + washed toward the
stage colour instead of dimmed). `STAGE=dark node render.mjs …` still renders the original dark stage.

Motion language: one easing family (expo-out `bezier(.16,1,.3,1)` for entrances, `bezier(.65,0,.35,1)`
for camera moves), three accents matching the light product's AA tokens — primary `#066B4A` (product /
positive), danger `#B80F2A` (leak), gold `#8A5300` (caught / new); dark stage: `#22D39A` / `#FF5C7A` /
`#E0B341`. Heebo + JetBrains Mono, the app's own files.

## Beats

| # | Time | Beat | On-screen copy (he) | On-screen copy (en) | Motion |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | **Hook** | כמה כסף / **דלף לך** / החודש? · ₪760 · "רוב בעלי המסעדות לא יודעים לענות." · "מסעדת הדגמה · אוקטובר 2026" | How much / **money leaked** / this month? · ₪760 · "Most restaurant owners can’t answer." · "Demo restaurant · October 2026" | Masked line rises, slow push-in, slot-machine ₪ reel with vertical motion blur, glow + specular sweep |
| 2 | 0:06–0:12.5 | **Problem** | עשרות משלוחים בשבוע. / חשבונית לכל אחד. / ואף אחד לא משווה שורה מול שורה. · stamps: "מחיר עלה +10.6%", "חויב על 3 ק״ג שלא הגיעו", "לא הוזמן" | Dozens of deliveries a week. / An invoice for each one. / And nobody checks them line by line. · "Price up +10.6%", "Billed 3 kg that never came", "Not ordered" | 9 Hebrew supplier invoices fly in from depth (3D, speed-blur), pile + camera shake, stamps slam; pile collapses into a scan line |
| 3 | 0:12.5–0:15 | **3-way match** | הזמנה · קבלת סחורה · חשבונית — "RestoMatch משווה כל חשבונית להזמנה ולמה שבאמת הגיע" | Order · Delivery · Invoice — "RestoMatch checks every invoice against the order and what really arrived" | Icons rise, connector draws, check-marks lock |
| 4 | 0:14.7–0:33 | **Product — owner** (REAL screens, demo data; label "מסך אמיתי · נתוני הדגמה") | 01 מספר אחד. בשקלים. · 02 בלש הדליפות · 03 עוצרים לפני התשלום · 04 מכתב דרישת זיכוי · callouts: דלף החודש 760 ₪ · 1.8% מהרכש │ בירה מהחבית: 520 ₪ ← 575 ₪ +10.6% │ חסום עד אישור שלך: 104.80 ₪ │ סה״כ לזיכוי: 104.80 ₪ | 01 One number. In shekels. · 02 Leak detective · 03 Stop it before you pay · 04 Credit-request letters · same callouts in English | 3D laptop in the device zone; per screen: light-wipe in → camera push-in → **spotlight** (outside dimmed to ~33% + blur + vignette; the focus rect lifted ×1.04 with +exposure and an accent glow, revealed by a mask opening from its centre line; 12-frame ramps) → ~1.5 s hold with the callout in the caption zone → pull back |
| 5 | 0:33–0:41.3 | **Receiver in English** (headline feature) | חדש · פיצ׳ר הדגל · מקבל הסחורה לא קורא עברית? **לא בעיה.** · callout "Cherry tomatoes ← עגבניות שרי" | New · flagship feature · Your receiver can’t read Hebrew? **No problem.** | Phone (real receiver screens in English) + the Hebrew→English morph panel (4 real invoice lines: the beam wipes the Hebrew, then the English rises in), then push-in + spotlight on the "Cherry tomatoes / עגבניות שרי" card on the phone |
| 6 | 0:41–0:46 | **Chains & branches** (REAL `/dashboard/chain`, S8, `seed:chain-demo`) | רשתות וסניפים · callout "הסניף הכי דולף: ירושלים 3.1%" | Chains & branches · "Leakiest branch: Jerusalem 3.1%" | Laptop push-in + spotlight on branch-ranking row #1 |
| 7 | 0:46–0:55 | **Value** | דלף החודש ₪760 (1.8% מתוך 42,263 ₪ רכש) · נתפס לפני תשלום ₪296 · נדרש מהספקים ₪464 → "בלי לשנות את העבודה היומיומית." · 1 מצלמים את החשבונית · 2 המערכת משווה שורה מול שורה · 3 מאשרים — לפני התשלום | Leaked this month ₪760 (1.8% of ₪42,263) · Caught before payment ₪296 · Claimed from suppliers ₪464 → "Without changing your daily routine." + 3 steps | Count-ups + sweeps, blur-out, kinetic line, steps stagger |
| 8 | 0:55–1:00 | **CTA** | RestoMatch · המספר שכל בעל מסעדה צריך · [תאמו הדגמה קצרה] · restomatch.co.il | RestoMatch · The number every restaurant owner needs · [Book a short demo] · restomatch.co.il | Ring burst, logo draws on, wordmark de-blurs, sweep |

Vertical social cut (1080×1920, ~27 s): Hook → owner dashboard on a phone (real `dashboard-he-phone`
capture) with the three ₪ chips → Receiver in English → Value → CTA.

Landing hero loop (for S6): 12 s, 1280×720, silent; the real dashboard on a slowly orbiting laptop,
one scan-beam pass, three floating chips (₪760 · 1.8% · ₪296) and a small "נתוני הדגמה" label.
Every motion is periodic in the 360-frame loop → seamless.

## Sources of every number / מקור לכל מספר

All demo figures are from the seeded demo tenant **"כפר הזיתים"** (`./scripts/dev-setup.sh`, seed run
with `DEMO_TODAY=2026-10-25`), month **October 2026**, and appear on the real screens captured into `public/shots/`.

| Number | Where it comes from |
|---|---|
| ₪760 leaked this month | `/dashboard` hero (`owner.leakHero`), `public/shots/dashboard-he.png`; seed log: "dashboard hero (this month): leak ₪760 of ₪42263 spend (1.8%)" |
| 1.8% of ₪42,263 | same hero ("1.8% מההוצאה על סחורה · מתוך ₪42,263 לפני מע״מ"); 760 / 42,263 = 1.80% |
| ₪296 caught before payment | hero card "נתפס לפני תשלום"; seed log "caught before payment ₪296" |
| ₪464 claimed from suppliers | hero card "נדרש מהספקים" (accepted to claim back). Shown as *claimed*, not "recovered" |
| Chain: leakiest branch ירושלים 975 ₪ = 2.9%, חיפה 355 ₪ = 0.6% (chain 2,089 ₪ = 1.5% of 137,059 ₪) | `/dashboard/chain` capture `public/shots/chain-he.png` after `pnpm --filter @restomatch/worker seed:chain-demo` (same `DEMO_TODAY`; base branch unchanged at ₪760) |
| 104.80 ₪ (approvals card / claim total) | `/dashboard/approvals` first card "ההפסד המוערך 104.80 ₪" (beer keg, Steinberg, invoice ST-24108) and `/dashboard/leaks/claims` "סה״כ לזיכוי 104.80 ₪" |
| 13 of 35 invoices flagged | hero card "חשבוניות עם חריגה 13 מתוך 35" (not used on screen beyond the real UI) |
| Beer keg ₪520 → ₪575 (+10.6%) | `/dashboard/leaks` table row "בירה מהחבית — חבית 30 ל׳", median ₪520.00 / latest ₪575.00 / +10.6% |
| "Billed 3 kg that never came" | `/dashboard/approvals`: cherry tomatoes, expected 6.5 received vs 9.5 billed ("חיוב על יותר ממה שהתקבל") |
| Receiver lines (Cherry tomatoes ₪14.00 ×15 kg, Coriander 10 bunch ×₪3.01, Romaine lettuce, Cucumbers) | the real English reconciliation `public/shots/reconcile-en.png` (local dev OCR stub; translations from `packages/translate` glossary) |
| 1.5% | not claimed as a result anywhere in the film (pilot target, docs/ICP.md) |

No ROI, savings-rate or customer claims are made. The paper invoices in beat 2 are illustrative props
built from real seeded product names and prices (line totals = qty × price, totals = Σ lines). URL `restomatch.co.il` is a placeholder (the landing's canonical URL is `APP_URL`, not yet
fixed) — change `SITE` in `src/copy.ts`.
