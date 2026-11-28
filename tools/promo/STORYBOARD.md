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
positive), danger `#B80F2A` (leak), gold `#755C00` (caught / new); dark stage: `#22D39A` / `#FF5C7A` /
`#E0B341`. Heebo + JetBrains Mono, the app's own files.

## Beats

| # | Time | Beat | On-screen copy (he) | On-screen copy (en) | Motion |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | **Hook** | כמה כסף / **דולף לכם** / החודש? · ₪2,250 · "רוב בעלי המסעדות לא יודעים לענות." · "דוגמה · מסעדה בדויה · אוקטובר" | How much / **money leaked** / this month? · ₪2,250 · "Most restaurant owners can’t answer." · "Sample · fictional restaurant · October" | Masked line rises, slow push-in, slot-machine ₪ reel with vertical motion blur, glow + specular sweep |
| 2 | 0:06–0:12.5 | **Problem** | עשרות משלוחים בשבוע. / חשבונית לכל אחד. / ואף אחד לא משווה שורה מול שורה. · stamps: "מחיר עלה +10.1%", "חויב על 3 ק״ג שלא הגיעו", "לא הוזמן" | Dozens of deliveries a week. / An invoice for each one. / And nobody checks them line by line. · "Price up +10.1%", "Billed 3 kg that never came", "Not ordered" | 9 Hebrew supplier invoices fly in from depth (3D, speed-blur), pile + camera shake, the three stamped cards rest on top (fixed spots) and the stamps slam; pile collapses into a scan line |
| 3 | 0:12.5–0:15 | **3-way match** | הזמנה · קבלת סחורה · חשבונית — "RestoMatch משווה כל חשבונית להזמנה ולמה שבאמת הגיע" | Order · Delivery · Invoice — "RestoMatch checks every invoice against the order and what really arrived" | Icons rise, connector draws, check-marks lock |
| 4 | 0:14.7–0:33.2 | **Product — owner** (screens DRAWN from components on the sample month; label "דוגמה · מסעדה בדויה, מספרים להמחשה") | 01 מספר אחד. בשקלים. · 02 מחירים שעלו · 03 מסמנים לפני התשלום · 04 בקשת זיכוי לכל ספק · callouts: דליפה החודש ₪2,250 · 1.5% מהרכש │ בירה מהחבית: ₪520.00 ← ₪572.40 +10.1% │ ממתין להחלטה שלך: ₪910 │ אושר לבקשת זיכוי: ₪720 (T2) | 01 One number. In shekels. · 02 Price rises · 03 Flag it before you pay · 04 A credit request per supplier · same callouts in English | 3D laptop; per screen: light-wipe in → camera push-in → spotlight → ~1.5 s hold with the callout → pull back; the laptop fades out completely before the receiver beat (dip) |
| 5 | 0:33.2–0:41.5 | **Receiver in English** (headline feature) | חדש · פיצ׳ר הדגל · מקבל הסחורה לא קורא עברית? **לא בעיה.** · callout "Cherry tomatoes ← עגבניות שרי" | New · flagship feature · Your receiver can’t read Hebrew? **No problem.** | Phone with the DRAWN English receiver screens (sample restaurant; quantities and states only — **no ₪**) + the Hebrew→English morph panel (names and quantities), then push-in + spotlight on the cherry-tomatoes card (ordered 15 kg, received 12 kg, "Short 3 kg"); dips in and out (no neighbouring ₪ shows through) |
| 6 | 0:41.5–0:54.9 | **Value** | דליפה החודש ₪2,250 (1.5% מתוך ₪150,000 רכש, לפני מע״מ) · נתפסו לפני תשלום ₪1,530 · בקשות זיכוי לשליחה ₪720 (T2) → "בלי לשנות את העבודה היומיומית." · 1 מצלמים את החשבונית · 2 המערכת משווה שורה מול שורה · 3 מאשרים — לפני התשלום | Leak this month ₪2,250 (1.5% of ₪150,000 spend, before VAT) · Caught before payment ₪1,530 · Credit requests to send ₪720 → "Without changing your daily routine." + 3 steps | Count-ups (settle on the sample figures), blur-out, kinetic line, steps stagger |
| 7 | 0:55–1:00 | **CTA** | RestoMatch · המספר שכל בעל מסעדה צריך · [בדיקת דליפה חינם] (= the site's CTA; no URL) | RestoMatch · The number every restaurant owner needs · [Get a free leak check] (no URL) | Ring burst, logo draws on, wordmark de-blurs, sweep |

The old vertical social cut (demo-seed phone capture, ₪760) is retired; a 9:16 cut of the sample-month
film is a follow-up.

Landing hero loop (S10, pinned in apps/web/lib/heroMedia.ts): 12 s, 1280×720, silent; the sample month's
dashboard on a slowly orbiting laptop, one scan-beam pass, floating chips (₪2,250 · 1.5% · ₪1,530).
Every motion is periodic in the 360-frame loop → seamless.

## Sample month (2026-11) / חודש הדוגמה

Since the public release, the 60 s films show the site's ONE sample month, not the demo seed: `src/sample.ts`
mirrors `apps/web/app/(marketing)/_components/sampleMonth.ts` and `scripts/check-sample.mjs` pins it (run by
`verify.sh`). Leak ₪2,250 = 1.5% of ₪150,000 purchases; 35 invoices checked · 13 with a gap; awaiting your
decision ₪910 (2 gaps, incl. the ₪104.80 draft-beer-keg example); credit requests to send ₪720 (3 gaps);
caught before payment ₪1,530; ₪620 approved for offset. The product beats are drawn from components
(`components/ProductScreens.tsx`, light tokens, Heebo) instead of demo-seed screenshots; every frame carries a
"דוגמה · מספרים להמחשה / Sample · illustrative figures" tag; no target line; partner wording toward suppliers
("בקשת זיכוי", "אושר לבקשת זיכוי" — never "דרישה/נדרש"). The chains beat is out (the sample month has no branch
figures). The tables below describe the earlier demo-seed cut.

## Sources of every number / מקור לכל מספר (current cut)

Every figure on screen comes from `src/sample.ts`: `SAMPLE` (= the site's `sampleMonth.ts`, pinned by
`scripts/check-sample.mjs`) or `FILM`, the film's breakdown inside that month, which the same script
reconciles to SAMPLE in integer agorot. No demo-seed figure and no demo restaurant name ("מסעדה לדוגמה /
Sample restaurant") appear anywhere.

| On screen | Source |
|---|---|
| Leak ₪2,250 · 1.5% · of ₪150,000 checked spend, before VAT | `SAMPLE.leak`, `SAMPLE.leakPct`, `SAMPLE.purchasing` (check: 150,000 × 1.5% = 2,250) |
| 35 invoices checked · 13 with a gap | `SAMPLE.checked`, `SAMPLE.withGap` |
| Caught before payment ₪1,530 | `SAMPLE.unpaid` (check: unpaid + paid = leak) |
| Awaiting your decision ₪910 · 2 gaps | `SAMPLE.decide` |
| Keg gap ₪104.80 = (₪572.40 − ₪520.00) × 2 kegs · price +10.1% | `FILM.keg` (check: = `SAMPLE.decide.example.amount`); % computed (`risePct`) |
| The other gap ₪805.20 | `SAMPLE.decide.amount − SAMPLE.decide.example.amount` |
| Entrecôte ₪139 → ₪149 · salmon ₪89 → ₪96 | `FILM.rises` (% computed) |
| Credit requests ₪300 · ₪240 · ₪180 = ₪720 · 3 | `FILM.credits` (check: Σ = `SAMPLE.credit.amount`, length = count) |
| Approved for offset ₪620 | `SAMPLE.goodNews` (check: unpaid − decide) |
| Receiver beat: cherry tomatoes ordered 15 kg, received 12 kg ("Short 3 kg") — **no ₪** | `FILM.delivery`; `scripts/frame-check.mjs` OCRs nothing — it checks the beat's frames against a ₪-free render |

Words follow `apps/web/lib/i18n/glossary.ts`: an undecided ₪ is a "פער / Gap", never "הפסד / loss"; nav and
screen names are the app's (בית · קבלת סחורה · אישורים · דליפה · בקשות זיכוי לשליחה; "מחירים שעלו", "המחיר
הרגיל"). No URL on the end card (the domain isn't final) — the site's dialog shows the real CTA. The old
9:16 social cut (demo-seed phone capture) is retired; a 9:16 cut of the sample-month film is a follow-up.
No ROI, savings-rate or customer claims are made. The paper invoices in beat 2 are illustrative props
(line totals = qty × price, totals = Σ lines; the keg/entrecôte/salmon prices are `FILM`'s).
