# `lib/prefs` — personal display preferences (DS3-06)

Density, text size and single-key shortcuts: the display choices a person makes in **הגדרות → תצוגה**.
They belong to the **device**, not the account (owner decision 6, 14.11.2026: "preferences are per device,
as today"), act at once, need no save button, and apply from the first HTML (no flash). No schema change and
nothing in `packages/db`.

## Storage keys (read these, do not invent new ones)

| Where                                                                           | Key          | Value                                                                                                                                                                                                                 | Lifetime                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie (first-party, not HttpOnly, `path=/`, `samesite=lax`, `secure` on https) | `rm_display` | `key=value` pairs joined by `&`, fixed tokens, **only explicit choices**: `density=regular\|compact`, `text=regular\|large`, `keys=on\|off`. Example: `density=compact&keys=off`. Absent cookie or key = the default. | 1 year (renewed on every page load; Safari and iOS cap a script-written cookie at 7 days, so there a choice lasts while the device opens the app at least weekly) |
| BroadcastChannel (no storage)                                                   | `rm-display` | message `'changed'`: other tabs re-read the cookie                                                                                                                                                                    | —                                                                                                                                                                 |

Nothing is kept in localStorage. The cookie must be listed on the cookie policy page
(`app/(marketing)/cookies/page.tsx`, category "preference") before this ships — a request to that page's owner.

**Defaults** (when a key is absent):

- density: by role, decision D4 (OWNER-DECISIONS-0711) — bookkeeper `compact` ("צפוף"); owner, manager, chef,
  receiver `regular` ("רגיל"). On a touch pointer the regular density applies whatever the choice (SPEC §7).
- text size: `regular`. `large` enlarges the content column by 1.1 (`textSizeRule`), as the reference does.
- single-key shortcuts: on. Combinations with Ctrl/⌘ are never affected.

A choice equal to the role's default is not stored (a shared device gives the next person their own default).

## Where a setting does nothing (it is then absent)

| Query (`schema.ts`) | Value                    | Effect                                                                               |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `COARSE_QUERY`      | `(pointer: coarse)`      | density is fixed at the regular size; the density setting and its command are absent |
| `NARROW_QUERY`      | `(max-width: 1023.98px)` | no side menu (the shell's `lg`); the side-menu setting and command are absent        |
| `PHONE_QUERY`       | narrow **and** coarse    | no keyboard; the single-key setting and command are absent                           |

The server cannot see the pointer: `PrefsRoot` passes a User-Agent hint (`readDeviceHints`: a phone or tablet
browser) as the SSR snapshot of `COARSE_QUERY`, so phones render the regular density from the first HTML. An
iPad that reports a desktop User-Agent is corrected after hydration. The lasting fix is CSS (request to DS3-00
below).

## DOM contract (what the provider renders)

Inside `PrefsProvider` (from the first HTML) and on `<html>` (after hydration, so portals follow; restored when the
provider unmounts):

| Attribute          | Values                   | Meaning                                                                                                                                                                                                                                 |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-density`     | `compact`, or **absent** | Selects the DS2 compact token mode (`[data-density='compact']` in `globals.css`). The regular density writes no attribute: the `:root` values apply (an explicit `default` would cancel `:root` media rules). Never on a touch pointer. |
| `data-text-size`   | `regular` \| `large`     | The text size in force. `large` also adds `@media screen{#main-content > *{zoom:var(--text-zoom-large,1.1)}}`.                                                                                                                          |
| `data-single-keys` | `on` \| `off`            | Whether single-key shortcuts may fire on this device.                                                                                                                                                                                   |

The SSR wrapper is `<div data-rm-prefs class="contents">` (no box of its own). Large text depends on the dashboard's
`#main-content` (app/dashboard/layout.tsx) having one child, its width container: the side menu, the top bar,
dialogs and toasts keep their size, as in the reference (the side menu's fit rule is measured at 100 %); printing is
never enlarged.

## API

```ts
import { usePrefs, singleKeysEnabled, useIsCoarse, useIsNarrow, useIsPhone } from '@/lib/prefs'; // client code
import { DISPLAY_COOKIE, viewDensity } from '@/lib/prefs/schema'; // server-safe constants
import { PrefsRoot, readDisplayChoices, readDeviceHints } from '@/lib/prefs/server'; // server components

const p = usePrefs();
p.density; // 'regular' | 'compact' — the CHOICE (the switch's selected value)
p.appliedDensity; // what the screen really uses ('regular' on a touch pointer)
p.viewDensity; // 'comfortable' | 'compact' — the views toolbar vocabulary, from the density in force
p.tableDensity; // 'default' | 'compact'     — DataTable's vocabulary, from the density in force
p.textSize; // 'regular' | 'large'
p.singleKeys; // boolean
p.coarse; // a touch pointer (the User-Agent hint on the server and during hydration)
p.setDensity('compact');
p.setTextSize('large');
p.setSingleKeys(false);
p.reset();

singleKeysEnabled(); // for key handlers outside React: reads the cookie on every call
```

The barrel `@/lib/prefs` re-exports client modules: server components import constants from `@/lib/prefs/schema`
and the server entry from `@/lib/prefs/server`.

## Mounting (request to DS3-02)

Mount once, around the whole shell, in `apps/web/app/dashboard/layout.tsx`, inside `NavProvider` (the provider takes
the viewer's role from it; or pass `role={active.role}`):

```tsx
<NavProvider value={...}>
  <PrefsRoot>
    <ShellFrame initialRail={rail}>…</ShellFrame>
  </PrefsRoot>
</NavProvider>
```

Until then, `app/dashboard/settings/layout.tsx` mounts its own `PrefsRoot`: the choices are saved, and they act only
while a settings screen is open (the provider restores `<html>` when it unmounts). A nested provider passes through,
so the double mount is harmless after DS3-02 lands; the settings mount can then go.

## Reading defensively before this branch is merged

Read the cookie itself (an `<html>` attribute exists only while a provider is mounted):

```ts
const m = document.cookie.match(/(?:^|;\s*)rm_display=([^;]*)/);
const keysOff = !!m && /(?:^|&)keys=off(?:&|$)/.test(decodeURIComponent(m[1]));
```

## Who reads what (requests)

- **DS3-00** — make "density is fixed on touch" a CSS fact: extend the coarse-pointer floor in `globals.css` to every
  DS2 density token (`--btn-h-primary`, `--nav-item-h`, `--chip-h`, `--fs-cell`, `--decision-row-h`, `--icon-md`, …)
  or scope `[data-density='compact']` to `(pointer: fine)`; then the User-Agent hint is no longer needed. A text-size
  token if large text should be a token.
- **DS3-01** — the views toolbar switch "מרווח / צפוף" (`lib/components/views/ViewToolbar.tsx`) becomes a reader and
  writer of `usePrefs()` (labels "רגיל / צפוף", `p.viewDensity`), instead of the `d` address parameter; `DataTable`
  takes its density from `p.tableDensity` and drops its own three-way density menu (no third density, no "מגע": the
  touch floor covers it). The selected segment of `SegmentedControl` needs a forced-colours mark (2 px `Highlight`).
- **DS3-02** — mount `PrefsRoot`; gate `/`, `?`, the G-chords and `[` on `singleKeysEnabled()`; the palette lists every
  setting (`app/dashboard/settings/_index/palette.ts` `useSettingsPaletteScreens`) and runs `useDisplayCommands()`;
  export a side-menu setter (settings synthesises Ctrl/⌘+B today); the same 7-day Safari cap applies to `rm_nav_rail`.
- **DS3-04** — the desk keys (J, K, 1, 2, Z, X) honour `singleKeysEnabled()`; arrow keys keep working; hide the
  single-key caps when it is off.
