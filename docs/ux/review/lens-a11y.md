# Lens review: Accessibility, WCAG 2.2 AA + IS 5568 (`a11y`)

**Date:** 2026-10-25 · **Lens:** cross-cutting, all pages · **Code:** `wt/` at `8fef118c` · **Rubric:** group F (F1–F10), plus G3, C10/C13 and R-5/R-6/R-7.

**Inputs:**
- `research/RUBRIC.md` §0, the top-10 rules, F, G3 and the appendix grep pack.
- `rtl.md` F7–F9, `ainative.md` P26, `pwa-field.md` P19, `systems.md` P10.
- `crawl-results.json`: 225 captures with axe tags `wcag2a/aa`, `wcag21a/aa` and `wcag22aa`.
- Screenshots in `shots/`. Crops are in `review/crops-a11y/` and `review/crops-mf/`.

**Related area findings.** This lens consolidates these and does not repeat their detail: admin-03, admin-24, admin-33, approvals-20, approvals-36, approvals-50, approvals-51, auth-15, auth-31, auth-32, catalog-20, catalog-23, catalog-40, catalog-41, chain-25, chain-30, chain-38, command-19 and mobile-field-19.

### Live probes run for this lens

These were read-only, against the lab on `:3320`. Scripts and raw JSON are in `review/tmp/a11y/`.

| Probe | Scope | Output |
|---|---|---|
| axe with `wcag2*` + `wcag22aa` + **`best-practice`** | 18 dashboard routes, owner, desktop he | `out/probe-desktop.json` |
| **Keyboard Tab-walk** | 7 routes desktop (1440×900), 3 routes phone (390×844). Each stop is scored for ring contrast (box-shadow/outline composited on `surface` and `bg`) and for how much of the element is visible: 5-point `elementFromPoint`, after smooth scroll settles. | `out/probe-desktop.json`, `out/probe-phone.json` |
| **Coarse-pointer target scan** | 11 routes, with CDP `Emulation.setTouchEmulationEnabled`, so `(pointer: coarse)` really matches. The original crawl did not get this. | `out/probe-phone.json` |
| Reflow and text spacing | Reflow at 320 px on 16 routes. 1.4.12 text-spacing injection on 2 routes. | `out/probe-reflow.json` |
| Drawer focus containment | Mobile drawer + Tab ×45 | `drawer.cjs` |
| Route announcement | Next.js `next-route-announcer` after a client navigation | `drawer.cjs` |
| Token contrast matrix | All text/tint/ring pairs | `contrast.py` |

> **Lab caveats** (not product bugs):
> - The red worker banner appears because the lab has no job heartbeat. It renders with `role="status"`, which is correct for a load-time banner.
> - The consent bar shows because every capture is a first visit. Its overlap with focus is still a real defect, because every first-time user and every cleared-cookie device hits it. It is judged here.
> - Screen-reader findings come from DOM and code evidence plus the live announcer check. No NVDA or VoiceOver speech log was recorded in this lab. The protocol in §6 says what to record.

---

## 0. Verdict

**Scores (0–10 against world-class: GitHub Primer, GOV.UK, Atlassian, Shopify Polaris admin):**

| Area | Score | Why |
|---|---|---|
| Mobile | **5.0** | The 44 px coarse floor works and reflow is clean. Focus is obscured by the bottom bar and the consent banner, the drawer leaks focus, the receiver quantity field has no focus indicator, and step changes are silent. |
| Desktop | **5.5** | axe is nearly clean. The focus ring fails 3:1 on 75–92% of Tab stops, every page is titled "RestoMatch", and focus is lost after every approval. |
| Functionality (can a keyboard or screen-reader user finish the job?) | **4.5** | Approve, receive and order can be operated, but not followed: no titles, no route announcement, no focus restore, toasts that vanish. |

### What already works (keep it)

**Automated checks are nearly clean.** Across 225 captures, axe found only 4 rule hits:
- `nested-interactive` ×5 nodes, on the public `/showcase/dashboard/invoices` (3 locales);
- `target-size` ×52 on `/dashboard/catalog` phone.

Adding `best-practice` on 18 routes found only `empty-table-header` and `heading-order` on the invoice detail. Text-token contrast is strong: `ink` is 17.1:1 and `subtle` is 5.36:1 on `bg`.

**Language and direction are correct.** Every page has `lang` and `dir`. Tenant data is tagged `lang="he" dir="auto"` through `originalProps()` (`lib/i18n/original.ts`). Receiver English names carry `lang` (`_steps/english.tsx:103-116`). There are **0 English `aria-label` literals in the Hebrew UI**, and context is interpolated into labels: "עריכה: {supplierName}" (`catalog/browser.tsx:555`) and "פתיחת הזמנה: {supplier} · {date}" (`orders-table.tsx:83`).

**Strong components to reuse as models:**
- **Global search** is a textbook combobox, with `role="combobox"`, `aria-activedescendant`, a grouped listbox and arrow/Esc handling (`dashboard/search.tsx:97-193`).
- **`ConfirmDialog`** uses a native `<dialog>` with `showModal()`. Focus is trapped, then restored, and Esc closes it.
- **The count screen** puts the product name and unit in each quantity label: "כמות של {name} ({unit})". It has a `role="progressbar"` with values and `enterKeyHint="next"` (`count-screen.tsx:356-421`).
- **LeadForm** is the form model: `noValidate`, `aria-invalid` with `aria-describedby`, focus on the first invalid field, and focus moved to the success heading (`LeadForm.tsx:63-136`).

**Shell basics are in place:**
- A skip link ("דילוג לתוכן") is the first stop in the dashboard and marketing shells.
- `<main id="main-content" tabIndex={-1}>` is present.
- Navs are labelled ("ניווט ראשי" / "ניווט מהיר").
- `aria-current="page"` is set on the desktop nav, drawer and bottom bar.

**Touch, zoom and reflow:**
- The coarse-pointer 44 px floor (`globals.css:415-447`) works on a real touch device. In the probe, every button, select and input on the field routes is ≥44 px.
- The viewport allows zoom (`width=device-width, initial-scale=1`).
- Overflow is **0 at 320 px on all 16 routes**. Wide tables scroll inside their own region, which 1.4.10 allows for data tables.

**Motion is partly handled.** The hero video and the landing motion respect `prefers-reduced-motion`, and the video has a pause control (`HeroVideo.tsx:15-44`).

### Why it is not world-class

