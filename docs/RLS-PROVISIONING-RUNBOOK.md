# RLS Provisioning Runbook (Epic 0.3 / 0.4)

> 🔒 **STOP-FOR-APPROVAL.** RLS + role provisioning and the audit-immutability
> layer have a manual cutover that does **not** go through `pnpm db:migrate`
> (`packages/db/drizzle/rls/0002` header; `DEPLOY_CUTOVER.md`). A mistake is
> either a cross-tenant exposure or an outage. Apply to **staging first**, get
> explicit human approval, then production. This PR ships the *automation and the
> guards* — it does **not** apply anything to production.

## What gets applied (idempotent)

| Artifact | File | Effect |
|----------|------|--------|
| Core tenant RLS | `drizzle/rls/0002_core_tenant_rls.sql` | enables RLS + per-`restaurant_id` policies on every tenant table; **fails loudly** if a `restaurant_id` table is missing a policy (completeness invariant). |
| Audit immutability | `drizzle/rls/0003_audit_immutable.sql` | splits `audit_log` into append-only SELECT+INSERT policies + a BEFORE UPDATE/DELETE trigger (tamper-evident). |
| App role | `ensureRlsAppRole` (`src/rls.ts`) | creates the non-owner `restomatch_app` login role and grants/revokes (incl. `REVOKE UPDATE, DELETE ON audit_log`). |
| Storage RLS (opt-in) | `drizzle/rls/0001_invoice_scans_rls.sql` | Supabase-only; private bucket + storage.objects policies. Gated by `PROVISION_STORAGE_RLS=1`. |

## Procedure (staging → prod)

1. **Dry-run on a staging branch / DB clone:**
   ```sh
   DATABASE_URL='postgres://<owner>@<staging>/<db>' pnpm --filter @restomatch/db provision-rls
   DATABASE_URL='postgres://<owner>@<staging>/<db>' pnpm --filter @restomatch/db check-rls
   ```
   `provision-rls` applies 0002 + 0003 + the app role. `check-rls` exits non-zero
   if any `restaurant_id` table still lacks RLS (the drift gate).
2. **Verify tenant traffic still works** with the app role connection (run the
   RLS attack suite against the staging DB; every tRPC read must still return
   data with the GUC set).
3. **Repair pre-conditions** flagged by either step (e.g. a new tenant table not
   in the 0002 policy array; cross-tenant `products.supplier_id` offenders for
   migration 0019).
4. **Approval gate** — get explicit sign-off before touching production.
5. **Production:** repeat step 1 against prod (owner connection), then point
   `DATABASE_URL_APP` at `restomatch_app`. The web boot guard
   (`assertAppRoleNoBypass` + `assertRlsEnabled`, `apps/web/lib/env.ts`, wired in
   `instrumentation.ts`) refuses to serve tenants if the role bypasses RLS or any
   `restaurant_id` table is unprotected.

## Runtime + CI guards (this PR)

- **Boot:** `instrumentation.register()` runs `assertAppRoleNoBypass(db)` then
  `assertRlsEnabled(db)` whenever the app role is in use (prod always; dev when
  `DATABASE_URL_APP` is set). The `ALLOW_OWNER_DB=1` dev escape hatch skips the
  guard and is **rejected in production** by `assertWebEnv`.
- **Fail-closed DB url:** `resolveWebDbUrl()` requires `DATABASE_URL_APP`; it only
  falls back to the owner `DATABASE_URL` under `ALLOW_OWNER_DB=1` / `NODE_ENV=test`.
- **CI:** `check-rls` / the 0002 completeness invariant (exercised by the RLS
  attack suite) fail the build if a `restaurant_id` table is added without a
  policy.

## Rollback

- App role: provisioning is additive + idempotent; the app role can be dropped
  (`drop role restomatch_app`) after repointing `DATABASE_URL_APP`.
- Audit immutability: `drop trigger audit_log_no_update_delete on audit_log;` and
  restore the 0002 `audit_log_tenant` ALL policy + re-grant.
- Migration 0019 (composite FK): `alter table products drop constraint
  products_supplier_same_tenant_fk;` then restore the single-column FK.
