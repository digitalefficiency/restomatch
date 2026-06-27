# PR1 — invoice-scans storage isolation · PRODUCTION APPLY RUNBOOK

> Security-critical, LIVE multi-tenant SaaS. Read the whole file before running
> anything. Commands are written for a human operator with the **owner / direct**
> Postgres connection and Supabase dashboard access. Nothing here runs in CI or
> by code — it is a deliberate, ordered, manual cutover.
>
> Branch: `feat/storage-isolation`. Implements Epic A items A.1, A.2, A.3, A.4,
> A.5, A.7 (A.6 + A.8 deferred).
>
> **Verified finding being fixed:** the `invoice-scans` bucket is `public=true`
> with no per-tenant storage policy, and the app used `getPublicUrl` — so invoice
> scans (PII) were world-readable by URL. (Mitigation already in place: the
> in-app viewer `/scans/[invoiceId]` was already session + `.eq(restaurant_id)` +
> signed-URL gated.)

---

## 0. What this PR changes (so you know what must line up)

| Area | Change |
|---|---|
| `drizzle/rls/0001_invoice_scans_rls.sql` | Bucket → **private**; storage.objects → **per-restaurant path-prefix** RLS (`(storage.foldername(name))[1] = app.current_restaurant_id()::text`) + a narrow `walk-ins/` policy for the anonymous showcase. |
| `drizzle/rls/0002_core_tenant_rls.sql` | Adds `storage_namespaces` to the tenant-table RLS loop. |
| `drizzle/0019_storage_namespaces.sql` | New `storage_namespaces` table (per-tenant prefix registry). |
| `drizzle/0020_invoice_scans_restaurant_not_null.sql` | **Guarded** `invoice_scans.restaurant_id` → NOT NULL (refuses while any unscoped row exists). |
| `packages/api` `scans.upload` | Server-side, membership-enforced upload (tenant + path derived from session, never the client). |
| `apps/web` | `getPublicUrl` removed; reads are signed URLs; dashboard upload goes through `scans.upload`; anon showcase signs `walk-ins/`; OCR fetches bytes server-side. |

**Hard prerequisite:** the storage policies reference `app.current_restaurant_id()`
(created by `0002_core_tenant_rls.sql`). If `0002` is **not** already applied in
prod (it is a manual deploy step — see ARCHITECTURE-AUDIT R-16), apply it (or at
least its `app` schema + function) **before** step 1 here.

> ⚠️ **UNCERTAIN — verify first:** whether `0002` is currently applied in prod.
> Check: `select to_regprocedure('app.current_restaurant_id()');` — must be
> non-null before applying `0001`.

Set these once:

```bash
export DATABASE_URL_DIRECT="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"  # owner / direct
export SUPABASE_PROJECT_REF="<ref>"
```

---

## 1. Make the bucket private + apply storage RLS

Run on the **owner/direct** connection (storage.buckets / storage.objects are
owned by `supabase_storage_admin`; the `postgres` role can alter them, and
`service_role` BYPASSES RLS by design — which is exactly why the app's
server-side reads/uploads keep working).

### 1a. Pre-flight (no writes)

```bash
psql "$DATABASE_URL_DIRECT" -c "select id, public from storage.buckets where id='invoice-scans';"
psql "$DATABASE_URL_DIRECT" -c "select to_regprocedure('app.current_restaurant_id()') as fn;"   # must be non-null
psql "$DATABASE_URL_DIRECT" -c "select count(*) as objects from storage.objects where bucket_id='invoice-scans';"
psql "$DATABASE_URL_DIRECT" -c "select (storage.foldername(name))[1] as prefix, count(*) from storage.objects where bucket_id='invoice-scans' group by 1 order by 2 desc;"
```

> The audit (R-02) saw ~14 showcase objects in prod; the task brief estimated ~7
> mapping rows. **Trust the live `count` above**, not either number. If every
> object is under `walk-ins/` (anonymous demo), there is no paying-tenant PII to
> move and the backfill in §2 collapses to "delete demo rows".

### 1b. Apply 0001 (bucket private + per-restaurant storage.objects policies)

The file is idempotent (every policy is `drop ... if exists` + `create`). It does
**not** depend on the new app code, so it is safe to apply before the deploy
(service-role keeps working; only `getPublicUrl` consumers break — and §3 deploys
the code that stops using `getPublicUrl` first).

```bash
psql "$DATABASE_URL_DIRECT" -f packages/db/drizzle/rls/0001_invoice_scans_rls.sql
```