The basics are labelled correctly, but four behaviours break the experience:
- **Focus is barely visible:** a 2.63–2.81:1 ring.
- **Focus is often hidden** behind the consent bar or the bottom bar.
- **Focus is thrown away** after every action and step.
- **The screen-reader user is never told where they are:** 65 routes share the title "RestoMatch", so Next's route announcer stays silent.

The legal layer (הצהרת נגישות) is also missing, which is an S0 under IS 5568 and Israeli accessibility regulation 35. Fix these at the **platform layer**, in 6 shared files. Do not patch 70 pages one by one.

---

## 1. Measured baseline (numbers to re-measure after the fix)

| Metric | Value | Source |
|---|---|---|
| Tab stops with ring contrast < 3:1 | `/dashboard` **47/56**, approvals **35/48**, invoice detail **36/41**, orders **81/88**, ledger 25/39, settings 45/54, leaks 43/48 | Tab-walk, desktop he |
| Tab stops **fully hidden** (0% visible) after focus | Desktop: dashboard 5, approvals 4 (**"אשר" and "דחה"**), orders 12, invoice 1. Phone: approvals 4 ("אשר", "דחה", "פתח חשבונית"), leaks **11** (filters under "ניווט מהיר" plus the consent bar). | Tab-walk |
| Tab stops in the open mobile drawer that land **outside** it | **19 of 45** | `drawer.cjs` |
| Routes whose `<title>` is exactly "RestoMatch" | **65** of 74 desktop-he captures. Every `/dashboard/*` route, plus login, 2FA, reset, onboarding and `/s/*`. | `crawl-results.json` |
| Text of `next-route-announcer` after a client navigation | **"" (empty)**. Focus stays on the bottom-bar link that was tapped. | `drawer.cjs` |
| Routes with no `<h1>` | `/dashboard/inbox`, `/dashboard/receiving`, `/dashboard/inventory/count` (start state), `/dashboard/team`, `/dashboard/settings` | crawl `h1` |
| `focus-visible:ring-primary/60` · `/50` · `ring-line` | 79 · 19 · 1 (the ghost variant, so all 65 ghost buttons) in 70 files | grep |
| `scroll-padding` in `globals.css` | 0 | grep |
| `role="alert"` uses | 40, of which ≥5 render at load time | grep |
| Forms using native `required` without `noValidate` | 19 files: login, 2FA, reset, set-password, onboarding, team, settings… | grep |
| `Field` hints exposed to assistive tech | **0 of 13**. `hintId` is minted but never wired. | `Input.tsx:54-64` |
| Fixed-pixel text under 12 px | `text-[11px]` ×53, `text-[10px]` ×45, `text-[9px]` ×3 | grep |
| GSAP files without a reduced-motion branch | 12 of 14. **6 are production receiving steps.** | grep |
| Interactive elements under 44 px on touch | catalog **56** (inline product links, 18 px tall), ledger **12** supplier links (36–68 × 41), the cookie-policy link on every page (82×18) | coarse scan |
| Overflow at 320 px | 0 on 16 routes | reflow probe |

### Contrast of the T2/T3 badges (the specific ask)

**All pass AA.** On tint-on-tint, the margin is thin.

| Pair | Ratio | Verdict |
|---|---|---|
| T2 `danger-solid`, white on `#B80F2A` | 6.69 | Pass |
| T2 `warning-solid`, white on `#A63D00` | 6.39 | Pass |
| T3 `gold` badge: text on 12% tint, over `surface` / `bg` / `surface-2` | 5.35 / 5.05 / 4.82 | Pass |
| T3 `accent`/`primary` badge on 12% tint, over `surface` / `bg` / `surface-2` | 5.45 / 5.13 / 4.91 | Pass |
| `info` (T4 hourglass) badge on 12% tint over `surface-2` | 4.69 | Pass, thin |
| Danger badge on a `bg-danger/10` card (tint on tint) | **4.58** | Pass, 0.08 margin |
| Chain heatmap `bg-gold/20 text-gold` over `bg` | **4.50** | At the threshold |
| Glass bottom bar `muted` label over a danger card scrolling beneath | 5.10 (over ink text: 4.86) | Pass |
| Nav badge `text-danger` on `bg-danger/15`, **10 px** | 5.11 | Pass, but 10 px |
| Hero drill CTA ring `ring-danger/60` | 3.29 / 3.20 | Pass, barely |
| **Focus ring `ring-primary/60`** | **2.81 / 2.73 / 2.67** | **Fail** (1.4.11) |
| **Focus ring `ring-primary/50`** | **2.31 / 2.25** | **Fail** |
| **Ghost button `ring-line`** | **1.39** | **Fail** |
| Input boundary while focused: `focus:border-primary/50` + ring /60 | ≈2.3 / 2.8 | **Fail.** The border gets *weaker* on focus. |

---

## 2. Findings, prioritised

Format: **ID · priority · WCAG SC · route · device**, then Evidence, Problem, Fix, Owner, Effort and Exemplar.

### P0: legal floor

**a11y-01 · P0 · IS 5568 / reg. 35 + WCAG 3.2.6 · all shells · both. There is no accessibility statement (הצהרת נגישות) and no consistent help location.**
- **Evidence:**
  - `ls app/(marketing)` contains about, cookies, leak-check, pricing, privacy and terms. There is no `accessibility`.
  - No i18n string contains "נגישות".
  - `MarketingShell` footer, the dashboard settings page, `/s/[token]` and `/login` link to none.
  - Also flagged in admin-03, auth-32 and rtl.md F9.
- **Problem:** Israeli regulation 35 of the Service Accessibility Regulations requires a public statement for a service offered to the public, plus a named coordinator. This is the one item that can bring a legal complaint before any user complains. The supplier portal (`/s/[token]`) is used by third parties, which raises the exposure.
- **Fix:**
  - Add `app/(marketing)/accessibility/page.tsx` (he default, en available) and add it to `sitemap.ts`. Contents:
    - "ת״י 5568 ברמה AA · WCAG 2.2 AA";
    - the date of the last audit;
    - the browsers and screen readers tested (NVDA 2025 + Chrome, VoiceOver iOS 18 Hebrew, TalkBack);
    - the accessibility arrangements (skip link, keyboard, reduced motion, receiver languages);
    - **known gaps**, taken from this report until it is fixed;
    - the coordinator's name, phone and email, with a 5 business-day reply SLA.
  - Link it from the `MarketingShell` footer, a new one-line dashboard footer ("הצהרת נגישות · עזרה · תנאים"), the `/s/[token]` footer, the `/login` card foot and the drawer footer.
  - Put "עזרה ונגישות" in the **same place** on every shell: footer end and drawer bottom (3.2.6).
  - **No overlay widget** (UserWay, Equalweb). They are common in IL but do not fix anything here.
