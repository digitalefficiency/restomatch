# Area review: Marketing site, pricing, legal and showcase (`marketing`)

**Reviewer:** UX review team, area `marketing` · **Date:** 2026-10-25 · **Tree:** `main` @ `8fef118c` (lab worktree)
**Routes:** `/`, `/about`, `/pricing`, `/privacy`, `/terms`, `/cookies`, `/leak-check`, `/leak-check/result`, `/leak-check/claim`, `/showcase`, `/showcase/receiver`, `/showcase/dashboard`, `/showcase/dashboard/invoices`, `/showcase/deliveries`, `/showcase/approvals`
**Lens:** the first impression of a restaurant owner, mostly on a phone, and how quickly that owner gets to a pilot.

## 0. Scores against world-class (0–10)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **4.5** | The hero is strong, but after it there is no persistent CTA for about 4,700 px. The menu never closes, a 114 px cookie bar asks consent for analytics that don't exist, the hero art is an illegible shrunken laptop, and the showcase chrome takes 22% of the screen. |
| Desktop | **6.0** | Light, calm and coherent, with a good hero headline. But the proof is thin, the hero art is illegible, features are buried on `/about`, pricing has no compare table or ROI anchor, and the showcase dashboard doesn't look like the product. |
| Functionality | **4.0** | A lead can be submitted with a **name only**, which leaves no way to reach the person. There is no direct contact channel, no self-serve "start free" even though it is promised, and no accessibility statement. The legal pages are public lawyer drafts, the success state is a dead end, flag-off leak-check sends visitors to `/login`, and there are no funnel analytics. |

**Bars:** fails the pilot bar (P0s below) and the world-class bar.

## 1. How this was reviewed

1. I read `areas-slim.json` and the 45 crawl rows. All 200s except `/leak-check*`, which returns 404 (flag off in the lab). axe found one serious violation: `nested-interactive` ×5 on `/showcase/dashboard/invoices`. There is no overflow-x.
2. I read every page and component. Marketing: `app/page.tsx`, `(marketing)/*` (MarketingShell, LeadForm, LazyLeadForm, HeroVideo, PromoVideoButton, detail-sections, RoiCalculator, AnchorScrollFix, LegalShell, pricing, about, privacy/terms/cookies, the leak-check page, form, result, DemoCta and claim). Showcase: `showcase/layout.tsx`, the hub, receiver steps, dashboard, invoices, deliveries and approvals. Also `CookieConsent.tsx`, `not-found.tsx`, `lib/heroMedia.ts`, `packages/db/src/plans.ts` and `packages/api/src/routers/leads.ts` (read only), plus the `landing`, `marketing`, `legal`, `leakCheck` and `showcase` i18n.
3. **The crawl's full-page PNGs leave the home sections blank.** This is an artifact: `.rm-defer` uses `content-visibility:auto`, and `.rm-step`/`.rm-reveal` use `animation-timeline: view()`. I re-captured with real scrolled viewports (Playwright against the lab on :3320, reduced motion, consent pre-set) into `review/mkt/*.png`. I also ran interaction probes (`review/mkt/measures-probes.json`) that open the menu, tap the hero CTA, submit the form empty, submit a name-only lead (lab DB), open the promo modal and tap the pricing "start free" CTA.
4. I scored against RUBRIC.md, mainly groups A, B, C, E, F, H (light), I and J (all Public-archetype rows), plus G, D and C13 for the showcase (Field archetype for `showcase/receiver`).

Evidence shorthand: `shots/…` = crawl captures, `mkt/…` = my viewport captures in `review/mkt/`, `crops/…` = contact sheets in `review/crops/`.

## 2. The primary task, walked end to end (phone, Hebrew, first visit)

**Task: "I own a restaurant. I saw an ad and I want to know whether this is worth a pilot."**

| # | What happens | Taps | Verdict |
|---|---|---|---|
| 1 | Land on `/`. Above the fold: eyebrow, H1 "כמה כסף דולף לך בקבלת סחורה?", lead line, **"בדיקת דליפה חינם"** (52 px, full width), "צפו ב-60 שניות", 3 ticks, top of the hero video. The cookie bar (114 px) appears once the CTA scrolls clear. | 0 | Good hero. The ₪ value only appears in tiny chips on the video. |
| 2 | Scroll. Steps, receiver morph, proof (₪2,250 / 0.39% / 12), pricing teaser, FAQ, form. **No CTA anywhere between the hero and the form.** The header on phone shows only ☰, EN and the logo (`MarketingShell.tsx:86-97` hides "כניסה" below sm and "תיאום הדגמה" below md). | ~8 screens | No persistent CTA, no WhatsApp. |
| 3 | Tap the hero CTA. A smooth scroll of **4,749 px over 1.8 s** to `#lead`. The CTA said "free leak check"; the section says "השאירו פרטים ונתאם…" and the button says **"תאמו לי הדגמה"**. | 1 | Promise mismatch. |
| 4 | Submit empty. Focus moves to the name field, which sits **under the sticky header**. The error is shown as a block above the consent checkbox, far from the field (`mkt/lead__phone-he_empty-submit.png`). | 1 | Fails F3 and C6. |
| 5 | Type a name only and submit. Result: **"תודה! קיבלנו את הפרטים — נחזור אליכם בהקדם"**. No phone, no email, so nobody can call back (`mkt/lead__phone-he_success-nameonly.png`). | 2 | **P0: a lost lead.** |
| 6 | The success card is half empty (31 rem reserved). It has no next step: no booking, no demo link, no WhatsApp, no "when we'll call". | 0 | Dead end. |

**Alternative path via pricing:** tap "התחילו בחינם" on `/pricing`. It lands on `/#lead`, the same "book a demo" form (`measures-probes.json → pricingTrialLands`). There is no self-serve start.

**Alternative path via the demo:** `/showcase` → receiver → complete the flow. The only CTA at the end is "קבלה נוספת" (`Confirmed.tsx:134`). The 28 px "תאמו הדגמה" in the header is the only route to conversion, and on phone there is **no way back to the site** (`layout.tsx:53-59`, `hidden sm:inline-flex`).

**Benchmark:** Ramp, Toast and MarginEdge put one consistent primary ("Get started" / "Get a demo") in a sticky header and repeat it at each section break. Ramp's form asks for a work email first and offers instant scheduling (Chili Piper) on submit. Israeli SMB SaaS adds WhatsApp click-to-chat as the default secondary [K]. RestoMatch takes 3 taps to reach a form that can drop the lead.

## 3. Page-by-page notes

