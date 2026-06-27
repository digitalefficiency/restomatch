# GO-LIVE — Security-Hardening Stack (`release/security-hardening`)

Single consolidated cutover for the 8-PR security stack (Epics A, D1, 0+D2, D3, E,
B, C + the CI fix), merged into **`release/security-hardening`** with migrations
sequenced **0019→0026** and the full suite green (typecheck 16/16 · `@restomatch/db`
9/9 · `apps/web` 73/73 · `@restomatch/api` 374/374).

> **Every step below marked 👤 is run BY YOU (the operator).** The agent is blocked
> from prod DB/Storage writes and from setting Vercel secrets, so it cannot perform
> these — run each via your own terminal (`!`) or the Vercel/Supabase dashboards.
> Run them **in order**. Detailed per-epic procedures live in the sub-runbooks
> referenced inline.

---

## What ships
| Epic | Effect at the live edge |
|---|---|
| **A** (storage) | `invoice-scans` bucket → **private**; per-restaurant `storage.objects` path-prefix RLS; `invoice_scans.restaurant_id` NOT NULL |
| **D1** (web) | Security headers, **nonce CSP (Report-Only)**, cookie pinning (byte-identical), API 401 JSON, OCR/rate-limit hardening |
| **0+D2** | RLS boot-guards (`DATABASE_URL_APP` fail-closed), append-only `audit_log`, composite `products.supplier_id` FK |
| **D3** | CI gates, `xlsx→exceljs`, `@restomatch/crypto` (argon2id) |
| **E** | Privacy/terms/cookies, DSR, consent, retention, breach docs (תיקון 13) — copy `[לאימות עו"ד]` |
| **B/C** | **Password (argon2id) primary + magic-link backup**, remember-me, `tokenVersion` revocation, **TOTP 2FA**, lockout |

**Additive & non-regressive:** magic-link login is preserved, no Auth.js cookie was
renamed (no live-session outage). Money stays NUMERIC ₪.

---

## Phase 0 — Secrets in Vercel  👤
1. **Generate the new required key** (do NOT paste it in chat):
   ```bash
   openssl rand -hex 32
   ```
2. In **Vercel → Project → Settings → Environment Variables**, set on **Production**:
   - `AUTH_ENC_KEY` = the value above. **REQUIRED** — once this code deploys, boot
     fails loudly without it (intended B.6 guard; it encrypts the TOTP secret at rest).
3. Set the **Preview** environment's variables too (this also fixes the failing
   preview deploys): `DATABASE_URL`, `DATABASE_URL_APP`, `AUTH_SECRET`, `AUTH_URL`,
   `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `REDIS_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_ENC_KEY`.
4. Optional rollout knobs (safe defaults — leave unset for now):
   `CSP_ENFORCE` (unset = Report-Only), `TRUSTED_PROXY_HOPS=1` (Vercel),
   `SHOWCASE_OCR_PERSIST_CONTACTS` (unset).

## Phase 1 — Backup  👤
Take a Supabase PITR checkpoint / manual snapshot **before** any migration. All
following DB steps use the **owner / direct** connection string (`DATABASE_URL_DIRECT`).

## Phase 2 — Pre-migration data repair  👤
Two new constraints reject bad existing data — repair first:
- **0020 (`invoice_scans.restaurant_id` NOT NULL):** every existing scan row must
  have a `restaurant_id`. Follow **`docs/PR1-storage-isolation-APPLY.md`** (backfill +
  bucket steps). If any NULL remains, 0020 aborts.
- **0021 (composite `products.supplier_id` FK):** repair any cross-tenant offender
  first (dry-run, then apply):
  ```bash
  DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db exec \
    tsx scripts/backfill-product-supplier.ts            # dry-run
  DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db exec \
    tsx scripts/backfill-product-supplier.ts --apply
  ```
  Detail: **`docs/RLS-PROVISIONING-RUNBOOK.md`**.

## Phase 3 — Apply migrations 0019→0026  👤
On the **owner/direct** connection (idempotent, ordered by the journal):
```bash
DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db migrate
```
Applies: `0019_storage_namespaces`, `0020_invoice_scans_restaurant_not_null`,
`0021_products_supplier_same_tenant`, `0022_legal_compliance`,
`0023_user_credentials`, `0024_two_factor_ticket`, `0025_totp_last_step`,
`0026_revoke_identity_tables`.

## Phase 4 — Provision RLS + the non-bypass role  👤
**After** Phase 3 (the REVOKEs are table-existence-gated, so the new identity tables
must exist first):
```bash
PROVISION_STORAGE_RLS=1 DATABASE_URL=<OWNER_DIRECT> \
  pnpm --filter @restomatch/db provision-rls
