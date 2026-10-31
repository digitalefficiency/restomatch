# Pilot tenant setup (pilot:config → pilot:setup → pilot:verify)

How a real, empty restaurant tenant is created in the shared production database, next to the demo tenant.

**Who runs what:**
- **The owner (Rom)** runs these commands against production, from his own machine.
- **Agents** only build and test them on a local Postgres. They never point them at a remote database.

**Where configs live:** keep tenant configs **outside the repo**, in `~/restomatch-pilot/`. They contain real names, emails and phone numbers. Inside the repo, `packages/db/scripts/pilot.local.json` and `*.pilot.json` are gitignored as a safety net.

## 0. Intake spreadsheets → config (optional, recommended)

Export the three intake sheets to CSV (UTF-8) into one folder, then:

```bash
pnpm --filter @restomatch/db pilot:config -- --from-csv ~/restomatch-pilot/tziki --out ~/restomatch-pilot/tziki.json
```

| File | Columns (extra columns are ignored) |
|---|---|
| `restaurant.csv` | one row: שם, ח״פ, כתובת |
| `staff.csv` | שם מלא, תפקיד (בעלים / מנהל / מקבל סחורה / שף / הנהלת חשבונות), מייל, נייד, שפה (he / en / ar / ru / ti / th) |
| `suppliers.csv` | שם הספק, ח״פ, איש קשר, נייד, מייל להזמנות, ימי הזמנה (e.g. `א,ג,ה`), שעת סגירה (HH:MM), ימי אספקה, מע״מ (18% / 0%), חשבונית מרכזת (כן / לא), optional תנאי תשלום |

These are the bare headers of S6's onboarding templates (`docs/pilot/chikti/templates/`, how to fill them: `HOW-TO-FILL.he.md`). A header with a trailing parenthetical, such as `מע״מ (18%|0%)`, is read the same.

How the CSV values are turned into the config:
- **Validation:** every unknown value stops the run with the file, row and column.
- **Flags:** the features map is the standard pilot list (`PILOT_FEATURES` in `pilot-config.ts`).
- **Order schedule:** each order day gets one window. The order is delivered on the next listed delivery day after it, and closes at the cutoff.
- **Info only:** the address, the contact person and "חשבונית מרכזת" are kept in the config but have no database column yet.

Or start from a template instead:
- `packages/db/scripts/pilot.example.json` (a customer);
- `packages/db/scripts/pilot.qa.example.json` (the internal QA tenant).

## 1. Dry-run (the default: changes nothing)

```bash
export DATABASE_URL='<owner session-pooler URL, see docs/client-ready/RESEED-PROD.md §2–3>'
export SEED_ALLOW_REMOTE_HOST='aws-0-<region>.pooler.supabase.com'   # the URL's exact host
PILOT_CONFIG=~/restomatch-pilot/tziki.json \
  pnpm --filter @restomatch/db pilot:setup -- --expect-project <project ref>
```

The script runs the **whole** plan inside one transaction, prints it and then **rolls back**:
- one line per row, saying `create`, `update` or `skip`;
- totals per table;
- a last line `PLAN-HASH=<sha256>`.

Read the plan. Only this tenant's names and emails appear in it.

## 2. Apply exactly what you reviewed

```bash
PILOT_CONFIG=~/restomatch-pilot/tziki.json \
  pnpm --filter @restomatch/db pilot:setup -- --expect-project <ref> --apply --plan-hash <hash from step 1> --confirm <business id>
```

It commits only if the plan recomputed now has the **same hash** and `--confirm` equals the config's business id. If anything changed in between (the config or the database), it refuses. Dry-run again.

## 3. Members set their passwords

No password is created. Each person opens `/login` → **שכחתי סיסמה** and sets one. If the members exceed the plan's seats (implicit trial 5, Pro 10), the run prints a warning.

## 4. Verify (read-only)

```bash
PILOT_CONFIG=~/restomatch-pilot/tziki.json \
  pnpm --filter @restomatch/db pilot:verify -- --restaurant <id printed by step 2> --expect-project <ref>
```

It runs inside `BEGIN READ ONLY` and prints PASS / FAIL / SKIP per check, then `VERIFY: PASS|FAIL`. The checks:
- the restaurant, its tolerances and its flags;
- the storage namespace;
- each supplier's VAT rate;
- no user in both the demo and a real tenant;
- platform admins by email domain;
- RLS on every tenant table;
- no anon/authenticated grants;
- the private invoice-scans bucket;
- billing.

If `platform_admins` fails with the demo domain, re-run the demo reseed **without** `DEMO_PLATFORM_ADMIN=1`.

## Guards (all checked before any write)

| Refused when | Why |
|---|---|
| `PILOT_CONFIG` is missing | there is no built-in example tenant any more |
| `--expect-project` is missing, or doesn't match the URL | a local DB needs `local`. A remote DB needs `SEED_ALLOW_REMOTE_HOST` = the exact host, and the Supabase ref (pooler user `postgres.<ref>` or host `db.<ref>.supabase.co`) = `<ref>`. Together with `--confirm` that makes 3 identifiers, as in the demo reseed |
| the demo business id, a demo name, a demo restaurant, a member at `@kfar-hazeitim.test`, any `.test` email, or a member of the demo tenant | the pilot tenant never touches the demo |
| the business id exists under a different name | pass `--update-existing` only when renaming on purpose |
| `features.all`, or an unknown flag | a pilot gets an explicit list (keys: `PILOT_FEATURE_KEYS`, kept equal to the app's `FEATURE_KEYS` by a test) |
| a supplier VAT other than 0 / 0.18, an invalid ח.פ check digit, or a bad `orderSchedule` | a wrong VAT rate shows up as fake leak (VAT_MISMATCH) |
| `--with-pos` with `--apply` but without `--allow-pos` | initial POs are for demos and dry runs, not for a live tenant |

## What a re-run does

The script is idempotent:
- the restaurant is matched by business id;
- users by email;
- memberships by user + restaurant + role;
- suppliers by business id, then by normalised name;
- products by normalised name.

It changes only what differs:
- **Settings are merged, never replaced.** Default tolerances and `baselineWindowDays` are written only where absent. Flags are merged key by key, so a flag turned on in the app stays on.
- **Nothing is ever deleted.**

## Undo a wrong apply

- **Wrong details or flags:** fix the config, dry-run, and apply. Use `--update-existing` if the name changed.
- **A wrong member:** remove them in `/dashboard/team`.
- **Never hand-delete rows** in the database.
