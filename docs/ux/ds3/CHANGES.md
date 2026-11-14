# DS3 · corrections after the sessions started

Newest first. When an entry names your package, refresh your copy of the handoff (`README.md`, "Where this
folder lives") and read the sections it points to. Your contract is still your section of `WORKPLAN.md`.

## 14.11.2026 · third correction

The reference's check scripts only. They keep their working copies and screenshots in `reference/checks/out/`
(ignored by git) instead of the system's temporary folder, which the repository's code scanning flags as unsafe.
No package is affected; refresh only if you run the checks.

## 14.11.2026 · second correction

From an independent review of this folder against the reference, today's code and the open pull requests.
Every item was re-checked by a second reviewer.

**All packages**

- **Receiver-language overlays.** A new key in an area receivers see needs the four overlay languages, or the
  type check fails. Each overlay file now has one owner. (`WORKPLAN.md`, "Rules of the partition")
- **A new page needs one registry line** and its labels: a permitted seam for every package. (same place)
- **Personal preferences have one contract**: the names `rm:keys:single`, `rm_density` / `rm:density`,
  `rm_text` / `rm:text`, who stores them, who applies them before first paint, who reads them. (same place)
- **Buttons.** An imperative is plural; a button or link may also be the name of what it creates or opens
  ("בקשת זיכוי", "להחלטה"). Spell "הכול". (`README.md`)
- **Undo.** Visible for 10 s; on the approvals desk the server allows 15 s on purpose. Keep the visible window
  the shorter one. (`README.md`)
- The command that runs the reference check is run from `../ds3-handoff`. (`README.md`)
- `OPEN-PRS.md` lists the open pull requests inside each boundary.

**DS3-00**

- The side menu sits on the **canvas** role, not on the surface role. (`SPEC.md` §2, §10.4)
- A card's border is `--rule`; `--line` is for the frame's edges and small chrome. (`SPEC.md` §2, §4)
- Recovered money is its own role (tier T3) whose clean value is the dark green `#00573B`; it is not the action
  role. (`SPEC.md` §2)
- Motion: add **one named set for the side menu** (80, 90, 120, 130, 160, 200 ms with
  `cubic-bezier(.2, 0, 0, 1)`), as the sidebar spec §10 fixes them. It is the only addition. (`SPEC.md` §8)
- New seam: the hard-coded copies of the canvas colour outside the tokens. Acceptance now reads "no new hex".
  (`WORKPLAN.md`, DS3-00)

**DS3-01**

- Radii: 12 px for toasts, the flyout, the palette and every control of the phone flow; 16 px only for dialogs
  and bottom sheets. Icons: 16 px in content, 20 px in menu rows and tiles, 18 px in the top bar. (`SPEC.md`
  §4 to §6)
- New seam: the registry line and labels of the kit page. The overlay files `components.ts` and `common.ts`
  are yours. The number pad (`overlay/QtyKeypad.tsx`) is yours, and `DS3-05` needs it. Both density switches
  take their default from the personal preference. (`WORKPLAN.md`, DS3-01)

**DS3-02**

- The menu sits on the page canvas, with labels in the secondary colour and the current row in ink on a white
  card. An earlier line of `SPEC.md` said "a white menu, labels in ink": that was wrong. (`SPEC.md` §10.4)
- **Lists in the collapsed menu also open after 220 ms of hover: the sidebar spec §7.2 requires it.** An
  earlier line of `KNOWN-ISSUES.md` called it a defect: that was wrong. The defect is only that a click on a
  tile whose list the hover already opened closes it. (`KNOWN-ISSUES.md`, "Side menu")
- The menu's timings come from the named motion set that `DS3-00` adds. (`SPEC.md` §8)
- Boundary: the shell's unit tests and the overlay `nav.ts` files are yours. You set `data-density` and
  `data-text` on the shell before first paint from `DS3-06`'s cookies, and the single-key switch outside the
  settings screen writes `rm:keys:single` through its store. Expect one registry line from each package that
  adds a page. (`WORKPLAN.md`, DS3-02)

**DS3-03**

- The overlay `overview.ts` files are yours. The recovered amount uses the T3 role, not the action role. The
  card "מחכה לך" mixes two VAT bases in the mock-up: state the basis beside each amount. (`WORKPLAN.md`,
  DS3-03; `KNOWN-ISSUES.md`, "Owner home")

**DS3-04**

- Undo: 10 s visible, shorter than the server's 15 s; change neither silently. Keys honour `rm:keys:single`.
  The toast and the row result "שולם כפי שחויב" keep the product's current wording, like the button. Empty
  state: "הכול מטופל" in the panel, "אין פערים פתוחים" in the queue. The dock slip's strings are in your
  message area. (`WORKPLAN.md`, DS3-04; `SPEC.md` §10.2; `KNOWN-ISSUES.md`)

**DS3-05**

- Boundary narrowed: the overlay files of `nav`, `components`, `common` and `overview` belong to other
  packages.
- **The flag needs two edits** (`features.ts` and the mirror in `pilot-setup.ts`, pilot value off), and **the
  demo restaurant has `features.all`**, which switches a new key on: the existing receiving specs must set your
  key to `false`, your own spec sets it to `true`, and the pull request says the demo restaurant shows the new
  order.
- The number pad belongs to `DS3-01`; the offline queue is `apps/web/lib/pwa/**`; the dock slip's strings
  belong to `DS3-04`. Phone controls have a 12 px radius. (`WORKPLAN.md`, DS3-05; `SPEC.md` §5, §10.3)

**DS3-06**

- **The quantity rule, exactly**, in three parts: when a gap opens, what sets its severity, when a bill blocks
  payment. Take your wording from the engine's code. (`KNOWN-ISSUES.md`, "Settings", item 1)
- **Saving re-checks nothing, but an open invoice that is checked again later reads the new thresholds.** Do
  not promise that open gaps stay open for good. (`KNOWN-ISSUES.md`, item 3; `SPEC.md` §10.5)
- The preference names are fixed, because three other packages read them; the store is yours. A new settings
  page needs its registry line. (`WORKPLAN.md`, DS3-06 and "Rules of the partition")

**DS3-07**

- Two budgets, both pinned by a test: the preloaded Hebrew file at most 50 KB, the four weights together at
  most 100 KB. The `themeColor` line of `apps/web/app/layout.tsx` is `DS3-00`'s seam. (`WORKPLAN.md`, DS3-07)

## 14.11.2026 · first correction (`b2dcb872`)

The reference only: the settings preview follows the matching engine's quantity rule; Ctrl B acts on the
mock-up under the pointer; the document lines and receiving times of the approvals mock-up are the demo
restaurant's. (`DS3-06`, `DS3-02`, `DS3-04`)
