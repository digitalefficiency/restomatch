# `lib/prefs` — personal display preferences (DS3-06)

Density, text size and single-key shortcuts: the display choices a person makes in **הגדרות → תצוגה**.
They belong to the **device**, not the account (owner decision 6, 14.11.2026: "preferences are per device,
as today"), act at once, need no save button, and apply from the first HTML (no flash). No schema change and
nothing in `packages/db`.

## Storage keys (read these, do not invent new ones)

| Where | Key | Value | Lifetime |
| --- | --- | --- | --- |
| Cookie (first-party, not HttpOnly, `path=/`, `samesite=lax`, `secure` on https) | `rm_display` | `key=value` pairs joined by `&`, fixed tokens, **only explicit choices**: `density=regular\|compact`, `text=regular\|large`, `keys=on\|off`. Example: `density=compact&keys=off`. Absent cookie or key = the default. | 1 year |
| BroadcastChannel (no storage) | `rm-display` | message `'changed'`: other tabs re-read the cookie | — |

Nothing is kept in localStorage. The cookie is listed for the cookie policy page
(`app/(marketing)/cookies/page.tsx`, category "preference") — a request to that page's owner.

**Defaults** (when a key is absent):

- density: by role, decision D4 (OWNER-DECISIONS-0711) — bookkeeper `compact` ("צפוף"); owner, manager, chef,
  receiver `regular` ("רגיל"). On a phone or a touch pointer density is fixed at the touch size whatever the
  choice (SPEC §7, D4 "field mode fixed"; `globals.css` floors coarse pointers).
- text size: `regular`. `large` sets the root font size to 110 % (`TEXT_SCALE`), as the reference's 1.1.
- single-key shortcuts: on. Combinations with Ctrl/⌘ are never affected.

A choice equal to the role's default is not stored (a shared device gives the next person their own default).

## DOM contract (what the provider renders)

Inside `PrefsProvider` (from the first HTML) and on `<html>` (after hydration, so portals follow; restored when the
provider unmounts):

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-density` | `default` \| `compact` | Selects the DS2 token density mode (`[data-density]` blocks in `globals.css`). `default` on a phone. |
| `data-text-size` | `regular` \| `large` | The text size in force. `large` also adds `:root{font-size:110%}`. |
| `data-single-keys` | `on` \| `off` | Whether single-key shortcuts may fire on this device. |

The SSR wrapper is `<div data-rm-prefs class="contents">` (no box of its own).

## API

```ts
import { usePrefs, singleKeysEnabled, viewDensity, tableDensity } from '@/lib/prefs';
import { PrefsRoot } from '@/lib/prefs/server';

const p = usePrefs();
p.density          // 'regular' | 'compact' — the choice in force (role default applied)
p.appliedDensity   // what the screen really uses ('regular' on a phone)
p.textSize         // 'regular' | 'large'
p.singleKeys       // boolean
p.touch            // phone / touch pointer (false on the server and during hydration)
p.setDensity('compact'); p.setTextSize('large'); p.setSingleKeys(false); p.reset();

singleKeysEnabled() // for key handlers outside React
viewDensity(p.density)  // 'comfortable' | 'compact' — the views toolbar vocabulary
tableDensity(p.density) // 'default' | 'compact'     — DataTable's vocabulary
```

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

Until then, `app/dashboard/settings/layout.tsx` mounts its own `PrefsRoot`, so the settings screens apply the choices
(a nested provider passes through, so the double mount is harmless after DS3-02 lands).

## Reading defensively before this branch is merged

```ts
// single-key shortcuts (DS3-04 desk keys, DS3-02 hotkeys)
const keysOn = document.documentElement.dataset.singleKeys !== 'off';
// or straight from the cookie
const m = document.cookie.match(/(?:^|;\s*)rm_display=([^;]*)/);
const keysOff = !!m && /(?:^|&)keys=off(?:&|$)/.test(decodeURIComponent(m[1]));
```

## Who reads what (requests)

- **DS3-01** — the views toolbar switch "מרווח / צפוף" (`lib/components/views/ViewToolbar.tsx`) becomes a reader and
  writer of `usePrefs()` (labels "רגיל / צפוף", `viewDensity()`), instead of the `d` address parameter; `DataTable`
  takes its default density from `tableDensity(usePrefs().density)`. No third density.
- **DS3-02** — mount `PrefsRoot`; gate `/`, `?`, the G-chords and `[` on `singleKeysEnabled()`; the palette lists every
  setting (`app/dashboard/settings/_index`) and runs the display commands.
- **DS3-04** — the desk keys (J, K, 1, 2, Z, X) honour `singleKeysEnabled()`; arrow keys keep working.
