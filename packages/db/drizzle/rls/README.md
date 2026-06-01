# Row-Level Security (RLS) policies

These SQL files codify RestoMatch's multi-tenant security boundary in the repo.
They are **not run by `pnpm db:migrate`** — apply them deliberately during the
**Phase-3 Supabase consolidation** (see `PROD-PROMPT.md`), after the Drizzle
migrations have created the tables.

## Tenancy model

Every tenant-scoped row carries a `restaurant_id`. RLS restricts each row to the
restaurant of the current request. Because RestoMatch authenticates with Auth.js
(not Supabase Auth), the active restaurant is passed to Postgres per transaction
via a GUC rather than a Supabase JWT claim:

```sql
SET LOCAL app.current_restaurant_id = '<uuid>';
```

The policies read it through `app.current_restaurant_id()`. **Wiring required:**
set this GUC at the start of every tRPC request transaction (in the tRPC context,
from `session.user.restaurantId`). Until that wiring lands, apply RLS only on a
connection role that is *not* the table owner and *not* `service_role` — both
bypass RLS.

## Files (apply in order)

1. `0001_invoice_scans_rls.sql` — lock down the `invoice-scans` Storage bucket
   (currently public) and add table RLS for `invoice_scans`.
2. `0002_core_tenant_rls.sql` — enable RLS + per-restaurant policies on every
   core table that has a `restaurant_id` column (idempotent; skips tables that
   don't).

## Important caveats

- **Storage:** switching the `invoice-scans` bucket to private requires the web
  code to serve **signed URLs** instead of `getPublicUrl()` (see
  `apps/web/lib/supabase/{client,server}.ts`). Do both together.
- **Child tables** (`invoice_lines`, `po_lines`, `gr_lines`) have no
  `restaurant_id`; protect them with join-based policies — example in
  `0002_core_tenant_rls.sql`.
- Apply to **staging first**, verify every tRPC query still returns data with the
  GUC set, then promote to production.