### 1c. Verify

```bash
# bucket is private
psql "$DATABASE_URL_DIRECT" -c "select public from storage.buckets where id='invoice-scans';"   # → f

# the 6 policies exist
psql "$DATABASE_URL_DIRECT" -c "select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'invoice_scans%' order by 1;"

# a raw public URL now 400/403s (replace <path>)
curl -sI "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/public/invoice-scans/<path>" | head -1
```

> ⚠️ **UNCERTAIN — existing dashboard policies:** prod may already carry storage
> policies created via the Supabase dashboard ("not in version control", R-04).
> List them (`pg_policies … schemaname='storage'`) and drop any stale
> `invoice_scans_*` bucket-wide `to authenticated` policy that `0001` did not
> recreate, so a looser legacy policy can't re-open read access.

---

## 2. Backfill existing invoice_scans rows, then enforce NOT NULL (A.7)

`0020` **refuses** to set `restaurant_id` NOT NULL while any unscoped row exists.
Resolve the existing rows first.

### 2a. Inspect

```bash
psql "$DATABASE_URL_DIRECT" -c "select id, invoice_id, restaurant_id, storage_path from invoice_scans order by created_at;"
psql "$DATABASE_URL_DIRECT" -c "select count(*) as unscoped from invoice_scans where restaurant_id is null;"
```

### 2b. Resolve each row — pick ONE per row

**Case A — anonymous showcase / demo rows** (path under `walk-ins/`, no real
tenant). These are not tenant data; delete the mapping row (and optionally the
object). This is the expected case given the audit.

```sql
-- inspect first, then:
delete from invoice_scans where restaurant_id is null and storage_path like 'walk-ins/%';
-- optional: remove the orphan objects too (or leave them under walk-ins/)
-- delete from storage.objects where bucket_id='invoice-scans' and (storage.foldername(name))[1]='walk-ins';
```

**Case B — a real paying tenant's scan at a non-prefixed / wrong path.** Two
moves are needed: the **physical object** (Storage key) AND the **mapping row**.

1. Move the object with the Storage API (a raw `update storage.objects set name`
   does **not** move the underlying S3 object reliably — use `move`):

   ```bash
   # service-role; from a trusted machine. <rid> = owning restaurant uuid.
   curl -s -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/move" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"bucketId":"invoice-scans","sourceKey":"<old/path.pdf>","destinationKey":"<rid>/<old-filename>.pdf"}'
   ```

2. Point the mapping row at the new path + owner:

   ```sql
   update invoice_scans
      set restaurant_id = '<rid>', storage_path = '<rid>/<old-filename>.pdf'
    where id = '<row-id>';
   ```

> ⚠️ **UNCERTAIN — tenant attribution:** there is no automatic way to know which
> tenant a legacy unscoped scan belongs to (the live `invoice_scans.invoice_id`
> is opaque text — `walk-…` — and does not join `invoices.id`). A human must map
> each Case-B row by hand (supplier name / upload time / cross-ref the owning
> invoice) before moving it. When in doubt, treat it as Case A (demo) and delete.

### 2c. Confirm zero unscoped, then apply 0020

```bash
psql "$DATABASE_URL_DIRECT" -c "select count(*) from invoice_scans where restaurant_id is null;"   # MUST be 0
psql "$DATABASE_URL_DIRECT" -f packages/db/drizzle/0020_invoice_scans_restaurant_not_null.sql
psql "$DATABASE_URL_DIRECT" -c "select is_nullable from information_schema.columns where table_name='invoice_scans' and column_name='restaurant_id';"  # → NO
```

### 2d. Create `storage_namespaces` (A.4) + its RLS

`onboarding.createRestaurant` writes a `storage_namespaces` row in its
transaction, so the table (and its tenant RLS) **must exist before the code
deploy in §3**, or restaurant creation will 500.

```bash
# table + FK + unique index
psql "$DATABASE_URL_DIRECT" -f packages/db/drizzle/0019_storage_namespaces.sql

# tenant RLS for it. Either re-apply 0002 (idempotent)…
psql "$DATABASE_URL_DIRECT" -f packages/db/drizzle/rls/0002_core_tenant_rls.sql
# …or, for minimal blast radius, just the one policy:
psql "$DATABASE_URL_DIRECT" <<'SQL'
alter table storage_namespaces enable row level security;
drop policy if exists storage_namespaces_tenant on storage_namespaces;
create policy storage_namespaces_tenant on storage_namespaces
  using (restaurant_id = app.current_restaurant_id());
SQL
```