- **Owner:** `growth-pmm-engineer` (page). `web-feature-engineer` (dashboard footer link). The coordinator's identity is an **owner decision**.
- **Effort:** S · **Exemplar:** the Kol Zchut and Bank of Israel accessibility statements (structure, coordinator block, known-gaps list); gov.il.

### P1: WCAG AA failures on primary flows

**a11y-02 · P1 · 1.4.11, 2.4.7 · every route · both. The focus indicator fails 3:1 almost everywhere, and on two controls it is effectively absent.**
- **Evidence:**
  - From the Tab-walk: 75–92% of stops measure 2.63:1.
  - The ghost variant `Button.tsx:27` uses `focus-visible:ring-line`, which is **1.39:1**. That affects 65 ghost buttons, **including the button that gets initial focus in every `ConfirmDialog`** (`ConfirmDialog.tsx:68`, `autoFocus` on the ghost "keep" button). A keyboard user opening a destructive confirm cannot see where focus is.
  - `Input.tsx:7` uses `focus:border-primary/50` (weaker than the resting `line-strong` at 3.59) plus `ring-primary/60 ring-offset-0`.
  - `nav.tsx:165` sets `focusRing` to `/60`.
  - **The receiver's quantity input has no indicator at all**: `AdjustQuantities.tsx:240` has `border-0 focus:outline-none` with no ring.
  - The language select (`LanguagePicker.tsx:67`) relies on a 2.63:1 `focus-within` ring on its label.
