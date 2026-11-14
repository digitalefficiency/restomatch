# DS3 · work plan

One package, one coding session, one branch, one draft pull request. The partition below is drawn so that two
packages never write the same file. `README.md` in this folder has the rules and the way of working;
`SPEC.md` says what each thing looks like and does. Paths are relative to the repository root, on `main` as of
`9dc0b934` (14.11.2026).

## Batch 1 (opened 14.11.2026)

| Package | What | Branch | Pull request base | Owning agent (`AGENTS.md`) |
| --- | --- | --- | --- | --- |
| `DS3-00` | Tokens of the clean finish | `claude/ds3-00-foundation` | `main` | `rtl-design-steward` |
| `DS3-01` | Shared components, icons, the kit page | `claude/ds3-01-components` | `claude/ds3-00-foundation` | `web-feature-engineer` + `rtl-design-steward` |
| `DS3-02` | The shell: side menu, top bar, command palette | `claude/ds3-02-shell` | `claude/ds3-01-components`, or `main` if nothing upstream was merged in | `web-feature-engineer` |
| `DS3-03` | Owner home | `claude/ds3-03-home` | same rule | `web-feature-engineer` |
| `DS3-04` | Approvals desk | `claude/ds3-04-approvals-desk` | same rule | `web-feature-engineer` |
| `DS3-05` | Delivery check on a phone | `claude/ds3-05-receiving` | same rule | `web-feature-engineer` |
| `DS3-06` | Settings and personal display preferences | `claude/ds3-06-settings` | same rule | `web-feature-engineer` |
| `DS3-07` | Typeface: Google Sans as a face (owner decision) | `claude/ds3-07-typeface` | `claude/ds3-00-foundation` | `rtl-design-steward` |

Universal gates wrap every package (`AGENTS.md`): `test-sentinel` always; `tenant-security-warden` whenever data
is touched; `money-format-marshal` whenever ₪ is rendered; `icp-keeper` for scope.

### Rules of the partition

- **Tokens** (`packages/ui-tokens/**`, the generated block and the hand-written rules of
  `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`) belong to `DS3-00`. `DS3-07` owns only the
  typeface files named in its section and regenerates the block after merging `DS3-00`. Nobody else edits
  these. The block of `globals.css` between `@tokens:start` and its end is generated
  (`pnpm --filter @restomatch/ui-tokens tokens:css`): never edit it by hand.
- **Shared components** (`apps/web/lib/components/**`) belong to `DS3-01`, except the sub-folders a screen
  package owns: `palette/` (`DS3-02`), `hero/` (`DS3-03`), `desk/` (`DS3-04`).
- **A screen package owns its route folder, its message files and its e2e spec**, and nothing else.
- **Messages:** each package edits only its own area under `apps/web/lib/i18n/messages/<area>/`. Put new
  strings in an existing area file; do not add an area (that needs a line in `messages/index.ts`, a shared
  file). The copy guard in `apps/web/lib/copy/**` stays as it is: meet it, do not loosen it.
- **e2e:** one spec per package, `apps/web/e2e/DS3-NN.spec.ts` (plus `DS3-NN-*.spec.ts` if needed). Existing
  specs of your screen may be updated where the screen changed on purpose; shared helpers
  (`apps/web/e2e/helpers*`, `auth.setup.ts`, `env.ts`) are read-only.
- **Seams** are the only edits allowed outside a boundary. Each is one small, named change, listed per
  package below, and is called out in the pull request under "Write boundary".
- **Immutable files** (`AGENTS.md`, "Immutability list") are never edited. If a package needs one changed, it
  writes the proposal into its pull request and stops there.
- **Reserved, not part of batch 1:** the invoices area: `apps/web/app/dashboard/invoices/**`,
  `apps/web/app/dashboard/inbox/**`, `apps/web/app/dashboard/approvals/pay-run/**`, the supplier ledger, and
  the role views of approvals beyond what `DS3-04` states. A dedicated proposal for that area is being
  prepared for the owner; do not restyle or restructure those screens now.

---

## DS3-00 · Tokens of the clean finish