```
This (re-)applies `rls/0002` (core tenant — now picks up the new identity-table +
audit REVOKEs), `rls/0003` (append-only audit), the `restomatch_app` login role, and
`rls/0001` (storage: bucket private + `storage.objects` policies). Migration
`0026_revoke_identity_tables` ALSO REVOKEs the credential tables independently, so the
REVOKE holds even if this step is skipped. Then verify:
```bash
DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db check-rls
# spot-check: \dp user_credentials  → restomatch_app has NO privileges
# spot-check: invoice-scans bucket  → public = false
```

## Phase 5 — Flip the web app to the non-bypass role  👤
Point the app's tenant connection at `restomatch_app` so RLS is actually enforced
(Epic 0 fail-closed). In Vercel **Production**:
- `DATABASE_URL_APP` = the `restomatch_app` connection string (printed by
  `provision-rls`). Keep the owner `DATABASE_URL` for identity/admin ops.
- Boot will hard-fail if `DATABASE_URL_APP` points at an RLS-bypassing role (guard).

## Phase 6 — Merge & deploy  👤
`release/security-hardening` is branched off **`feat/supplier-catalog-cadence`**; the
consolidation PR (opened for you) targets that branch so the diff is exactly the 8
epics. To ship:
1. Review + merge the consolidation PR → `feat/supplier-catalog-cadence`.
2. Take `feat/supplier-catalog-cadence` → `main` via your normal flow.
3. **Vercel auto-deploys `main`.** With `AUTH_ENC_KEY` set (Phase 0), boot succeeds;
   without it, boot fails by design.

## Phase 7 — Smoke test (live)  👤
1. **Magic-link** login of an existing pilot user still works (no password needed).
2. **Password**: set-password → log out → log in with password.
3. **2FA**: enrol TOTP in Settings → log out → login now demands the code; one recovery code works once.
4. **Invoice upload** → worker OCRs → 3-way match; **order email** reaches supplier "רום".
5. `/privacy`, `/terms`, `/cookies` render (RTL); cookie-consent banner appears.

## Phase 8 — Promote CSP (after a soak)  👤
Collect `Content-Security-Policy-Report-Only` violations for a representative window,
widen `buildCsp()` allowlists for any legitimate source, then set **`CSP_ENFORCE=1`**
in Vercel (instant rollback = clear the var).

---

## Rollback
- **Code**: revert the `main` merge / redeploy the previous Vercel build. No cookie or
  secret rename ⇒ existing live sessions survive a code rollback.
- **DB**: migrations are additive; restore the Phase-1 snapshot if needed. Password/2FA
  are inert without enrolled users (no user has a password/`totp_enabled_at` until they opt in).
- **Per-feature**: `CSP_ENFORCE` (unset), retention job flags (off by default),
  `SHOWCASE_OCR_PERSIST_CONTACTS` (unset).

## Worker (pilot)
The OCR/match/outbox worker runs locally for the pilot (`start-worker.sh`). Keep it
running in your own terminal so invoice OCR + order emails dispatch:
```bash
! bash <scratchpad>/start-worker.sh
```
