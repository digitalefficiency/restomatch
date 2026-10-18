# Row-Level Security (RLS) policies

These SQL files codify RestoMatch's multi-tenant security boundary in the repo.
They are **not run by `pnpm db:migrate`** — production application happens
deliberately during the **Phase-3 Supabase consolidation** (see `PROD-PROMPT.md`),
after the Drizzle migrations have created the tables.

**The local test DB gets them automatically:** the RLS attack suite
(`packages/api/src/__tests__/rls.attack.test.ts`) applies `0002` and creates a
non-owner `restomatch_app` role via `applyCoreTenantRls()` / `ensureRlsAppRole()`
(`packages/db/src/rls.ts`), then proves cross-tenant raw SQL is blocked.

## Tenancy model

Every tenant-scoped row carries a `restaurant_id` (child tables `po_lines`,
`gr_lines`, `invoice_lines`, `product_aliases` are scoped through their parent
with join-based policies). The active restaurant is passed to Postgres per
transaction via GUCs rather than a Supabase JWT claim (Auth.js, not Supabase Auth):

```sql
SET LOCAL app.current_restaurant_id = '<uuid>';
SET LOCAL app.current_user_id = '<uuid>';
```

**Wiring (done):** `memberProcedureBase` in `packages/api/src/trpc.ts` wraps every
member procedure in `withRestaurant()` (`packages/db/src/client.ts`) — a
transaction that sets both GUCs and rolls back the procedure's writes on error.

**Tenant creation:** no inserts are allowed without a GUC. `onboarding.createRestaurant`
generates the restaurant uuid in code and sets the GUC to it *before* inserting,
so the new row satisfies `restaurants_tenant` and `INSERT … RETURNING` can see it
(RETURNING enforces SELECT policies on the returned row).

**Worker:** connects with a service (RLS-bypassing) role **by design** — cron jobs
(baselines, daily expectations, outbox dispatch) are inherently cross-tenant.
Worker tenant safety relies on the explicit payload-ownership guards inside each
job (see `apps/worker/src/jobs/`).

## Files (apply in order)

1. `0001_invoice_scans_rls.sql` — **Supabase-only** (touches `storage.buckets` /
   `storage.objects`): lock down the `invoice-scans` Storage bucket + table RLS.
   Not applicable to a plain Postgres test DB.
2. `0002_core_tenant_rls.sql` — enable RLS + per-restaurant policies on every
   core table. Idempotent; **fails loudly** if a listed table is missing its
   `restaurant_id` column. When adding a table to the schema, add it to the
   DO-block array (or a join policy if it has no `restaurant_id`) — the RLS
   attack suite is where that omission should surface.

## Important caveats

- **Storage:** switching the `invoice-scans` bucket to private requires the web
  code to serve **signed URLs** instead of `getPublicUrl()` (see
  `apps/web/lib/supabase/{client,server}.ts`). Do both together (Phase 1, Session 3).
- RLS is bypassed by the table owner and superusers. Production must connect with
  a non-owner role (like the test `restomatch_app`); Supabase's `service_role`
  bypasses RLS and is reserved for the worker.
- Apply to **staging first**, verify every tRPC query still returns data with the
  GUC set, then promote to production.
