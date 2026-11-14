# Checks of the DS3 reference

These scripts drive `../reference.html` in a headless browser. They test the **mock-ups**, not the product:
use them to read what behaviour is expected, and to confirm the reference still works after an edit.

They need Playwright with a Chromium it can launch (`require('playwright')`). In a cloud session it is
pre-installed; the scripts pass `HTTPS_PROXY` to the browser so that the two typefaces load from Google Fonts.
Screenshots and working copies go to an `out` folder beside the scripts. The repository's `.gitignore` ignores
it, so nothing of it is committed.

| Script | What it checks | Result on 14.11.2026 |
| --- | --- | --- |
| `ref-check.cjs <abs path to reference.html> [width] [out dir]` | No script errors; every mock-up rendered; one screenshot per mock-up. | 0 errors at 1440 and 390 |
| `menu-check.cjs [1440\|390]` | The side menu and the settings screen: geometry, folding, the fit rule, the collapsed rail and its lists, the pin, keys, favourites, thresholds preview, save, undo, restore, search, palette, the desk menu's amounts, the phone. | 139 of 139 at 1440; 11 of 11 at 390 |
| `audit.cjs [1440\|390]` | Contrast of every text node against its real background, text sizes, target sizes, across the states of every mock-up. | 0 findings; lowest contrast 5.42:1 |
| `kit-check.cjs [1440\|390]` | The fifteen kit cards, the palette demo, density on the desk and in the kit. | no errors, no overflow |

Known gaps of the mock-ups against the product's rules are in `../../KNOWN-ISSUES.md`; a passing check does not
override that file.
