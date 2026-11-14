# W3-04b · `ai_drafts`: schema-train proposal (item 4, after H-04)

This is a **proposal**, not a migration. `packages/db/drizzle/**`, `packages/db/src/schema.ts` and
`packages/db/src/rls.ts` are on the AGENTS.md immutability list, so a human-authored, owner-signed PR
applies these files. W3-04's own PRs never touch them.

| File | Goes to |
|---|---|
| `00NN_ai_drafts.sql` | `packages/db/drizzle/00NN_ai_drafts.sql` (the train assigns the number) + the journal entry |
| `schema.ts.diff` | `packages/db/src/schema.ts` (`aiDrafts` after `recipeItems`; typechecks against main 3aab830b) |
| RLS completeness | **no list entry needed**: `check-rls-completeness` queries every `restaurant_id` table, and the migration enables RLS itself |

## Review notes folded in (orchestrator, 14.11)
1. **Kill-switch boundary.** It fires at "<60 % of ≥20": 11/20 (55 %) turns drafts off, 12/20 (60 %) keeps them on, and 19 decided never fires. This is pinned in `packages/api/src/__tests__/ask-drafts.test.ts`, already on main.
2. **llm_money backstop.** `ai_drafts_body_no_shekel_check CHECK (position('₪' in "body") = 0)`. Drizzle carries no `check()` anywhere in `schema.ts` (recipes keeps its CHECKs in SQL only), so the CHECK lives in the SQL and attack case 4 asserts that the DB refuses the row.
3. **Decided consistency.** `CHECK (("status" = 'draft') = ("decided_at" IS NULL))`. `decided_by` is intentionally not tied, because ON DELETE SET NULL would break the CHECK when a user is removed. A comment says so in both the SQL and the schema.
4. **RLS.** Copied byte-for-byte from `0057_recipes.sql:84`: `ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;`, which is ENABLE only, with no FORCE. The `<table>_tenant` policy and the byte-identical `app.current_restaurant_id()` reader are the same as 0057.

## Verified locally (lab test DB, inside a rolled-back transaction)
- Applying the file twice works (idempotent). `relrowsecurity = t` and `relforcerowsecurity = f`.
- These rows are refused: ₪ in the body, empty `basis_refs`, a decided status without `decided_at`, and a negative `amount_agorot`. A valid `{{amount}}` draft is accepted.

## After the table is on main: W3-04's own PR (API + attack)
- `ask.drafts.list`: owner, manager and bookkeeper. Read-only; returns recent drafts and the acceptance stats.
- `ask.drafts.decide { id, outcome, editedBody? }`: owner and manager. Guarded by `WHERE status = 'draft'`; returns CONFLICT if the draft is already decided. Never sends anything.
- There is no public create. Only the server-side Ask tool loop (`buildDraft`) inserts drafts.
- `coverage/W3-04.ts` (fragment only):
  - `'ask.drafts.list': 'attack — ask-drafts.attack.test.ts: B lists → never sees A rows; receiver/chef FORBIDDEN'`
  - `'ask.drafts.decide': 'attack — ask-drafts.attack.test.ts: B decides A id → NOT_FOUND, A row unchanged; bookkeeper FORBIDDEN; no re-decide'`
- New `ask-drafts.attack.test.ts` (add-only):
  1. RLS under `rls_app`: A sees only A's rows, and B's insert is refused.
  2. B deciding A's draft → NOT_FOUND.
  3. The role matrix above.
  4. The DB refuses a body containing ₪, and `amount_agorot` is an integer.
  5. The kill-switch at 11 used out of 20.

## Owner summary (Hebrew, one line)
טבלה חדשה לטיוטות של RestoMatch (מכתב בקשת זיכוי, הודעה לספק, הערה להזמנה). אלה רק טיוטות: שום דבר לא נשלח בלי לחיצה, והסכום תמיד מגיע מהמערכת ולא מהבינה המלאכותית. הטבלה שומרת אם כל טיוטה התקבלה, נערכה או נמחקה, כדי לכבות את הטיוטות אוטומטית כשפחות מ-60% מהן שימושיות. כל מסעדה רואה רק את הטיוטות שלה.