> Backfill namespaces for existing tenants (so they are explicit/quota-trackable;
> not strictly required since the prefix is also derived at upload time):
>
> ```sql
> insert into storage_namespaces (restaurant_id, bucket, prefix)
> select id, 'invoice-scans', id::text || '/' from restaurants
> on conflict (restaurant_id, bucket) do nothing;
> ```

---

## 3. Deploy order (vs. the web/api/worker change)

The new app code is **forward-compatible with a still-public bucket** (it signs
URLs and never calls `getPublicUrl`), but the old code is **not** compatible with
a private bucket. So sequence DB-prereqs → code → bucket-flip:

1. **DB prereqs first** (no user-visible effect):
   `0019` (storage_namespaces) → `0002` re-apply (namespace RLS) → §2 backfill →
   `0020` (NOT NULL). Confirm `app.current_restaurant_id()` exists.
2. **Env:** ensure `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` are
   set on **web/api** (used by `scans.upload`) and on the **worker** (OCR fetch).
3. **Deploy the code** (web + worker). At this point uploads go through
   `scans.upload`, reads are signed, OCR fetches bytes server-side. The bucket is
   still public — harmless; nothing reads public URLs anymore.
4. **Flip the bucket private + apply storage RLS** (§1b). Service-role paths keep
   working; the anonymous showcase keeps working via the `walk-ins/` policy +
   signed URLs.
5. **Smoke test** (see §5).

> Body-size note: `scans.upload` sends the file base64-encoded over tRPC (cap
> ~10 MB raw). If invoices exceed that, raise the cap in `routers/scans.ts` and
> confirm the Next.js route body limit on `/api/trpc`.

---

## 4. Rollback

Per layer, least-destructive first:

- **Storage RLS / bucket (undo §1):**
  ```sql
  update storage.buckets set public = true where id='invoice-scans';
  drop policy if exists invoice_scans_tenant_select on storage.objects;
  drop policy if exists invoice_scans_tenant_insert on storage.objects;
  drop policy if exists invoice_scans_tenant_update on storage.objects;
  drop policy if exists invoice_scans_tenant_delete on storage.objects;
  drop policy if exists invoice_scans_walkins_select on storage.objects;
  drop policy if exists invoice_scans_walkins_insert on storage.objects;
  ```
  (Re-exposes scans publicly — only as a last resort.)
- **Code:** redeploy the previous build. NOTE the old build calls `getPublicUrl`,
  so if you roll back code you must ALSO roll back the bucket to public (above),
  or reads break.
- **NOT NULL (undo §2c):** `alter table invoice_scans alter column restaurant_id drop not null;`
- **storage_namespaces (undo §2d):** `drop table if exists storage_namespaces;`
  (only after redeploying code that doesn't write it).

---

## 5. Post-cutover smoke tests

1. **Public URL is dead:** `curl -sI …/object/public/invoice-scans/<path>` → 400/403.
2. **Authenticated viewer still works:** open `/scans/<invoiceId>` as a member of
   the owning tenant → renders via a fresh signed URL.
3. **Cross-tenant viewer 404s:** same URL as a different tenant → `notFound()`.
4. **Dashboard upload:** receive an invoice in the dashboard wizard → object lands
   at `<restaurantId>/…`; `invoice_scans.restaurant_id` is set; OCR runs.
5. **Showcase still works:** anonymous `/showcase/receiver` upload → object under
   `walk-ins/…`, OCR runs off a signed URL, no `invoice_scans` row created.
6. **Namespace provisioning:** create a new restaurant → a `storage_namespaces`
   row with `prefix = '<id>/'` exists.

---

## 6. What is NOT covered here (deferred)

- **A.6** — shorter signed-URL TTL + authenticated download proxy / `noreferrer`.
- **A.8** — constrain `receiving.registerInvoice.imageUrl` to the invoice-scans
  prefix + have the worker re-sign from the stored `storage_path` instead of
  carrying a signed URL on the job (SSRF + signed-URL-expiry hardening).

> ⚠️ Until A.8: the worker OCRs the signed URL handed to `registerInvoice`. With
> the 30-min TTL and immediate processing this is fine, but a long queue backlog
> could let the URL expire before the worker fetches it. Re-signing from
> `storage_path` is the durable fix (A.8).
