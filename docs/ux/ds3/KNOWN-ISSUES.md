# DS3 · known issues in the reference

The mock-ups are a proposal, not product code. Independent reviewers checked them against the product's rules;
the points below are where a mock-up is wrong, looser than an approved spec, or shows demo values. **Where this
file and the reference disagree, this file wins. Where the product's code or an approved spec and the reference
disagree, the code or the spec wins.** Two review rounds were cut short on 14.11, so this list is not complete:
check your own area as you map it.

## Production moved after the proposal was written

Train C was merged and deployed on 14.11.2026 (`main`, pull request 321, then twelve more merges). The
proposal's "today" pictures and sentences describe production before that. Much of what the proposal calls new
now exists on `main` in some form: the DS2 token system, a reworked owner home, the approvals desk with an
evidence panel and shortcut keys, the invoice register, the receiving board, a command palette. Map your area
on `main` first and build the difference only.

## Settings: the tolerance thresholds (DS3-06)

1. **The quantity rule in the mock-up is not the engine's rule.** A reviewer ran the real matching engine
   against the mock-up's preview: the engine opens an ordered-versus-received gap above the **percentage
   alone**; the unit tolerance only decides when a bill for more than was received blocks payment. The mock-up
   treats a quantity gap as needing both. Implement the preview by calling the engine (read only:
   `packages/matching/**` is on the immutability list), never by re-implementing its rule in the client.
   Confirm the rule yourself in `packages/matching/src/engine.ts` before you write copy about it.
2. Corrected field descriptions (replace the mock-up's):
   - quantity, percent: `הפרש בין מה שהוזמן למה שהתקבל נפתח כפער מעל האחוז הזה`
   - quantity, units: `חיוב על יותר ממה שהתקבל חוסם תשלום רק מעל מספר היחידות הזה`
3. **A saved threshold does not touch gaps that are already open.** Thresholds are read when an invoice is
   matched; saving starts no re-match. The mock-up's wording after saving ("בספים שבתוקף פתוחים היום 2 פערים")
   implies otherwise. After saving, state the real count of open gaps, and add
   `הספים שנשמרו חלים על חשבוניות שייבדקו מעכשיו`. Show the "לא היו נפתחים" line only while there are unsaved
   changes.
4. The mock-up lists three approval rules; the approvals engine has more (`packages/api/src/approvals/engine.ts`,
   read only). Show what the engine has.
5. Density already exists per screen: the toolbar switch "מרווח / צפוף" on approvals and the leak screens
   (`apps/web/lib/components/views/`), kept in the address. Decision D4 (7.11) asks for density by role with a
   saved personal switch worded **"רגיל / צפוף"**. DS3-06 unifies the two; it does not add a third.
6. Copy defects found in the settings mock-up: four preview lines run to 13 or 14 words (the limit is 12);
   "צור קשר" is a masculine singular imperative (use a plural form); the favourite toast "הגדרות נוסף למועדפים"
   needs rewording; the empty states use two sentences; a screen reader hears the internal words "dens",
   "text", "rail" on three controls. Fix them as you build; do not copy them.

## Side menu (DS3-02): where the mock-up is looser than `docs/ux/sidebar/SPEC.md`

The owner-approved spec wins on every point.

- Arrow keys must reach **every** row (spec §8, §14.9). In the mock-up they reach only the four linked rows and
  the group headers.
- Lists in the collapsed menu open on click (spec §7.2). The mock-up also opens on a 220 ms hover, so a click
  after a short rest closes the list it just opened.
- Tab order equals DOM order equals visual order (spec §8). In the mock-up Tab from inside a flyout list leaves
  the menu.
- Forced-colours mode (spec §6): the current row and tile get a 2 px `Highlight` outline, pills a 1 px
  `CanvasText` border, dots keep their colour. Not built in the mock-up.
- Not in the mock-up at all, but in the spec: the bell's list, the `G` shortcuts and the keys `/` and `?`, aim
  detection for the flyout, the icons' glide on collapse, the cross-fade of a changed amount, the pressed state
  (ink at 7 %), `aria-controls` on a tile.
- The fit rule may fold the "ניהול" group too (spec §4.2 exempts only the group just opened, the current
  page's group and a group holding money).
- Flyout rows have the same height as panel rows (spec §1.3). In two mock-ups they differ (32 against 28).
- Mirroring: the truck icon is never mirrored (spec §15); list icons are (spec §3).
- "לטיפולי" keeps its count when a gap becomes a credit request ready to send (spec §5.3).
- The top bar follows spec §1.5 (background, padding, the bell's size, the page name).
- The page's shortcut bug (Ctrl B acting on the wrong mock-up) is a property of a page with three menus and
  does not exist in the product.

## Approvals desk (DS3-04)

- Four of the twelve invoice lines shown on the document image, and three of the four receiving times, are
  invented demo values. The product shows the real lines.
- Train C already lists the three quantities (ordered, received, billed). What DS3 adds is the table form with
  prices and the calculation line, and dense rows instead of cards.
- The button "שלמו כפי שחויב" follows the wording in the product, which does not yet record payments. The page
  suggested considering "ישולם כפי שחויב": an owner decision, not yours.

## Owner home (DS3-03)

- The count "23 numbers on the first screen" includes four numbers in the side menu; like for like with the
  product's own meter it is 19 in the content.
- The pilot restaurant will not see: the pay run, incoming invoices, "שאלו את RestoMatch", the group "מטבח",
  integrations, and (with one branch) the group "רשת". The mock-up shows the demo restaurant with every
  feature on.

## Design language

- Google Sans has fixed-width digits only with tabular figures switched on (`font-variant-numeric:
  tabular-nums`); IBM Plex Sans Hebrew has them by default. Keep the numeric feature settings on the number
  role whatever the typeface.
- The 5:1 contrast statement holds for the clean finish (lowest measured pair 5.42:1).