### `/` Home (Landing v2)
- **Works:** the hero hierarchy (one H1, one solid primary, one secondary), honest copy ("יעד, לא הבטחה"), `data-keep-clear` keeping the consent bar off the CTA, LCP engineering (preloaded poster, video after `load`, reduced-motion respected), FAQ JSON-LD and hreflang.
- **Phone:** the hero art is a 16:9 desktop laptop shot at 356×200 px. The dashboard inside is about 170 px wide and unreadable, and only the three chips (₪760, 1.8%, ₪296) are legible (`crops/s_home_phone_a.png`). A vertical promo cut was produced (task #9) but isn't used. `heroMedia.ts` has no portrait source, and the promo modal plays 16:9 inside a 358 px dialog (`crops/s_probes.png`, panel 3).
- **Steps:** on phone this is 3 stacked centred items, about 1.5 screens for 3 short sentences.
- **Receiver morph:** a great differentiator (Hebrew paper, English receiver). The 7 s infinite loop has no pause control (F9, WCAG 2.2.2).
- **Proof row:** money is set in `font-mono` (`page.tsx:366`). JetBrains has no Hebrew, so "בחודש" inside "₪2,250 בחודש" falls back to another face (`crops/s_home_phone_b.png`). The leak figure here (₪2,250, 1.5%) differs from the hero video (₪760, 1.8%) and the showcase (₪4,820, "דליפה פוטנציאלית").
- **Pricing teaser:** "חינם" vs "החל מ-₪349 לחודש + מע״מ". Fine, but its CTA "לכל המסלולים" leaves the page.
- **Lead form:** 4 fields, only the name required. The placeholders look like values ("ישראל ישראלי", "כפר הזיתים", "120000"). The phone placeholder is LTR-aligned while the others are right-aligned. The consent text uses ASCII `דוא"ל`. A `source` of `'landing'` is hard-coded.
- **Footer:** product / company / legal. It is missing an accessibility statement, contact details (phone, WhatsApp, email), company identity (ח.פ., address) and a "הגדרות עוגיות" link. The copyright is set in `font-mono`, and its Hebrew spacing renders wide (`shots/pricing__public__desktop-he.png`, bottom).
- **Desktop:** clean and calm. The hero art is again a small, illegible laptop (`mkt/home__desktop-he-rm-c_00.png`). Below the fold the page goes straight from 3 steps to the receiver card to 3 numbers. An executive never sees an actual invoice-vs-order comparison or a real product screen on the home page.

### `/about`
- 13 phone screens (9,041 px). The page mixes the founder story, the problem in ₪, the full feature list, the ROI calculator and trust, under an "אודות" H1. The nav item "יכולות" deep-links to `/about#features`, so the product page is hidden inside About.
- The problem cards hard-code `₪3,900`-style strings (₪ before the digits, no space) next to `formatIls` output (`2,250 ₪`) on the same page. That is two money formats.
- **ROI calculator** (`RoiCalculator.tsx`): `type="number"` (`:45`), with no thousands separator ("150000"). The ₪ adornment sits at the start. Mono digits. A danger-red card shows a self-entered estimate. It has **no CTA** and its result isn't carried into the lead form, so the owner types their purchasing figure twice (WCAG 3.3.7).
- There is no team, no faces and no company details. "אנחנו בשלב פיילוט" is honest, but nothing tells the owner what a pilot is (duration, what we need from you, what you get).

### `/pricing`
- **Desktop:** 4 tidy columns (`shots/pricing__public__desktop-he.png`). The **Basic (₪349) column visibly lists fewer features than the free Trial**: Trial has integrations, WhatsApp alerts, analytics and export (`plans.ts:28-43`), so paying looks like a downgrade. There is no compare table, no FAQ, no explanation of what counts as an invoice, no trial duration and no annual option.
- **Phone:** 4 stacked cards (3,522 px). "מומלץ" (Pro) is the 3rd card, about 2 screens down (`crops/s_pricing_phone.png`).
- VAT appears only in the footnote; the price row says "/ חודש", while the home says "לחודש + מע״מ".
- **Every CTA goes to `/#lead`** (`pricing/page.tsx:94-104`), a cross-page jump to the bottom of the home page that loses the plan context.
- "איך תמחרנו" is a paragraph. It should be the calculator.

### `/privacy`, `/terms`, `/cookies`
- These publish a **lawyer draft**:
  - A gold banner reads "טיוטה לבדיקת עורך/ת דין… אין להסתמך על נוסח זה".
  - Every clause carries a `[לאימות עו"ד]` tag.
  - Clauses contain placeholders such as "יושלמו כאן".
  - The header reads "עודכן לאחרונה: —".
  - No controller is identified and there is no contact address (`legal.he.ts:8-13, 28-29, 103`; `crops/privacy_phone_top.png`).
- The sub-processor table lists **Upstash** and **Fly.io** (`privacy/page.tsx:147,149`), both stale after the Redis removal (#15) and the in-Vercel jobs change (#136). It also says DPA "בבדיקה" for every row.
- There is a typo, "דוא"ד" (`legal.he.ts:33`), and ASCII quotes throughout.
- The cookie policy says preferences can be changed "by deleting the cookie in the browser" (`legal.he.ts:182`). There is no in-site control.

### `/leak-check`, `/leak-check/result`, `/leak-check/claim` (flag off in the lab; reviewed from code)
- **Flag off:** visitors get the root `not-found.tsx`. Its only button is "חזרה לסקירה" → `/dashboard`, which sends an anonymous visitor to `/login`. It renders as `<Link><Button>` (nested interactive) with no marketing chrome (`shots/leak-check__public__phone-he.png`). Any ad, QR code or email linking to `/leak-check` is a dead end the moment the flag is off.
- **Flag on, phone:** the explainer column renders first and the upload form second (`page.tsx:36-81`), so the action is below the fold. Picked files show only as "N קבצים נבחרו", with no thumbnails and no way to remove one. The button cycles through 3 indeterminate labels during upload and OCR. A 10-file OCR can take tens of seconds, which calls for determinate stages (I3).
- **Result:** the H1 is a sentence ("נמצאה דליפה של ₪X במדגם שלכם"), not the app's T1 LeakHero (J2, fintech P24). The table uses mono ₪, a `text-end` amount column and "Σ" as the label of the totals row.
- **"התחילו ניסיון עם התוצאות האלה":** this goes to claim, then `/login` (magic link), then `/onboarding`, then claim again, then confirm. That is about 6 steps plus an email round trip, even though the visitor already gave an email.

### `/showcase` hub and shell
- **Chrome on phone:** the sticky header is about 185 px (22% of 844). It holds the brand row, a CTA+EN row, a tab row (5 tabs, 3 visible, no fade or scroll affordance, **no active state**: no `aria-current` in `ShowcaseLink`, `layout.tsx:91-99`) and an 11 px disclaimer strip.
- **Navigation and targets:** "לאתר" is hidden on phone. The CTA is 28 px tall and the tabs are 32 px (`menu-probe` output).
- **Missing pieces:** no skip link, no footer (no legal or accessibility links). Its own visual system: an inline font-family and radial gradient (`layout.tsx:23-31`), max-w-7xl, 18 hex colours, 65 sub-12 px text sizes and 74 `font-mono` uses across the showcase.
- **Hub cards:** good ("01 · מובייל · צוות הקבלה"). The number tags are mono and letter-spaced.

### `/showcase/receiver`
- Phone-first and credible. It has a step indicator, supplier cards, real OCR and a demo-image option.
- **Problems:**
  - The eyebrow "צעד 1 מתוך 5" is `uppercase tracking-[0.18em]` on Hebrew (E6, `SupplierSelect.tsx:149`).
  - A second EN switcher sits inside the page, on top of the one in the header.
  - "המשך לסריקה" is a narrow button at the bottom start rather than a full-width 56 px thumb-zone primary (G2).
  - GSAP animations ignore reduced motion (F9).
  - **The flow ends without a conversion** (`Confirmed.tsx:134`): its primary is "קבלה נוספת".

### `/showcase/dashboard` and `/showcase/dashboard/invoices`
- **This is not the product (J3).** It shows 3 mono KPI cards ("דליפה פוטנציאלית החודש ₪4,820", "נחסך עד כה ₪12,340", "ממתינות 7"), a heatmap about 1,300 px tall on desktop that is mostly "·" cells, and an event feed (`shots/showcase_dashboard__public__desktop-he.png`). The real owner home is a LeakHero plus a Needs-you stack.
- The vocabulary ("פוטנציאלית", "נחסך") is off-glossary (A9).
- **Invoices:** the rows are `role="button"` divs containing 2 `<Link>`s, which axe flags as `nested-interactive` (serious) ×5 (`invoices/page.tsx:255-283`). The filter chips are about 30 px tall.

### `/showcase/deliveries` and `/showcase/approvals`
- **Deliveries:** a nice use of call and WhatsApp to the rep. The native `<input type="time">` rendered "07:41 AM" in the captures (12-hour, E8; this depends on the browser locale). The red card is correctly T2.
- **Approvals:** the matrix is readable on phone. The Hebrew copy leaks jargon: "PO line", "סף ה-block" (`approvals/page.tsx:117,144`). Neither page has an in-page CTA.

## 4. Findings

Severity: P0 blocks or misleads a core task or loses money or trust · P1 major friction, or below par against the benchmark · P2 polish · P3 nit. `humanPR` = needs a human-authored PR or an owner/counsel decision.

### P0

**mkt-01 · A lead can be submitted with no way to contact it** · functional · both · `/` `#lead` · effort S · humanPR: no (server-side enforcement is a proposal for the immutable `leads.ts`)
- *Evidence:* `apps/web/app/(marketing)/_components/LeadForm.tsx:153-171`, which only checks the name. `:204-216`: phone is optional, and there is no email field even though the router accepts `email` (`packages/api/src/routers/leads.ts:15-17`). Probe: a name-only submission returned the success state (`mkt/lead__phone-he_success-nameonly.png`).
- *Problem:* the success copy promises "נחזור אליכם בהקדם", but the row holds only a name. Every such submission is a lost pilot.
- *Fix:*
  - Require **one contact channel**: a "נייד / וואטסאפ" field (`type=tel`, `autocomplete=tel`, `dir=ltr` with `rtl:text-right`). Validate Israeli mobiles with `/^0?5\d-?\d{7}$/` and normalise to `05X-XXXXXXX`, or offer "או אימייל" as a toggle.
  - Put the inline error under the field: "צריך טלפון או אימייל כדי שנחזור אליכם".
  - Drop "שם מלא" to optional (first name is enough).
  - Proposal (human PR): add a zod `.refine(phone || email)` to `LeadInput`.
- *Exemplar:* Ramp's demo form (work email is the first and required field); Toast's demo form (phone required).

**mkt-02 · No accessibility statement (הצהרת נגישות)** · a11y/trust · both · all public shells · effort M · humanPR: yes (statement content and the coordinator come from the owner)
- *Evidence:* there is no `app/(marketing)/accessibility` route. The footer links (`MarketingShell.tsx:183-196`) and the sitemap (`(marketing)/_components/seo.ts:15`) have no entry. This confirms rtl.md F9.
- *Rule:* F1 (S0, Israeli Service Accessibility Regulations, reg. 35).
- *Fix:*
  - Add `/accessibility` (he/en) with:
    - ת״י 5568 AA / WCAG 2.2 AA;
    - the audit date;
    - the browsers and screen readers tested;
    - known gaps (for example, the showcase GSAP motion);
    - the coordinator's name, phone and email, and a response SLA.
  - Link it in the marketing footer "משפטי" column, the showcase footer (new), login, dashboard settings and `/s/[token]`. Add it to `MARKETING_ROUTES`.
  - No overlay widget.
- *Exemplar:* the accessibility statements of Kol Zchut and the SII.

**mkt-03 · Legal pages are public counsel drafts with placeholders and stale facts** · trust · both · `/privacy`, `/terms`, `/cookies` · effort M · humanPR: yes (counsel and owner)
- *Evidence:* `lib/i18n/messages/marketing/legal.he.ts:8-13` (the "טיוטה… אין להסתמך" banner), `:28-29` (no controller identity, "יושלמו כאן"), `:103` (no contact), `:33` (typo "דוא"ד"). `(marketing)/_components/LegalShell.tsx:34-57,85-93` tags every clause `[לאימות עו"ד]` and shows "עודכן לאחרונה: —". `(marketing)/privacy/page.tsx:142-152` lists Upstash and Fly.io, both removed (#15, #136). Screenshot `crops/privacy_phone_top.png`.
- *Problem:* the first thing a careful owner or bookkeeper clicks before handing over supplier invoices says "do not rely on this". It also lacks the controller identity and contact that the duty-to-inform requires, while the site is collecting leads.
- *Fix:* the owner and counsel finalise the 3 texts. Remove the draft banner and tags. Fill in the controller (legal name, ח.פ., address), a privacy contact and a date. Make the sub-processor table match production (drop Upstash and Fly unless still used; fill in countries and DPA status). Fix the typo and gershayim.
- *Exemplar:* Stripe's privacy centre (named entity, dated versions, a sub-processor list with locations).

### P1

**mkt-04 · One destination, four names; the free leak check is a demo form** · flow/copy · both · `/`, `/pricing`, header · effort S · humanPR: no
- *Evidence:*
  - Hero "בדיקת דליפה חינם" → `#lead` (`app/page.tsx:189-192`, `landing/he.ts:21`).
  - Header "תיאום הדגמה" (`marketing/he.ts:22`).
  - Submit "תאמו לי הדגמה" (`:55`).
  - Pricing "התחילו בחינם" → `/#lead` (`pricing/page.tsx:94-104`; probe `pricingTrialLands`).
  - With `leakCheckPublic()` on, the nav's "בדיקת דליפה חינם" goes to `/leak-check` while the hero button with the same label goes to `#lead` (`MarketingShell.tsx:53`).
- *Fix:* pick one primary and use it everywhere. Suggested: **"בדיקת דליפה חינם"**.
  - When `leakCheckPublicEnabled()`, the hero, header and pricing route to `/leak-check`.
  - Otherwise they go to `#lead`, with the submit button reading "תאמו בדיקת דליפה" and a section line "נריץ 10 חשבוניות שלכם ונראה לכם את ה-₪".
  - Rename "התחילו בחינם" to "התחילו פיילוט חינם" unless a real self-serve signup ships (see big move 1).
- *Exemplar:* Ramp ("Get started" is the same flow in the header, hero and pricing).

**mkt-05 · No persistent CTA on phone; the hero CTA scroll-jumps 4,749 px** · flow · mobile · `/`, `/about`, `/pricing` · effort S · humanPR: no
- *Evidence:* `MarketingShell.tsx:86-97` (login is `hidden sm:inline-flex`, the CTA is `hidden md:inline-flex`). Probe `afterHeroCta`: `scrollY 4749`, 1,843 ms. `crops/s_home_phone_a–c.png` show no CTA between the hero and the form.
- *Fix:* add a `<StickyCta>` below md that appears once the hero CTA leaves the viewport and hides while `#lead` or the footer is visible:
  - 64 px plus `env(safe-area-inset-bottom)`;
  - **[וואטסאפ]** (outline) and **[בדיקת דליפה חינם]** (solid), each at least 48 px;
  - publishes `--rm-bottomnav-h` and sits above the consent bar via `--consent-h`.
  - Also show a compact 40 px "בדיקה חינם" pill in the header below md.
  - Replace the 4.7k px jump with an in-place bottom sheet holding the 2-field form (mkt-01).
- *Exemplar:* Toast and Square mobile sites (a sticky "Get a demo"); Wolt for Business.

**mkt-06 · No direct contact channel anywhere** · functional/trust · both · all marketing pages · effort S · humanPR: no (the owner supplies the number)
- *Evidence:* no `mailto:`, `tel:` or `wa.me` link in `(marketing)/`, `app/page.tsx` or the landing/marketing i18n (grep). The error copy says "או כתבו לנו ישירות" (`marketing/he.ts:61`) with nowhere to write. The footer's "יצירת קשר" → `/#lead` (`MarketingShell.tsx:176-178`).
- *Fix:*
  - Add a WhatsApp click-to-chat (`https://wa.me/972XXXXXXXXX?text=` prefilled with "היי, אני מ-<מסעדה>, רוצה בדיקת דליפה חינם") to the sticky bar, the form section, the success state, the error state and the footer.
  - Add a phone and email to the footer and to the privacy contact clause.
  - Number as a config constant (`lib/contact.ts`).
- *Exemplar:* the Israeli SMB SaaS norm is a WhatsApp chip beside every primary CTA [K]; Intercom-style "talk to us" on Ramp.

**mkt-07 · The lead success state is a dead end** · states/flow · both · `/` `#lead` · effort S · humanPR: no
- *Evidence:* `LeadForm.tsx:130-145` (one sentence, no actions). `LazyLeadForm.tsx:51` reserves `min-h-[31rem]`, so half the card is empty (`mkt/lead__phone-he_success-nameonly.png`).
- *Fix:* the success card should state:
  - who, when and how: "רום יחזור אליכם עד מחר 12:00 בוואטסאפ ל-050-…";
  - one primary action, "שלחו לנו עכשיו 3 חשבוניות בוואטסאפ" (wa.me), or a slot picker (Cal.com embed) "קבעו 15 דק׳";
  - a secondary "בינתיים — פתחו את הדמו החי";
  - and release the reserved height after mount.
- *Exemplar:* Chili Piper instant booking after a demo form (Ramp, Rippling).

**mkt-08 · The mobile menu never closes** · functional · mobile · all marketing pages · effort S · humanPR: no
- *Evidence:* `MarketingShell.tsx:98-124` uses a native `<details>`. Probe (`review/scripts/menu-probe.cjs`): `open:true` after tapping the "/#how" link, after tapping outside and after Esc (`mkt/home__phone-he_menu-after-anchor.png`).
- *Fix:* replace it with a small client `MobileMenu`:
  - `button aria-expanded` that opens a full-height sheet from the start edge with a scrim;
  - closes on link click, hash change, outside tap and Esc, and returns focus to the trigger;
  - 48 px rows, with the primary CTA and the WhatsApp chip pinned at the bottom.
- *Exemplar:* Linear and Stripe mobile nav sheets; Material navigation drawer.

**mkt-09 · Focus and errors land under the sticky header; the error sits far from its field** · a11y · both · `/` `#lead`, all forms · effort S · humanPR: no
- *Evidence:* `app/globals.css` has no `scroll-padding` (rubric F3 baseline). `LeadForm.tsx:153-157` focuses `#lead-name`, which ends up under the 56 px header (`mkt/lead__phone-he_empty-submit.png`). `:260-268` renders the error as a block above the consent row.
- *Fix:*
  - `html{scroll-padding-top:calc(var(--rm-header-h,64px) + 12px);scroll-padding-bottom:var(--consent-h,0px)}`.
  - Render field errors through `Field`'s error slot directly under the input, with `aria-describedby`.
  - Keep a summary only when there are 3 or more errors (C6).
- *Exemplar:* GOV.UK error pattern; Primer forms.

**mkt-10 · The cookie banner covers 114 px of every phone first visit to ask about analytics that don't exist** · trust/perf · mobile · all public pages · effort S · humanPR: yes (legal sign-off on consent)
- *Evidence:*
  - `lib/components/CookieConsent.tsx:83-121`; probe `consentH: 114px`.
  - The cookie policy lists analytics as "(עתידי)" (`legal.he.ts:168`), and no analytics SDK is in the repo (grep).
  - "קבלת הכל" is the solid primary next to an outline "רק חיוניות" (`:107-120`), a nudge.
  - There is no way to reopen the choice (`legal.he.ts:182`).
- *Fix:*
  - While only strictly-necessary cookies exist, don't render the banner. Show a "הגדרות עוגיות" link in the footer that opens a small sheet.
  - When analytics land: equal-weight buttons, the same reopen link, and `--consent-h` keeps sticky UI clear.
- *Exemplar:* GOV.UK cookie banner (equal buttons, a settings page); Plausible/Vercel cookieless analytics avoid the banner entirely.

**mkt-11 · Pricing doesn't sell: no plan context, no compare, no trial terms, Pro buried on phone** · ia/flow · both · `/pricing` · effort M · humanPR: no (UI only; see mkt-27 for the entitlements question)
- *Evidence:*
  - `pricing/page.tsx:94-104`: every CTA → `/#lead`, and the plan is lost (source stays `'landing'`, `LeadForm.tsx:167`).
  - `:59` stacks 4 cards; Pro is the 3rd card on phone (`crops/s_pricing_phone.png`).
  - `:91` "/ חודש" with no VAT beside the price; the footnote is at `:140`.
  - No trial duration copy (`marketing/he.ts:113`).
- *Fix:*
  - **Phone:** a segmented switcher [ניסיון | בסיס | מקצועי | רשת] with Pro preselected, one card visible, and a sticky "התחילו עם מקצועי" bar.
  - **Desktop:** keep the 4 columns, add a compare table (rows: invoices per month, branches, users, WhatsApp alerts, export, integrations) and a pricing FAQ (what counts as an invoice, what happens at the trial limit, cancelling, VAT).
  - Put "+ מע״מ" beside each price.
  - Make CTAs plan-aware: `/?plan=pro#lead` with `source:'pricing:pro'` (the router's free-text `source` already allows this, so no router change).
  - Replace "איך תמחרנו" with the calculator: "ברכש של ₪___ — מקצועי מחזיר את עצמו אם הוא תופס 0.39%".
- *Exemplar:* Linear and Notion pricing (compare table plus FAQ); Ramp savings calculator.

**mkt-12 · Flag-off `/leak-check` is a 404 that sends visitors to `/login`** · flow/states · both · `/leak-check*` · effort S · humanPR: no
- *Evidence:* `(marketing)/leak-check/page.tsx:29` (`notFound()`). `app/not-found.tsx:24-26` links to `/dashboard` with the label "חזרה לסקירה", as `<Link><Button>`, with no marketing chrome. Screenshot `shots/leak-check__public__phone-he.png`; crawl status 404 plus a console error.
- *Fix:*
  - When the flag is off, `redirect('/?intent=leak-check#lead')`, or render a MarketingShell T4 page: "הבדיקה האוטומטית תיפתח בקרוב — נריץ אותה איתכם ידנית" with the lead form.
  - Give the marketing group its own `not-found.tsx` inside MarketingShell, with links to home, demo and pricing.
  - Fix the nested `Link>Button` (use `Button asChild` or a styled Link).
- *Exemplar:* Stripe docs 404 (search plus the top destinations, inside the site chrome).

**mkt-13 · Leak-check, the best acquisition asset, is buried, slow to act on and ends in a 6-step claim** · flow · mobile · `/leak-check`, `/result`, `/claim` · effort M · humanPR: no
- *Evidence:*
  - `leak-check/page.tsx:36-81`: the form is the 2nd grid child, below the explainer on phone.
  - `LeakCheckForm.tsx:217-235`: shows "N קבצים נבחרו" only, with no list and no remove.
  - `:299-306`: indeterminate phases only.
  - `result/page.tsx:110-112`: the hero is a sentence. `:155-170`: mono ₪, `text-end`, "Σ".
  - `claim/page.tsx:37-38`: login, then onboarding, then the claim.
- *Fix:*
  - **Phone:** order the page as H1, upload, then the explainer collapsed under "מה נבדק".
  - Selected files show as 64×80 thumbnails with ✕. Upload and OCR show determinate stages ("מפענחים 3/7…").
  - The result renders the app's `<LeakHero>` (T1 ₪, "% מהרכש שנבדק", "7 חשבוניות נבדקו", "הערכה ממדגם").
  - "המשיכו עם התוצאות" sends the magic link to the email already given and attaches the result automatically after onboarding (one confirmation).
  - Amounts align physically right (R-1), in Heebo tabular.
- *Exemplar:* fintech.md P24 (first ₪ under 10 minutes, the same hero in the app); Ramp's free savings analysis.

**mkt-14 · The phone hero art is a shrunken desktop; the vertical promo is unused** · visual · mobile · `/` · effort M · humanPR: no
- *Evidence:* `lib/heroMedia.ts:20-46` (only 16:9 loops and posters), `public/media/hero-poster.jpg` (the laptop screen is about 45% of the frame), `HeroVideo.tsx:65-97`, `PromoVideoButton.tsx:171` (16:9 in a 92vw dialog). Screenshots `crops/s_home_phone_a.png`, `crops/s_probes.png` panel 3.
- *Fix:*
  - Below sm, show a **portrait** loop of the receiver phone flow (photo → line flagged → "₪36 נתפסו") at 9:16, about 360×480, through `<source media="(max-width:639px)">` with a matching poster.
  - The promo modal plays the vertical cut full-screen on phones.
  - Keep the desktop loop for md and up.
- *Exemplar:* Ramp and Mercury mobile heroes (device-native UI crops, not laptops) [K].

**mkt-15 · Auto-moving content without a pause; showcase GSAP ignores reduced motion** · a11y · both · `/`, `/showcase/*` · effort S · humanPR: no
- *Evidence:*
  - `app/globals.css:263-271`: `rm-morph` runs 7 s infinite.
  - `app/page.tsx:324`: no pause control. The hero eyebrow dot pulses forever (`:170`).
  - GSAP without `matchMedia` in 12 showcase files, e.g. `showcase/approvals/page.tsx`, `receiver/_steps/*.tsx`, `dashboard/invoices/page.tsx:65-72`.
- *Rule:* F9 (WCAG 2.2.2, Level A).
- *Fix:*
  - Add a 44 px "השהיית האנימציה" toggle on the morph card (reuse the HeroVideo button style) and stop the loop after 3 cycles.
  - Remove the infinite pulse.
  - Wrap showcase GSAP in `gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', …)`.
- *Exemplar:* Apple HIG Motion; IBM Carbon motion.

**mkt-16 · The showcase shell eats a quarter of the phone, hides where you are and has no way back** · ia/nav · mobile · `/showcase/*` · effort M · humanPR: no
- *Evidence:*
  - `showcase/layout.tsx:32-85`: a 3-row header plus an 11 px note, about 185 px.
  - `:53-59`: "לאתר" is `hidden sm:inline-flex`.
  - `:60-65`: the CTA is `text-xs`, 28 px.
  - `:91-99`: `ShowcaseLink` has no active state and no `aria-current`; the tabs are 32 px.
  - No skip link and no footer.
  - Probe output in `review/mkt/` (`menu-probe.cjs`).
- *Fix:*
  - **Phone header:** one row (logo, "דמו" badge, a 40 px "תאמו" pill, ☰).
  - **Demo picker:** a "בחרו דמו ▾" sheet, or a bottom segmented bar with an active pill and `aria-current="page"`.
  - Move the disclaimer into the badge's popover. Add a skip link and the marketing footer (legal and accessibility).
  - On desktop, keep the tabs with an underline active state.
- *Exemplar:* Stripe's interactive demo chrome (one slim bar, a clear "exit demo"); Navattic/Arcade product tours.

**mkt-17 · The showcase dashboard isn't the product the prospect will get** · trust/visual · both · `/showcase/dashboard`, `/invoices` · effort L · humanPR: no
- *Evidence:* `showcase/dashboard/page.tsx` (3 mono KPI cards, an 8×4 heatmap about 1,300 px tall on desktop, a feed) vs the real owner home (LeakHero plus Needs-you). `showcase/layout.tsx:23-31` sets an inline font-family and gradient. Screenshot `shots/showcase_dashboard__public__desktop-he.png`; ia-map #20.
- *Rule:* J3 (S1 for the demo).
- *Fix:* render the real dashboard components against a static, read-only demo tenant fixture ("כפר הזיתים", DEMO_TODAY) behind a demo session (see big move 3). At minimum, replace the KPI row with `LeakHero` plus a 3-item Needs-you stack, and cap the heatmap at the 3 worst cells with "עוד".
- *Exemplar:* Linear's public demo workspace; Stripe test-mode dashboard.

**mkt-18 · The demos end at the aha moment with no conversion** · flow · both · `/showcase/*` · effort S · humanPR: no
- *Evidence:* `showcase/receiver/_steps/Confirmed.tsx:134`: the only primary is `onReset` ("קבלה נוספת"). Grep shows `#lead` only in `showcase/page.tsx:74` and `layout.tsx:61`.
- *Fix:*
  - Add a T3 end card after the confirmed receipt: "₪36 נתפסו במשלוח הזה — לפני תשלום. רוצים את זה בדלת שלכם?" with [התחילו פיילוט חינם] and [שלחו חשבונית בוואטסאפ].
  - Demote "קבלה נוספת" to a text button.
  - Add the same end card at the bottom of the dashboard, invoices, deliveries and approvals pages.
- *Exemplar:* Navattic/Arcade tours (the last step is a CTA); Ramp's interactive demo.

**mkt-19 · Trust layer is thin for a product that asks for supplier invoices** · trust · both · `/`, `/about` · effort M · humanPR: yes (owner facts, photos, company ID)
- *Evidence:* the footer (`MarketingShell.tsx:134-204`) has only a tagline and "נבנה בישראל". `/about` (`about/page.tsx:191-218`) has no people, company identity or pilot terms. The honesty rules (`landing/he.ts:5-7`) correctly forbid fake logos, but nothing replaces them.
- *Fix:*
  - A founder card with face, name, direct mobile and WhatsApp: "אני עונה אישית".
  - A **"פיילוט מייסדים"** box with explicit terms (duration, what we need: about 20 invoices and 15 minutes; what you get: a ₪ report; price after; cancel anytime).
  - Company details (legal name, ח.פ., address) in the footer.
  - Factual integration marks ("עובד עם MarketMan · ייבוא מזסטר · ייצוא להנהלת חשבונות").
  - A one-page "איפה הנתונים שלכם" link.
- *Exemplar:* Ramp customer and security pages; Linear's "built by" notes.

### P2

**mkt-20 · Money set in `font-mono` across marketing and the showcase** · visual · both · effort S · humanPR: no
- *Evidence:*
  - `app/page.tsx:366,420`
  - `pricing/page.tsx:88`
  - `RoiCalculator.tsx:51,104,108`
  - `detail-sections.tsx:122`
  - `leak-check/result/page.tsx:155,168`
  - 74 `font-mono` uses in `app/showcase`
  - Visible fallback on "בחודש" (`crops/s_home_phone_b.png`)
- *Rule:* B2.
- *Fix:* wrap every amount in a `<Money>` component (Heebo 800, `tabular-nums lining-nums`, ₪ in its own span). Keep mono for INV/PO numbers only.
- *Exemplar:* Stripe and Mercury balances.

**mkt-21 · Three leak numbers and labels across one funnel** · trust · both · effort S · humanPR: no
- *Evidence:*
  - Hero video: "דלף החודש ₪760 · 1.8%" (`public/media/hero-poster.jpg`).
  - Proof: "₪2,250 בחודש · 1.5%" (`app/page.tsx:92-106`).
  - Showcase: "דליפה פוטנציאלית החודש ₪4,820", "נחסך עד כה ₪12,340".
  - Problem cards: "₪3,900 בשנה" in a different format.
- *Rule:* A9.
- *Fix:* use one illustrative restaurant and one set of figures across the hero video, proof, showcase and calculator default, each labelled "דוגמה". Use the glossary words ("דלף החודש", "נתפס לפני תשלום", "הוחזר"); drop "פוטנציאלית" and "נחסך".
- *Exemplar:* Stripe balance states (each defined once).

**mkt-22 · Features and the calculator live on "About"; the home has no product proof** · ia · both · `/`, `/about` · effort M · humanPR: no
- *Evidence:* `MarketingShell.tsx:9-15` ("יכולות" → `/about#features`); `about/page.tsx:221-225`; `app/page.tsx` has no screens section. `/about` is 9,041 px on phone.
- *Fix:*
  - **Home order:** hero → problem in ₪ (4 cards as a horizontal snap row on phone) → how it works → product proof tabs ("מקבל הסחורה | הבעלים | הנהלת החשבונות", each a legible real screen) → inline calculator → pricing → FAQ → form.
  - Move features to `/product`. Keep `/about` for the story, people and company.
- *Exemplar:* Ramp homepage product tabs; MarginEdge "How it works".

**mkt-23 · ROI calculator: number input, no formatting, no CTA, result not reused** · functional · both · `/about#roi` · effort S · humanPR: no
- *Evidence:* `RoiCalculator.tsx:43-52` (`type="number"`, ₪ at start), `:93-130` (no CTA); `LeadForm.tsx:230-243` asks for the purchasing figure again.
- *Rule:* C7, WCAG 3.3.7.
- *Fix:*
  - `type=text inputMode=decimal`, formatted "150,000" on blur, ₪ at the end, Heebo.
  - Add a CTA under the result, "בדקו את המספר האמיתי שלכם", that opens the form with `monthlyIls` prefilled (sessionStorage).
  - The leak card is a self-estimate, so make it neutral or gold, not danger-red.
- *Exemplar:* Ramp savings calculator → demo with prefilled values.

**mkt-24 · Pricing entitlements make the free trial look richer than paid Basic** · trust · both · `/pricing` · effort S · humanPR: yes (`plans.ts` and `packages/billing` are immutable)
- *Evidence:* `packages/db/src/plans.ts:28-43`: trial has `ALL_FEATURES`; Basic has `features: []`. `shots/pricing__public__desktop-he.png`: the Basic column is shorter.
- *Fix:* proposal to the owner. Either give the trial Basic's feature set, or state it as "ניסיון = כל היכולות של מקצועי ל-30 יום". UI-side, label the trial card "כולל את כל היכולות של מקצועי בזמן הניסיון".
- *Exemplar:* Linear and Notion trials ("trial of the top plan").

**mkt-25 · Showcase invoice rows nest links inside a button role** · a11y · both · `/showcase/dashboard/invoices` · effort S · humanPR: no
- *Evidence:* `showcase/dashboard/invoices/page.tsx:255-283`; crawl axe `nested-interactive` serious ×5.
- *Fix:* make the expander a real `<button aria-expanded>` on the row heading or chevron, and render the supplier avatar and name Links as siblings outside it.
- *Exemplar:* Primer ActionList; GOV.UK accordion.

**mkt-26 · Hebrew copy and orthography drift** · copy · both · effort S · humanPR: no (the legal strings themselves need counsel)
- *Evidence:*
  - H1 in singular masculine "דולף לך" (`landing/he.ts:18`), while the rest of the site uses plural "אתם"/"תאמו", and the submit button mixes them ("תאמו לי").
  - ASCII quotes: `בדוא"ל` (`marketing/he.ts:42`), `עו"ד`/`ארה"ב`/`דוא"ל` (`legal.he.ts:13,57,68`).
  - Jargon: "PO line", "סף ה-block" (`showcase/approvals/page.tsx:117,144`).
  - "Σ" as a label (`leak-check/result/page.tsx:165`).
  - Placeholders that look like values: "ישראל ישראלי", "כפר הזיתים", "120000" (`marketing/he.ts:46,50,53`).
- *Rule:* E7, E9, C5.
- *Fix:*
  - H1: "כמה כסף דולף לכם בקבלת סחורה?"; submit: "תאמו בדיקת דליפה".
  - Use gershayim (״) everywhere.
  - "שורת הזמנה תואמת", "סף החסימה", "סה״כ".
  - Placeholders as "לדוגמה: 120,000".
- *Exemplar:* Intuit content design; Polaris voice.

**mkt-27 · Letter-spacing and uppercase on Hebrew, physical CSS and sub-12 px text in the showcase and legal** · rtl · both · effort S · humanPR: no
- *Evidence:*
  - `showcase/receiver/_steps/SupplierSelect.tsx:149` (`uppercase tracking-[0.18em]` on "צעד 1 מתוך 5").
  - `showcase/page.tsx:113,118` (`tracking-wider`).
  - `privacy/page.tsx:181` (`font-mono uppercase tracking-wider` table head).
  - `HeroVideo.tsx:107` (`left-3`, `text-[11px]`).
  - `showcase/layout.tsx:45,81` (11 px).
  - 65 `text-[9|10|11px]` uses under `app/showcase`.
- *Rule:* E6, E1, B1.
- *Fix:* gate tracking and uppercase behind `ltr:`; use `start-3`; raise to at least 12 px (14 px on the receiver demo, the field floor).
- *Exemplar:* RestoMatch's own `detail-sections.tsx:48` (`rtl:tracking-normal`).

**mkt-28 · No funnel instrumentation or attribution** · functional · both · effort S · humanPR: no
- *Evidence:* no analytics SDK (grep). `LeadForm.tsx:167` hard-codes `source:'landing'` for leads from `/`, `/pricing`, `/about` and the showcase. No UTM capture.
- *Fix:*
  - `source = \`${pathname}:${cta}:${utm_source ?? ''}\`` (≤120 chars, which the router allows), with UTM params stored in sessionStorage on landing.
  - Add cookieless page analytics (Vercel Web Analytics or Plausible) so the weekly growth funnel has data.
- *Exemplar:* Ramp/HubSpot hidden UTM fields.

**mkt-29 · Desktop hero art is illegible; the better evidence component sits unused** · visual · desktop · `/` · effort S · humanPR: no
- *Evidence:* `mkt/home__desktop-he-rm-c_00.png`: the laptop screen is about 240 px wide in a 520 px card. `HeroMatch.tsx` (an animated, legible 3-way line comparison with ₪ caught) renders only when `heroMedia.available` is false (`app/page.tsx:218-231`).
- *Fix:* on lg and up, the hero right column is the legible `HeroMatch` card (order | received | invoice, 3 flagged lines, "₪X נתפסו לפני תשלום"), and the film stays behind "צפו ב-60 שניות".
- *Exemplar:* Ramp hero (a real, readable product UI at 1:1).

**mkt-30 · Deferred rendering makes the page jump and leaves the form loading** · perf/states · both · `/` · effort S · humanPR: no
- *Evidence:*
  - `.rm-defer` with `contain-intrinsic-size: auto 640px` (`globals.css:388-390`) on 5 sections. The page height changes as you scroll: phone 6,340 → 6,757 px, desktop 5,202 → 4,529 px (`mkt/measures-scroll.json`).
  - `AnchorScrollFix.tsx` exists only to compensate.
  - The lead form shows "טוען את הטופס…" until its JS arrives (`LazyLeadForm.tsx:55-61`), and with no JS it can't submit.
- *Fix:*
  - Per-section measured intrinsic sizes (`auto 1100px` how-phone, etc.), or drop `rm-defer` on short sections.
  - Server-render the form as a Server Action with progressive enhancement; hydrate the tRPC niceties later.
- *Exemplar:* web.dev content-visibility guidance (accurate intrinsic sizes).

### P3

**mkt-31 · 12-hour time in the deliveries demo** · rtl · both · `/showcase/deliveries` · effort S · humanPR: no
- *Evidence:* `showcase/deliveries/page.tsx:176` (native `type="time"`, which rendered "07:41 AM" in the captures; `crops/s_show_d.png`).
- *Rule:* E8.
- *Fix:* display a 24-hour `HH:mm` chip and edit through a 24-hour picker sheet.

**mkt-32 · A second language switcher inside the receiver demo, plus a mono copyright line** · visual · both · effort S · humanPR: no
- *Evidence:* the receiver page's own EN toggle (`crops/s_show_b.png`); `MarketingShell.tsx:200` (`font-mono` on Hebrew © text).
- *Fix:* keep only the header switcher; set the copyright in Heebo.

## 5. Big moves (benchmark-grade)

1. **A leak check in your pocket (mobile-first, no login).**
   - The hero's primary opens a full-screen sheet: "צלמו 3–10 חשבוניות" (rear camera, multi-page, thumbnails), or "שלחו בוואטסאפ" to the ingest number (`ingestWhatsapp` exists).
   - Within about 60 s it shows the **app's own LeakHero**: T1 ₪, % of the spend checked, and evidence lines linked to the photo.
   - Then "שמרו את התוצאות" creates the account with the email or phone already given (results attach automatically) and books the pilot call.
   - This turns the most persuasive asset into the front door and makes the owner's first ₪ arrive before the first sales call.
   - *Exemplar:* Ramp's free savings analysis; Wise's "see the fee before you sign up"; fintech.md P24.
2. **A WhatsApp-native conversion layer.**
   - A sticky phone bar [וואטסאפ] [בדיקת דליפה חינם].
   - A 2-field form in a bottom sheet (name plus mobile/WhatsApp, with optional restaurant and monthly purchasing prefilled from the calculator).
   - Instant booking on submit (15-minute slots) and a WhatsApp confirmation template.
   - Every lead is source- and plan-attributed.
   - *Exemplar:* Chili Piper instant scheduling on Ramp's demo form; the Israeli SMB WhatsApp-first norm [K].
3. **Showcase = the real app in demo mode.**
   - A read-only demo session on a fixed tenant ("כפר הזיתים", DEMO_TODAY), with a role switcher (בעלים on a desktop frame / מקבל סחורה on a phone frame / הנהלת חשבונות).
   - A 5-hotspot guided tour (leak hero → approve a ₪52 price hike → open the invoice evidence → receiver flags a short line → claim drafted), ending in a CTA.
   - One number across the hero video, proof and demo. It retires the separate showcase design system (max-w-7xl, inline gradient, mono KPIs) and proves J3.
   - *Exemplar:* Linear's public workspace; Stripe test mode; Navattic/Arcade tours.
4. **Pricing that sells ROI.**
   - "הרכש שלכם בחודש ₪___ · חשבוניות בחודש ___" recommends a plan and shows payback ("מקצועי מחזיר את עצמו אם תפס 0.39% מהרכש — בפיילוט היעד 1.5%").
   - On phone, a segmented plan switcher with Pro preselected and a sticky CTA. On desktop, a compare table plus a pricing FAQ.
   - A pilot-terms box. Plan-aware CTAs.
   - *Exemplar:* Ramp savings calculator; Linear and Notion pricing; Toast's pricing quiz.
5. **A trust and legal stack worthy of supplier invoices.**
   - Finalised privacy, terms and cookies (named controller, contact, dated, accurate sub-processors).
   - `/accessibility` (IS 5568) linked from every shell.
   - Company identity in the footer. A founder card with face and direct WhatsApp.
   - A "פיילוט מייסדים" program with explicit terms. A one-page "איפה הנתונים שלכם" (RLS isolation, 2FA, deletion, retention).
   - Factual integration marks (MarketMan, Zester import, accounting export).
   - *Exemplar:* Stripe privacy centre; Ramp security page; the Kol Zchut accessibility statement.
6. **Role-split home for the two real audiences.**
   - Below the hero, a "מי אתם?" segmented control: **בעלים** (desktop frame: leak hero, approvals, monthly ₪ report), **מנהל/ת משמרת** (phone: order and approve), **מקבל/ת סחורה** (phone: photograph, then the English check).
   - Each shows a legible, real screen and a 3-line "what changes for you", with one CTA.
   - On desktop the hero art becomes the legible HeroMatch card; on phone it becomes a portrait receiver loop.
   - This answers the owner's direction directly: mobile work for the floor, organised desktop for the bosses.
   - *Exemplar:* Ramp homepage product tabs; Toast's "for owners / for managers" pages.

## 6. What's already right (keep)
- An honest copy policy (no fake logos, "יעד, לא הבטחה", "הערכה שלכם — לא שלנו").
- Hero LCP engineering, reduced motion on the hero video, and the `data-keep-clear` consent logic.
- The honeypot, rate-limit handling and focus move on lead success. Explicit, unticked marketing consent with its text stored.
- Leak-check security (PoW, signed short-lived links, claim requires the same email plus a POST).
- The showcase receiver offers a demo image and real OCR. The deliveries demo puts the call/WhatsApp rep one tap away.

## 7. Evidence index
- Crawl captures: `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/shots/{home,about,pricing,privacy,terms,cookies,leak-check*,showcase*}__public__{desktop,phone}-{he,en}.png`
- Viewport captures and probes: `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/review/mkt/` (`*-rm-c_NN.png`, `home__phone-he_menu-open.png`, `home__phone-he_after-hero-cta.png`, `lead__phone-he_empty-submit.png`, `lead__phone-he_success-nameonly.png`, `home__phone-he_promo-modal.png`, `pricing__phone-he_after-trial-cta.png`, `measures-*.json`)
- Contact sheets: `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/review/crops/s_*.png`
- Scripts: `/tmp/claude-0/-home-user-restomatch/6017cf94-803d-5529-a9cf-e8b0ac3fa36a/scratchpad/ux/review/scripts/{mkt-capture.cjs,menu-probe.cjs,sheet.py,crop.py}`
- Lab note: one name-only lead ("בדיקת UX מעבדה") was created in the **local lab DB only** by the probe.
