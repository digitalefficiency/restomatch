# Checks of the invoices-area reference

These scripts drive `../reference.html` in a headless browser with real pointer, touch and keyboard events. They
test the **mock-ups**, not the product: use them to read what behaviour is expected, and to confirm the reference
still works after an edit.

They need Playwright with a Chromium it can launch (`require('playwright')`). In a cloud session it is
pre-installed; `launch.cjs` finds it and passes `HTTPS_PROXY` to the browser so that the typefaces load from
Google Fonts. Working copies go to an `out` folder beside the scripts. The repository's `.gitignore` ignores it,
so nothing of it is committed.

Run a script from this folder, for example:

```bash
node verify17.cjs
```

| Script | What it checks | Result on 28.11.2026 (Version 6) |
| --- | --- | --- |
| `check.cjs [1440\|390]` | The four mock-ups end to end: the register's places, search and sort; the invoice screen; the desk by role with its keys, undo and escalation; the pay run; the roles switch; no script errors. | 74 of 74 at 1440; 72 of 72 at 390 |
| `verify10.cjs [1440\|390]` | The findings of the first independent review of the page: focus after each action, the message with "ביטול", layout at both widths. | 34 of 34 at 1440; 32 of 32 at 390 |
| `verify11.cjs [1440\|390]` | Roles and amounts: who sees which gap and which ₪, the counts on the menu, the pay run's holds. | 20 of 20 at 1440; 19 of 19 at 390 |
| `verify13.cjs` | The desk after several decisions in a row; the "הוחלט היום" group; the empty states. | 16 of 16 |
| `verify14.cjs` | A phone: the desk's detail, the dock, the page's contents bar. | 19 of 19 |
| `verify15.cjs` | The invoice screen around the supplier's document: the viewer (size, turn, drag, keys), the divider, the mark, the table and the document pointing at each other, the whole-screen dialog, the three document states. | 61 of 61 |
| `verify16.cjs` | The findings of the independent review of the document screen: scrolling handed back to the page, the dialog's focus and keys, reduced motion, names for a screen reader, what the papers print. | 53 of 53 |
| `verify17.cjs` | The findings of the confirmation review: the tag in the margin, the data pane's floor, the pinned amount by keyboard, a trackpad pinch, the keys on the viewer's tools, the sticky head, a phone without marks. | 37 of 37 |

The scripts are numbered by the review round that wrote them; there is no 12.

Known gaps of the mock-ups against the product's rules and the code are in `../../KNOWN-ISSUES.md`; a passing
check does not override that file.