- **Fix:** one token and one utility, applied in three shared components.
  - **Token.** In `globals.css :root`, add `--c-focus: 26 91 199;` (#1A5BC7). It measures **6.24:1** on surface, 5.85 on bg and 5.56 on surface-2, and it is distinct from money-green and danger (R-5). Mirror it in `packages/ui-tokens` `webColors.focus`, and add `focus: v('focus')` to the Tailwind config.
  - **Base rule.** In `@layer base`, add `:focus-visible { outline: 2px solid rgb(var(--c-focus)); outline-offset: 2px; }`. Use outline rather than box-shadow, so it survives `overflow:hidden` and forced-colours mode, and add `@media (forced-colors: active) { :focus-visible { outline-color: Highlight } }`.
  - **Remove** every `focus:outline-none` plus `ring-*/60|/50|ring-line`. In `Button.tsx`, `Input.tsx`, `nav.tsx` and `ViewToolbar.tsx`, delete the per-variant rings and rely on the base rule. A codemod handles the other 70 files: `sed -E 's/ ?focus(-visible)?:(outline-none|ring-(2|offset-[a-z0-9-]+|primary(\/[0-9]+)?|gold(\/[0-9]+)?|danger(\/[0-9]+)?|line|inset))//g'`.
  - **Inputs.** Keep the border at `line-strong` while focused, and use the outline as the indicator. Delete `focus:border-primary/50`.
  - **Quantity and stepper inputs** in the field flows get the same outline. No exceptions.
  - **Lint guard.** Add an ESLint `no-restricted-syntax` rule on the class strings `ring-line`, `ring-primary/60` and `focus:outline-none` without `focus-visible:outline`.
- **Owner:** `rtl-design-steward` (token), `web-feature-engineer` (codemod), `test-sentinel` (an e2e that asserts the computed `outline-color` on 20 random Tab stops ≥ 3:1).
- **Effort:** M · **Exemplar:** GitHub Primer ("a 2 px focus ring MUST be used"); Atlassian `color.border.focused`; GOV.UK's yellow focus state, which is legible on any surface.

**a11y-03 · P1 · 2.4.11 Focus Not Obscured (AA) · approvals, orders, leaks, dashboard, invoice · both. Sticky chrome and the consent banner fully hide the focused control, including Approve and Reject.**
- **Evidence:**
  - From the Tab-walk: desktop approvals stops 32 and 33 ("דחה", "אשר") are 0% visible under `div[הסכמה לשימוש בעוגיות]`.
  - Orders has 12 hidden stops. Dashboard stops 37–40 hide the T1 actions "איך הגענו ל-760 ₪?" and "מה מאחורי המספר".
  - Phone leaks: 11 stops are 0–40% visible under `nav[ניווט מהיר]` plus the consent bar.
  - Screenshot: `crops-a11y/dashboard_owner_desktop_00.png`. The consent bar covers the hero CTA in the first viewport at 1440×900.
  - `globals.css` has no `scroll-padding`. `CookieConsent.tsx` pads `body`, but focus scrolling ignores body padding and aligns to the viewport edge.
- **Fix:**
  - **Publish the chrome heights.** `ConsentClearance` already publishes `--consent-h`. Publish `--rm-header-h` from the dashboard header (a `ResizeObserver` in a tiny `ChromeMetrics` client component in `dashboard/layout.tsx`) and `--rm-bottomnav-h` from `MobileNav`'s bar (72 px plus the safe area). Use 0 at `lg`.
  - **Pad the scroll edges.** In `globals.css` base: `html { scroll-padding-top: calc(var(--rm-header-h, 0px) + 8px); scroll-padding-bottom: calc(var(--rm-bottomnav-h, 0px) + var(--consent-h, 0px) + 8px); }`. Browsers apply scroll-padding to focus scrolling.
  - **Field flows.** Wizards that own their own sticky footer (`AdjustQuantities` footer, the order wizard) add `--rm-flowbar-h`.
  - **Consent banner:** see a11y-12.
  - **Gate.** A Playwright test (`test-sentinel`) Tab-walks `/dashboard/approvals` at 390×844 and 1440×900 with the consent bar visible, and asserts that every focused element is ≥50% visible.
- **Owner:** `rtl-design-steward` + `web-feature-engineer` · **Effort:** S · **Exemplar:** the GOV.UK sticky-header pattern with `scroll-padding-top`; Polaris `Frame` offsets for its top bar.

**a11y-04 · P1 · 2.4.2 Page Titled (A) + 4.1.3 · 65 routes · both. Every app page is titled "RestoMatch", so client navigation is never announced.**
- **Evidence:**
  - Root `generateMetadata` returns `title: 'RestoMatch'` (`app/layout.tsx:29`). No `/dashboard/*` page exports `metadata` or `generateMetadata`.
  - Next 15.5.28's `app-router-announcer.js:54-67` announces **only when `document.title` changes**. A live check after a bottom-bar tap gave title "RestoMatch" → "RestoMatch", an empty announcer, and focus left on the tapped link.
  - Browser tabs and history are indistinguishable for the multi-tab desktop owner and bookkeeper (also in chain-38).
- **Fix:**
  - **Title template.** In `app/dashboard/layout.tsx`, export `metadata = { title: { template: '%s · RestoMatch', default: 'RestoMatch' } }`.
  - **Per-page titles.** Each `page.tsx` exports `generateMetadata` that returns its h1 text from i18n: "תור אישורים (4)", "חשבונית MF-24950 · דגי הים התיכון", "קליטת סחורה · ירקות השרון".
  - **Counts.** Where a count is T2, put it first: "(4) תור אישורים".
  - **Focus on navigation.** Add `useRouteFocus()` in the dashboard layout. On `pathname` change it moves focus to the page `<h1 tabIndex={-1}>` (or to `#main-content`) without scrolling (`preventScroll`). This gives a screen-reader user both an announcement and a position.
  - **Auth and portal pages** get "כניסה", "אימות דו-שלבי", "איפוס סיסמה" and "אישור הזמנה · {restaurant}".
  - **Unit test.** No two dashboard routes share a title.
- **Owner:** `web-feature-engineer` · **Effort:** M (≈70 one-line `generateMetadata` exports plus the hook) · **Exemplar:** GOV.UK ("Error: " prefix and a unique title per page); GitHub (focus moves to the page heading on Turbo navigation); the Next.js route-announcer docs.

**a11y-05 · P1 · 2.4.3, 4.1.3, 2.4.6 · `/dashboard/approvals`, `approvals/pay-run` · both (bookkeeper desktop, manager phone). Decisions throw focus away, are not announced, and the buttons have no context.**
- **Evidence (`approvals/list.tsx`):**
  - `:73-76`: after `approve.mutate`, the queue refetches and the card unmounts. The focused button disappears, so `document.activeElement` becomes `body` and the next Tab restarts at the skip link.
  - Nothing announces "אושר".
  - `:263-273`: each card's buttons are named only "אשר", "דחה" and "העבר לבעלים". A screen-reader button list reads "אשר, אשר, אשר, אשר".
  - The card's `aria-label={label}` is the discrepancy type, which is repeated ("מחיר גבוה מהמצופה" ×3 in the seed).
  - `:204-210`: opening "דחה" does not move focus to the reason textarea, and the placeholder is the only visible label.
- **Fix:**
  - **Buttons.** Give each `aria-describedby={`dq-${d.id}-summary`}`, pointing at a visually-hidden line "{product} · {supplier} · ₪52.50". Keep the visible name "אשר" first so 2.5.3 still holds.
  - **Card.** Use `aria-labelledby` on the card for the h2 plus product. Do not use a duplicate `aria-label`.
  - **Exit.** Remove the row optimistically. Move focus to the **next card's primary button**, or to the "התור ריק" heading when the queue is empty. Announce through a polite region: "אושר · שמן זית · ‏52.50 ₪ · נותרו 3" (F7). Undo lasts 10 s (R-7), and the toast pauses on focus.
  - **Reject.** Autofocus the reason textarea. Give it a visible `<label>` "סיבת הדחייה (חובה)". Esc cancels and returns focus to "דחה".
- **Owner:** `web-feature-engineer` · **Effort:** M · **Exemplar:** Gmail and Superhuman (archive moves focus to the next conversation and announces it); Polaris IndexTable bulk actions; Linear (the focus ring follows to the next issue).

**a11y-06 · P1 · 2.4.3, 4.1.3, 3.2.2 · `/dashboard/receiving/[poId]`, `/dashboard/orders/new` · mobile. Wizard steps swap with no focus or scroll management.**
- **Evidence:**
  - `receiving/[poId]/wizard.tsx` calls `setStep(...)` at `:261, 357, 438, 469, 515, 596, 604, 642`, and `orders/new/wizard.tsx` at `:97, 185, 203, 291, 510, 513, 665`. Neither file has `focus()` or `scrollTo`.
  - The new step's `<h1>` (`StepHeader`, `SupplierSelect.tsx:152`) is never focused.
  - On a phone, after "המשך" at the bottom of a long step, the next step opens **scrolled to the middle**. A screen-reader user hears nothing.
- **Fix:** add a shared `useStepFocus(step)`. On step change, `headingRef.current?.focus({ preventScroll: true })`, then `window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })`. `StepHeader` renders `<h1 ref tabIndex={-1}>` with the eyebrow "צעד 2 מתוך 5" inside it as a visually-separate span, so it is announced as "צעד 2 מתוך 5, צלם את החשבונית". The same hook goes in `inventory/count`.
- **Owner:** `ocr-procurement-engineer` (receiving), `web-feature-engineer` (orders) · **Effort:** S · **Exemplar:** GOV.UK "question pages" (focus to the heading on each step); the Shopify checkout step transitions.

**a11y-07 · P1 · 2.4.7, 4.1.2, 1.3.1, 2.3.3/2.2.2 · receiving wizard (adjust, scan and processing steps) · mobile (receiver). The core field controls are not accessible.**
- **Evidence (`app/showcase/receiver/_steps/*`, which production `/dashboard/receiving/[poId]` imports):**
  - **Quantity input** (`AdjustQuantities.tsx:234-243`):
    - `type="number"` with `border-0 focus:outline-none` gives **no focus indicator**.
    - `aria-label={t('steps.adjust.qtyLabel')}` is the same for every line, so 12 inputs are all named "כמות שהתקבלה".
    - The ± buttons are just "הפחת" / "הוסף" (`:228, 249`).
  - **Preset chips** "כמו בהזמנה N", "חסר" and "פגום" (`:322-328`) show an active fill but have **no `aria-pressed`**.
  - **The matched-lines disclosure** (`:84-103`) has no `aria-expanded` and no `aria-controls`.
  - **"נקבע ✓"** (`:289-293`) appears silently.
  - **Upload status** "מעלה…" / "נשמר" / error (`InvoiceScan.tsx:292-330`) has no live role. The error is `text-xs truncate`, so a field user **cannot read why the upload failed**.
  - **The processing bar** (`Processing.tsx:257-262`) has no `role="progressbar"`.
  - **The viewfinder corners** pulse forever: `gsap.to('.viewfinder-corner', { repeat: -1, yoyo: true })` at `InvoiceScan.tsx:85-90`. That is auto-moving content for more than 5 s with no pause (2.2.2, Level A).
  - **All 6 steps** run GSAP entrance staggers with no reduced-motion branch.
- **Fix:**
  - **Labels with context.** Quantity: `aria-label={t('steps.adjust.qtyLabelFor', { name, unit })}` → "כמות שהתקבלה — עגבניות שרי (ק״ג)". Stepper buttons: "הפחת 1 — עגבניות שרי". Copy the count-screen pattern at `count-screen.tsx:356-357`.
  - **Quantity input.** Use `type="text" inputMode="decimal" dir="ltr"` (C7) with the shared focus outline and a visible 2 px `line-strong` boundary.
  - **Chips.** Add `aria-pressed={active}` plus a check icon when active, so state is not shown by fill alone.
  - **Disclosure.** Add `aria-expanded` and `aria-controls`.
  - **"נקבע".** Add it to a polite live region: "עגבניות שרי · נקבע 8 ק״ג".
  - **Upload status.** Wrap it in `role="status"`. Errors move to `role="alert"` at **14 px, wrapping, not truncated**, with a "נסה שוב" button. Upload becomes `role="progressbar" aria-valuenow={pct}` (G6).
  - **Viewfinder.** Remove the infinite yoyo, or run it 3 cycles and stop. Wrap every `gsap.*` in `gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', …)`; under reduce, use an opacity-only ≤150 ms swap (ainative P26).
- **Owner:** `ocr-procurement-engineer` · **Effort:** M · **Exemplar:** Shopify POS receive screen (labelled steppers); Apple HIG steppers; React Aria `NumberField` (an accessible name that includes context, plus increment/decrement labels).

**a11y-08 · P1 · 2.4.3, 4.1.2 (modal contract) · mobile drawer on every dashboard route · mobile. The drawer is `aria-modal="true"` but does not contain focus.**
- **Evidence:**
  - `nav.tsx:320-414` portals a `role="dialog" aria-modal="true"` panel but never makes the page `inert`.
  - Live, 19 of 45 Tab stops land **outside** it: the skip link, the menu button, the language select, the approvals filters…. These are all behind the dim overlay, so focus goes somewhere the user cannot see.
  - Esc uses `e.key`, which is fine. The close button is 32 px before the coarse floor.
- **Fix:**
  - **Containment.** While open, set `inert` on `#main-content`, the `<header>` and the bottom-bar `<nav>`. React 19 `inert` is a boolean prop. Use a `useInertSiblings(open)` hook in `nav.tsx`. Or render the drawer as a native `<dialog>` with `showModal()`, like `ConfirmDialog`.
  - **Restore.** On close, return focus to the trigger. Today it is always `triggerRef`, but "עוד" in the bottom bar is a second trigger, so remember `document.activeElement` instead.
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** Radix `Dialog` and React Aria `Modal` (`inert` plus a focus scope); Polaris `Sheet`.

**a11y-09 · P1 · 2.2.1 (A), 4.1.3 · all dashboard toasts · both. Error toasts vanish after 7 s, and success toasts may never be announced.**
- **Evidence (`Toast.tsx`):**
  - `:28, :49`: `DURATION_MS = { success: 3500, error: 7000 }` with `setTimeout` and **no pause on hover or focus**. Errors auto-dismiss, which breaks R-6.
  - `:68-71`: each toast is a **newly mounted** `role="status"` / `role="alert"` node. Live regions inserted together with their text are unreliably announced (polite especially, in VoiceOver and NVDA).
  - `:85-92`: the dismiss button is a 16×16 icon.
  - Export warnings (admin area) arrive as stacked 7 s errors.
- **Fix:**
  - **Persistent regions.** Mount two **persistent, empty** regions in `ToastProvider` at layout start: `<div role="status" aria-live="polite" className="sr-only">` and `<div role="alert" className="sr-only">`. Write the message text into them after mount, and render the visual toasts separately as `aria-hidden` duplicates.
  - **Timing:**
    - success: 5 s;
    - with an action (Undo): ≥10 s;
    - **error: sticky until dismissed**;
    - every timer pauses on `pointerenter` and `focusin` and resumes on leave;
    - at most 3 stacked.
  - **Dismiss button.** `min-h-11 min-w-11` on coarse pointers and 24 px on fine.
  - **Shared API.** Export `useAnnounce()` from the same provider for non-toast announcements (a11y-05, a11y-06, a11y-07).
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** Polaris Toast (timing and pause); React Aria `LiveAnnouncer`; Atlassian Flag (errors persist).

### P2: AA failures off the primary path, robustness, and IS 5568 hygiene

**a11y-10 · P2 (P1 on the receiver's home) · 1.3.1, 2.4.6 · `/dashboard/receiving`, `/dashboard/inbox`, `/dashboard/inventory/count` (start), `/dashboard/team`, `/dashboard/settings` · both. These pages have no `<h1>`.**
- **Evidence:**
  - The crawl `h1` count is 0 on these routes.
  - `SectionHeader` defaults to `level = 2` (`Heading.tsx`). `settings/page.tsx:55-76` renders five h2 sections with no page title. `receiving/page.tsx:44` reuses `t('inbox.title')` at h2.
  - The invoice detail has `heading-order` (an h3 under the h1) and an empty `<th>` (`correction-client.tsx:315`).
- **Fix:**
  - **Pages.** Pass `level={1}` on each page's first `SectionHeader`. Settings gets an h1 "הגדרות", with the five sections as h2.
  - **Lint.** Add a rule (`test-sentinel`): every `app/dashboard/**/page.tsx` renders exactly one `level={1}` or `<h1`.
  - **Table.** `<th><span className="sr-only">{t('correction.colActions')}</span></th>`.
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** Primer page header; GOV.UK (one h1 per page).

**a11y-11 · P2 (P1 on auth) · 3.3.1, 3.3.2, 3.3.3, 1.3.1 · login, 2FA, reset, set-password, onboarding, team, settings, branches, recipes · both. Forms rely on native validation and unlinked hints.**
- **Evidence:**
  - **Native validation.** 19 files use `required` without `noValidate`. The browser's bubble appears in the **browser UI language**: English on most Israeli Chrome installs, not Hebrew. There is no `aria-invalid`, and the error does not persist.
  - **Hints.** `Field` mints `hintId` but never passes `aria-describedby` to its child (`Input.tsx:54-64`), so all 13 hints are silent.
  - **Login.** The magic-link email has **no visible label**, only a placeholder plus `aria-label` (`login/page.tsx:186-196`, 3.3.2).
  - **Login error.** The server error renders at the top with `role="alert"`. Focus is not moved, and the fields are not marked invalid.
  - **Count screen.** An invalid quantity is shown **by red border only** (`count-screen.tsx:367-372`): color-only (1.4.1), with no message.
- **Fix:**
  - **`Field`.** Clone its child with `aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}` and `aria-invalid`. Add an `error` prop that renders `<p id={errorId} className="text-sm text-danger">` with an icon. Put the hint **between the label and the control**.
  - **Forms.** Every form gets `noValidate`. On submit it runs zod, focuses the first invalid field and shows inline Hebrew errors with a suggestion, e.g. "מספר ח״פ צריך 9 ספרות — בלי מקפים". Copy `LeadForm.tsx`.
  - **Magic link.** Add a visible label: "או קבלו קישור כניסה למייל".
  - **Count screen.** Add an inline error "רק מספרים, למשל 2.5" linked by `aria-describedby`.
- **Owner:** `web-feature-engineer`, `growth-pmm-engineer` (auth copy) · **Effort:** M · **Exemplar:** the GOV.UK error summary plus inline errors; Stripe Checkout inline validation.

**a11y-12 · P2 · 4.1.2, 2.1.1, 2.4.3 · cookie consent on every route · both. The consent banner is a mis-declared, unreachable "dialog".**
- **Evidence:**
  - `CookieConsent.tsx:85-86` declares `role="dialog"` **and** `aria-live="polite"`. A dialog that is also a live region re-reads its whole content on every change.
  - It renders **after** `{children}` in `app/layout.tsx:52`. A keyboard user tabs through all 56 dashboard stops before reaching "רק חיוניות".
  - There is no Esc key and no focus management.
  - The "למדיניות העוגיות" link is 82×18 on touch.
  - It covers the T1 CTA on desktop (a11y-03).
- **Fix:**
  - **Semantics.** Change to `role="region" aria-label="הסכמה לעוגיות"`, with no `aria-live`.
  - **Order.** Render it **first** in `<body>`, just after the skip link (visually still fixed at the bottom), so it is the 2nd Tab stop.
  - **Esc.** Esc means "רק חיוניות". That is the safe default and is reversible in `/cookies`.
  - **Layout.** On `/login*`, `/reset` and `/s/*`, and inside the dashboard after sign-in, render it as an inline, static strip at the top of `main` (no overlap). Only strictly-necessary cookies are set there; see auth-31.
  - **Link.** Give the link `touch-target`.
- **Owner:** `growth-pmm-engineer` · **Effort:** S · **Exemplar:** the GOV.UK cookie banner (top of the page, in the focus order first, no overlay).

**a11y-13 · P2 · 4.1.3 (AA) · `/dashboard`, leaks, approvals, orders, chain (every `ViewToolbar`) · both. Filter, period and density changes update results silently.**
- **Evidence:**
  - `ViewToolbar.tsx:115` calls `router.replace` on every change. Nothing announces "מציג 12 חשבוניות · ‏760 ₪".
  - `Segmented` (`:493-520`) is `role="radiogroup"` with `role="radio"` buttons, but each button is its own Tab stop and there are no arrow keys, so it breaks the ARIA radio pattern.
  - On phone, `MultiFilter` popovers are native `<details>`. Esc does not close them, and focus stays on the summary.
- **Fix:**
  - **Announce.** After the server re-render, announce the result count and ₪ through `useAnnounce()` (polite, debounced 500 ms).
  - **`Segmented`.** Use a roving tabindex: arrow keys move and select, and only the checked item is tabbable. Or drop the ARIA roles and use `aria-pressed` toggle buttons.
  - **`MultiFilter`.** Esc closes the `<details>` and returns focus to its summary.
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** Algolia InstantSearch "N results" live region; WAI-ARIA APG radio group.

**a11y-14 · P2 · 3.2.2 On Input (A) · header language picker on every route · both. Arrow keys on the focused language select switch the whole UI language and direction.**
- **Evidence:** `LanguagePicker.tsx:61-64`. `onChange` calls `switchTo()` immediately, writing a cookie and setting `document.documentElement.lang/dir` plus `router.refresh()`. On Windows Chromium, ↑/↓ on a closed select fires `change`. A keyboard user who tabs onto it and presses ↓ lands in English, Arabic or Russian with the layout flipped. The chain branch switcher had the same pattern (chain-25).
- **Fix:**
  - **Picker.** Render it as a button plus menu (`aria-haspopup="menu"`, like `BranchSwitcher`), with items that carry `lang={l}` and their native names. Or keep the select and commit only on blur or Enter, with a visible "החל" when the value differs.
  - **Focus ring.** Use the shared outline on the select itself, not the label's `focus-within`.
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** the GOV.UK language toggle (links, not a select); Wikipedia's ULS button plus menu.

**a11y-15 · P2 · 2.3.3 / 2.2.2 / IS 5568 · global · both. There is no global reduced-motion fallback, and GSAP ignores the preference.**
- **Evidence:**
  - `globals.css` handles only `scroll-behavior`, `rm-reveal` and `rm-morph`.
  - The rest has no guard: 53 `transition-all`, 2 `active:scale-95`, 6 hover translate/scale, `Skeleton`'s `animate-pulse` with no `motion-reduce`, and `animate-ping` on `/scans/[id]`.
  - 12 GSAP files lack `matchMedia`, including showcase pages.
  - The landing `rm-morph` runs a 7 s infinite loop with no pause control. It is `aria-hidden`, but it moves for more than 5 s beside content (2.2.2).
- **Fix:**
  - **CSS fallback.** Add to `globals.css` base: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }`, plus an allow-list class `.motion-essential` for the spinner. Replace `transition-all` with `transition-[color,background-color,border-color,opacity]` (I5).
  - **GSAP.** Add one helper, `lib/motion/gsap.ts`, that exports `fromSafe(targets, vars)`. It wraps `gsap.matchMedia()` and becomes a no-op under reduce. Replace 14 call sites.
  - **`rm-morph`.** Stop it after 3 cycles, or add a visible pause button.
- **Owner:** `rtl-design-steward` (CSS, tokens), the area owners (GSAP sites) · **Effort:** S · **Exemplar:** Apple HIG Motion ("Reduce Motion"); IBM Carbon motion tokens; GOV.UK (no decorative motion).

**a11y-16 · P2 · 1.4.4, 1.4.12, IS 5568 (font scaling) · global, worst on the bottom bar and badges · mobile. Fixed-pixel micro type and truncation hide content when text is enlarged.**
- **Evidence:**
  - **Fixed pixels.** There are 101 fixed-px sizes under 12 px: `text-[11px]` ×53, `[10px]` ×45 and `[9px]` ×3. They include the bottom-bar labels (`nav.tsx:432, 450`), the nav badge (`nav.tsx:159`, 10 px) and the count-screen price source (`count-screen.tsx:349`). Fixed px does not follow the user's browser font-size setting.
  - **Text spacing.** The 1.4.12 injection clipped **13** `.truncate` elements on `/dashboard`.
  - **Money truncated.** The approvals summary truncates the **₪ value itself**: `SummaryTile` `truncate font-mono text-lg` (`approvals/list.tsx:291`). A ₪ figure clipped with an ellipsis at 200% zoom is a trust failure as well as an a11y one.
- **Fix:**
  - **Type scale.** Replace all `text-[9–11px]` with the closed scale in rem. The floor is `text-xs` (0.75 rem) on desk and **0.875 rem on field routes** (R-13).
  - **Bottom bar.** Labels become `text-xs` with `leading-tight` and wrap to 2 lines rather than truncate.
  - **Money.** Never use `truncate` on money or quantities. Use `min-w-0 break-words` with `text-balance`, and let the tile grow (B3). Add a lint rule: `truncate` and `formatIls(` in the same element → error.
- **Owner:** `rtl-design-steward` · **Effort:** M · **Exemplar:** Apple Dynamic Type (layouts grow, never clip numbers); Material type scale in sp.

**a11y-17 · P2 · 2.5.8 (AA) + house 44 px rule · catalog, suppliers/ledger, every page's consent link · mobile. Inline links escape the coarse-pointer floor.**
- **Evidence:**
  - From the coarse-pointer scan: buttons, inputs and selects are all ≥44.
  - Links: catalog has **56** links under 44 (52 product links at 18 px; axe `target-size` ×52 = catalog-23), the ledger has 12 supplier links (36–68 × 41), and the cookie link is 82×18.
  - `globals.css:435-438` lifts `a` only with `.touch-target`.
- **Fix:**
  - **Rows.** In list and table rows on phones, make the **whole row** the link target (`<a className="block min-h-12">`) and keep only one inline link per row.
  - **CSS.** Inside `@media (pointer: coarse)`, add `table a, li > a, [data-row-link] { min-height: 44px; display: inline-flex; align-items: center; }`.
  - **Gate.** A Playwright gate checks ≥44 under touch emulation, using the `Emulation.setTouchEmulationEnabled` trick from this probe (the crawl's `hasTouch` alone did not match `pointer: coarse`).
- **Owner:** `web-feature-engineer`; `test-sentinel` (gate) · **Effort:** S · **Exemplar:** Apple HIG (44 pt); Material (48 dp list rows).

**a11y-18 · P2 · 4.1.3, F7 · inventory, recipes, every `ErrorNotice` · both. Load-time messages use assertive `role="alert"`.**
- **Evidence:** these render at load and interrupt the screen reader's page reading:
  - `ErrorNotice` (`EntitlementUpsell.tsx:92-105`, 11 call sites) renders on query failure;
  - `inventory-home.tsx:69` and `period-card.tsx:52` use muted text with `role="alert"`;
  - `recipes/price-alert.tsx:51` is a load-time price alert card.

  Separately, `Spinner` is `role="status"` (`Spinner.tsx:12`) **inside every loading `Button`**, so each spinner announces "טוען" on top of `aria-busy`.
- **Fix:**
  - **Load-time.** Use `role="status"`, or no role, for load-time content. Keep `alert` only for errors injected after a user action.
  - **Spinner.** Add a `decorative` prop: `aria-hidden` when inside a button, since the button already carries `aria-busy`.
- **Owner:** `web-feature-engineer` · **Effort:** S · **Exemplar:** WAI live-region guidance; Red Hat PatternFly alert a11y.

**a11y-19 · P2 · 1.1.1, 1.3.1 · `/dashboard`, `/dashboard/leaks`, `/dashboard/chain` · desktop. Charts expose only a caption.**
- **Evidence:**
  - `BreakdownChart.tsx:181` uses `role="img" aria-label={caption}`, i.e. "מגמת הדליפה". Per-point values sit in `<title>` inside a `role="img"`, where they are presentational and never read.
  - The heatmap explains each cell only by `title` (`LeakHeatmap.tsx:76`; chain-25).
  - The ViewToolbar's "טבלה" face exists but is not offered from the chart.
- **Fix:**
  - **Chart label.** Make the `aria-label` a sentence: "מגמת דליפה ב-25 הימים האחרונים: יורדת, מ-‏131 ₪ ב-12.10 ל-0 ₪ ב-24.10. הנתונים המלאים בטבלה."
  - **Table toggle.** Add a visible "הצג כטבלה" link with `aria-controls` to the table face.
  - **Heatmap.** Cells become buttons with an `aria-label` sentence that opens the branch-month peek.
- **Owner:** `matching-engine-guardian` owns the SQL; this is UI only, so `web-feature-engineer` · **Effort:** S · **Exemplar:** Highcharts accessibility module (auto summary plus data table); GOV.UK charts with tables.

### P3: hardening

**a11y-20 · P3 · 4.1.2 · `/showcase/dashboard/invoices` (public demo, he/en/phone) · both. `nested-interactive` ×5 (axe "serious").**
- **Evidence:** `.audit-row` is a clickable row that wraps a link and button (crawl, 3 captures). Also listed as approvals-50.
- **Fix:** the row becomes a plain `<li>`, with one primary `<a>` stretched over it using the `after:absolute after:inset-0` "stretched link" pattern. Secondary buttons get `relative z-10`.
- **Owner:** `growth-pmm-engineer` · **Effort:** S.

**a11y-21 · P3 · 1.4.3 / 1.4.11 hardening · T2/T3 tints · both. Badges pass, but only by 0.0–0.3 when tints stack.**
- **Evidence:** §1 table: a danger badge on a `danger/10` card measures 4.58, chain `gold/20` on `bg` 4.50, and `info` on `surface-2` 4.69. There are 16 `bg-{role}/15–30` text uses.
- **Fix:**
  - Define role tokens with guaranteed pairs: `--c-danger-tint` / `--c-on-danger-tint` and so on (B8). Never stack a tinted badge on a tinted card; put badges on `surface` inside tinted cards.
  - Add a token unit test in `packages/ui-tokens`, run by `contrast.py` logic, that fails below 4.6 (a 0.1 safety margin).
- **Owner:** `rtl-design-steward` · **Effort:** S · **Exemplar:** Atlassian and Primer token contrast tables.

**a11y-22 · P3 · 2.4.1, 1.3.1 · `/admin*`, `/showcase/*`, `/scans/[id]`, `/s/[token]` · both. Shells outside the dashboard have no skip link or proper landmarks.**
- **Evidence:**
  - `admin/layout.tsx:24-33` puts the `<header>` **inside** `<main>`, with an unlabeled `<nav>` and no skip link.
  - `showcase/layout.tsx:32-69` has a header and nav but no skip link.
  - `/scans/[id]` has no `<main>`, h1 or skip link (approvals-51).
- **Fix:**
  - Add a shared `<SkipLink />` plus `<main id="main-content" tabIndex={-1}>` component, used by every layout.
  - Admin: `header` becomes a sibling of `main`, and `nav aria-label="ניווט ניהול"`.
- **Owner:** `web-feature-engineer` · **Effort:** S.

**a11y-23 · P2 · process gate (CI wiring is human) · all routes. No automated a11y regression gate.**
- **Evidence:** the crawl's axe run is lab-only. `.github/workflows/ci.yml` runs no axe, keyboard or contrast checks. This report's probes (Tab-walk, obscured %, coarse targets, reflow) are ad-hoc scripts.
- **Fix:**
  - **Spec (`test-sentinel` writes it).** Promote `review/tmp/a11y/probe.cjs` into `apps/web/e2e/a11y.spec.ts` with these assertions:
    - axe `wcag22aa` plus `best-practice` is clean on every route in he and en;
    - a Tab-walk of 3 primary routes at 390 and 1440 has ring ≥3:1 and ≥50% visibility;
    - targets are ≥44 under touch emulation;
    - titles are unique;
    - reduced-motion emulation leaves no running transforms.
  - **CI.** **Adding it to CI is a human edit** of `.github/workflows/ci.yml` (immutable). Propose the step.
- **Owner:** `test-sentinel` (spec), human (CI) · **Effort:** M · **humanPR:** yes (workflow file).

---

## 3. Big moves (the platform fixes that close 80% of the above)

1. **The A11y Foundation PR (one PR, ~6 shared files).** It closes a11y-02, a11y-03, a11y-04 and a11y-15:
   - the `--c-focus` token and a base `:focus-visible` outline;
   - removal of the per-component rings (codemod);
   - `scroll-padding` from the published chrome heights;
   - the reduced-motion CSS fallback;
   - a title template plus `useRouteFocus()` in the dashboard layout.

   Benchmark: Primer's focus system plus GOV.UK's page-title discipline. It makes every later feature accessible by default.
2. **"Nothing happens silently": one `LiveAnnouncer` plus focus choreography.** It closes a11y-05, a11y-06, a11y-07, a11y-09 and a11y-13:
   - persistent polite and assertive regions in `ToastProvider`, with `useAnnounce()`;
   - the toast timing rework (R-6);
   - `useStepFocus()` for wizards;
   - "focus next" after queue decisions.

   Benchmark: React Aria LiveAnnouncer, Gmail and Linear focus-follows-action.
3. **A field-grade accessible receiving flow.** The AdjustQuantities, InvoiceScan and Processing pass covers contextual labels, `aria-pressed` chips, a visible quantity focus, the live upload progressbar, readable errors, and no infinite motion. It pairs with mobile-field G-fixes so the receiver at the door, a sighted user with gloves in sun glare, benefits from the same changes. Benchmark: Shopify POS receive and React Aria NumberField.
4. **The legal and help layer.** It closes a11y-01 and a11y-12: the `/accessibility` statement with a coordinator, a consistent "עזרה ונגישות" location in every shell, and a consent banner that is first in the focus order and never overlays. Benchmark: Kol Zchut statement; GOV.UK cookie banner.
5. **Lock it in.** a11y-23: the `e2e/a11y.spec.ts` gate (axe wcag22aa + best-practice, Tab-walk visibility, touch targets, unique titles, reduced motion), with a human adding it to CI. Benchmark: GitHub's axe-in-CI plus manual audit cadence.

---

## 4. Rubric F scorecard (whole product)

| Criterion | Score | Key evidence |
|---|---|---|
| F1 legal layer + consistent help | **Fail (S0)** | a11y-01 |
| F2 contrast | Pass, with thin margins | §1 table; a11y-21 |
| F3 focus visible and not hidden | **Fail** | a11y-02, a11y-03 |
| F4 targets | Partial | Buttons pass; links fail (a11y-17) |
| F5 structure and landmarks | Partial | Titles (a11y-04), h1 (a11y-10), other shells (a11y-22) |
| F6 names and language | Partial | Hebrew names everywhere; context missing on repeated actions (a11y-05, a11y-07) |
| F7 live regions and timing | **Fail** | a11y-09, a11y-18, a11y-05 |
| F8 keyboard | Partial | Drawer leak (a11y-08), language picker (a11y-14), radiogroup (a11y-13); Ctrl+S `e.key` (catalog-40) |
| F9 motion | Partial | a11y-07 (viewfinder loop), a11y-15 |
| F10 forms and auth | Partial | OTP done right; native validation and unlinked hints (a11y-11) |

---

## 5. Fix order for the implementation plan

| Wave | Findings | Notes |
|---|---|---|
| **Wave A (pilot bar)** | a11y-01 (owner names the coordinator), the Foundation PR (a11y-02/03/04/15), a11y-08, a11y-09 | ≈3 days; mostly shared files |
| **Wave B (primary flows)** | a11y-05, a11y-06, a11y-07, a11y-12 | Approvals, receiving, orders, consent |
| **Wave C (hygiene)** | a11y-10, 11, 13, 14, 16, 17, 18, 19 | |
| **Wave D (lock-in)** | a11y-20, 21, 22, 23 | a11y-23 needs a human CI edit |

No finding touches the immutable money, RLS, schema, pricing or outbox files. Only a11y-23's CI wiring touches `.github/workflows/*`, which is human-only.

---

## 6. Manual protocol still owed (record before closing the lens)

1. **NVDA 2025 + Chrome (Hebrew voice):** `/dashboard` → approvals → approve one → open the invoice → back. Record the speech log. Expect a title on each navigation, the ₪ read as "760 שקלים", and "אושר · …".
2. **VoiceOver iOS 18 (Carmit):** the receiving wizard end to end. Each quantity line must be read with its product name, and the upload status must be spoken.
3. **TalkBack Android 14:** the bottom bar plus the drawer. Focus must not escape the drawer.
4. **Windows High Contrast / forced-colors:** the focus outline is visible, and badges keep their word.
5. **200% browser zoom at 1280:** no ₪ truncation in summary tiles or the hero.
