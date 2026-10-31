# RestoMatch UI/UX upgrade: implementation plan

**Date:** 2026-10-25 · **Base:** `main` @ `8fef118c` · **Author:** design director / head of product (UX review team)
**Inputs:** 12 area reviews, 8 lens reviews (`review/area-*.md`, `review/lens-*.md`), `research/RUBRIC.md` (rules R-1…R-15), `research/functional-gaps.md`, `research/ia-map.md`.
**Owner-facing summary:** `review/REVIEW-REPORT.he.md`.

This plan turns about 600 verified findings (about 430 from the areas and 180 from the lenses, overlapping in places) into 51 work packages. They run in 4 waves plus a human-PR track. Each package states its owning agent (AGENTS.md ownership map), the exact paths it may edit, the findings it closes, its acceptance criteria, and whether it needs a human-authored PR.

---

## 0. Ground rules for every package

### 0.1 Governance (AGENTS.md, binding)
- Agents **open a PR and stop**. A human merges and deploys. Self-repair is capped at 2 retries.
- **Immutable files are never auto-edited.** A package marked `humanPR: true` is drafted by the named agent as a proposal branch. A human authors, reviews and merges it. The list: `packages/matching/**`, the leak canary and its fixtures, `apps/web/lib/money.ts` (`formatIls`), RLS SQL and `packages/db/src/rls.ts`, `packages/db/drizzle/0000..0008` + `meta/`, `packages/db/src/schema.ts`, `drizzle.config.ts`, the COVERAGE manifest and `rls.attack.test.ts` (adding an entry is allowed, restructuring is not), `plans.ts`, `packages/billing/*`, `packages/api/src/approvals/engine.ts`, `notifications/outbox.ts`, `apps/worker/src/cron.ts`, `routers/leads.ts`, `app/api/trpc/[trpc]/route.ts`, `lib/rateLimit.ts`, `.github/workflows/*`, `.claude/agents/*`, `AGENTS.md`, `OPERATING.md`.
- **UI reads money rules and never redefines them.** `TOTAL_TOLERANCE_ILS`, tolerances, the VAT rate and the approval thresholds are imported read-only from `@restomatch/matching` or the engine exports.
- **Gates on every package:** `test-sentinel` always. `tenant-security-warden` whenever data, roles, middleware, auth or a tRPC procedure is touched. `icp-keeper` holds a scope veto. `leak-economist` signs off any ₪ label, definition or copy that changes the meaning of a number.

### 0.2 Path-ownership rules (they make parallel worktrees safe)
1. **No two packages in the same wave edit the same path.** Each wave section ends with an overlap ledger.
2. **A route folder owns its satellites.** The package that owns `apps/web/app/dashboard/<seg>/**` also owns `lib/i18n/messages/<ns>/**` for that area and, from wave 2, `apps/web/lib/nav/routes/<seg>.ts`.
3. **New i18n namespaces are only added by the package that owns `lib/i18n/messages/index.ts` in that wave.** That is nobody in wave 1, W2-13 in wave 2 and W3-08 in wave 3. Everyone else adds keys to a namespace they own. The wave-1 shell uses `nav`, resilience uses `common`, home uses `overview`, and DS uses `components`.
4. **Dependencies.** Only the package that owns a `package.json` and `pnpm-lock.yaml` in a wave may add dependencies: W1-01 (`tailwind-merge`), W2-15 and W3-03 (barcode ponyfill). No other package adds dependencies.
5. **tRPC router registration.** `packages/api/src/index.ts` is edited only in wave 1, by W1-04. That package pre-registers empty routers `invoices`, `tasks`, `nav`, `push` and `close` for later waves. Later packages add procedures only to router files they own.
6. **COVERAGE manifest.** In wave 1 only W1-07 adds entries to `cross-tenant.attack.test.ts`, and only add-only entries. From wave 2, after the human-authored W2-01 splits the manifest, each package adds its entries in its own fragment `packages/api/src/__tests__/coverage/<package-id>.ts`. **W2-01 merges first in wave 2.**
7. **Tests live beside what they test.** e2e specs are `apps/web/e2e/<package-id>.spec.ts` (an existing spec is edited only by the package listed as its owner). Visual baselines live under `apps/web/e2e/__screenshots__/<package-id>/`. Unit tests go in the owned folder's `__tests__/`.
8. **Shared primitives.** In wave 1, primitives are created only by the DS packages (W1-01, W1-02) and by the few packages that create a new, named folder (`lib/components/hero`, `flags`, `table`, `desk`). In waves 2 and 3, changes to `lib/components/**` go through the DS-maintenance package (W2-15) unless the folder is assigned to another package. **Wave-1 flow packages use only existing classes and components.** v2 primitives (`<Money>`, MetricTile, Sheet, DataTable…) are adopted from wave 2, area by area.

### 0.3 Definition of Done (applies to every UI package; acceptance lists below add package-specific checks)
- **DoD-1 Screens.** Playwright on the lab seed (`כפר הזיתים`, `DEMO_TODAY=2026-10-25`) for every touched route: `he` 390×844, `he` 1440×900 and `en` 1440×900. Field routes also need `he` 375×667 with `hasTouch`. Baselines are committed and reviewed by `rtl-design-steward`.
- **DoD-2 Axe.** `wcag22aa` + best-practice: 0 critical and 0 serious violations on touched routes, in `he` and `en`. The lab worker banner is excluded.
- **DoD-3 Keyboard.** Every new control is reachable. The focus ring is ≥3:1 (the global `--c-focus` from W1-01). Focus is never hidden under sticky chrome (WCAG 2.4.11), checked with a Tab-walk at 390 and 1440.
- **DoD-4 RTL and money.** No `dir="ltr"` around a he-IL ₪ string. In `he`, a Playwright bbox check confirms the ₪ glyph is left of the first digit on every new or changed amount. No `font-mono` on money. No `uppercase`/`tracking-*` on Hebrew. Logical properties only. Chart time runs left = oldest. Precision contract: hero and tiles 0 dp, lines 2 dp. Every visible total equals its visible rows.
- **DoD-5 States.** Each touched route has a layout-true loading state, a typed empty state and an in-shell error state with retry. "Unknown" is never shown as ₪0. Any new `loading.tsx` passes `apps/web/scripts/check-soft-nav.mjs` 6/6 in he and en.
- **DoD-6 Copy.** he/en key parity (`i18n.test`). Plural imperative or noun buttons. No masculine-singular CTA, slash forms or English jargon in `he`. Counts use the plural syntax once W1-01 lands.
- **DoD-7 Field.** Applies to `receiving/[poId]`, `inventory/count`, `orders/new` and `orders/capture`. The primary sits in the bottom third: ≥56 px tall, width ≥ viewport − 40 px. Targets ≥48 px. Text floor 14 px, inputs 16 px. CLS ≤0.05 at 4× CPU. Nothing is lost on reload.
- **DoD-8 API.** Any new or changed procedure has the right role tier, a COVERAGE entry and a cross-tenant attack test. It needs no schema change unless the package is `humanPR`.
- **DoD-9 Build.** `pnpm turbo run build typecheck test --concurrency=1` is green in CI. A CI check confirms the diff touches no immutable path, unless the package is `humanPR`.

---

## 1. Design-system foundation (what W1-01 and W1-02 ship)

The foundation is wave 1 because every later wave adopts it. It is built to be **backward compatible**: existing call sites keep compiling and rendering until their area package migrates.

### 1.1 Tokens ("Command Center Light"; `packages/ui-tokens` generates `globals.css` vars and a Tailwind preset)
| Layer | Decision |
|---|---|
| Focus | `--c-focus` `#1A5BC7` (6.24:1 on white). Global `:focus-visible { outline: 2px solid rgb(var(--c-focus)) !important; outline-offset: 2px }`, which overrides the 79 `ring-primary/60` and 21 `ring-line` sites without a codemod. 3 px under `[data-mode=field]`; `forced-colors` fallback. |
| Status colour roles | Families `primary · danger · warn · gold · info · neutral`, each with `text`, `icon`, `border`, `bg-bold`, `bg-bold-hover`, `bg-subtle`, `bg-subtle-hover`, `border-subtle` and `on-bold`. Text on subtle is ≥5.5:1; white on bold is ≥6.2:1. Danger example: `#B80F2A / #990C23 / #FCECEF / #F8DADF / #EDB3BD`. Alpha tints (`bg-danger/12`…) are deprecated and linted (warn in W2, error in W4). |
| Money states | `leak` (ink figure + danger marker, T1 only) · `atRisk` (bold chip + ink figure) · `caught` (gold) · `claimed` (primary) · `credited` (primary + ✓) · `returned` (gold) · `outstanding` (ink + DeadlineChip: warn ≤7 days, danger only when late) · `pending` (muted + clock) · `zero` (muted or the T3 sentence; never danger). |
| Type | Closed scale replaces Tailwind `fontSize`: caption 12/16, body-sm 14/20, body 16/24, heading-sm 16/24 600, heading-md 20/28 700, heading-lg 24/32 700 (page h1), metric-sm 16/24 600, metric-md 24/32 700, metric-lg 32/40 700, metric-hero 56/60 desktop and 40/44 mobile, 800 weight (R-15). Field mode raises caption to 14/20. Heebo with `tabular-nums lining-nums` for money. JetBrains Mono only through `<Token>` (identifiers). |
| Shape and elevation | Radius: control 8, card 12, overlay 16, pill. Elevation: e0 border, e1 card, e2 overlay, e3 modal + scrim. The 6 px danger rail is allowed only on the T1 hero; 3 px row-tone rails only on T2 queue rows. Glow blobs, `leak-gradient` rails and `shadow-glow-*` are deprecated in `/dashboard`. |
| Motion | `--dur-micro 100 / short 150 / medium 240 / long 400`. Standard easing `cubic-bezier(.2,0,.38,.9)`; exits run at 0.5–0.7× the entrance. Global `prefers-reduced-motion` fallback with a `.motion-essential` allow-list. `transition-all` is deprecated. |
| Density and containers | Rows: compact 32, default 48, touch 56. Controls: 32/40/48/56. Containers: app fluid to 1600, form 720, prose 70ch, auth 440. |
| Data-viz | Categorical 6 (primary, info, gold, `#8A4FBF`, `#00838F`, warn). Sequential "price creep" ramp `#FDF0E7 → #7A2D00` with an ink/white text switch. Roles for grid, axis, target (dashed) and leak series. |
| Chrome vars | `--rm-header-h`, `--rm-bottomnav-h`, `--consent-h`, `--rm-actionbar-h`, published by the shell and the action bars. `html { scroll-padding-top/bottom }` uses them. |

### 1.2 Components (APIs fixed in W1-01 and W1-02; adoption happens per area)
- **Numeric layer (W1-01).** `<Money value|agorot context="hero|tile|line|unit|inline" state? exact? unavailable?>` renders a plain `<bdi className="num">` around the frozen `formatIls()`, with no `dir`, precision taken from `context` and exact agorot in `title`. Also: `<Token kind="invoice|po|sku|allocation">` (mono, `bdi dir=ltr`, nowrap, copy), `<Delta>` (arrow + word + absolute ₪, no hand-built sign), `<PriceMove from to basis?>` (old ← new, R-4), `<DateTime>` (`dd.MM.yyyy · HH:mm`, relative with absolute title) and `<MetricTile state>`. `KpiCard` and `StatCard` become compatibility wrappers.
- **Feedback and overlays (W1-01).** Toast v2: action slot; 5 s plain, ≥10 s with an action; errors persist; pauses on hover and focus; persistent polite and assertive live regions; `useAnnounce()`. Also: `Banner`, `InlineMessage`, `Sheet` (detents 50/92 %, grabber, scrim, focus trap, pinned 56 px primary), `QtyKeypad`, `ConfirmDialog` that names the ₪ and the party, `EmptyState kind=first-use|no-results|inbox-zero|error|permission`, Skeleton variants (`hero`, `kpiRow`, `row`, `card`, `table`, `form`, `wizardStep`) with a motion-safe shimmer, and `Spinner decorative`.
- **Controls and forms (W1-01).** Button v2: `primary|secondary|tertiary|danger`, sizes sm 32 / md 40 / lg 48 / xl 56, pressed state, locked-width loading, success, `disabledReason`; `gold` and `accent` remain as aliases until W4. Also: `IconButton` (label required), `RowActions` (≤2 inline + ⋯), Field v2 (hint between label and control, error slot, `aria-describedby`, `aria-invalid`), `MoneyInput`, `QuantityInput`, `DateField` (dd.mm.yyyy, Sunday-first), `SegmentedControl`, `Tabs`, `Steps`, `FilterChip`, `StatusChip` (icon + word + colour) and `CountBadge`. `cn` moves to `extendTailwindMerge`.
- **Desk primitives (W1-02).** A headless `DataTable` (no new dependency): column defs, `aria-sort`, money-first sort descending, sticky header and identity column, `NumCell` (physically right in both locales, R-1), `TotalsRow`, `BatchBar` (count + Σ₪, block rows excluded, ₪200 cap per R-12), cell states `na|pending|unavailable`, `MobileCardList` below 768, `ColumnsMenu`, `ExportMenu` (CSV with BOM and header rows for period, scope, filters and generated time), `ViewTabs` with counts, and `useTableUrlState` (sort, cols, sel, view, page). Also `SplitPane` (`?sel=`, J/K by `KeyboardEvent.code`, active only while the list has focus) and `Peek` (480/520 px, Space/Esc, focus return).

---

## 2. Wave 1: safe, high-value, no immutable files (12 packages, all parallel)

**Theme:** stop the P0s (data loss, wrong or unbelievable ₪, legal floor), give every role its home and a usable shell, and lay the design-system foundation. No package depends on another inside the wave. W1-01 should merge early because waves 2 and 3 build on it.

