# DS3 · the clean finish

**Status, 14.11.2026:** direction approved by the owner; implementation in flight as separate work packages,
one coding session and one draft pull request each. Nothing here ships without the owner's merge
(`AGENTS.md`: pull requests only).

## What this is

DS3 is the next version of the product's look and behaviour, on top of DS2 (train C, in production since
14.11.2026). It comes from a design proposal the owner reviewed: four live mock-ups (owner home, approvals
desk, delivery check on a phone, the shell with the side menu and settings), a design language, a motion
chapter, a component kit and a front-end chapter.

The owner's words on 14.11.2026:

> אני מאוד אוהב את כל מה שעשית. אתה צריך לפתוח מלא סשנים שימלאו את כל מה שבנית עד עכשיו בעיצוב הנקי.

So: build everything the proposal shows, in the **clean** finish ("נקי").

## What is in this folder

| Path | What it is |
| --- | --- |
| `SPEC.md` | The design spec of the clean finish: colour, type, shape, controls, status language, icons, density, motion, and the five screens. Binding for every package. |
| `WORKPLAN.md` | The work packages `DS3-00` … `DS3-07` (batch 1) and the later batches: goal, write boundary, upstream, slices, acceptance. Binding for every package. |
| `KNOWN-ISSUES.md` | Where the mock-ups are known to be wrong or looser than the product's own rules. Read it before copying behaviour or wording from the reference. |
| `CHANGES.md` | Corrections to this folder made after the sessions started, newest first. |
| `OPEN-PRS.md` | The open pull requests whose files fall inside each package's boundary, as of 14.11.2026. |
| `reference/reference.html` | The mock-ups and the kit in the clean finish, live, in one standalone page. **The visual and behavioural source of truth.** |
| `reference/src/` | The sources of that page: `product.css` (the look), `script.js` (the behaviour), `ex1.html` … `ex4.html`, `kit.html`, `sprite.html` (60 icons), `kit-sources.json`. |
| `reference/PAGE-TEXT.he.md` | The Hebrew text of the proposal page: what changes on each screen and why, with sources. Its "היום" statements describe production **before** train C; see the note at its top. |
| `reference/checks/` | The automatic checks that the reference passes (menu and settings behaviour, contrast, text and target sizes, the kit). They are executable descriptions of expected behaviour. |

## Decisions: what is settled and what is not

| # | Question on the proposal page | Status | What the packages do |
| --- | --- | --- | --- |
| 1 | Build the design system from the four examples? | **Approved** 14.11. | Everything in `WORKPLAN.md`. |
| 2 | Which finish? | **Clean**, chosen 14.11. The warm-paper finish and the dark-rail finish are dropped. | No warm paper, no brass, no second numeral typeface, a light side menu. Recovered money is green. |
| 3 | Replace IBM Plex Sans Hebrew with Google Sans? | **Not answered explicitly.** The approved mock-ups render in Google Sans; the standing decision (D2, 7.11, reaffirmed 11.11) is Plex. | Isolated in `DS3-07` as its own pull request. Every other package is typeface-agnostic and uses the UI font role. The owner decides by merging or closing that one pull request. |
| 4 | Small change on production first, new screens on train C? | **Moot.** Train C is production since 14.11. | Everything builds on `main`. |
| 5 | Dock: count before the photo, quantity field opens empty? | **Not answered.** The page said to check with the receivers first. | `DS3-05` builds it behind a feature flag that is **off** by default. Merging changes nothing for the pilot restaurant. |
| 6 | Side menu to the spec approved on 31.10, plus the settings screen? | **Approved** with the page's recommendations: preferences are per device (as today); groups open on entry as the spec says; text size, and settings and display commands inside Ctrl K. | `DS3-02`, `DS3-06`. |

Not proposed and not to be built (never decided by the owner): reordering, hiding, renaming or resizing the side
menu; a dark theme; an accessibility overlay widget; a recents tray; expanding the collapsed menu on hover; a
rule builder; self-service plan changes; new notification schedules; a PIN or shared-device mode.

## Rules every package keeps

`AGENTS.md` is binding in full (pull requests only, the immutability list, the ownership map, the retry cap of
two, an artifact for every run). On top of it, the owner's rules that the proposal was reviewed against:

- **Light product only.** Every text and background pair passes WCAG AA (4.5:1); the reference holds 5:1.
- **Emphasis tiers T1 to T4 keep their meaning** (`AGENTS.md`, "Design vocabulary"). DS3 changes how they look,
  never what they mean.
- **A money figure is never red.** Ink, muted, green or the brand colour only. The single approved exception is
  the solid red pill with white text in the side menu (sidebar spec).
- **Pending is never a warning.** Waiting and consolidated invoices are neutral (T4).
- Never show "1.5%" or the word "יעד". Never write "דרישה" or "תביעה": the term is **"בקשת זיכוי"**. None of
  "נחסם", "נחסך", "הפסד", "חיסכון", "חריגה", "ריכוז" in new copy.
