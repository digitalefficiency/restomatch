# `lib/prefs` — personal display preferences (DS3-06)

Density, text size and single-key shortcuts: the display choices a person makes in **הגדרות → תצוגה**. They
belong to the **device**, not the account (owner decision 6, 14.11.2026: "preferences are per device, as
today"), act at once, need no save button, and apply from the first HTML (no flash). No schema change and
nothing in `packages/db`.

## Storage: the contract's names (fixed — DS3 `WORKPLAN.md`, "Personal preferences: one contract")

| Preference           | Where                                                                            | Key              | Values                | Absent             |
| -------------------- | -------------------------------------------------------------------------------- | ---------------- | --------------------- | ------------------ |
| Density              | cookie (1 year, `path=/`, `samesite=lax`, `secure` on https; read on the server) | `rm_density`     | `regular` / `compact` | the role's default |
|                      | localStorage (mirror)                                                            | `rm:density`     | same                  | —                  |
| Text size            | cookie (same attributes)                                                         | `rm_text`        | `regular` / `large`   | `regular`          |
|                      | localStorage (mirror)                                                            | `rm:text`        | same                  | —                  |
| Single-key shortcuts | localStorage only (sidebar spec §13)                                             | `rm:keys:single` | `1` / `0`             | on                 |

- After writing `rm:keys:single` the store fires `rm:keys` on `window` (the shell's event name), and only after
  the write landed, so mounted key handlers re-read it.
- Every storage read and write sits in try/catch: a preference never breaks a page. A choice the browser
  refuses to store (cookies blocked, a full or refused localStorage) still holds for that page: re-reads keep
  it and `singleKeysEnabled()` answers with it, until storage holds a value for that key again.
- **A stored value only picks one of the product's constants** (`pickDensity`, `pickTextSize`,
  `pickSingleKeys`): anything else reads as "not chosen". Nothing read from storage, or back from the page, is
  written into the page as is (DS3 `CHANGES.md`, third and fourth corrections).
- A density or text choice equal to the role's default is not stored, so a shared device gives the next person
  their own default. The single-key switch is stored as the person set it, as the shell's switch does.
- Safari and iOS cap a script-written cookie at 7 days: the first reader on each page load writes the cookies
  back with a fresh lifetime, and restores a dropped cookie from its localStorage mirror.
- The cookie policy page (`app/(marketing)/cookies/page.tsx`) lists the two cookies (category "preference",
  one year) and the three localStorage keys; a new key or cookie here needs its line there too.

**Defaults** (D4, OWNER-DECISIONS-0711): density `compact` ("צפוף") for the bookkeeper, `regular` ("רגיל")
for owner, manager, chef and receiver; on a touch pointer the regular density applies whatever the choice
(SPEC §7). Text size `regular`; `large` enlarges the content column by 1.1, as the reference does.
Single-key shortcuts on; Ctrl/⌘ combinations are never affected.

## Where a setting does nothing (it is then absent)

| Query (`schema.ts`) | Value                    | Effect                                                                   |
| ------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `COARSE_QUERY`      | `(pointer: coarse)`      | density is fixed at the regular size; its setting and command are absent |
| `NARROW_QUERY`      | `(max-width: 1023.98px)` | no side menu (the shell's `lg`); its setting and command are absent      |
| `PHONE_QUERY`       | narrow **and** coarse    | no keyboard; the single-key setting and command are absent               |

The server cannot see the pointer: `PrefsRoot` passes a User-Agent hint (`readDeviceHints`: a phone or tablet
browser) as the SSR snapshot of `COARSE_QUERY`. DS3-00's coarse-pointer floor makes it a CSS fact as well.

## Attributes (the contract: `data-density`, `data-text`)

- **The shell (DS3-02)** sets `data-density` and `data-text` on `#rm-app` on the server from the two cookies,
  before first paint. Use `shellAttrs(cookieHeader, role, hints)` (from `@/lib/prefs/schema`): an absent cookie
  gives the role's default (the bookkeeper starts compact) and a phone renders the regular density.
- **The provider** puts the same attributes on its `display: contents` wrapper (`data-density="compact"` or
  none, `data-text="large"` or none) and mirrors them onto `<html>` after hydration, so portals follow;
  restored when it unmounts (only known values are restored). No attribute for the single-key switch: key
  handlers read the key.
- **A change** (settings, a palette command) updates the store at once and calls `router.refresh()`
  (`settings/_components/useShellRefresh.ts`), because a layout is not re-rendered by a navigation: the
  shell's server-set attributes follow without a reload. Simpler for the shell: read `usePrefs()` in
  `ShellFrame` (its SSR snapshot is the cookies) and drop the refresh.
- **Styles.** What `data-density` and `data-text` drive belongs to DS3-00 (tokens) and DS3-01 (components).
  Large text has one mechanism, DS3-00's: `[data-text='large']` sets `--text-zoom` to 1.1 and the class
  `rm-text-zoom` on the content wrapper beside the menu applies it (DS3-02 adds the class). Until DS3-00's
  rule is in this branch's base, the provider adds the interim rule
  `@media screen{#main-content > *{zoom:var(--text-zoom-large,1.1)}}` (the reference's zoom on the content
  column; the side menu, dialogs, toasts and print keep their size), and it is deleted then (`textSizeRule`
  in `schema.ts`, one line in `PrefsProvider.tsx`). `#main-content > *` is the very element DS3-02 gives
  `rm-text-zoom`, so if both meet before that, the content is still zoomed once, not twice.

## API

```ts
import { usePrefs, singleKeysEnabled, useIsCoarse, useIsNarrow, useIsPhone } from '@/lib/prefs'; // client code
import { shellAttrs, DENSITY_COOKIE, viewDensity } from '@/lib/prefs/schema'; // server-safe
import { PrefsRoot, readDisplayChoices, readDeviceHints } from '@/lib/prefs/server'; // server components

const p = usePrefs();
p.density; // 'regular' | 'compact' — the CHOICE (the switch's selected value)
p.appliedDensity; // what the screen really uses ('regular' on a touch pointer)
p.viewDensity; // 'comfortable' | 'compact' — the views toolbar vocabulary, from the density in force
p.tableDensity; // 'default' | 'compact'     — DataTable's vocabulary, from the density in force
p.textSize; // 'regular' | 'large'
p.singleKeys; // boolean (true on the server: the key lives in localStorage)
p.coarse; // a touch pointer (the User-Agent hint on the server and during hydration)
p.setDensity('compact');
p.setTextSize('large');
p.setSingleKeys(false);
p.reset();

singleKeysEnabled(); // for key handlers outside React: reads rm:keys:single on every call
```

The barrel `@/lib/prefs` re-exports client modules: server components import from `@/lib/prefs/schema` and
`@/lib/prefs/server`.

## Mounting (DS3-02)

Mount once, around the whole shell, in `apps/web/app/dashboard/layout.tsx`, inside `NavProvider` (the
provider takes the viewer's role from it; or pass `role={active.role}`):

```tsx
const shell = shellAttrs((await headers()).get('cookie'), active.role, await readDeviceHints());
<NavProvider value={...}>
  <PrefsRoot>
    <ShellFrame initialRail={rail} density={shell.density} textSize={shell.text}>…</ShellFrame>
  </PrefsRoot>
</NavProvider>
```

Until then, `app/dashboard/settings/layout.tsx` mounts its own `PrefsRoot`: the choices are saved under the
contract's names, and the provider's attributes act while a settings screen is open (it restores `<html>`
when it unmounts). A nested provider passes through, so the double mount is harmless; the settings mount can
go once the shell mounts it.

Readers go through this module, never a raw key or cookie (WORKPLAN, "Personal preferences: one contract"):
`usePrefs()` in React, `singleKeysEnabled()` in a key handler outside React, `shellAttrs()` /
`readDisplayChoices()` on the server.

## Who reads what (requests)

- **DS3-00** — done on your branch (`[data-text='large']` sets `--text-zoom`; `.rm-text-zoom` applies it).
  Keep the coarse-pointer floor for every compact token.
- **DS3-01** — done on your branch: `DataTable` reads `usePrefs().tableDensity` (the density in force). The
  views toolbar takes the preference as its default only where the page passes it to the parser:
  `parseView(searchParams, await viewDefaults(role))` (`lib/components/views/defaults.ts`). The selected
  segment of `SegmentedControl` needs a forced-colours mark.
- **Every screen that parses views** (the home, approvals, leaks and its report and breakdown, chain and its
  matrix: DS3-03, DS3-04 and later owners) — call `parseView(searchParams, await viewDefaults(role))`, or a
  bookkeeper and anyone who chose "צפוף" still get the comfortable view there.
- **DS3-02** — set the shell's attributes with `shellAttrs` (role default when the cookie is absent); the
  single-key switch in the account menu, the cheat sheet and the palette goes through `usePrefs()` /
  `setDisplayChoices` (same key, same event); the palette lists `useSettingsPaletteScreens()` and runs
  `useDisplayCommands()` (`app/dashboard/settings/_index/palette.ts`); export a side-menu setter (settings
  synthesises Ctrl/⌘+B today).
- **DS3-04** — the desk keys honour `singleKeysEnabled()`; arrow keys keep working.