### W1-01 · Design-system foundation v2: tokens, focus, motion, numeric and core primitives
- **Owner:** rtl-design-steward (money-format-marshal reviews `<Money>`) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `packages/ui-tokens/**`; `apps/web/tailwind.config.ts`; `apps/web/app/globals.css`; `apps/web/app/layout.tsx` (root: `viewport` export with `viewportFit: cover` and `interactiveWidget: resizes-content`, title default, consent rendered first in DOM); `apps/web/lib/components/{Button,Input,Badge,Card,Toast,Skeleton,Spinner,EmptyState,ConfirmDialog,Heading,KpiCard,StatCard,Sparkline,FlowAccent,FlowBar,CookieConsent,UnitText,cn,index}.ts(x)`; new `apps/web/lib/components/{money,feedback,overlay,form,data-viz,icon}/**`; `apps/web/lib/components/__tests__/**` (for these files); `apps/web/lib/cookieConsent.ts`; `apps/web/lib/i18n/translate.ts` (plural syntax only); `apps/web/lib/i18n/messages/components/**`; `apps/web/app/dashboard/lab/tokens/**` (platform-admin style page); `apps/web/package.json` + `pnpm-lock.yaml` (`tailwind-merge`); `apps/web/e2e/{a11y,smoke,i18n-sweep,consent-clearance}.spec.ts`; `apps/web/e2e/W1-01.spec.ts`.
- **Findings:** design-system-01 (primitive), -02 (primitive), -03, -04, -05, -06, -07 (core set), -08, -11 (tokens), -12, -13, -14, -15, -16, -17, -19, -20, -21, -22; a11y-02, -03 (CSS), -09, -11 (Field), -12, -15, -16, -17 (CSS), -18, -21; mobile-field-14, -17, -19, -22; perf-states-13, -18, -20; copy-rtl-10; auth-21 (Field); auth-31; leaks-35; mkt-09 (CSS).
- **Acceptance:**
  1. A token build generates `globals.css` vars and a Tailwind preset that replaces `fontSize`, `borderRadius`, `boxShadow` and `transitionDuration`. `webColors`, `glows` and the `--rm-*` hex duplicates are removed or aliased. A unit test fails any text/background role pair below 4.6:1.
  2. Every `:focus-visible` element shows a 2 px `#1A5BC7` outline with a 2 px offset, including sites still carrying `focus:outline-none` (computed-style e2e on 20 Tab stops across /dashboard, approvals and orders: contrast ≥3:1). Tab-walk at 390 and 1440 with the consent bar shown: every focused element is ≥50 % visible (scroll-padding).
  3. Reduced motion: no running transforms or animations (except `.motion-essential`) on /, /dashboard or /showcase/receiver. No `transition-all` in changed files.
  4. `<Money>` renders `formatIls()` output unchanged (snapshot against `formatIls` for 20 values × he/en × 0/2 dp). In he, the ₪ glyph sits left of the digits. No `dir` attribute. Heebo tabular.
  5. Toast: errors persist until dismissed. An action toast lasts ≥10 s and pauses on hover and focus. At most 3 stack. Messages are announced through persistent live regions (NVDA smoke). The toast sits above `--rm-bottomnav-h + --consent-h + safe-area`.
  6. Field v2 links hint and error through `aria-describedby`. `MoneyInput` accepts `7,5` and `1,250.50` and formats on blur. `DateField` reads dd.mm.yyyy in he regardless of browser locale.
  7. EmptyState `kind` requires an action for `first-use` and `no-results` (TypeScript overloads). The existing EmptyState API still compiles everywhere.
  8. `translate.ts` supports `{count, plural, one{…} two{…} other{# …}}` through `Intl.PluralRules`. Existing strings are unchanged (snapshot of all namespaces).
  9. Cookie consent is `role=region` (not dialog), first in focus order, dismissible with Esc (necessary-only), and inline (not overlaid) inside `/dashboard` and on auth/portal routes.
  10. The `/dashboard/lab/tokens` page renders every token and component in he/en × compact/default/touch. It is `notFound()` for non-platform-admins. Visual baseline committed.
  11. The existing `KpiCard`, `StatCard`, `Button` (incl. `gold`/`accent`) and `Toast` call sites need no edits: `next build` is green with zero changes outside these paths.

### W1-02 · Desk primitives: DataTable, SplitPane, Peek, BatchBar, ViewTabs
- **Owner:** rtl-design-steward (with web-feature-engineer) · **Device:** desktop · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/lib/components/table/**`; `apps/web/lib/components/desk/**`; `apps/web/app/dashboard/lab/desk/**`; `apps/web/e2e/W1-02.spec.ts`.
- **Findings:** design-system-10, -11 (rows); exec-desktop-05, -06, -07, -08, -14, -15, -17 (primitives).
- **Acceptance:**
  1. A lab page with 500 seeded rows: exactly one `th[aria-sort]`, and ₪ columns sort descending on the first click. Sticky header, sticky identity column and sticky action column.
  2. `NumCell` is physically right-aligned in he and en, with fixed decimals per column and ₪ in the header (R-1). The totals row equals the server-provided sum (test passes `sumAgorot`).
  3. `BatchBar` shows "N נבחרו · ₪Σ". A `block` row has a disabled checkbox with the visible reason "דורש בדיקה פרטנית". Select-all excludes rows above the cap.
  4. `useTableUrlState` round-trips `sort`, `cols`, `sel`, `view` and `page`. Back restores selection and scroll.
  5. `SplitPane`: J/K fire only while the list has focus and are bound by `KeyboardEvent.code`, so they work on a Hebrew layout. `Peek` opens from cache in under 100 ms, traps focus, and Esc returns focus to the row.
  6. Below 768 px the same column definitions render a `MobileCardList` with the ₪ at the line end. No horizontal scroll at 390.
  7. `ExportMenu` CSV opens in Excel-he with correct Hebrew (BOM). Header rows state period, scope, filters and generated-at (Asia/Jerusalem).
  8. Axe clean on the lab page in he and en. Row heights 32/48/56 follow `data-density`.

### W1-03 · Nav registry and app shell v2: sidebar, role bottom bars, titles, field chrome
- **Owner:** web-feature-engineer (rtl-design-steward visuals; tenant-security-warden for the `ROUTE_ROLES` generation) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** new `apps/web/lib/nav/**` (registry core, `groups.ts`, `routes/<seg>.ts` for every existing route key, `RouteTitle`, `useRouteFocus`, `titleFor`); `apps/web/lib/roles.ts` (generated from the registry, same values except listed deltas); `apps/web/app/dashboard/layout.tsx` (also one `Promise.all` for the layout fetches and `<Suspense>` around the worker banner); `apps/web/app/dashboard/nav.tsx`; `apps/web/app/dashboard/search.tsx`, `searchOptions.ts` (registry "מסכים" section, role-true placeholder); `apps/web/app/dashboard/worker-status.tsx`; `apps/web/lib/components/{Breadcrumbs,PageHeader}.tsx`; `apps/web/lib/i18n/LanguagePicker.tsx`; `apps/web/lib/i18n/messages/nav/**`; `apps/web/app/admin/layout.tsx`; `apps/web/lib/__tests__/{roles,nav-registry}.test.ts`; `apps/web/e2e/{nav-fit,role-switch}.spec.ts`, `apps/web/e2e/W1-03.spec.ts`.
- **Findings:** ia-nav-02, -03, -05, -06, -11, -12 (groups), -15, -16, -18, -20, -24; exec-desktop-04, -18, -20 (render), -22, -24; command-19 (titles), -30; mobile-field-05 (chrome), -07, -18; perf-states-02 (layout), -06; a11y-04, -08, -10 (PageHeader contract), -14; copy-rtl-21; admin-08 (nav entry); approvals-52; SUP-01 (nav entry); leaks-22 (route rule); design-system-18; receiving-18 (bar); orders-16; foodcost-21 (chef bar).
- **Acceptance:**
  1. One registry drives the desktop rail, the bottom bars, the "עוד" sheet, search "מסכים", titles, breadcrumbs and `ROUTE_ROLES`. Unit tests: every `app/dashboard/**/page.tsx` is registered; every allowed non-detail route is reachable in ≤2 interactions per role; no rendered nav link targets a forbidden route; generated `ROUTE_ROLES` equals today's map except `/dashboard/leaks/report` (now explicit) and `/dashboard/suppliers/ledger` (bookkeeper nav entry).
  2. Desktop (≥1024): an inline-start sidebar, 248 px expanded and 64 px as a rail (Ctrl/⌘+B by `code`, persisted with try/catch). Six job-ordered groups: בית · כסף · דליפות · רכש · מטבח · רשת · ניהול (footer). Active pill and `aria-current`. 56 px top bar (breadcrumb · period slot · 🔍 · avatar menu with sign-out). No nav wrap at 1440. Content top ≤180 px at 1440×900. Pay run, supplier ledger and integrations are reachable from nav for the right roles.
  3. Mobile: the bottom bar is server-rendered (present in SSR HTML, no portal): 64 px + safe area, solid surface, 12 px labels never truncated at 360 px in he/en/ar/ru, 56×32 active pill, `aria-current`. Per-role sets: receiver היום·קבלות·ספקים·עוד; chef היום·ספירה·מנות·עוד; manager היום·הזמנות·קבלה·אישורים·עוד; owner בית·אישורים·דליפות·הזמנות·עוד; bookkeeper בית·אישורים·תשלומים·חשבוניות·עוד. Hidden on registry field routes and while the on-screen keyboard is open. ☰ removed. Header 56 px: branch chip (≥2 memberships), 🔍 44 px, avatar; email out of the chrome. The `data-rm-logout` form contract is preserved.
  4. `document.title` = `<label> · <branch when ≥2> — RestoMatch` on every dashboard route. Client navigation is announced (Next route announcer fires, e2e), and focus moves to the page h1.
  5. The drawer makes page content `inert` while open (0 of 45 Tab stops escape). Focus returns to the opener.
  6. "עזרה · הצהרת נגישות · צור קשר" sits in the sidebar footer and the עוד sheet, in the same position on every dashboard route.
  7. `PageHeader` renders exactly one h1 (heading-lg) equal to the nav label's short form, a context line (branch · period · freshness) and at most 1 primary + 1 secondary + ⋯. Crumbs the viewer can't open render as plain text.
  8. The header language picker is a button and menu (no change on arrow keys). The admin layout has correct landmarks, a labelled nav and a skip link.

### W1-04 · Shell resilience: in-shell errors, forbidden pages, offline, expired sessions, branch-safe switching
- **Owner:** web-feature-engineer (tenant-security-warden for middleware and the `/go` resolver) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/middleware.ts`; new `apps/web/app/dashboard/forbidden/**`, `apps/web/app/dashboard/not-found.tsx`, `apps/web/app/dashboard/error.tsx`, `apps/web/app/dashboard/go/**`; `apps/web/app/dashboard/{branch-switcher.tsx,branch-actions.ts}`; `apps/web/app/dashboard/chain/switch-button.tsx`; `apps/web/lib/trpc/**`; new `apps/web/lib/net/**`; `apps/web/lib/components/{errors.ts,RouteProgress.tsx,routeProgressState.ts}`; `apps/web/scripts/check-soft-nav.mjs`; `packages/api/src/index.ts` + new empty routers `packages/api/src/routers/{invoices,tasks,nav,push,close}.ts`; `apps/web/lib/i18n/messages/common/**`; `apps/web/e2e/client-nav.spec.ts`, `apps/web/e2e/W1-04.spec.ts`.
- **Findings:** ia-nav-07, -08 (switch, context, resolver), -09 (resolver); perf-states-01 (shell part), -04, -08, -09 (dashboard), -15; exec-desktop-23; command-12 (keep path); chain-31 (verbs).
- **Acceptance:**
  1. A forbidden route renders an in-shell T4 page (HTTP 403) naming the screen and the roles that can open it, with "בקשו גישה מ־<owner>" (prefilled WhatsApp/e-mail) and "פתחו ב־<branch>" when another membership allows it. The 24 forbidden role/route pairs from the probe are tested. No silent redirect.
  2. `dashboard/not-found` and `dashboard/error` keep the nav. Error offers "נסו שוב" (`startTransition(router.refresh + reset)`) and a digest. Unknown entity URLs return HTTP 404 (not 200).
  3. Branch switch keeps the path and non-entity filters (`p, from, to, cmp, sev, type, st`). Detail routes fall back to their registry parent with a toast. `approvals?sev=block` survives a switch (e2e). Chain uses "עבדו כסניף הזה".
  4. `/dashboard/go?r=&to=` re-checks membership, switches branch, validates `to` with `safeRelativePath` and returns 303. A regression test refuses a non-member `r`.
  5. Offline: a T4 chip "אין חיבור · נעדכן כשהרשת תחזור" appears within 2 s. Mutations use `networkMode: 'always'`, so they fail inline at once instead of spinning paused (e2e approve while offline).
  6. Session expiry: `UNAUTHORIZED` opens a re-auth sheet in place. Page state is kept and the failed call retried after sign-in. `friendlyError` separates `sessionExpired` from `forbidden`.
  7. QueryClient `staleTime` is 30 s, so there is no client refetch right after hydration on suppliers/catalog/orders (network assertion). `RouteProgress` fires for `router.push`.
  8. `check-soft-nav.mjs` covers approvals filters, pay-run month, supplier tabs and one cross-route tap per boundary, and passes 6/6 in he/en. The empty routers are registered and the COVERAGE completeness test stays green.