**Goal.** Production renders in the clean finish's colours, elevation and focus, through the DS token
pipeline, with every guard green. This is a change of values and a few roles, not of structure.

**Reference.** `SPEC.md` §2, §4, §7, §8; `reference/src/product.css` lines 1 to 60 (the `.rm` block).

**Write boundary.** `packages/ui-tokens/**` (except `src/fonts.ts`, which `DS3-07` owns; you may read it) ·
`apps/web/app/globals.css` · `apps/web/tailwind.config.ts` · `apps/web/app/dashboard/lab/tokens/**` (the
token lab) · the token lab's snapshot baselines (`apps/web/e2e/W1-01.spec.ts-snapshots/**`) ·
`apps/web/e2e/DS3-00.spec.ts`.

**Slices.**
1. Map the pipeline (`packages/ui-tokens`: primitives → semantic roles → modes → `scripts/generate.ts` → the
   generated block in `globals.css` → the Tailwind preset) and every guard on it (the contrast test, the
   ratchet, `ds-baseline.json`, the lab snapshot, lints).
2. Write the role table: DS2 role → value today → `SPEC.md` §2 value → contrast against each surface it
   meets. Publish it in the pull request. Change primitives and roles to the clean values; add a role only
   where the spec needs one that DS2 lacks (for example the amber dot's ring, the solid red of a dot), named in
   DS2's own scheme.
3. Recovered money (T3) is green in the clean finish. Find how T3 is tinted today (gold) and move the role, not
   the call sites.
4. Motion tokens already equal `SPEC.md` §8: confirm, do not duplicate. Density variables: confirm they can
   express `SPEC.md` §7 and extend only if needed (the personal switch itself is `DS3-06`).
5. Regenerate, update the guards the repository's way (never by weakening a test), refresh the lab snapshots,
   and capture the six highest-traffic screens before and after at 1440 and 390 for the pull request.

**Acceptance.** Every text pair still passes the contrast test (AA), and the pairs listed in `SPEC.md` §2
hold what the reference holds. No hex colour outside `packages/ui-tokens`. No screen breaks: run the e2e
suite and the a11y spec; list anything that changed visually and was not intended. The typeface is untouched.

**Downstream.** `DS3-01` and `DS3-07` stack on your branch. Push early: a first commit with the values, then
the refinements.

## DS3-01 · Shared components, icons, the kit page

**Goal.** Each of the fifteen kit components (`SPEC.md` §10.6) exists once in `apps/web/lib/components`, in the
clean finish, and the kit page shows them live. Screens adopt them instead of drawing their own.

**Reference.** `reference/reference.html#kit`, `reference/src/kit.html`, `kit-sources.json`, `sprite.html`;
`SPEC.md` §3 (money), §5, §6, §9.

**Write boundary.** `apps/web/lib/components/**` except `palette/`, `hero/`, `desk/` · a new
`apps/web/app/dashboard/lab/kit/**` (the kit page, beside the existing `lab/tokens` and `lab/desk`, which
are not yours) · `apps/web/lib/i18n/messages/{components,common,explain,views}/**` ·
`apps/web/e2e/DS3-01.spec.ts`.

**Slices.**
1. Inventory every exported component, its props, variants, tests and how many screens import it. Table: kit
   component → the product's component → tokens only / structural change / missing.
2. Status pill, button with a key cap, the money component (sign, agorot, tabular figures), the change against
   a previous period, the "ordered · received · billed" line, tabs and filters with counts, the table, the
   toast with undo and its ten-second line, "where the amount comes from" (the explanation that opens the
   calculation itself), loading / empty / error, the tooltip, the field, switch and number field with steppers.
3. Icons: the two-tone state (`--i-duo`) on the icon component; add only the glyphs the reference has and the
   product lacks. Keep Lucide as the base.
4. The kit page as a new route under the existing lab (`lab/kit`): every component live, regular and compact,
   with its states.
5. Keep every public prop working. Where a component's API must change, change all call sites in the same
   pull request only if they are inside your boundary; otherwise add the new variant beside the old one and
   list the call sites under "Requests to other packages".

**Acceptance.** No component formats ₪ by hand; no colour, radius, shadow or duration outside tokens; every
component passes the a11y spec in both densities; unit tests updated; the kit page matches the reference's kit
side by side.

**Downstream.** The screen packages merge your branch when they need a component. Push small and often.

## DS3-02 · The shell: side menu, top bar, command palette

**Goal.** The side menu follows `docs/ux/sidebar/SPEC.md` (owner-approved 31.10.2026) item by item, in the
clean finish; the top bar follows its §1.5; the command palette is mounted and also finds settings and runs
display commands.

**Reference.** `reference/reference.html#ex4` (and the menus of `#ex1`, `#ex2`), script section "the side
menu"; `SPEC.md` §10.4; `KNOWN-ISSUES.md`, "Side menu": the spec wins over the mock-up on every point there.
`reference/checks/menu-check.cjs` holds 139 assertions on the behaviour.

**Write boundary.** `apps/web/lib/nav/**` · `apps/web/app/dashboard/{layout.tsx,nav.tsx,search.tsx,
searchOptions.ts,branch-switcher.tsx}` · `apps/web/lib/components/palette/**` · `apps/web/lib/hotkeys.ts` ·
`apps/web/lib/i18n/messages/nav/**` · `apps/web/e2e/DS3-02.spec.ts` and the existing navigation specs where
the menu changed on purpose.

**Seams.** `DS3-06` gives you a preferences provider (`apps/web/lib/prefs/**`); mounting it in `layout.tsx`
is yours. The star beside a page title needs the shared page header: ask `DS3-01` (or build the star inside
your boundary and list it under "Promote to shared").

**Slices.**
1. Spec conformance table: every numbered item of the sidebar spec → built / partly / not built on `main`,
   with evidence. Build what is missing: sizes and axes, group headers, the dot rule, the single solid pill,
   default-open groups by role with the current group always open, the fit rule and its polite announcement
   (also visible for sighted users), the collapsed rail with one tile per group and its list, the pin,
   favourites, the keyboard map, tooltips, the collapse motion, forced-colours.
2. Preferences stay per device, as today (`lib/nav/prefs.ts`: the rail in a cookie so the server renders the
   final width). Do not move them to the server.
3. The palette: mount it, keep what it holds, add display commands and every setting (the list of settings
   comes from `DS3-06`; until then, the existing settings routes).
4. Each role's menu: check owner, manager, bookkeeper, chef and receiver; receivers and chefs keep their
   bottom bar on a phone.

**Acceptance.** The spec's own acceptance list (§14) passes; port the behaviour assertions that apply into the
e2e spec; no layout shift on load in either state; keyboard only, screen reader names, 200% zoom and a 700 px
high window all work.

## DS3-03 · Owner home

**Goal.** The home reads as `SPEC.md` §10.1: one leading number with its proof one click away, what needs the
owner now with a single primary action, good news in calm green.

**Reference.** `reference/reference.html#ex1`, `reference/src/ex1.html`, script section "1 · home".

**Write boundary.** `apps/web/app/dashboard/page.tsx` · `apps/web/app/dashboard/home/**` ·
`apps/web/lib/components/hero/**` · `apps/web/lib/i18n/messages/overview/**` (confirm this is the home's
area before editing) · `apps/web/e2e/DS3-03.spec.ts` and the home's existing specs where it changed on
purpose.

**Not yours.** The numbers themselves: every figure comes from the existing procedures and the charts SQL
(`packages/charts`, owned by `matching-engine-guardian`); the leak definition is immutable. If the calculation
panel needs a breakdown the API does not return, write the request into the pull request.

**Slices.** Map the train C home (zones, role lenses, what each role sees) against §10.1 → the leak card
(hero size, the dot instead of any red bar or frame, the scale sentence, the pace line, the split bar with its
two links, "איך הגענו לסכום?" opening the calculation in place) → "מחכה לך" with one filled button → the
recovered card in green → the phone layout → entry motion, once, off under reduced motion → empty, loading
and error states.

**Acceptance.** The numbers equal what the same procedures return today, to the agora. The count of numbers on
the first screen does not grow (the product's own meter in the e2e helpers). One filled primary button in the
viewport. Managers and bookkeepers see their own lens, unchanged in meaning.

## DS3-04 · Approvals desk

**Goal.** The desk reads as `SPEC.md` §10.2: dense rows, the "ordered · received · billed" table with the
calculation line, the decision where the evidence is.

**Reference.** `reference/reference.html#ex2`, script section "2 · the decisions desk".

**Write boundary.** `apps/web/app/dashboard/approvals/**` **except `approvals/pay-run/**`** (reserved) ·
`apps/web/lib/components/desk/**` · `apps/web/app/dashboard/lab/desk/**` (the desk lab) ·
`apps/web/lib/i18n/messages/approvals/**` · `apps/web/e2e/DS3-04.spec.ts` and the desk's existing specs where
it changed on purpose.

**Not yours.** `packages/api/src/approvals/engine.ts` (immutable) and who decides what. The router
(`packages/api/src/routers/approvals.ts`) only if a read needs one more field; say so in the pull request and
bring in the tenant-security gate. The role lanes ("waiting for others") stay as they are in meaning: the
invoices-area proposal will come back to them.

**Slices.** Map the train C desk (queue, evidence panel, keys, undo, density, branch strip) against §10.2 →
rows instead of cards, grouped by tier, with the head's count and sum → the three-way table with prices and the
calculation line (through the shared component of `DS3-01` when it lands; a local one until then) → the
explanation opens the calculation itself → the decision bar and the reasons row → what happens next line →
toast with undo → keys honour the single-key preference (from `DS3-06`; until it lands, read the same storage
key defensively) → narrow layout → empty state.

**Acceptance.** Every decision still calls the same procedure with the same input. Keys never fire while
typing. Undo behaves as the server allows; the visible window matches the server's. No ₪ shown to a role that
must not see it. The desk's existing e2e specs pass or are updated with the reason.

## DS3-05 · Delivery check on a phone

**Goal.** The receiving flow on a phone reads as `SPEC.md` §10.3: one row per item, a thumb-side tick, the
product's own number pad, a button that always says the next step.

**Reference.** `reference/reference.html#ex3` (the first phone is live), script section "3 · the delivery
check on a phone".

**Write boundary.** `apps/web/app/dashboard/receiving/**` ·
`apps/web/lib/i18n/messages/{receiving,receiverLangs,dockPrice}/**` · `apps/web/e2e/DS3-05.spec.ts` and the
receiving specs where the flow changed on purpose.

**Seams.** One entry in the feature registry for the flag below (find how flows are gated and defaulted off
today; `packages/api/src/lib/features.ts` is the likely place). Nothing in `apps/web/app/receiver-sw.js` or
the offline queue unless a change is needed for parity, and then say so.

**Slices.**
1. Map today's flow step by step (photo, reading, review, count, close; online and offline) and its six
   languages.
2. Look and interaction that **keep today's order**: the row, the tick, the pencil and the number pad sheet,
   the primary button's wording, the summary before closing, touch targets, the end screen.
3. Behind a new flag, **off by default**: counting before the photo, and the quantity field opening empty
   instead of pre-filled with the ordered quantity. With the flag off, the pilot restaurant's flow is exactly
   today's.
4. Every new string in all six languages, through the existing receiver translation path. No ₪.

**Acceptance.** With the flag off, the e2e flow of today passes unchanged except for look. With it on, the new
order passes its own spec. Targets at least 44 px; works at 360 px wide; closing without a connection still
works; a screen reader names every control.

## DS3-06 · Settings and personal display preferences

**Goal.** A settings screen that reads as `SPEC.md` §10.5, and the personal display preferences that act on
the whole product: density, text size, single-key shortcuts.

**Reference.** `reference/reference.html#ex4` (the settings part), script section "4 · settings";
`KNOWN-ISSUES.md`, "Settings": it corrects the mock-up on the threshold rule and on wording.

**Write boundary.** `apps/web/app/dashboard/settings/**` · a new `apps/web/lib/prefs/**` (the preferences
store and provider) · `apps/web/lib/i18n/messages/settings/**` · `apps/web/e2e/DS3-06.spec.ts` and the
settings specs where the screen changed on purpose.

**Seams.** A read-only preview procedure in `packages/api/src/routers/settings.ts` (what a threshold change
would do to the gaps open now), calling the matching engine without editing it; add its line to the
cross-tenant coverage manifest as `AGENTS.md` allows (add only). The density switch that exists in
`apps/web/lib/components/views/` becomes a reader of your store: that edit belongs to `DS3-01`; give it the
hook and list the request.

**Not yours.** The schema (`packages/db/**`): preferences stay per device, so no column is needed. The
approvals engine and the matching engine. Team and integrations screens. Pull requests `#324` (features hub)
and `#309` (sign-in) are open on neighbouring files: check them first.

**Slices.** Map the settings screens, what each saves, where and how it is audited → the two-group layout
with scope chips and search → display settings that act at once (density worded "רגיל / צפוף" per decision D4,
text size, the side menu, single-key shortcuts), stored per device, applied before first paint → the
restaurant thresholds with the default markers, the save bar, the ten-second undo, the history and restore →
the preview before saving, from the engine → the list of settings exported for the palette (`DS3-02`).

**Acceptance.** Saving writes exactly what today's procedure writes and is audited the same way. The preview
never claims that saving changes gaps that are already open. No preference flashes on load. Phone: settings
that do nothing on a phone are absent. Every string passes the copy guard.

## DS3-07 · Typeface: Google Sans as a face

**This package is an owner decision in the form of a pull request.** The standing decision (D2, 7.11,
reaffirmed 11.11) is IBM Plex Sans Hebrew, and it reached users with train C. The approved mock-ups render in
Google Sans. The owner merges this pull request if he wants the change and closes it if he does not. Nothing
else in DS3 depends on it.

**Reference.** `SPEC.md` §3; `reference/PAGE-TEXT.he.md`, "אותיות ומספרים" (measurements and trade-offs); the
typeface switch at the top of `reference/reference.html`.

**Write boundary.** `packages/ui-tokens/src/fonts.ts` · `apps/web/public/fonts/**` (a new folder for the
face, with its licence text, beside the existing ones) · the font loading in `apps/web/app/layout.tsx` ·
`apps/web/e2e/DS3-07.spec.ts`.

**Seams.** After merging `DS3-00`: regenerate the token block of `globals.css` (run the generator, change
nothing by hand); the font tests of `packages/ui-tokens`; and, only if a face needs it, the lines of
`packages/ui-tokens/src/{build,modes}.ts` that name faces. Say each one in the pull request.

**Slices.** Read how DS2 defines a face (`FaceId`, roles, metric-matched fallback, self-hosted files with the
licence text, preload rules, the receiver scripts) → **check the licence of every file before adding it** and
record the source and version → add the face beside Plex and Heebo for the six receiver languages; self-host,
subset the way DS2 does, stay within the download budget the owner set (100 KB for Hebrew and Latin) →
switch the active face in one line, keeping the undo → tabular figures on the number role → measure layout
shift and the largest paint against Plex on the home and the desk; publish both sets of numbers and
side-by-side screenshots in six languages.

**Acceptance.** One line switches back. No layout shift regression. Digits are fixed-width in every weight.
₪, geresh, gershayim and maqaf render in the face. The pull request states plainly what changes for users and
what it costs.

---

## Later batches (not opened yet)

**Batch 2: the remaining product screens**, once `DS3-00` and `DS3-01` are green. Each adopts the shared
components and removes local styling; no change of behaviour. Proposed groups, each with a disjoint write
set: leaks, reports, month close and exports (`dashboard/{leaks,reports,close,exports}`) · credit requests,
suppliers and contracts (`dashboard/{recovery,suppliers,contracts}`, without the ledger) · ordering and the
kitchen (`dashboard/{orders,catalog,products,inventory,recipes}`) · chain, team, integrations and Ask
(`dashboard/{chain,branches,team,integrations,ask}`) · outside the dashboard (`app/{(auth),login,
onboarding,join,invite,welcome,admin}`). Several open pull requests work in these folders today; the groups
open when those have landed. Marketing pages are out of scope (`growth-pmm-engineer`).

**Batch 3: the invoices area** (register, the invoice page, approvals as each role sees them, the pay run),
after the owner has seen and approved its own proposal.