- Buttons: at most 4 words. A button that tells the person to act is in the plural imperative ("שמרו", "שלמו
  כפי שחויב"); a button or link may also be the name of what it creates or opens, as the product's glossary
  already has it ("בקשת זיכוי", "להחלטה"). Never a singular imperative. A visible line: one sentence, at most
  12 words. A toast: at most 8 words. Gender-neutral Hebrew (no gendered second-person forms). Spell "הכול".
- ₪ sits left of the digits; every ₪ goes through `formatIls()` / the shared money component; the VAT basis is
  stated beside an amount; numbers are physically right-aligned in columns.
- Dates `dd.MM.yyyy`; date and time `dd.MM.yyyy · HH:mm`.
- Undo is visible for 10 s where the proposal shows one. On the approvals desk the server allows a little
  more on purpose (`REOPEN_WINDOW_MS`, 15 s), so that a click at the last moment still lands: keep the visible
  window shorter than the server's, and change neither without saying so in the pull request.
- Touch targets at least 44 px on a phone; desk text at least 12 px; one filled primary button per viewport.
- Receivers never see ₪; chefs see ₪ only where they do today.
- Radii 8 (control) · 12 (card) · 16 (overlay), as decision D6 already set.
- No colour, size, radius, shadow, duration or easing is hard-coded outside the tokens. The side menu's
  timings come from the one named motion set that `DS3-00` adds for it (`SPEC.md` §8).
- A new key in the message areas that receivers see (`nav`, `components`, and the parts of `common` and
  `overview` that `apps/web/lib/__tests__/receiver-langs.test.ts` lists) must be added in all four overlay
  languages (ar, ru, th, ti) in the same pull request, or the type check fails. `WORKPLAN.md` says which
  package may edit which overlay file.

The owner-decision documents that older specs cite (`OWNER-DECISIONS-0711.md`, `KICKOFF-0711.md`,
`terms/GLOSSARY.md`, the DS2 spec and verdict) are not on `main`; they live on the kit branch
`claude/wave2-kit-addendum-0711`. Fetch and read them there.

## How a package works

1. **Read first:** `AGENTS.md`, `STATE.md`, this file, `SPEC.md`, your section of `WORKPLAN.md`,
   `KNOWN-ISSUES.md`, then open `reference/reference.html` at 1440 px and at 390 px and use the mock-up of your
   area. The sidebar package also reads `docs/ux/sidebar/SPEC.md` (owner-approved 31.10): where the mock-up and
   that spec differ, the spec wins.
2. **Map before you change.** The proposal was drawn before train C reached production. Part of it already
   exists on `main` in some form. List what exists, what differs and what is missing, and build only the
   difference. Reuse and extend the DS2 components; do not create a parallel set.
3. **Stay inside your write boundary** (`WORKPLAN.md`). The only edits allowed outside it are the seam lines
   that your section names. Need something from another package: take it from its branch when it is there
   (see "Upstream" below); otherwise build it locally inside your boundary and list it in your pull request
   under "Promote to shared".
4. **Check the open pull requests** that touch your boundary before you start and before you finish. Where one
   overlaps, say so in your pull request and keep your change easy to rebase. Never push to someone else's
   branch.
5. **Verify like a user.** Run the app with the demo seed and look at your screen as each role that can reach
   it, at 1440 px and 390 px, in Hebrew and one more language. Compare with the reference side by side. Keep
   the gates green (`AGENTS.md`, "Test / CI facts"); add or update the e2e spec of your screen.
6. **Open one draft pull request and stop.** Title `ux(DS3-NN): …`. Body sections: What · Why · Write boundary
   · Evidence (before and after screenshots at both widths) · Tests · Owner decisions touched · Requests to
   other packages · Promote to shared · Not done.

### Upstream

`main` ← `DS3-00` (tokens) ← `DS3-01` (shared components) ← the screen packages `DS3-02` … `DS3-06`.
`DS3-07` (typeface) stacks on `DS3-00`.

A screen package starts from `main` and consumes the DS2 roles and components by name, so it compiles from day
one. When an upstream branch has something you need, `git fetch origin <branch>` and merge it into yours; then
your pull request's base is that upstream branch (a stacked pull request, as this repository already does).
Before you finish, merge the latest upstream and look at your screen again with the new values.

### Where this folder lives until it is merged

Branch `claude/admiring-faraday-3oxulo` (a docs-only draft pull request). From a checkout of `main`:

```bash
git fetch origin claude/admiring-faraday-3oxulo
```

```bash
git worktree add ../ds3-handoff origin/claude/admiring-faraday-3oxulo
```

Then read `../ds3-handoff/docs/ux/ds3/`. Do not copy the folder into your own branch. The branch moves when
the handoff is corrected; to refresh:

```bash
git -C ../ds3-handoff fetch origin claude/admiring-faraday-3oxulo && git -C ../ds3-handoff checkout --detach origin/claude/admiring-faraday-3oxulo
```

`CHANGES.md` in this folder lists every correction made after the sessions started, newest first.

### Using the reference

```bash
cd ../ds3-handoff && node docs/ux/ds3/reference/checks/ref-check.cjs "$PWD/docs/ux/ds3/reference/reference.html" 1440 /tmp/ds3-shots
```

That loads the page headless, reports script errors and what rendered, and writes one screenshot per mock-up.
`reference/checks/README.md` lists the other checks. The reference loads its two typefaces from Google Fonts;
without network access it falls back to a system font and widths shift a little.