### W1-05 · Role homes ("Today") and the receiving board, with an honest leak hero
- **Owner:** web-feature-engineer (leak-economist for the hero; tenant-security-warden for `receiving.ts`) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/page.tsx`; new `apps/web/app/dashboard/home/**`; `apps/web/app/dashboard/{vat-at-risk.tsx,activity.tsx}`; `apps/web/app/dashboard/receiving/{page.tsx,loading.tsx}`; new `apps/web/lib/components/hero/**` (presentational `LeakHero`); `apps/web/lib/i18n/messages/overview/**`; `packages/api/src/routers/receiving.ts`; `packages/api/src/__tests__/receiving.test.ts`, new `receiving-board.test.ts`; `apps/web/e2e/demo-path.spec.ts`, `apps/web/e2e/W1-05.spec.ts`.
- **Findings:** command-01, -02, -03 (home hero), -04 (interim), -05 (UI), -07, -08, -09, -10 (A: strip), -11, -12 (chain line), -16, -23, -25, -26, -28, -31; ia-nav-01; mobile-field-06; exec-desktop-01 (home tiles), -12, -21 (home); design-system-09; foodcost-21; receiving-13, -18, -31; auth-10 (hero states); functional-flows-17 (home row); perf-states-02 (home).
- **Acceptance:**
  1. `/dashboard` renders by role:
     - **Receiver:** a board with a summary line ("היום: 5 משלוחים · 2 התקבלו · 1 באיחור"); groups באיחור / עכשיו-הבא / בהמשך / התקבלו; the next truck enlarged with one 56 px CTA naming the next state; a "חשבונית בלי הזמנה" tile.
     - **Chef:** a count tile from `inventory.current`, then dishes over target with the cause ingredient.
     - **Manager:** Needs-you first (₪ awaiting the manager from `approvals.myQueue`; supplier cut-offs from `order_schedule`; deliveries today; open count).
     - **Bookkeeper:** a strip (routed to me ₪·n · pay-run totals · VAT at risk · last export placeholder).
     - **Owner:** a compact hero ≤260 px plus Needs-you (≤3 rows on phone, ≤5 tiles on desktop).
  2. The receiver and chef homes never call `owner.kpis`, `owner.leakHero` or `owner.leakSummary` (network assertion). No owner view toolbar renders for them.
  3. The hero delta compares the same day-span ("▼ ₪182 (−19%) לעומת 1–25 בספטמבר"). The full-month "חודש קודם" caption is gone. No "יעד" line (R-14 default). Three typed states: no data shows "—" with a single "צלמו חשבונית" CTA; clean shows the T3 sentence; a thin base (<5 invoices) shows ₪ without %.
  4. Undecided money (₪296 in the lab) appears as a T2 Needs-you row with a decide verb, and no longer as the gold "נתפס" tile.
  5. Layout gates:
     - At 375×667 (worker banner mocked healthy) the hero ₪ and the first Needs-you row are visible without scrolling.
     - At 1440×900 the Needs-you strip bottom is ≤330 px.
     - The desktop home is ≤1,800 px tall, with a 12-column grid (main 8, rail 4).
     - The trend is collapsed behind "הצג מגמה".
  6. Each hero tile and each Needs-you row is a ≥48 px link. For 3 rows, e2e confirms the landing list shows the same ₪.
  7. Receiving board:
     - Closed receipts read "התקבל ✓" and open read-only.
     - In-progress is neutral (not warning).
     - Past-dated open POs appear under "באיחור".
     - The server rejects `markGrLine` and `submitReceipt` on a non-pending receipt (test).
  8. The hero streams first, with each card in its own `<Suspense>`. A forced failure in one card shows "לא נטען · נסו שוב", never ₪0, and the hero still renders.
  9. `LeakHero` is exported from `lib/components/hero` as a pure presentational component for later showcase and leak-check reuse.

### W1-06 · Delivery Check v1 and never losing field work (receiving wizard)
- **Owner:** ocr-procurement-engineer (web-feature-engineer for UI) · **Device:** mobile · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/receiving/[poId]/**`; `apps/web/app/dashboard/receiving/dock-price-hint.tsx`; `apps/web/app/showcase/receiver/{_steps/**,_state.ts,_mock.ts}`; `apps/web/lib/pwa/**` **except** `PwaQueueReset.tsx`; `apps/web/lib/i18n/messages/{receiving,dockPrice}/**`; `apps/web/e2e/{receiving-review,dock-slip}.spec.ts`, `apps/web/e2e/W1-06.spec.ts`.
- **Findings:** receiving-01, -02, -03 (v1), -05, -06, -07 (S fix), -08, -10, -11, -14, -15, -16, -22, -23 (inline), -24, -25, -26, -27, -29, -30, -34, -35; mobile-field-01, -03 (v1), -04 (v1), -22, -23; perf-states-05, -11 (stages), -17; a11y-06 (wizard), -07; mkt-15 and mkt-27 (receiver steps); orders-12 (dock slip ref); functional-flows-11 (no fake signature); design-system-01 (dock slip and price hint); auth-01 (guard side).
- **Acceptance:**
  1. Every PO line can be counted:
     - Matched lines are collapsed rows with "ערוך".
     - Quick confirm moves to the count screen as "הכל הגיע כמו בהזמנה (12)".
     - e2e: invoice 10, PO 10, delivered 8 records `qty_received = 8`.
  2. A sticky "✓ סמנו את השאר כמו בהזמנה (8)" with a 10 s undo. Close enables when all lines are resolved, and the footer counts "9 מתוך 12 אושרו".
  3. Each mark is saved on change (300 ms debounce, full-row `markGrLine`) with a per-line "נשמר" state. A reload mid-count restores every mark (e2e). A leave guard covers back, nav and `beforeunload`. Screen Wake Lock is held while the wizard is open. A completed or partial receipt opens a read-only summary instead of restarting at scan.
  4. "חסר" writes `qtyReceived = 0`, `qtyRejected = 0`, `rejectReason = 'missing'`. The slip prints "חסר", never "נפסל/פגום".
  5. Capture:
     - The primary is `<input accept=image/* capture=environment>`, with "העלו קובץ / PDF" as a separate text link.
     - A client blur/darkness gate gives a named reason.
     - No infinite pulse.
     - The demo-invoice button renders only under `/showcase`; the live flow offers "אין חשבונית עכשיו — קלטו מול ההזמנה".
  6. Evidence: no signed URL is persisted, the invoice photo is never sent as `signatureUrl`, and Confirmed links to `/dashboard/invoices/<id>`.
  7. One ₪ only. The client heuristic is removed from Confirmed and review. The engine total comes from `dockSlip`, or the screen shows "הסכום ייקבע אחרי הבדיקה". No gold "חיסכון".
  8. Processing shows no looping fake stages: honest stage text with elapsed seconds, and "המשך מול ההזמנה" at 10 s.
  9. Field mode (DoD-7):
     - 56 px sticky ActionBar in the bottom third (bbox at 375×667 and 390×844).
     - Type: body 16, item names 17/600, quantities 24 bold tabular.
     - Controls: 56×56 steppers; chips 48 px with 8 px gaps.
     - Inputs: kg/L open a decimal keypad (comma accepted, 3 dp); counted units get a stepper. The tolerance confirm reads `@restomatch/matching` values.
  10. Logout with queued photos: online flushes first; offline shows a sheet naming the count. `clearQueue()` is never called without confirmation (unit test). `purgeOtherUsers` becomes keep-and-attribute.
  11. The sync state appears only after 400 ms, as a fixed chip. CLS ≤0.05 at 4× CPU on `/dashboard/receiving` and the wizard.
  12. GSAP is removed from the field steps; route JS for `receiving/[poId]` is ≤170 KB gz. A step change focuses the step h1.
  13. a11y: each quantity input is named per line, chips use `aria-pressed`, the toggle uses `aria-expanded`, progress has `role=progressbar`, and errors sit on the line or footer, not the top.
  14. Money: no `dir=ltr` or mono around ₪ in the wizard, slip or price hint. The dock slip passes the ₪-left-of-digits assertion. Copy: plural imperative; "צלמו חשבונית" and "העלו קובץ" are split; no "לקבע / המוקפא / ביטחון OCR".

### W1-07 · Money-named approvals: verbs, server totals, safe concurrency, two-thumb mobile, undo
- **Owner:** web-feature-engineer (leak-economist, tenant-security-warden, test-sentinel) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/approvals/{page.tsx,list.tsx,vocab.ts,loading.tsx,error.tsx}`, `apps/web/app/dashboard/approvals/__tests__/**` (**not** `pay-run/**`); new `apps/web/lib/components/flags/**` (`WhyLine`); `apps/web/lib/i18n/messages/approvals/**`; `packages/api/src/routers/approvals.ts`; `packages/api/src/notifications/templates.ts` (approval copy only); `packages/api/src/__tests__/cross-tenant.attack.test.ts` (**add-only** COVERAGE: `approvals.queueSummary`, `approvals.reopen`); `packages/api/src/__tests__/approvals-router.test.ts`, new `approvals-concurrency.attack.test.ts`; `apps/web/e2e/W1-07.spec.ts`.
- **Findings:** approvals-01, -03, -04, -05, -06, -07, -08, -11, -14, -15, -16, -17, -18, -19, -20, -23 (empty state); functional-flows-07 (others lane), -08; a11y-05; perf-states-07; mobile-field-11, -15; copy-rtl-09 (approvals).
- **Acceptance:**
  1. A per-type verb map lives in `vocab.ts`. A unit test locks the mapping: `approve()` = "דרוש ₪X מהספק", `reject()` = "שלם כפי שחויב…", `escalate()` = "העבר לבעלים". The same map drives activity titles and approval e-mails. UNORDERED_ARRIVAL shows only "שייך להזמנה". PRICE_LOWER and MISSING show "סמן כנבדק". No explanatory subtitle is needed.
  2. `approvals.queueSummary` returns count, blockers, oldest age and the claimable ₪ (`lib/claims` rule, 2 dp, "לפני מע״מ"). The tiles equal the server value with >50 items, both after "טען עוד" and after a decision.
  3. Decisions update only rows in `open`/`escalated`. A stale card gets CONFLICT naming the decider and time. The concurrent-decision attack test passes. There is never a second audit or activity row.
  4. Optimistic exit (150 ms), focus moves to the next card, a polite announcement, and a 10 s undo toast backed by `approvals.reopen` (same decider, inside the window, compensating audit). Failure re-inserts the card at its index with an inline error. Page 1 is never refetched, and loaded pages are kept.
  5. The waive sheet offers 3–5 reason chips per type and commits in one tap. `reasonCode` is stored in the audit `after`. "אחר" reveals a labelled textarea.
  6. The why-line appears in every density: "₪575.00 × 2 חבית במקום ₪522.60 (הזמנה PO-…, 14.10) = ₪104.80 · ‎+10.0% · סף ±2% או ₪5". Data comes from `myQueue` joins (invoice line qty and unit, PO number and date, source). Rendered by `lib/components/flags/WhyLine`.
  7. Phone (390×844): the first card's two 48 px 50/50 buttons are visible without scrolling. Filters collapse to one chip row. Escalate and evidence sit in ⋯.
  8. Default sort is severity, then `invoices.due_date` (when present), then ₪. Cards show age ("ממתין 4 ימים"). The empty state is role-aware ("אין חריגות שממתינות לך · 4 ממתינות לבעלים (₪296.00)") and shows a read-only "ממתין לאחרים" lane.
  9. Money uses a plain tabular `bdi`. Red is only on `block`. `loading.tsx` is layout-true (cards about 310 px). `error.tsx` stays in the shell.

### W1-08 · Leak → claim → recovery trust pass
- **Owner:** web-feature-engineer (leak-economist gate; matching-engine-guardian consulted, no charts edits) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/leaks/**`; `apps/web/app/dashboard/recovery/**`; `apps/web/app/dashboard/suppliers/[id]/{leak-card/**,leak-card-view.tsx,leak-card-data.ts,leak-card-logic.ts}`; `apps/web/lib/components/views/**`; `apps/web/lib/components/LeakHeatmap.tsx`; `apps/web/lib/activeRestaurant.ts`; `apps/web/lib/i18n/messages/{leaks,leakProof,views,recovery}/**`; `packages/api/src/ask/offline.ts` + `packages/api/src/__tests__/ask.test.ts`; `apps/web/e2e/supplier-leak-card.spec.ts`, `apps/web/e2e/W1-08.spec.ts`.
- **Findings:** leaks-01, -03 (interim rename), -04, -05, -06 (phase 1), -07, -08 (agent part), -10, -11, -15, -16, -18, -21, -22 (UI), -23, -24, -28, -31, -32, -34; command-03 (Ask + default compare), -06 (toolbar), -24 (chart); SUP-02 (expected vs charged), SUP-17 (CTA and copy); copy-rtl-01; chain-01, -02, -03, -04, -07, -08, -25, -28, -37; perf-states-12, -14 (recovery); a11y-13; exec-desktop-10 (default compare).
- **Acceptance:**
  1. The claim letter "מאת", its signature and the report subtitle use the active restaurant and its ח״פ (test seeds 2 memberships with the second active).
  2. Visible totals equal their rows on the hub, breakdown and proof: a Playwright Σ assertion, with 2 dp next to rows and the exact value in `title`.
  3. The report compare covers the same day-span ("1–25 באוק׳ מול 1–25 בספט׳"). `DEFAULT_VIEW.compare = 'prev'` (aligned). Ask `leakChange` uses the same span and names it, with 20 owner phrasings as unit tests. "כמה" alone never maps to the leak.
  4. Three states (no data T4 with a CTA / clean T3 / failure "לא זמין · נסו שוב") on breakdown, report and explorer. Never a green ₪0 for no data, never a red ₪0. Lines where Δ = 0 show as a T4 note.
  5. "דליפה" means only the monthly leak. Creep is renamed "מחירים שעלו · 30 הימים האחרונים" in a calm tone with its own section. The tile that measured accepted-and-resolved is renamed "אושר לדרישה" with the ₪12.66 explanation line, until H-07 lands. The hub defines its T1.
  6. Claims:
     - One letter per supplier, with "לקיזוז לפני תשלום" and "לזיכוי" sections and a page total.
     - Per-letter print/PDF (`data-print-root`), wa.me text and mailto.
     - "סמן כנשלח" calls `recovery.transition` after a 10 s deferred commit with undo, and the badge reads "נשלח 25.10 · נותרו 7 ימים".
     - Letter content: invoice number and date, "חויב X × ₪Y · בהזמנה ₪Z", a plain-Hebrew reason per type, a reply-by date and the signer.
  7. Recovery:
     - No select-on-change. A next-step button per status plus ⋯.
     - Write-off and "הכסף חזר" go through a ConfirmDialog naming the ₪ and supplier, with reason chips sent as the transition note. Reversible moves are deferred 10 s with undo. Batch select makes one transition call.
     - Countdown chips run from `COALESCE(letterSentAt, claimedAt)`. The banner splits into "לא נשלחו" and "ממתינות לתשובת ספק", each with a CTA. The reminder copy says it goes to the restaurant.
     - A funnel נדרש → זוכה → הוחזר with פתוח, במחלוקת and ויתרנו, using Hamilton rounding so the printed parts sum. The supplier table is at 2 dp.
  8. Phone: claim cards are grouped by supplier with sticky headers, and the outstanding ₪ is visible at 390. ViewToolbar collapses below `lg` to one "תצוגה · N" sheet; the hero sits above 50 % of the viewport at 390×844.
  9. The supplier leak card (client-facing) shows expected vs charged per unit and the type for each top line. Its CTA opens claims filtered `?sup=`. Copy uses "דרישת זיכוי", never "תביעה".
  10. ViewToolbar commits optimistically (`useTransition`), sets `aria-busy` on data regions and announces the result count. Chart: no `rtl:-scale-x-100`, ₪0 days drawn as muted ticks, an aria-label sentence. `loading.tsx` and `error.tsx` for leaks and recovery pass the soft-nav check.

### W1-09 · Sign-in and supplier portal: no lost photos, no silent loss of the supplier's answer
- **Owner:** web-feature-engineer (tenant-security-warden) · **Device:** mobile · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/login/**`; `apps/web/app/(auth)/**`; `apps/web/app/onboarding/**`; `apps/web/app/invite/**`; `apps/web/app/s/**`; `apps/web/app/api/supplier-confirm/**`; `apps/web/lib/pwa/PwaQueueReset.tsx` (delete); `apps/web/lib/i18n/messages/{auth,onboarding,supplierConfirm}/**`; `apps/web/e2e/{auth,consent-login}.spec.ts`, `apps/web/e2e/W1-09.spec.ts`.
- **Findings:** auth-01, -02, -03, -05 (one form), -06, -07 (phase 1), -08, -09, -11, -14, -15, -16 (now part), -17, -18, -19 (UI strings), -20, -21, -22, -23, -24, -25, -26, -27, -28, -30, -31, -32 (footer); a11y-11 (auth); perf-states-09 (portal).
- **Acceptance:**
  1. Visiting `/login` never clears the offline queue (e2e: the queue survives). It shows the T4 note "N צילומי חשבונית ממתינים במכשיר · היכנסו כדי לשלוח". `PwaQueueReset` is deleted.
  2. Login:
     - A wrong password keeps the email and focuses the password.
     - One email field serves both password and magic link (`formAction`).
     - "שכחתם?" is 14 px beside the label, with a 44 px show/hide toggle.
     - Submit shows a pending state.
     - After 2 failures it offers "קבלו קוד כניסה למייל".
     - Signed-in users with a `callbackUrl` are redirected.
  3. Check-email shows the masked address (from an httpOnly cookie), a 30 s resend cooldown, open-Gmail/Outlook and a spam hint. 2FA has a recovery-code mode (text input, autocapitalize off).
  4. Onboarding honours `callbackUrl` via `safeRelativePath` (e2e: leak-check claim → onboarding → claim). It asks for "השם שלך", uses `noValidate` with inline errors, and strips dashes from ח״פ.
  5. Invite errors are T4 per code (EXPIRED / WRONG_EMAIL with "התנתקות וכניסה עם a@b" / USED). A member-less user is never linked to `/dashboard`.
  6. Portal:
     - One adaptive sticky primary: "אישור ההזמנה כפי שהיא" with no changes, "שליחת התשובה · 2 שינויים" (with a diff summary) once something is edited.
     - "As is" with edits asks "לבטל 2 שינויים ולאשר כפי שהוזמן?".
     - HTTP 409 shows the recorded answer and its date, never a false success.
  7. Portal visuals and content:
     - Money in a plain tabular `bdi`, passing the ₪-left assertion.
     - Inputs use `line-strong` borders and text-sm labels.
     - Per-line and order ₪ totals, an "אין במלאי" chip, and call/WhatsApp when a restaurant phone is on file.
     - The done card restates the diff.
  8. Portal not-found and expired states have no dashboard CTA ("הקישור הזה כבר לא פעיל…").
  9. An AuthShell with the LanguagePicker on every auth and portal page. Footer "הצהרת נגישות · פרטיות · תנאים". Per-route titles. Skip link. The consent bar never covers the primary.

### W1-10 · Catalog and price-list money safety
- **Owner:** ocr-procurement-engineer (web-feature-engineer for UI; leak-economist) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `packages/api/src/catalog/**`; `packages/api/src/contracts/import.ts` (re-exports the moved parser); new `packages/api/src/lib/{parseMoneyCell,unitPrice}.ts`; `packages/api/src/priceAlerts/sweep.ts` (imports the shared `catalogUnitPrice`); `packages/api/src/routers/{catalog,mapping}.ts`; `packages/api/src/__tests__/catalog-parse.test.ts`, new `catalog-commit.test.ts`, `mapping-rematch.test.ts`; `apps/web/app/dashboard/{catalog,products}/**`; `apps/web/lib/i18n/messages/{catalog,products}/**`; `apps/web/e2e/W1-10.spec.ts`.
- **Findings:** catalog-01, -02, -03, -13, -18, -20, -22, -23, -29, -37, -40, -41, -50.
- **Acceptance:**
  1. Strict cell parsing. These parse: `1,250` → 1250; `₪1,250` → 1250; `1,250,000`; `12,90` → 12.9; `1,250.00`; `₪ 2,400`. `-5` is rejected. A non-empty cell that fails to parse is held out of the commit and listed as "מחיר לא ברור". The preview shows the parsed "₪ שיובא" and flags 0, >5× and <0.2× the current price.
  2. Matches scoring 0.6–0.9, or with a unit/pack mismatch, never auto-link and never create a confidence-1 alias. The wizard adds "בדיקה · N התאמות דורשות אישור" (accept / choose / new), and the done CTA links there.
  3. A VAT-basis toggle is required, pre-set from a "כולל מע״מ" header. Conversion uses the engine VAT rate (read-only import). The choice is stored in `column_mapping` jsonb.
  4. `mapping.confirm` enqueues a re-match of the affected invoices (skipping consolidated, reporting those blocked by claims). The toast reads "קושר · 6 שורות · 3 חשבוניות נשלחו לבדיקה מחדש · בטל".
  5. "הזול ביותר" compares normalised ₪ per default unit, and only when ≥2 comparable prices exist. The sweep and the product page share one `catalogUnitPrice` (parity test).
  6. Inline commit ≤200 rows; larger files go to the job with a determinate progress card. Price inputs are text with `inputMode=decimal`, 16 px. No native `confirm()`. Ctrl+S binds by `code`. The product link is keyboard-reachable. Confidence is a word plus its basis, not a %.
  7. A new tenant can create a supplier inline in the import. The catalog empty state has one CTA, "ייבוא מחירון ראשון".

### W1-11 · Orders: reorder, never lose a draft, fix the reminder link, send with undo
- **Owner:** web-feature-engineer (ocr-procurement-engineer for the worker job) · **Device:** mobile · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/orders/**`; `apps/web/lib/i18n/messages/orders/**`; `apps/worker/src/jobs/orderReminders.ts` + new `apps/worker/src/__tests__/orderReminders.test.ts`; `apps/web/e2e/{orders-wizard-delivery,orders-received}.spec.ts`, `apps/web/e2e/W1-11.spec.ts`.
- **Findings:** orders-02, -05, -06, -07, -08, -12 (UI), -13, -22, -23, -24, -25 (move out of list), -26, -27, -28, -29, -30, -31, -34, -35; a11y-06 (orders); ia-nav-09 (reminder link); mobile-field-08 (part); functional-flows-12 (cancel notice part).
- **Acceptance:**
  1. "הזמן שוב" on the detail header, phone cards and the desktop row overflow. It prefills lines at the current contract or last price, copies free lines verbatim, lists unavailable lines, picks the next valid delivery date, and offers attach/replace when a draft exists. ≤4 taps (e2e).
  2. The reminder link works: the page accepts `supplierId ?? supplier`, the job emits `?supplierId=`, and a worker test asserts the URL. `cron.ts` is untouched.
  3. The server draft is the save model. The draft is created on the first line and lines autosave. Reopening offers "המשך מהטיוטה (7 פריטים)". There is a leave guard, and the change-supplier sheet has a 10 s undo.
  4. REVIEW shows the literal supplier document. The CTA names supplier and channel ("שלח לירקות השרון בוואטסאפ"). A 10 s "בטל שליחה" countdown runs before `placeOrder`. Closing the page inside the window leaves a visible draft.
  5. Cancel sits in ⋯ behind a ConfirmDialog naming supplier, ₪ and date, with "שלח הודעת ביטול לספק" (on by default; wa.me or the email document path).
  6. Field mode on new/capture: no bottom nav, a 64 px cart bar ("7 פריטים · ₪1,240 · אספקה ג׳ 07:00") and a 56 px primary.
  7. Inputs are text with `inputMode=decimal`. Totals note "לא כולל 2 שורות ללא מחיר". Delivery chips offer the next 3 valid days with a reasoning line. Copy fixes ("נשלח ל… · אספקה …"). `loading.tsx` and `error.tsx`. `notFound()` only for NOT_FOUND.
  8. Desktop list: one stretched row link (one Tab stop per row). Status chips have icon + word, and cancelled is neutral. The "#F8E05686" ref appears in the detail, list and phone card and is searchable. The price-document setting leaves the list page (it shows as a read-only chip in REVIEW).

### W1-12 · Public site: accessibility statement, conversion basics, honest 404s
- **Owner:** growth-pmm-engineer · **Device:** both · **Effort:** M · **humanPR:** no (merge blocked until the owner supplies the coordinator and contact details)
- **Paths:** `apps/web/app/(marketing)/**` **except** `{privacy,terms,cookies}/**`; new `apps/web/app/(marketing)/accessibility/**`; `apps/web/app/page.tsx`; `apps/web/app/not-found.tsx`; `apps/web/app/sitemap.ts`; `apps/web/lib/publicPaths.ts`; new `apps/web/lib/contact.ts`; `apps/web/app/showcase/**` **except** `receiver/{_steps/**,_state.ts,_mock.ts}`; `apps/web/lib/i18n/messages/{marketing (except legal.*),landing,showcase,leakCheck}/**`; `apps/web/e2e/W1-12.spec.ts`.
- **Findings:** mkt-01, -02, -04, -05, -06, -07, -08, -09, -12, -15, -16, -18, -25, -26, -27, -28, -31, -32; a11y-01, -20, -22 (showcase); admin-03 (page); auth-32 (page); ia-nav-20 (page); perf-states-09 (marketing).
- **Acceptance:**
  1. `/accessibility` (he default, en available) covers ת״י 5568 AA / WCAG 2.2 AA, the audit date, the browsers and assistive technologies tested, the arrangements, known gaps (seeded from this review) and the coordinator's name, phone and e-mail with a 5-business-day SLA. It is in the sitemap and `publicPaths`, linked from the marketing and showcase footers, and has no overlay widget.
  2. Lead form: the name stays required (router untouched); the client requires phone OR e-mail; an e-mail field is added; Israeli phone validation; inline errors with `aria-describedby`; `type=tel dir=ltr`. Success copy is specific, with a demo link and WhatsApp when configured. The reserved min-height is released.
  3. Phone:
     - A sticky CTA appears after the hero leaves view and hides over `#lead` and the footer, above the consent bar.
     - The menu is a sheet that closes on link, hash, outside tap and Esc, returning focus.
     - The showcase header is one row ≤64 px, with an active demo pill and `aria-current`.
  4. One CTA label everywhere ("בדיקת דליפה חינם"). `lib/contact.ts` renders wa.me, tel and mailto only when env is set, and error copy never points to a missing channel.
  5. The root 404 is anonymous-aware (links `/` for visitors), uses marketing chrome and no nested interactive. A `(marketing)/not-found` exists.
  6. Motion: `rm-morph` has a ≥44 px pause and stops after 3 cycles. GSAP on showcase pages sits behind `matchMedia(no-preference)`.
  7. Every demo ends in a `ShowcaseEndCard` (T3 ₪ line + "התחילו פיילוט חינם"). UTM params are captured into `source` (≤120 chars).

### Wave-1 overlap ledger (shared hot spots and their single owner)
| Path | Owner in W1 |
|---|---|
| `app/dashboard/layout.tsx`, `nav.tsx`, `search.tsx`, `lib/nav/**`, `lib/roles.ts`, `LanguagePicker.tsx`, `admin/layout.tsx` | W1-03 |
| `middleware.ts`, `branch-switcher.tsx`, `chain/switch-button.tsx`, `lib/trpc/**`, `lib/net/**`, `errors.ts`, `RouteProgress*`, `packages/api/src/index.ts`, `check-soft-nav.mjs` | W1-04 |
| `app/layout.tsx` (root), `globals.css`, `tailwind.config.ts`, `ui-tokens`, `translate.ts`, `CookieConsent.tsx`, `apps/web/package.json`, lockfile | W1-01 |
| `packages/api/src/routers/receiving.ts`, `receiving/page.tsx` | W1-05 · `receiving/[poId]/**` and `lib/pwa/**` (minus `PwaQueueReset.tsx`) → W1-06 |
| `cross-tenant.attack.test.ts`, `routers/approvals.ts`, `notifications/templates.ts` | W1-07 |
| `lib/components/views/**`, `ask/offline.ts`, `lib/activeRestaurant.ts`, `suppliers/[id]/leak-card*` | W1-08 |
| `showcase/receiver/{_steps,_state,_mock}` → W1-06; rest of `showcase/**` → W1-12 | |
| `lib/components/{table,desk}` W1-02 · `hero` W1-05 · `flags` W1-07 · `Breadcrumbs`, `PageHeader` W1-03 | |

---

## 3. Wave 2: adopt the system, close the money loop, desk efficiency (14 agent + 4 human-PR packages)

**Merge order:** W2-01 (human) first; the other packages then rebase. H-01, H-02 and H-03 run in parallel and are path-disjoint. Every wave-2 package converts its own area's money to `<Money>`, its tiles to `MetricTile`, its lists to `DataTable` and its states to the v2 primitives (DoD-4/5), with lint in warn mode (W2-15).

### W2-01 · COVERAGE manifest fragments (enabler)
- **Owner:** test-sentinel · **Device:** both · **Effort:** S · **humanPR:** **yes** (restructures the immutable manifest; it is not weakened)
- **Paths:** `packages/api/src/__tests__/cross-tenant.attack.test.ts`; new `packages/api/src/__tests__/coverage/index.ts`.
- **Findings:** enabler for every wave-2/3 package that adds a procedure (DoD-8).
- **Acceptance:** `COVERAGE = { ...base, ...fragments }`, where fragments are loaded with `import.meta.glob('./coverage/*.ts', { eager: true })`. No entry is removed or downgraded, and the completeness test still fails for an undeclared procedure (a negative test proves it). A README states that each package owns `coverage/<package-id>.ts`.

### W2-02 · Invoice register, invoice cockpit and intake
- **Owner:** web-feature-engineer (tenant-security-warden) · **Device:** desktop · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{invoices,inbox}/**`; `apps/web/app/scans/**`; `apps/web/app/showcase/dashboard/invoices/**`; new `apps/web/lib/components/{invoice,documents}/**` (ported `InvoiceScanViewer`, `InvoicePoCompareViewer`, audit timeline, `DocumentFlow`); `apps/web/lib/nav/routes/{invoices,inbox}.ts`; `packages/api/src/routers/{invoices,ingest}.ts`; `packages/api/src/__tests__/coverage/W2-02.ts`, `invoices-*.test.ts`, `ingest.attack.test.ts`; `apps/web/lib/i18n/messages/{invoices,ingest,scans}/**`; `apps/web/e2e/consolidated.spec.ts`, `apps/web/e2e/W2-02.spec.ts`.
- **Findings:** exec-desktop-02, -13; approvals-31, -32, -33, -34, -35, -36, -37, -38, -39, -40, -41, -42, -43, -44, -45, -46, -47, -48, -49 (agent part), -50, -51, -53; ia-nav-13, -23; functional-flows-07 (bookkeeper can approve intake and correct OCR), -10 (invoice node), -17 (invoice action); a11y-10 (inbox); perf-states-19 (inbox).
- **Acceptance:**
  1. `/dashboard/invoices` is a DataTable register with tabs and counts: לבדיקה · ממתינות לשיוך (T4) · הותאמו · בהשהיה · שולמו · ללא מספר הקצאה · נכנסות (today's inbox). Columns: date, supplier, number (`<Token>`), ₪, due date, ₪ gap, status chip, allocation ✓/✗. Totals row; `?sel=` split pane.
  2. `invoices.detail` returns status, PO and GR refs, and lines joined to their discrepancies (expected with source, actual, Δ, tolerance).
  3. The `[invoiceId]` cockpit at ≥1024 is a 44/56 split with the document at the start edge (zoom 50–400 %, rotate, thumbnails) beside a three-way table (הוזמן · התקבל · חויב · מחיר צפוי (מקור, תאריך) · מחיר בחשבונית · פער ₪). Flagged lines are expanded with the W1-07 verbs, with a sticky "החלט על N פערים · ₪X" and a `DocumentFlow` strip.
  4. OCR editing becomes an explicit "ערוך נתוני סריקה" mode that re-matches automatically and shows the ₪ before → after. A live reconciliation line reads "שורות = לפני מע״מ ✓ · מע״מ 18% ✓", taking the VAT rate and tolerance from the engine.
  5. Phone: a "מסמך | שורות" segmented control and line cards (no clipped ₪).
  6. The breadcrumb follows `?from=`; the title is "MF-24950 · דגי הים התיכון"; `[` and `]` step through the originating queue.
  7. Intake: image/PDF previews through `ingest.documentPreview` (short-lived signed URL; PDFs in a sandboxed iframe). Bulk "פענח N". Inline post-OCR outcome. Revoke goes through a ConfirmDialog with error handling. Clipboard copy is honest. Channels and allow-list move to settings links.
  8. `/scans/[id]` is a minimal original view with "← חזרה לחשבונית" and a scan role rule that mirrors invoices (no chef).
  9. The bookkeeper can approve intake documents and correct invoice headers and lines (`financeProcedure`), with COVERAGE and attack tests.

### W2-03 · A pay run that ends: due dates, mark paid, holds, short-pay view
- **Owner:** web-feature-engineer (leak-economist and matching-engine-guardian sign off the claims rule) · **Device:** both · **Effort:** M · **humanPR:** no (`paid_at` columns come later via H-03; until then the audit row carries them)
- **Paths:** `apps/web/app/dashboard/approvals/pay-run/**`; `apps/web/lib/nav/routes/payRun.ts`; `packages/api/src/routers/payRun.ts`; `packages/api/src/lib/claims.ts`; new `packages/api/src/lib/dueDate.ts`; `packages/api/src/__tests__/{payrun.attack.test.ts,claims.test.ts}`, new `payrun-*.test.ts`, `coverage/W2-03.ts`; `apps/web/lib/i18n/messages/payRun/**`; `apps/web/e2e/W2-03.spec.ts`.
- **Findings:** approvals-21, -22, -23, -24 (agent part), -25, -26, -28, -29 (remittance PDF), -30; functional-flows-04 (agent part), -17 (hold); exec-desktop-03 (pay run), -08 (pay run batch).
- **Acceptance:**
  1. `computeDueDate(invoiceDate, supplier.paymentTerms)` handles שוטף+N, מזומן and an explicit due date. Unknown terms show "אין תנאי תשלום · הגדר".
  2. All unpaid checked invoices, bucketed באיחור / השבוע / שבוע הבא / מאוחר יותר. The invoice due in 3 days (MF-24950) is visible by default. "לפי חודש חשבונית" stays as a filter.
  3. DataTable with checkboxes. Held and duplicate rows can't be selected and show the reason as text. A sticky bar reads "נבחרו N · ₪X כולל מע״מ · [סמן כשולם…] [ייצוא]". `payRun.markPaid` and `unmarkPaid` write `status='paid'` plus an audit row (`paidOn`, method, reference). Undo lasts ≥10 s.
  4. The claims rule changes so paid invoices keep their accepted claims (letters and recovery are unaffected; unit test). "נתפס" is measured at decision time.
  5. Held rows read "ממתין להחלטת: בעלים · 4 ימים · ₪100.00 במחלוקת מתוך ₪4,513.15", with "החלט" (opens `/dashboard/approvals?invoice=`) or "שלח תזכורת" (in-app). Rows missing an allocation number are held ("חסר מספר הקצאה · ₪VAT · בקש מהספק").
  6. Phone: a one-line summary, held rows first with inline decisions, then a compact payable list. A per-supplier remittance PDF lists deductions with claim refs. The zero-credit KPI becomes a calm sentence. One page primary.

### W2-04 · Approvals desk: invoice-level 3-pane, bulk, keys, history, notification landing
- **Owner:** web-feature-engineer (tenant-security-warden) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/approvals/**` **except** `pay-run/**` (adds `approvals/[invoiceId]/**`); `apps/web/lib/nav/routes/approvals.ts`; `packages/api/src/routers/approvals.ts`; `apps/worker/src/jobs/{matchInvoice,endOfDayReport}.ts` (deep links only; recipient routing is H-05); `packages/api/src/__tests__/approvals-*.test.ts`, `coverage/W2-04.ts`; `apps/web/lib/i18n/messages/approvals/**`; `apps/web/e2e/W1-07.spec.ts`, `apps/web/e2e/W2-04.spec.ts`.
- **Findings:** approvals-02, -09, -10, -12 (links); functional-flows-03 (escalate notification), -05 (claim created at decision time); exec-desktop-05, -07, -08, -14 (approvals); ia-nav-09 (approval links).
- **Acceptance:**
  1. Cards are grouped by invoice ("משקאות שטיינברג · ST-24108 · ₪104.80 בסיכון · 1 פער"). A group-level primary appears only when every line is non-block, the viewer can act on all of them, and the group is under the cap.
  2. At ≥1536: 3 panes (list 380 | document | decision 400). At 1280–1535: 2 panes. Keys per R-9 (`1/2/3 J/K X Z Enter O ?`), bound by `code` and active only while the list has focus. `?sel=` in the URL. Target: ≥10 rows at default density and ≥15 compact at 1440×900.
  3. `approvals.decideMany` enforces the block rule and the ₪200 cap server-side (attack test). BatchBar reads "נבחרו N · ₪X". One audit row per item. 10 s undo.
  4. A "הצג ראיות" peek (480 px desktop, 85 vh sheet on mobile) holds the scan crop and the PO, GR and invoice lines, with the decision buttons inside.
  5. A "היסטוריה" disclosure shows the last 3 audit rows. "העבר לבעלים" opens a sheet with note chips. The escalation writes activity plus an owner notification through the existing `enqueueNotification` (no `outbox.ts` change).
  6. `/dashboard/approvals/[invoiceId]` is the mobile landing for push and e-mail: a thumb card, a sticky 50/50 48 px pair and the next card slides up. Notification links use `/dashboard/go?r=&to=/dashboard/approvals?invoice=<id>`.
  7. A claim is created inside the approve transaction, so `claimed_at` equals decision time (test). Cards show the age and due-date countdown in H8 tones.

### W2-05 · Receiving 2: walk-in deliveries, multi-page capture, exceptions with evidence, outbox, desktop tower
- **Owner:** ocr-procurement-engineer (tenant-security-warden) · **Device:** both · **Effort:** L · **humanPR:** no (line order columns come via H-03; interim sort here)
- **Paths:** `apps/web/app/dashboard/receiving/**`; `apps/web/app/showcase/receiver/{_steps/**,_state.ts,_mock.ts}`; `apps/web/lib/pwa/**`; `apps/web/app/receiver-sw.js/**`; `apps/web/lib/nav/routes/receiving.ts`; `packages/api/src/routers/{receiving,scans}.ts`; `packages/api/src/receiving/**`; `packages/api/src/__tests__/receiving*.test.ts`, `dock-slip*.test.ts`, `coverage/W2-05.ts`; `apps/web/lib/i18n/messages/{receiving,dockPrice,receiverLangs}/**`; `apps/web/e2e/{receiving-review,dock-slip}.spec.ts`, `apps/web/e2e/W2-05.spec.ts`.
- **Findings:** receiving-02 (resume at review), -03 (multi-page), -04, -07 (sheet, photos, driver), -09, -12 (interim sort), -17 (agent part), -19, -20, -21, -28, -32 (decision-gated), -33; mobile-field-02, -04; functional-flows-03 (dock exception), -06, -11, -19 (dock line display); perf-states-11 (XHR progress).
- **Acceptance:**
  1. Walk-in: "ספק הגיע בלי הזמנה" (FAB plus empty-state CTA) → supplier chips → that supplier's recent items → Delivery Check → GR plus a retro PO (`po_source='manual'`, note "קבלה ללא הזמנה"). The PO is priced from catalog, contract or last price, never from the invoice. The manager confirms in the UI. `receiving.startWalkIn` has COVERAGE.
  2. Multi-page capture: a page loop ("+ עמוד" / "סיימתי · שלחו 3 עמ׳"), a thumbnail strip (retake, delete, reorder), per-page upload under one `clientUploadId`, and a server merge to one PDF with `pdf-lib` (already a dependency). The invoice row and dedupe stay single-document. A determinate XHR progress bar.
  3. Document chip: חשבונית מס / תעודת משלוח / זיכוי, defaulted from history. A delivery note is stored on the GR (photos + "ת״מ <n>"), never as an invoice.
  4. ✗ on a line opens the exception sheet: reason chips, qty stepper or keypad, a 48 px rear-camera photo into `gr_lines.photos` (absolute auth-gated URL) and a note. Finish asks "זיכוי / החלפה" and the driver's name (optional signature canvas). The slip is offered only after the count, full screen at ≥16 px. Each share is logged in `activity_events`. A short or rejected line notifies the manager (existing `enqueueNotification`).
  5. An IndexedDB outbox (`lib/pwa/outbox.ts`) carries typed mutations with idempotency keys (`grLine`, `submitReceipt`, `photo`, `slipShared`), backoff and a header chip ("⟳ 3 ממתינים") opening per-item status. Today's POs are precached, so the wizard renders with zero bars (airplane-mode e2e: a 12-line receipt survives a reload and syncs exactly once).
  6. Resume at review via `receiving.receiptInvoice` (no re-shoot, no second OCR charge). The supplier's confirmed quantity shows on the line ("הספק הודיע: 6").
  7. Desktop: a receipts DataTable with date navigation, status, receiver, ₪ ordered, exceptions ₪, invoice status and slip-sent. A row opens a split-pane receipt detail (image | lines ordered/billed/received/Δ₪ | evidence and timeline). Polls every 30 s while visible.
  8. Chef can receive, behind an owner-decided restaurant setting (registry route rule + `receiverProcedure`). Optional °C entry on chilled lines.

### W2-06 · Orders 2: order guide, cut-off board, send from my WhatsApp, chef requests, supplier changes
- **Owner:** web-feature-engineer (tenant-security-warden) · **Device:** mobile · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/orders/**`; `apps/web/lib/nav/routes/orders.ts`; `packages/api/src/routers/orders.ts`; `packages/api/src/orders/**`; `packages/api/src/__tests__/order*.test.ts`, `coverage/W2-06.ts`; `apps/web/lib/i18n/messages/orders/**`; `apps/web/e2e/W1-11.spec.ts`, `apps/web/e2e/W2-06.spec.ts`.
- **Findings:** orders-01, -03, -04, -09, -10 (agent part), -11, -14, -15, -17, -18, -19, -21; ia-nav-14; mobile-field-08, -09; functional-flows-07 (chef requester), -12, -19 (order display); exec-desktop-06 (orders table).
- **Acceptance:**
  1. `orders.orderGuide` (manager tier, or chef if decided) derives rows from the last 8 POs (no schema): `usualQty` is the median of the last 4, plus `lastQty`. Rows are grouped by category and storage area, with a ghost "בד״כ 5", "כמו בפעם הקודמת" with undo, 48 px steppers and a kg keypad. A routine 10-line order takes ≤9 taps and ≤45 s with no keyboard (e2e timer).
  2. `orders.supplierBoard` (batched) replaces the select: 72 px rows sorted by next cut-off, with chips "נסגר בעוד 2:15" (warn ≤3 h, danger ≤30 min) and "הזמנה אחרונה: לפני 3 ימים · ₪875". The SENT step offers "הבא בתור".
  3. `orders.markSentManually` opens wa.me with the exact document text synchronously from the tap, then flips draft → sent ("נשלחה ידנית בוואטסאפ"). It is the default when the plan lacks `whatsapp_alerts`.
  4. `orders.createDraftRequest` (chef) leads to "שלח למנהל לאישור". The manager list gets a "ממתינות לשליחה (2)" section with one-tap send. A WhatsApp share from any role lands as a request, never a 404.
  5. Detail: an object header with a state-driven primary (שלח / קבל סחורה / ראה פערים ₪), a 3-way table הוזמן · התקבל · חויב · פער ₪, the supplier's answer shown as a diff ("הספק שינה 2 שורות") and the timeline "נשלח 09:00 · ענה 09:40". `orders.addOrderLine` and `productId` mapping on drafts; amend before cut-off.
  6. Desktop list: DataTable with saved-view tabs and counts (דורש טיפול · מגיע היום · באיחור · טיוטות · השבוע), search by supplier, #ref or product, a Σ footer and bulk send. Phone: day groups (היום/מחר/השבוע), relative dates, an inline action per state and a 56 px FAB. Capture: clipboard paste, inline product mapping with suggestion and basis, sticky confirm.

### W2-07 · Inventory count as a field instrument, with an audited denominator
- **Owner:** web-feature-engineer (tenant-security-warden for `setSales`) · **Device:** mobile · **Effort:** M · **humanPR:** no (shelf order, count units and submitted status are in H-04)
- **Paths:** `apps/web/app/dashboard/inventory/**`; `apps/web/lib/nav/routes/inventory.ts`; `packages/api/src/routers/inventory.ts`; `packages/api/src/inventory/**`; `packages/api/src/__tests__/inventory*.test.ts`, `coverage/W2-07.ts`; `apps/web/lib/i18n/messages/inventory/**`; `apps/web/e2e/inventory.spec.ts`, `apps/web/e2e/W2-07.spec.ts`.
- **Findings:** foodcost-01, -02, -03, -04 (agent part), -05, -06, -07 (notify interim), -08, -09, -19, -20 (decision-gated), -22 (inventory), -24, -25, -35 (inventory); mobile-field-10; a11y-06 (count); perf-states-03 (inventory).
- **Acceptance:**
  1. `inventory.setSales` is manager tier with `recordAudit('inventory.sales_set')`. The chef sees sales read-only or as % only. PeriodCard shows "הוזן ע״י <name> · <date>".
  2. Food and total stock are both labelled everywhere ("מלאי מזון ₪9,490.66 · כולל בר ומשקאות ₪13,474.xx") at one precision. Bar lines are tagged "לא נכנס לעלות המזון".
  3. Field shell:
     - A sticky area header ("מקרר · 7/17 · ₪1,240") and an area chip bar with completion rings.
     - Enter/Next jumps to the next uncounted qty, then to the next area (0 navigation taps per line).
     - The area select leaves the row ("סידור אזורים" mode).
     - A "חפש בספירה" field, a date chip and a 56 px field.
  4. Each line shows "בפעם הקודמת 8 · התקבלו 6", muted and never prefilled. An instant guard fires at >2×, <50 % or >₪2,000 per line ("999 תבניות = ₪33,966 — נכון?"). Finish stays blocked until flags are resolved, and the panel lists flags as jump links.
  5. The chef gets "סיימתי לספור · שלח לסגירה", which notifies the manager and adds a Needs-you card. Discard and amend use a Sheet/ConfirmDialog with reason chips and the ₪ before → after.
  6. A visible outbox chip ("↑ 3 ממתינים · נשמר במכשיר") with retry and backoff. Finish shows the flush reason inline.
  7. The closed-count detail is a DataTable with Δ vs the previous count, area subtotals, "לא נספר (N)" and amend in the row menu. Bookkeeper read-only access if decided (registry route rule + read procedures with COVERAGE).

### W2-08 · Task spine and homes v2: one "מחכה לך" queue, nav badges, bell
- **Owner:** web-feature-engineer · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{page.tsx,home/**,vat-at-risk.tsx,activity.tsx,nav.tsx,layout.tsx,not-found.tsx}`; `apps/web/lib/nav/**` **except** `routes/*` owned by other W2 packages; `apps/web/lib/components/{hero,notifications}/**`; `packages/api/src/routers/{tasks,nav}.ts`; new `packages/api/src/tasks/**`; `packages/api/src/__tests__/coverage/W2-08.ts`, `tasks*.test.ts`; `apps/web/lib/i18n/messages/{overview,nav}/**`; `apps/web/e2e/{nav-fit,role-switch,demo-path}.spec.ts`, `apps/web/e2e/W2-08.spec.ts`.
- **Findings:** functional-flows-09; ia-nav-08 (`whereIs`), -17, -19; exec-desktop-20 (data); command-02 (rest), -25, -29; design-system-09 (adoption).
- **Acceptance:**
  1. `tasks.mine({role})` (computed, no table) returns `{type, entityId, title, ilsAgorot, tier, due, verb, deepLink}` for the 15 task types in functional-flows-09. Ranked by ₪ × urgency, scoped to the viewer.
  2. Homes render from `tasks.mine`; inbox zero is one T3 line. `nav.badges` (staleTime 30 s, refetch on focus and every 60 s) feeds sidebar and bottom-bar badges: ₪ for money items, counts for capture items, danger only when a block exists, hidden at 0, 99+ cap, aria-label "אישורים, 4 פריטים, ‏296 ₪ בסיכון".
  3. A bell (360 px popover / sheet) reads the same source plus T3 news. Items deep-link to the exact card. "Seen" lives in localStorage (server seen-state is H-04).
  4. The hero and tiles use `LeakHero`, `<Money>` and `MetricTile` (no mono, no 11 px). The secondary KPIs fold into a completeness line. The price-alert teaser shows the top alert with ₪/month and is T2 only at ≥3 % and ≥₪50/month.
  5. The in-shell 404 asks `nav.whereIs({kind,id})` and offers "שייך ל<branch> · פתח שם" (COVERAGE + attack test).

### W2-09 · Leak evidence and drill: every ₪ explains itself and opens its rows
- **Owner:** web-feature-engineer (matching-engine-guardian owns the `packages/charts` changes: additive evidence fields only, no ₪ definition changes) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/leaks/**` **except** `claims/**`; `apps/web/app/dashboard/suppliers/[id]/{leak-card/**,leak-card-view.tsx,leak-card-data.ts,leak-card-logic.ts}`; `apps/web/lib/components/{views,drill,flags}/**`, `LeakHeatmap.tsx`; `packages/charts/**`; `packages/api/src/routers/owner.ts`; `apps/web/lib/nav/routes/leaks.ts`; `apps/web/next.config.ts` (308 redirects); `packages/api/src/__tests__/coverage/W2-09.ts`, owner and charts tests; `apps/web/lib/i18n/messages/{leaks,leakProof,views}/**`; `apps/web/e2e/supplier-leak-card.spec.ts`, `apps/web/e2e/W2-09.spec.ts`.
- **Findings:** leaks-02, -09, -12, -13, -20, -25, -26, -27, -29, -30, -33; SUP-02 (complete); exec-desktop-01, -10, -19; a11y-19; ia-nav-12 (phase 2).
- **Acceptance:**
  1. `computeLeakBreakdown` adds `tolerance_used`, line qty and unit, the PO number and GR (delivery-note) number, and the expected source and date. Charts tests cover the new fields, and the leak canary is untouched and green.
  2. `WhyLine` on breakdown lines, proof findings, the supplier leak card and the approvals card: "חויב ₪149.00 × 10 ק״ג · בהזמנה ₪139.00 · הפרש ₪100.00 · סף: …". The source label is truthful (order PO-123 vs historical p90), and compact density keeps the math on one line.
  3. `DrillLink` (`data-drill-total` in agorot) on every hero tile, KPI, bar, heatmap tile and report row. The landing headers echo the same ₪. An e2e clicks every `[data-drill]` and asserts equality to the agora.
  4. The leak hub has URL tabs סקירה · פירוק · הוכחה · מגמת מחירים · דוח. Old URLs 308 to them, and every sub-page's up-link points to the hub. Breakdown groups "עוד לא שולם — אפשר לעצור (₪296)" and "שולם — לדרוש זיכוי (₪463.54)" as a dense sortable DataTable with a 480 px peek. The CTA follows invoice state.
  5. `leakDrivers` (charts) returns the top 3 contributors to Δ; DrillLink chips sit under the hero delta and on the report.
  6. Report export is a 3-sheet XLSX/CSV, plus a line-level breakdown CSV with the WhyLine fields. `m` and `month` params 308 to `p`. Phone: hero + up to 3 act-now cards + top-5 rows with a 56 px thumb CTA.

### W2-10 · Claims composer (phase 1) and recovery desk
- **Owner:** web-feature-engineer (leak-economist) · **Device:** both · **Effort:** M · **humanPR:** no (server send and the supplier portal are H-06)
- **Paths:** `apps/web/app/dashboard/leaks/claims/**`; `apps/web/app/dashboard/recovery/**`; `apps/web/lib/nav/routes/{claims,recovery}.ts`; `packages/api/src/routers/recovery.ts`; `packages/api/src/recovery/**`; `packages/api/src/__tests__/recovery*.test.ts`, `coverage/W2-10.ts`; `apps/web/lib/i18n/messages/recovery/**` (claims strings migrate here; `leaks.claims.*` keys are not deleted until W4-01); `apps/web/e2e/W2-10.spec.ts`.
- **Findings:** chain-05, -06, -09, -10, -26, -27; copy-rtl-14; leaks-06 (composer); functional-flows-05 (phase 1).
- **Acceptance:**
  1. One draft per supplier merges unpaid and paid lines, with evidence auto-attached (delivery-note photo, invoice crop, contract). The preview shows exactly what the supplier gets (PDF + WhatsApp text). Send hands off via wa.me or mailto with a 10 s "בטל שליחה". `letter_sent` is set only on confirm.
  2. The letter line template reads "{פריט} · {כמות} {יח׳} · חויב ₪{billed} ליח׳ במקום ₪{agreed} שסוכם (הזמנה {po}, ת״מ {dn}, {date}) = ₪{delta}". Subject wording follows owner decision D-3. The closing asks for a חשבונית זיכוי by a date.
  3. Recovery split view: suppliers ranked by owed ₪ × days overdue | a supplier dossier grouped by next action (לשליחה · ממתין לספק · במחלוקת · זוכה — לאשר קיזוז) with counts and ₪. URL state `?tab=&s=`. Sortable.
  4. `recovery.history` returns actor name and role. The peek shows claim math, invoice links, dock evidence and the timeline (dd.MM.yyyy HH:mm Asia/Jerusalem). Exports include history.
  5. Credit form: a "כולל מע״מ / לפני מע״מ" segmented control with no default. Conversion is server-side in agorot with half-up rounding at the supplier/restaurant VAT rate. A running remainder "נבחר ₪X מתוך ₪Y · הפרש ₪Z" shows ✓ at 0. Unallocated balance persists on the supplier row.
  6. A claim settled through a credit line on a paid invoice auto-advances to recovered ("קוזז בחשבונית X ששולמה 12.11"). Bulk "אשרו קיזוז/החזר" goes through a ConfirmDialog and blocks or confirms when `outstanding > 0`.
  7. Optimistic rows with inline errors; claims are synced once per request. Period filter on claimed, credited and recovered; CSV/XLSX; a per-supplier "דף דרישות" PDF; pagination "200 מתוך 340".

### W2-11 · Supplier 360, vendor table and the bookkeeper's ledger
- **Owner:** web-feature-engineer · **Device:** both · **Effort:** L · **humanPR:** no (bank details and the change alert are H-03)
- **Paths:** `apps/web/app/dashboard/suppliers/**` **except** `[id]/leak-card*`; `apps/web/lib/nav/routes/suppliers.ts`; `packages/api/src/routers/suppliers.ts`; `packages/api/src/ledger/**`; `packages/api/src/__tests__/supplier*.test.ts`, `coverage/W2-11.ts`; `apps/web/lib/i18n/messages/suppliers/**`; `apps/web/e2e/supplier-ledger.spec.ts`, `apps/web/e2e/W2-11.spec.ts`.
- **Findings:** SUP-01, -03, -04, -05, -06, -07, -14 (decision-gated), -15, -16 (ledger), -18, -19, -20, -21, -22, -23, -24 (agent part), -25, -26, -27, -28, -29 (suppliers), -34, -35.
- **Acceptance:**
  1. A default "סקירה" tab:
     - The header shows one "דליפה · 90 יום" ₪ (same source as the leak tab) plus [WhatsApp] [חיוג] [הזמנה חדשה].
     - An act-now row of up to 3 ₪-ranked cards.
     - A rhythm line "הזמנה עד ב׳ 12:00 (בעוד 2:10) · משלוח ג׳ 09:30".
     - A 6-month spend sparkline, price movers with ₪/month and the last 5 invoices.
     - Tabs reduced to 5.
  2. At ≥1024 the list is a DataTable with sortable columns (רכש החודש ₪ · דליפה ₪ desc default · מעל חוזה ₪ · פתוח לדרישה ₪ · משלוח הבא · תנאי תשלום), a totals row and split detail. Scorecards fold into columns.
  3. Phone: cards sorted by "מגיע היום" and soonest cut-off, with 48 px [WhatsApp][חיוג][הזמנה] and an 85 vh peek sheet. Numbers render as `bdi`, and all contacts are tel/wa.me/mailto links.
  4. Ledger: compact 36 px rows with totals row and column, sortable, `?from&to` up to 24 months, exception-only chips ("כל התעודות חויבו" replaces "מותאם"), and an open-month eyebrow. A cell opens a 520 px drawer (`SupplierLedgerTable`, `?sup&m`) inside the ledger route with no role bounce. The CSV has all columns.
  5. Bookkeeper read-only supplier hub (registry rule; writes stay manager). Receiver ledger access follows owner decision D-6 (procedure tier + `supplier-ledger.db.test.ts`).
  6. Forms: ח״פ check digit and duplicate warning, a structured payment-terms picker, a merged "ימים ושעות" section with a sentence summary, a dirty guard, a sticky save bar on mobile, a 24 h time picker, deactivate in ⋯ with undo and inactive suppliers shown at full contrast.

### W2-12 · Contracts and price intelligence: one ₪ queue
- **Owner:** web-feature-engineer (leak-economist) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/contracts/**`; `apps/web/lib/nav/routes/contracts.ts`; `packages/api/src/routers/{contracts,priceAlerts}.ts`; `packages/api/src/{contracts,priceAlerts}/**`; `packages/api/src/__tests__/{contracts,price-alert}*.test.ts`, `coverage/W2-12.ts`; `apps/web/lib/i18n/messages/contracts/**`; `apps/web/e2e/W2-12.spec.ts`.
- **Findings:** SUP-08, -09, -10, -11 (agent part), -12, -13, -16 (contracts), -29 (contracts), -30, -31, -32; leaks-19; command-14 (basis on contracts and alerts).
- **Acceptance:**
  1. The first tab, "לטיפול", merges over-contract lines and price alerts into one ₪-ranked queue under "₪152.50 חויבו מעל החוזה · 2 שורות · 1 התראת מחיר". Clean state: "כל החשבוניות ב-90 יום תאמו את החוזה ✓".
  2. Each card has the math "₪149.00 − ₪139.00 = ₪10.00 × 10 ק״ג" and `PriceMove` with its basis. Primary: [הוסף לדרישת זיכוי · ₪X] when a discrepancy exists, otherwise a manual wa.me request. ⋯ offers [עדכן מחיר חוזה] (new `valid_from`, undo) and [דחה ▾ reason chips].
  3. Alerts show "≈₪212 בחודש (הערכה)". T2 only at ≥3 % and ≥₪50/month, otherwise T4. Thresholds get a ₪ floor and a live preview "4 התראות ב-90 יום".
  4. Contract entry: text `inputMode=decimal`, a product combobox, "מחיר אחרון בחשבונית ₪96.00 (20.10) · חציון 90 יום ₪91.40" and "נעל מחירים נוכחיים כחוזה".
  5. Import has a "בדיקה" diff step (current · new · Δ% · ₪/month, chips, per-row exclude, effect-named commit) and one merged supplier + file step.
  6. Lists are grouped by supplier with expiry chips. Phone cards. ConfirmDialog instead of `window.confirm`. No `<bdi dir=ltr>` around ₪.

### W2-13 · Copy system: glossary-as-code, bidi isolation, server copy into i18n
- **Owner:** rtl-design-steward (with web-feature-engineer; test-sentinel owns the gate test) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/lib/i18n/translate.ts`; new `apps/web/lib/i18n/glossary.ts`; `apps/web/lib/i18n/__tests__/**`; `apps/web/lib/i18n/messages/index.ts`; `apps/web/lib/i18n/messages/{emails,components,common}/**`; `apps/web/lib/components/{ActivityFeed.tsx,activityText.ts}`; `apps/web/lib/messageTemplates.ts`; `packages/api/src/notifications/templates.ts`; `packages/api/src/match/persist.ts`; `apps/worker/scripts/seed-demo.ts` (activity metadata); `packages/api/src/__tests__/email*.test.ts`.
- **Findings:** copy-rtl-02, -03, -04, -05, -06, -07, -08, -09, -12, -13, -15, -16, -17, -18, -19, -20; command-15, -27; auth-19 (e-mails); leaks-15.
- **Acceptance:**
  1. `glossary.ts` holds `{concept, he, en, define, retireHe[], retireEn[], allow[]}` for the leak, the base, the funnel states (נמצא · נדרש · זוכה · הוחזר · פתוח · במחלוקת · ויתור), the document names (per D-1), פער (per D-2), קבלת סחורה, ת״מ, ח״פ and the role names. It also feeds "מה זה?" popovers.
  2. A vitest walks `ALL_NAMESPACES` and reports retired terms, masculine-imperative first words, slash forms, `{count}` without plural, quotes or signs next to placeholders, `...` or emoji, ASCII quotes in Hebrew abbreviations, and English tokens (PO, OCR, stub, Webhook) in `he`. It runs in **warn** mode with a per-namespace report; it becomes an error in W4-01.
  3. `interpolate()` wraps values in FSI/PDI by default, with opt-out for file names and CSV keys. A `stripIsolates()` test helper keeps existing tests green. Lab I ("Coca-Cola Ltd.") renders correctly.
  4. Activity renders from metadata in both locales. `persist.ts` and the seed write metadata only, and the Hebrew reverse-parser is deleted. Grouped per object, actor chip, relative time.
  5. All e-mail subjects and bodies move into `messages/emails/{he,en}` with plurals (no "1 ימים"), plural address and no emoji. The weekly subject reads "{week}: נמצאו ₪{x} בפערים · ₪{y} עוד פתוחים". `outbox.ts` and `cron.ts` are untouched.

### W2-14 · Admin trust: visible rules, guarded roles, honest exports
- **Owner:** web-feature-engineer (tenant-security-warden for roles) · **Device:** desktop · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{settings,team,exports,integrations}/**`; `apps/web/lib/nav/routes/{settings,team,exports,integrations}.ts`; `packages/api/src/routers/{settings,team,integrations,exports}.ts`; `packages/api/src/exports/**`; `apps/web/lib/growth/ReferralCard.tsx`; `packages/api/src/__tests__/{settings,integrations,exports}*.test.ts`, `coverage/W2-14.ts`; `apps/web/lib/i18n/messages/{settings,team,accounting,integrations}/**`; `apps/web/e2e/W2-14.spec.ts`.
- **Findings:** admin-01, -02, -04, -09 (interim), -10, -12, -13, -14, -15, -20, -22, -24, -25, -26, -29, -31, -32, -33, -37; perf-states-10, -14 (team and settings); orders-25.
- **Acceptance:**
  1. Settings show **effective** values with source chips "ברירת מחדל / הותאם". The server component reads `resolveTolerances` and `resolveApprovalThresholds` read-only, with no redefinition. `settings.update` accepts `null` to restore a default. Each group has a rule sentence. `recordAudit` runs on update and profile changes, with a history drawer. VAT is read-only with "שנה…".
  2. A role change is staged ("שינוי: ‹ישן› ← ‹חדש› · [שמור] [בטל]"). Promotion to owner and downgrades go through a ConfirmDialog listing the permissions gained or lost. The own-row select is disabled. Result is shown inline. A role picker with descriptions and a "מה מותר?" matrix generated from the registry and procedure tiers.
  3. "אזור מסוכן": typed confirm, and a sole-owner path to ownership transfer. Team removal through ConfirmDialog; revoke has undo.
  4. Export copy states what is included. A persistent result panel ("הקובץ ירד · 42 חשבוניות · ⚠ 2 לא נכללו (פירוט) · ⚠ 3 שמות ספק עם תווים שהוחלפו") replaces toasts. Disputed invoices are counted before download. The status column is localised and gets a "₪ במחלוקת" column.
  5. Integrations: a mapping table ספק · ח״פ · כרטיס · מקור. No invented `S…` codes ("חסר ח״פ · הוסף"). The POS import confirms replacement ("יחליף נתונים של 01.10–15.10").
  6. One h1 per page. Per-route titles. Section index and dirty guard. Money and % inputs are text/decimal with adornments.

### W2-15 · DS adoption and primitive maintenance
- **Owner:** rtl-design-steward · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/lib/components/**` **except** `{invoice,documents,drill,views,flags,hero,notifications}/**`, `LeakHeatmap.tsx`, `ActivityFeed.tsx`, `activityText.ts`, `CookieConsent.tsx`; `packages/ui-tokens/**`; `apps/web/app/globals.css`; `apps/web/tailwind.config.ts`; `apps/web/eslint.config.mjs`; new `apps/web/scripts/ds-check.sh`; `apps/web/app/dashboard/lab/**`; `apps/web/package.json` + lockfile.
- **Findings:** design-system-02 (lint warn), -07 (retire shared duplicates), -14 (lint), -22; intake queue for primitive bugs raised by wave-2 packages.
- **Acceptance:** ESLint and `ds-check.sh` rules run in **warn** mode for font-mono outside `Token`, `dir=ltr` around money, arbitrary `text-[…]`, hex in TSX, semantic alpha tints, `transition-all`, glow/flow/glass in `/dashboard`, ungated `uppercase`/`tracking`, weak rings, `type=number|date`, local `Kpi|Stat|StatusBadge|SectionHeader|Segmented|Steps` functions and `variant=gold|accent`. A per-area warning count is published in the PR. Primitive fixes requested by W2 packages land here within the wave. The lab baseline is updated.

### Human-PR track, wave 2
- **H-01 · `formatIls` `signDisplay` option** (money-format-marshal; humanPR). **Paths:** `apps/web/lib/money.ts`, `apps/web/lib/__tests__/money*.test.ts`. **Findings:** design-system-24, copy-rtl-11, receiving-23, SUP-11, foodcost-17, chain-23, approvals-49. **Acceptance:** additive `signDisplay?: 'auto'|'exceptZero'|'never'`. Default output is byte-identical (snapshot of 200 values). In he, `exceptZero` renders the sign before the currency inside one isolate.
- **H-02 · Legal and consent** (growth-pmm-engineer drafts; counsel and the owner author; humanPR). **Paths:** `apps/web/app/(marketing)/{privacy,terms,cookies}/**`, `apps/web/lib/i18n/messages/marketing/legal.*`, `apps/web/lib/components/CookieConsent.tsx`, `apps/web/lib/cookieConsent.ts`. **Findings:** mkt-03, mkt-10, mkt-19 (identity), mkt-02 (coordinator content). **Acceptance:** named controller, privacy contact, dated versions, accurate sub-processors and no draft banner after counsel sign-off. No consent banner while only strictly-necessary cookies exist, plus a footer "הגדרות עוגיות" sheet.
- **H-03 · Schema batch A: money pipeline and notification plumbing** (drafted by web-feature-engineer; tenant-security-warden reviews RLS; humanPR). **Paths:** `packages/db/src/schema.ts`, a new migration (next number), `packages/db/drizzle/rls/0002_core_tenant_rls.sql` table list, shape tests. **Columns and tables:** `invoices.paid_at/paid_amount/payment_method/payment_ref`; `export_runs`; `consolidated_invoice_links`; `leak_month_snapshots` + `leak_month_corrections`; `recovery_claims.seq_no`; `restaurants.address/contact_phone`; `supplier_bank_accounts` + change audit; `suppliers.min_order_ils/delivery_fee_ils`; `po_lines.line_no`, `invoice_lines.line_no`; `supplier_catalog_items.effective_from`; `push_subscriptions`; `users.whatsapp_opt_in`; `notification_prefs`. **Findings:** approvals-21 (columns), admin-06, approvals-27/functional-flows-13 (table), leaks-17 (snapshot), leaks-08 (address and claim number), SUP-24, orders-33, receiving-12, catalog-10 (effective date), functional-flows-02 and mobile-field-13 (storage). **Acceptance:** `check-rls` passes for every new tenant table. A shape test exists per migration. No existing column changes meaning.

### Wave-2 overlap ledger
| Path | Owner in W2 |
|---|---|
| `cross-tenant.attack.test.ts` | W2-01 only; everyone else uses `coverage/<id>.ts` |
| `app/dashboard/{layout,nav,page,not-found}.tsx`, `home/**`, `lib/nav/**` core | W2-08 |
| `lib/nav/routes/<seg>.ts` | the package owning that route folder |
| `approvals/pay-run/**` + `routers/payRun.ts` + `lib/claims.ts` | W2-03 · `approvals/**` rest + `routers/approvals.ts` → W2-04 |
| `leaks/**` minus `claims/**`, `suppliers/[id]/leak-card*`, `packages/charts/**`, `routers/owner.ts`, `next.config.ts` | W2-09 · `leaks/claims/**`, `recovery/**` → W2-10 |
| `notifications/templates.ts`, `match/persist.ts`, `translate.ts`, `messages/index.ts` | W2-13 |
| `lib/components/**` (unassigned parts), `globals.css`, tokens, eslint, `apps/web/package.json` | W2-15 |
| `apps/web/lib/money.ts` · `schema.ts` · legal pages + `CookieConsent.tsx` | H-01 · H-03 · H-02 |
| `apps/worker/src/jobs/{matchInvoice,endOfDayReport}.ts` | W2-04 |

---

## 4. Wave 3: chain scope, kitchen, field platform, close and growth (12 agent + 5 human-PR packages)

### W3-01 · Branches as scope: "כל הסניפים", roll-up matrix, in-place drill
- **Owner:** web-feature-engineer (tenant-security-warden **mandatory**) · **Device:** desktop · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{chain,branches}/**`; `apps/web/app/dashboard/{branch-switcher.tsx,branch-actions.ts,layout.tsx,nav.tsx}`; `apps/web/lib/nav/**` core + `routes/{chain,branches}.ts`; `apps/web/app/dashboard/{approvals,invoices}/**` (branch column and filter only); `packages/api/src/routers/{chain,approvals,payRun,invoices}.ts`; `packages/charts/src/chain.ts`; `packages/api/src/__tests__/chain.attack.test.ts`, `coverage/W3-01.ts`; `apps/web/lib/i18n/messages/{chain,nav}/**`; `apps/web/e2e/W3-01.spec.ts`.
- **Findings:** chain-11, -12, -13, -14, -15, -16, -17, -18, -19, -20, -21, -22, -29, -30, -32, -39; exec-desktop-11; approvals-13; orders-32; SUP-33; ia-nav-08 (phase 3); command-12 (chain).
- **Acceptance:** A `b=all|<id>|g:<group>` URL scope with a rail chip that applies instantly (no reload). Approvals, pay run and invoices gain a "סניף" column and filter. Reads aggregate per membership inside `inBranch`. Writes run in the row's own `withRestaurant` after a membership check. RLS is untouched. Chain matrix: a pinned total row equal to the KPIs, ₪ awaiting, open claims ₪, recovered ₪, completeness, Δ and a sparkline. Every cell is a DrillLink or opens a 520 px branch peek. The heatmap runs newest next to the names (left = oldest). Names wrap and are not truncated to the shared prefix. Three states (no data T4 / pending / clean T3) with no emoji. Disparity rows offer "קבעו מחיר חוזה אחיד" (ConfirmDialog naming ₪ and branches) and "בקשו מהספק מחיר אחיד". Read-only chain scope for bookkeepers on chain accounts. Sections stream with per-branch error cards. "worst branch → its biggest item" is ≤2 clicks with 0 reloads (e2e).

### W3-02 · Recipe workbench, kitchen card and the food-cost control room
- **Owner:** web-feature-engineer · **Device:** both · **Effort:** L · **humanPR:** no (kitchen-card fields and waste come via H-04)
- **Paths:** `apps/web/app/dashboard/{recipes,inventory}/**`; `apps/web/lib/nav/routes/{recipes,inventory}.ts`; `packages/api/src/routers/{recipes,inventory}.ts`; `packages/api/src/{recipes,inventory}/**`; `packages/api/src/__tests__/recipes*.test.ts`, `coverage/W3-02.ts`; `apps/web/lib/i18n/messages/{recipes,inventory}/**`; `apps/web/e2e/W3-02.spec.ts`.
- **Findings:** foodcost-10, -11, -12, -13, -14, -15, -16, -17 (agent part), -18, -26, -27, -28, -29, -30, -31, -34; mobile-field-16; command-13.
- **Acceptance:** `recipes.preview` (no write) is debounced 250 ms, so plate cost, food %, margin and gap to target update live, with a share-of-plate bar. A "נסה בלי לשמור" sandbox. A sticky bottom summary on phone. An ARIA combobox for ingredients (keyboard pick focuses qty). A dense ingredient grid on desktop with the H1 = dish name. A role-branched recipes page (chef: dishes needing attention first). One food-cost glossary (בפועל = count-based; "עלות תאורטית לפי מכירות"; "ממוצע תפריט (לא משוקלל)", neutral). `PriceMove` old ← new everywhere, plus ₪/month impact and a "הצע מחיר תפריט" for crossings. Audited recipe history. The phone recipe defaults to a read-only service card with portion scaling (method and allergens once H-04 lands). Food-cost control room: period sparkline, a clickable equation (purchases → invoices, credits → claims, stock → counts), category split and top-10 unexplained usage.

### W3-03 · Installable app, push and field tools
- **Owner:** ocr-procurement-engineer (web-feature-engineer; tenant-security-warden for the share target) · **Device:** mobile · **Effort:** L · **humanPR:** no (provider credentials and routing are in H-05)
- **Paths:** `apps/web/lib/pwa/**`; `apps/web/public/pwa/**`; `apps/web/app/receiver-sw.js/**`; new `apps/web/app/dashboard/share/**`; `apps/web/app/dashboard/receiving/**`; `apps/web/app/showcase/receiver/{_steps/**,_state.ts,_mock.ts}`; new `apps/web/app/dashboard/settings/notifications/**`; new `apps/web/lib/components/field/**` (`ScanButton`, `MicButton`); `apps/web/package.json` + lockfile (self-hosted ZXing WASM ponyfill); `apps/worker/src/jobs/{dailyExpectations,supplierDelays}.ts`; `packages/api/src/routers/push.ts`; `packages/api/src/__tests__/coverage/W3-03.ts`; `apps/web/lib/i18n/messages/{receiving,common}/**`; `apps/web/e2e/W3-03.spec.ts`.
- **Findings:** mobile-field-12, -13 (agent part), -20, -21; ia-nav-10, -19 (app badge); functional-flows-02 (UI), -16 (agent part); receiving-36; admin-16 (UI).
- **Acceptance:** One app-wide manifest (`id` kept, `scope /dashboard/`, `start_url /dashboard?source=pwa`, shortcuts קבלת משלוח / ספירה / הזמנה חדשה / אישורים). `share_target` is a POST multipart accepting image/PDF and text, routed by role (file → invoice capture without PO; text → order capture or request). Never a 404. The install sheet appears after the 2nd completed task (Android `prompt()`, iOS 3-step coach), with no re-ask for 14 days, and calls `storage.persist()` after install. VAPID subscription UI per role and event. The SW push handler deep-links to the exact card. `setAppBadge(open T2)`. Permission is asked only from a gesture after a meaningful action. Mock providers report `skipped_no_provider`, never `sent`. The 06:00 job enqueues the receiver brief "3 משלוחים היום". ScanButton (BarcodeDetector or ZXing) jumps to the line in ≤400 ms on a Galaxy A14-class phone. MicButton (he-IL) always shows the transcript before any write. `DocumentFlow` on the receipt summary.

### W3-04 · Command palette, hotkeys, Ask everywhere and AI drafts
- **Owner:** web-feature-engineer (leak-economist for drafts) · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{search.tsx,searchOptions.ts}`; new `apps/web/lib/hotkeys.ts`, `apps/web/lib/components/palette/**`; `apps/web/app/dashboard/ask/**`; `packages/api/src/ask/**`; `packages/api/src/routers/{ask,search}.ts`; `packages/api/src/__tests__/{ask,search}*.test.ts`, `coverage/W3-04.ts`; `apps/web/lib/i18n/messages/ask/**`; `apps/web/e2e/W3-04.spec.ts`.
- **Findings:** ia-nav-04, -21; exec-desktop-09; command-17, -20; perf-states-16; functional-flows-15.
- **Acceptance:** Ctrl/⌘K (by `code`), `/` and the 🔍 open a 640 px palette. Sections in order: מחכה לך → מסכים (registry aliases he/en) → רשומות (role-filtered; `# @ >` prefixes; POs and recipes added to `search.global`) → פעולות (money moves only open their confirm screen) → שאלו. Frecency recents with no network at 0 characters. `normalizeHe` (wrong layout, finals, geresh, niqqud). G-chords within 1,000 ms; a `?` cheat sheet; Alt-hold hints; all inactive inside inputs. Ask: pinned composer, sessionStorage thread, `?q=` auto-submit, an interpreted-intent chip with "לא זו השאלה?", inline citations opening a peek, the ungrounded banner above the answer, streamed output with "עצור", and bookkeeper read-only. AI drafts are draft-only tools returning ids, labelled "טיוטה של RestoMatch" with basis and acceptance tracking. ₪ always comes from the engine or `lib/claims`, never the LLM. A kill-switch fires below 60 % acceptance.

### W3-05 · Month close and accountant desk
- **Owner:** web-feature-engineer (leak-economist) · **Device:** desktop · **Effort:** M · **humanPR:** no (`export_runs` from H-03)
- **Paths:** new `apps/web/app/dashboard/close/**`; `apps/web/app/dashboard/exports/**`; `apps/web/lib/nav/routes/{close,exports}.ts`; `packages/api/src/routers/{close,exports}.ts`; `packages/api/src/exports/**`; `packages/api/src/__tests__/exports*.test.ts`, `coverage/W3-05.ts`; `apps/web/lib/i18n/messages/accounting/**`; `apps/web/e2e/W3-05.spec.ts`.
- **Findings:** exec-desktop-03 (close); functional-flows-18; admin-04 (rest), -05, -06 (UI), -07, -29, -30; command-10 (checklist).
- **Acceptance:** A 6-step auto-ticking checklist (delivery notes invoiced · consolidated linked · allocation numbers · claims sent · pay run approved · export done), each with count, ₪, owner, due date and a verb. `exports.preview` shows count, ₪ including VAT, VAT, disputed, and excluded rows by reason with fix links, before download. One primary "ייצוא אוקטובר לחשבשבת" (remembered software). A logged run, period lock and "רק מה שחדש מאז". Multi-branch: a zip per branch (one file only when ח״פ is shared). "חבילה לרו״ח" zip. The he-IL range field and month stepper.

### W3-06 · Marketing growth: demo = product, pricing that sells ROI, mobile leak check
- **Owner:** growth-pmm-engineer · **Device:** both · **Effort:** L · **humanPR:** no (trial entitlements are H-10)
- **Paths:** `apps/web/app/(marketing)/**` **except** legal; `apps/web/app/page.tsx`; `apps/web/app/showcase/**` **except** `receiver/{_steps,_state,_mock}`; `apps/web/lib/heroMedia.ts`; `apps/web/public/media/**`; `packages/api/src/routers/leakCheck.ts`; `apps/web/lib/i18n/messages/{marketing,landing,showcase,leakCheck}/**`; `apps/web/e2e/W3-06.spec.ts`.
- **Findings:** mkt-11, -13, -14, -17, -20, -21, -22, -23, -29, -30; design-system-23 (showcase).
- **Acceptance:** The showcase dashboard renders the product's `LeakHero` and Needs-you from static fixtures, with one figure set across hero video, proof, showcase and calculator, each labelled "דוגמה". Pricing: "+ מע״מ" beside every price, Heebo tabular, plan-aware CTAs (`?plan=pro`, `source pricing:pro`), Pro preselected on phone, a compare table and FAQ on desktop, and the ROI calculator embedded. Leak check on phone: upload card first, thumbnails with ✕, determinate stages, the `LeakHero` result, and a login prefilled from the check. Product page split from About. The legible HeroMatch on desktop; a 9:16 loop on phone. All amounts use `<Money>`. Measured `contain-intrinsic-size`, and the lead form as a progressively enhanced Server Action.

### W3-07a · Admin console and integrations hub
- **Owner:** web-feature-engineer (tenant-security-warden) · **Device:** desktop · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/admin/**`; `apps/web/app/dashboard/integrations/**`; `apps/web/app/dashboard/settings/**` **except** `notifications/**`; `packages/api/src/routers/{admin,integrations,settings}.ts`; `packages/api/src/__tests__/{admin,integrations,settings}*.test.ts`, `coverage/W3-07a.ts`; `apps/web/lib/i18n/messages/{admin,integrations,settings}/**`; `apps/web/e2e/W3-07a.spec.ts`.
- **Findings:** admin-08 (hub), -11 (agent part), -17 (read-only plan and usage), -23, -28, -35, -36 (UI once H-04 lands); design-system-23 (admin).
- **Acceptance:** A "חיבורים" hub grouped הנהלת חשבונות · קופה · רכש · קליטת חשבוניות, with status chips, last sync, plain-Hebrew last error plus one fix CTA, and a nav dot only when action is needed. Intake addresses live here. MarketMan and Zester get a real contact path. "תוכנית ושימוש" is read-only from `getEntitlements`/`getQuota` (no redefinition). Admin writes are staged with a required reason stored in the audit `after`. A per-restaurant "פיצ׳רים פעילים" view with source. Admin uses dashboard primitives (no mono or tracking on Hebrew).

### W3-07b · Team join and sign-in v2
- **Owner:** web-feature-engineer (tenant-security-warden **mandatory**) · **Device:** mobile · **Effort:** L · **humanPR:** no (PIN and device mode are H-04)
- **Paths:** `apps/web/app/dashboard/team/**`; `apps/web/app/{login,(auth),invite,onboarding}/**`; new `apps/web/app/{join,welcome}/**`; `apps/web/auth.ts` (passkeys behind a flag); `packages/api/src/routers/{team,onboarding}.ts`; `packages/api/src/__tests__/{team,onboarding}*.test.ts`, `coverage/W3-07b.ts`; `apps/web/lib/i18n/messages/{auth,onboarding,team}/**`; `apps/web/e2e/{auth,consent-login}.spec.ts`, `apps/web/e2e/W3-07b.spec.ts`.
- **Findings:** auth-04, -07 (phase 2 code), -10 (activation checklist), -12, -13 (remember-me + passkeys), -29; admin-18 (agent part), -19, -21, -27, -34.
- **Acceptance:**
  - Invites: link + WhatsApp + QR. `/join/[token]` shows restaurant, role and inviter, and the single-use, 7-day, e-mail-bound token creates the session (attack test).
  - First run: a welcome flow (name, language incl. ar/ru/th/ti when enabled, install coach) that ends on the role home.
  - Codes and passkeys: a 6-digit e-mail code (10 min, 5 attempts via the existing limiter, auto-submit, `one-time-code`). Passkeys for owner and bookkeeper via the existing authenticators table. Remember-me pre-checked only in standalone display mode on a non-shared device.
  - `/onboarding` detects pending invites and offers to join instead of creating a stray tenant.
  - Activation checklist "1/4" with the hero sample labelled "דוגמה".
  - Roster: 2FA column, last active, stale-access filter, multi-branch invites.

### W3-08 · Actionable monthly report, one report with tabs
- **Owner:** web-feature-engineer (leak-economist) · **Device:** both · **Effort:** M · **humanPR:** no (sending is H-05)
- **Paths:** `apps/web/app/dashboard/reports/**`; `packages/api/src/reports/**`; `packages/api/src/routers/monthlyReport.ts`; `apps/web/lib/nav/routes/reports.ts`; `apps/web/lib/i18n/messages/index.ts` + new `messages/reports/**` (report keys migrate out of `recovery`); `packages/api/src/__tests__/monthly-report*.test.ts`, `coverage/W3-08.ts`; `apps/web/e2e/W3-08.spec.ts`.
- **Findings:** command-18, -21, -22; leaks-17 (label).
- **Acceptance:** One "דוח חודשי" with tabs סיכום · מייל · וואטסאפ · PDF (`/reports/digest` 308 → `?tab=email`). A status pill "פתוח · עד 25.10" / "סגור · 05.11 · לא ישתנה" (snapshot data once H-07 lands). Next steps are T2 rows with ₪ and a deep-link verb. Supplier and issue rows link to the breakdown. A 12-month select and an aligned delta. The headline matches the open or closed state. The e-mail frame is ported to light tokens. An auto-sized preview. "שלח לי עותק" shows as "בקרוב" until H-05. Bookkeeper read and PDF access per decision D-7.

### W3-09 · Order-to-door loop: PO lifecycle, supplier portal 2.0, document flow
- **Owner:** web-feature-engineer (matching-engine-guardian consulted; tenant-security-warden for the public portal) · **Device:** both · **Effort:** L · **humanPR:** no (revised match expectations are H-08)
- **Paths:** `apps/web/app/s/**` **except** `c/**`; `apps/web/app/api/supplier-confirm/**`; `packages/api/src/supplierConfirm/**`; `packages/api/src/orders/**` (new `lifecycle.ts`); `packages/api/src/routers/{orders,receiving}.ts`; `apps/web/app/dashboard/orders/**`; `apps/web/lib/components/documents/**`; new `packages/charts/src/coverage.ts`; `packages/api/src/__tests__/{order,supplier-confirm}*.test.ts`, `coverage/W3-09.ts`; `apps/web/lib/i18n/messages/{supplierConfirm,orders}/**`; `apps/web/e2e/W3-09.spec.ts`.
- **Findings:** functional-flows-01, -03 (supplier answer), -10 (PO/GR/claim nodes), -19 (accept-change UI), -20; auth-16 (agent part); orders-10 (UI part).
- **Acceptance:** `canTransition` tables for the PO, fired by events: supplier confirm → confirmed; GR closed partial → partial; GR completed and all invoices matched → closed. "late" is derived at expected + 60 min. Each transition writes `activity_events` and notifies the sender. Portal 2.0: per-line ✓ / shortage stepper / substitution (product + price), a delivery-window confirm or proposal, a 10-minute edit window and he/ar/ru. `DocumentFlow` on PO, GR and invoice with every node linked and T4 for missing nodes. A coverage line under the hero ("בדקנו 78% מהרכש · 22% הגיע בלי הזמנה (₪9,400)") with a drill-down.

### W3-10 · Catalog and products 2: price-list inbox, mapping triage, item master
- **Owner:** ocr-procurement-engineer (web-feature-engineer for UI) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `apps/web/app/dashboard/{catalog,products}/**`; `packages/api/src/catalog/**`; `packages/api/src/routers/{catalog,mapping,products}.ts`; `packages/catalog/**`; `apps/worker/src/jobs/importCatalog.ts`; `packages/api/src/__tests__/catalog*.test.ts`, `coverage/W3-10.ts`; `apps/web/lib/i18n/messages/{catalog,products}/**`; `apps/web/e2e/W3-10.spec.ts`.
- **Findings:** catalog-04, -05, -06, -07, -08, -09, -10, -11, -12, -14, -15, -16, -17, -19, -21, -24, -25, -26, -27, -28, -30, -31, -32, -33, -34, -35, -36, -38, -39, -42, -43, -44, -45, -46, -47, -48, -49, -51, -52.
- **Acceptance:**
  - Import is one "ייבוא מחירון" with a contract toggle replacing both wizards. It accepts PDF, photo and paste, auto-detects the header and sheet, adds a "מה ישתנה" step (↑/↓ with ₪/month, missing items to disable, unclear) and supports revert via audit.
  - One "לקשר" queue (SKU lines, no-SKU lines, import suggestions) ranked by unmapped ₪, with a split view and keys 1/2/3/4/J/K/Z. Nav and Needs-you count "7 לקישור · ₪1,240".
  - An item master with a product object page, a normalised supplier comparison, merge with preview and a read-only chef view.
  - Phone: 72 px rows with a bottom sheet and "+ להזמנה". `normalizeHe` search plus barcode.

### W3-11 · Document intelligence: credit notes and supplier statements
- **Owner:** ocr-procurement-engineer (leak-economist) · **Device:** both · **Effort:** L · **humanPR:** no
- **Paths:** `packages/ocr/**`; `packages/api/src/ingest/**`; `apps/web/app/dashboard/{inbox,recovery,leaks/claims}/**`; `apps/web/app/dashboard/suppliers/ledger/**`; `packages/api/src/routers/{ingest,recovery,suppliers}.ts`; `packages/api/src/{recovery,ledger}/**`; `packages/api/src/__tests__/{ingest,recovery,supplier-ledger}*.test.ts`, `coverage/W3-11.ts`; `apps/web/lib/i18n/messages/{ingest,recovery,suppliers}/**`; `apps/web/e2e/W3-11.spec.ts`.
- **Findings:** functional-flows-14, -21; chain-33.
- **Acceptance:** An OCR document-type classifier (חשבונית / ת״מ / מרכזת / חשבונית זיכוי / כרטסת) with a confirm chip on the inbox row. A credit note goes to `credit_notes` with a suggested claim allocation, confirmed by "אשר שיוך", which marks claims credited in integer agorot. "צלמו תעודת זיכוי" (rear camera, multi-page) on mobile recovery and receiving, followed by a T3 owner card. Statement upload → line reconciliation with flags (billed-not-received, credit missing, payment unapplied, invoice we never got). Each flag becomes a task. Claim letters show the restaurant address and claim number from H-03.

### Human-PR track, wave 3
- **H-04 · Schema batch B: field and platform** (humanPR). **Paths:** `packages/db/src/schema.ts`, a new migration, the RLS list and shape tests. **Contents:** device registration plus per-user PIN hash, idle lock and per-person audit (FG-18); `saved_views` + `view_subscriptions`; `inventory_count_lines.shelf_order` or `products.count_sort`, count units per product and inventory `submitted` status; `waste_entries`; recipe kitchen-card fields (method, photo, allergens, plating); `suppliers.billing_mode`; a sessions table; `purchase_orders.opened_at`; revised expected qty/price columns on `po_lines` (original kept for audit); `notification_seen`. **Findings:** auth-13, mobile-field-25, foodcost-04 (column), -07 (status), -23, -32, -33, exec-desktop-16 (tables), ia-nav-22 (server views), receiving-17 (column), admin-36, functional-flows-19 (columns), orders-10 (opened).
- **H-05 · Delivery and scheduling** (`outbox.ts`, `cron.ts`; credentials are Phase-6 human intake; humanPR). **Paths:** `packages/api/src/notifications/**`, `apps/worker/src/cron.ts`, `apps/worker/src/jobs/{outboxDispatch,recoveryReminders,matchInvoice}.ts`. **Contents:** real Web Push (VAPID) and WhatsApp utility templates (`rm_decision_needed`, `rm_delivery_late`, `rm_claim_reply`); role → member phone resolution at enqueue; mocks write `skipped_no_provider`; quiet hours 23:00–06:00 + Shabbat/holidays; ≤6 per user per day; a late-truck check every 15 min; claim chase drafts on days 3/7/14 awaiting a tap; monthly report and digest send; saved-view subscriptions; registration of the H-07 close job. **Findings:** functional-flows-02, -05 (cadence), -16 (cadence), mobile-field-13, approvals-12 (reminders), command-21 (send), admin-16 (routing), exec-desktop-16 (delivery).
- **H-06 · Supplier claim portal and server send** (public attack surface; humanPR). **Paths:** new `apps/web/app/s/c/**`, `apps/web/app/api/claims/**`, `packages/api/src/claimPortal/**`, public-route attack tests. **Contents:** a 72 h token per claim letter (supplierConfirm model). The supplier accepts or disputes per line and uploads a credit note, and the status moves automatically. `guardPublicRequest` limits per IP and per token hash. **Findings:** functional-flows-05 (portal), SUP-17 (server send), leaks-06 (phase 2).
- **H-07 · ₪ definitions and closed months** (matching-engine-guardian; humanPR per the ownership map for ₪ math). **Paths:** `packages/charts/src/{leak-hero,leak-report}.ts`, new `apps/worker/src/jobs/leakMonthClose.ts`, charts tests. **Contents:** a hero partition (undecided / claimed / waived) with a parity test that the parts sum to `leakIls`; the funnel נמצא → נדרש → זוכה → הוחזר taken from `recovery_claims`; a monthly snapshot on the 5th with dated correction lines. **Findings:** leaks-03, -14, -17, command-04.
- **H-10 · Plans and billing** (owner decision; humanPR). **Paths:** `packages/db/src/plans.ts`, `packages/billing/**`. **Findings:** mkt-24, admin-17 (billing rail).

### Wave-3 overlap ledger (key points)
`layout.tsx`/`nav.tsx`, `routers/{approvals,payRun,invoices,chain}.ts` → W3-01. `routers/{orders,receiving}.ts`, `orders/**` pages, `supplierConfirm/**` → W3-09. Receiving **pages**, `lib/pwa/**` and showcase receiver steps → W3-03. `recovery/**`, `leaks/claims/**`, `inbox/**`, `suppliers/ledger/**` and the `ingest`/`recovery`/`suppliers` routers → W3-11. `settings/notifications/**` → W3-03; the rest of `settings/**` → W3-07a. `messages/index.ts` → W3-08. `apps/web/package.json` → W3-03. `packages/charts`: `chain.ts` W3-01 · `coverage.ts` W3-09 · `leak-hero`/`leak-report` H-07. `schema.ts` → H-04. `notifications/**` + `cron.ts` → H-05. `app/s/c/**` → H-06 (W3-09 excludes it).

---

## 5. Wave 4: harden and lock in (1 agent + 3 human-PR packages)

### W4-01 · DS, a11y, copy and performance sweep (flip the gates to error)
- **Owner:** rtl-design-steward + test-sentinel · **Device:** both · **Effort:** M · **humanPR:** no
- **Paths:** `apps/web/app/**`, `apps/web/lib/**` (residual offenders only; it is the only agent package in the wave), `apps/web/eslint.config.mjs`, `apps/web/scripts/**`, `apps/web/e2e/**`, `apps/web/lib/i18n/messages/**` (orphan keys).
- **Findings:** design-system-02 (residual codemod), design-system lint flip, copy-rtl-20 (gate → error), a11y-23 (spec), perf-states-21 (specs and RUM).
- **Acceptance:** DS lint and the copy gate run at **error** with 0 offenders. `<Money>` is used for 100 % of ₪ renders (grep: 0 `dir="ltr"` money, 0 mono money). A new `e2e/a11y.spec.ts` covers axe `wcag22aa` + best-practice on every route in he and en, Tab-walk visibility ≥50 % and rings ≥3:1 at 390 and 1440, targets ≥44 px under CDP touch emulation, unique titles, and no transforms under reduced motion. A perf spec checks CLS ≤0.05 on 8 field and queue routes at 4× CPU, LCP = hero on /dashboard, route JS ≤170 KB on field routes and soft-nav 6/6. `useReportWebVitals` reports to Speed Insights tagged with route, role and pointer.

### Human-PR track, wave 4
- **H-08 · Engine: revised supplier expectation and consolidated accept** (`packages/matching/**`; matching-engine-guardian). **Findings:** functional-flows-13, -19, approvals-27, auth-16 (revised expectation), orders-10, receiving-10 (per-product tolerance proposal). Uses H-03/H-04 columns. The leak canary stays green; a known shortage becomes T4, not a false alarm.
- **H-09 · CI gates** (`.github/workflows/ci.yml`). Wires W4-01's a11y, perf, soft-nav, DS-lint, copy-gate and bundle-budget checks as blocking steps. **Findings:** a11y-23, perf-states-21, design-system (enforcement).
- **H-11 · Least-privilege money visibility** (owner decision D-6; touches attack-suite assertions). **Paths:** `packages/api/src/routers/owner.ts`, `packages/api/src/__tests__/cross-tenant.attack.test.ts` (assertions flipped to FORBIDDEN, a strengthening). **Findings:** command-05, leaks-22 (procedure part).

---

## 6. Package index and sequencing summary

| Wave | Packages | Gate to start | Exit criteria |
|---|---|---|---|
| 1 | W1-01…W1-12 (12, parallel) | none | 0 open S0 from this review. Every role lands on its job. The shell works on phone and desk. DS foundation merged. |
| 2 | W2-01 first, then W2-02…W2-15 + H-01/H-02/H-03 | W1-01, W1-03 and W1-04 merged | The money loop closes (register → decide → pay → claim → recover). Desk tables, split panes and keys are live. Copy and DS gates in warn mode. |
| 3 | W3-01…W3-11 (12) + H-04/H-05/H-06/H-07/H-10 | W2-01, W2-08, W2-13 and H-03 merged | Chain scope, kitchen, installable app with push, close desk, palette, document intelligence. |
| 4 | W4-01 + H-08/H-09/H-11 | all wave-3 agent packages merged | Gates at error and blocking in CI. World-class bar (0 S0, 0 S1 on primary flows). |

**Finding coverage:** each finding ID appears in at least one package. Split findings name their part (e.g. "agent part", "interim", "phase 1"). Owner decisions that gate scope are flagged inline ("decision-gated") and listed in `REVIEW-REPORT.he.md` §9.
