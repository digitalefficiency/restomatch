# Pilot QA — one journey, three stages

One suite walks a **brand-new, empty restaurant** from first login to a claims letter and asserts
the owner decisions. It runs in three places, each with its own approval:

| Stage | Where | Who runs it | Approval | Writes? |
|---|---|---|---|---|
| **A** — lab | local production build, local Postgres | anyone (agents included) | none — local only | local DB only |
| **B** — `PILOT_PROBE=public` | production | anyone, after a promote | none — GETs only, no login | no |
| **B** — `PILOT_PROBE=readonly` | production | **Rom only** | Rom (logs in as the QA users) | no (login only) |
| **C** — `PILOT_PROBE=write` | production's **QA tenant** | **Rom only** | Rom, per run | yes, QA tenant only |

`OPERATING.md` binds all of it: no agent logs in to production, and nothing in this suite runs
against the pilot customer's tenant or the demo tenant. Files: `scripts/pilot-lab.sh`,
`apps/web/e2e/pilot/` (separate config — not part of the shared e2e suite or of blocking CI).

## What the journey asserts (owner decisions)

- No "1.5%" and no "יעד" (target) on any screen it visits.
- Chef and receiver see no ₪ (receiver on a Pixel 7 phone context; office roles at 1440 px).
- Chef and orders: `CHEF_CAN_CREATE_ORDERS` in `apps/web/e2e/pilot/support.ts`. The owner hasn't
  decided yet, so it asserts today's behaviour (`true`). Flip it once the decision is made.
- ₪ amounts are never left-aligned in RTL. Each worker signs in with their own email and password.
- Terminology: מרכזת / פער / דרישת זיכוי / קבלת סחורה (`TERMINOLOGY` in `support.ts`).
- The cookie banner shows on a fresh visit; `/accessibility` and `/privacy` return 200.
- Isolation: one branch (no switcher entries beyond the tenant itself), no demo supplier name on
  any visited screen, and a demo PO id is not-found or forbidden.

Steps that wait on an unmerged PR are `test.fixme`, with the PR named in `WAITS`
(`pilot-journey.spec.ts`):
- 5b (6 MB photo upload) waits on W1-06's image shrink.
- 8, 9 and 11 (approve/reject/undo, the claims letter, a manual line on an OCR-failed invoice) wait
  on S2's manual invoice lines. Without OCR keys, a fresh tenant gets no invoice lines.

## Stage A — local lab

Needs Postgres 16 + pgvector on localhost and pilot-setup v2 on the tree
(`packages/db/scripts/pilot-setup.ts` with `--plan-hash`).

```bash
service postgresql start
scripts/pilot-lab.sh                 # fresh DB → build → serve → cron → journey → stop
scripts/pilot-lab.sh up              # same, but keep serving on :3400 (Ctrl-C stops it)
PILOT_LAB_SKIP_BUILD=1 scripts/pilot-lab.sh   # reuse apps/web/.next built from THIS tree
```

What it does:
1. Drops and recreates `restomatch_pilotlab`, then migrate → provision-rls → check-rls.
2. Seeds the demo tenant next door (isolation evidence only).
3. Runs pilot-setup v2 with a config made from `packages/db/scripts/pilot.qa.example.json` (five
   roles, no suppliers or products): `--dry-run`, then `--apply --plan-hash … --confirm …`.
4. Sets lab passwords. `e2e/pilot/lab.ts` refuses any `DATABASE_URL` that isn't
   localhost/127.0.0.1.
5. Runs `next build` and `next start` with the CI placeholder env (as `scripts/verify.sh`
   layer 2: `RESEND_API_KEY` / `EMAIL_FROM` / `SUPABASE_SERVICE_ROLE_KEY` placeholders, no
   `ANTHROPIC_API_KEY`).
6. Emulates the cron with GET `/api/cron/jobs` every 60 s, using a lab `CRON_SECRET`.

Output, under `apps/web/test-results/pilot/`:
- `report/index.html` — the HTML report, with a screenshot per step;
- `report.json`;
- `artifacts/` — traces and failure screenshots;
- `lab/` — DB, pilot-setup, build, server and cron logs.

Env knobs: `PILOT_LAB_PG_BASE`, `PILOT_LAB_DB`, `PILOT_LAB_PORT` (3400), `PILOT_LAB_PASSWORD`.

## Stage B — production probe (read only)

`EXPECTED_SHA` is the commit that was just promoted. healthz must report it.

```bash
cd apps/web
# public: GETs only, no login. Anyone may run it after a promote.
PILOT_PROBE=public PILOT_BASE_URL=https://restomatchrrr.vercel.app EXPECTED_SHA=<sha> \
  pnpm exec playwright test -c e2e/pilot/playwright.pilot.config.ts

# readonly: Rom only, after each promote and Sun 8.11 05:30. Credentials come from env vars
# (never from a file in git): PILOT_<ROLE>_EMAIL / PILOT_<ROLE>_PASSWORD for
# ROLE in OWNER MANAGER RECEIVER [CHEF BOOKKEEPER]; optional PILOT_TENANT_CONFIRM.
PILOT_PROBE=readonly PILOT_BASE_URL=https://restomatchrrr.vercel.app EXPECTED_SHA=<sha> \
  pnpm exec playwright test -c e2e/pilot/playwright.pilot.config.ts
```

- **public** checks:
  - `/api/healthz` is ok and `commit` = `EXPECTED_SHA`;
  - `/api/healthz?jobs=1` is ok. If the response has no `jobs` section yet, the check is a plain
    liveness check and the report notes it.
  - `/login`, `/accessibility` and `/privacy` return 200;
  - the cookie banner is visible.
- **readonly** adds, per role whose env vars are set:
  - login lands on `/dashboard`;
  - the session's tenant is "RestoMatch QA (פנימי)" (and `PILOT_TENANT_CONFIRM`, if set) — on any
    other tenant the run stops;
  - no target copy;
  - no ₪ for receiver and chef;
  - one branch.

## Stage C — the journey on production's QA tenant (Rom only)

```bash
cd apps/web
PILOT_PROBE=write PILOT_BASE_URL=https://restomatchrrr.vercel.app \
PILOT_TENANT_CONFIRM=<QA restaurant id> \
PILOT_OWNER_EMAIL=… PILOT_OWNER_PASSWORD=… PILOT_MANAGER_EMAIL=… PILOT_MANAGER_PASSWORD=… \
PILOT_RECEIVER_EMAIL=… PILOT_RECEIVER_PASSWORD=… [PILOT_CHEF_… PILOT_BOOKKEEPER_…] \
  pnpm exec playwright test -c e2e/pilot/playwright.pilot.config.ts
```

Guards:
- `PILOT_TENANT_CONFIRM` is required.
- After **every** login, the session's restaurant id must equal it and the shell must show
  "RestoMatch QA (פנימי)". The first mismatch stops the run, and no further login is attempted.
- Supplier names carry a run tag (`QA-<MMDDhhmm>`), so each run's rows are its own.
- Lab-only steps are skipped: the brand-new-tenant empty state, and back-dating a PO to make it
  late.

What Stage C writes, on the QA tenant only:
- two suppliers, a 3-line catalog, two record-only orders (channel "ללא שליחה" — nothing is sent
  to a supplier), and one closed receipt;
- a CSV export download.

## Running the probe here (agents)

This container's egress blocks `*.vercel.app`, so even `PILOT_PROBE=public` can't reach
production from an agent session. Rom (or any machine with normal egress) runs it.
