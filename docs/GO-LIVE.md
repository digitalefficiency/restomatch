# GO-LIVE — the one ordered checklist (plan v2, Wave 0)

> **Source of truth for taking RestoMatch from "live pilot on the June-26 build" to
> "security stack live, worker supervised, ready for Wave 1".** Written 2026-09-08.
> Supersedes the ordering in `GO-LIVE-RUNBOOK.md` (Jun 26) and folds in
> `GO-LIVE-SECURITY-STACK.md` (Jun 27) — those two keep the detailed per-step
> commands and are linked below. `DEPLOY_CUTOVER.md` / `DEPLOY_supplier_catalog_cadence.md`
> are historical stubs.
>
> 👤 = the owner runs it (prod write / secrets / DNS). 🤖 = the agent prepares it on a
> branch and verifies. **Never paste secrets in chat.**

## Verified starting state (2026-09-08)

| Component | State |
|---|---|
| Web | Vercel `project-6bs41`, LIVE on the 2026-06-26 build of `59da7ba`; git-connected; every PR preview build fails (Preview env has no secrets) |
| Supabase `cringgshiafwsszyqufo` | schema through **0018** (verified 2026-06-26); 0019–0026 written, NOT applied; RLS on 38 tables; `restomatch_app` exists with `rolbypassrls=false` — **re-verify via psql in step B before anything else** |
| Redis / Email | Upstash `rediss://` set; Resend in **sandbox** (delivers only to the owner's mailbox) |
| Worker | runs only on the owner's Mac via `apps/worker/scripts/start-worker.sh` (Session 2) |
| Security stack | PR #9 (`release/security-hardening`) code-complete, CI `typecheck + test` green, unmerged |
| GitHub | `main` is still the empty placeholder; no branch protection; Dependency graph not enabled |

## A. Repo + CI first (🤖 Sessions 1–2 done; 👤 review + merge)
- [ ] 👤 Merge in this order (stacked PRs; GitHub retargets bases automatically): **#13** (security dependency bump → `wave0/s1-ci-state`), **#10** (CI matrix + `testDbUrl()` + this checklist → `release/security-hardening`), **#11** (S2–S5, R7, M8, worker watchdog, cutover scripts), **#12** (HUMAN-PR: S1 app-role password, M4 VAT 18%, M7, migration 0027). All are CI-green on the real gates; `pnpm audit` turns green once #13 is in.
- [ ] 👤 GitHub → Settings → Code security: enable **Dependency graph** (then drop the `continue-on-error` on the `dependency review` step). Consider branch protection on `main` requiring `typecheck + test`, `worker tests`, `web build + typecheck`.
- [ ] 👤 Vercel → Settings → Environment Variables → add `CRON_SECRET` (Production) so `/api/cron/worker-heartbeat` accepts Vercel Cron (schedule ships in `apps/web/vercel.json`; minute-level crons need a Pro plan), and `WORKER_ALERT_EMAILS` (your mailbox).

## B. Pre-cutover code fixes (🤖 Session 2 — DONE in #11/#12/#13; kept as the review checklist)
- [ ] S1 `packages/db/src/rls.ts`: `APP_ROLE_PASSWORD` required in production, throwaway default only for `_test`/`localhost` URLs, `alter role … with password` on every run, print the connection string.
- [ ] S2 `AUTH_ENC_KEY` (+ `TRUSTED_PROXY_HOPS`, `APP_ROLE_PASSWORD`) in `.env.example` + `docs/ENV-PRODUCTION.md`.
- [ ] S3 `trustedProxyHops()` at `auth.ts`, `(auth)/actions.ts`, `login/2fa/actions.ts`.
- [ ] S4 `registerInvoice.imageUrl` restricted to the scans-bucket signed-URL prefix.
- [ ] S5 `seed.ts` refuses any DSN that is not `localhost`/`_test`.
- [ ] R7 middleware public allowlist: `/reset`, `/set-password`, `/privacy`, `/terms`, `/cookies` (+ `/api/inbound` reserved for W3) with a middleware test.
- [ ] M7 unique `goods_receipts(restaurant_id, po_id)` + upsert in `startReceipt`; M8 idempotency key on `registerInvoice`.
- [ ] M4 (human-PR): VAT default 0.18 in `schema.ts`, `buildMatchInput.ts`, the engine default + leak-canary fixtures + `schema.test.ts`; migration `0027_leak_trust.sql` also updates untouched `0.17` rows.
- [ ] `packages/db/scripts/verify-cutover.ts` (migrations at 0026, RLS complete, bucket private, app role no-bypass, legal routes 200, dump age < 2 h) + `rehearse-cutover.ts` (apply journal ≤ 18 → seed an unscoped scan + a cross-tenant product → assert 0020 aborts → run both backfills → finish → `provision-rls` → `verify-cutover`).
- [x] `apps/worker/scripts/start-worker.sh` + launchd plist; heartbeat key in Redis every 60 s; Vercel cron `/api/cron/worker-heartbeat` (5 min) emails the owner when stale > 10 min; dashboard banner. 👤 Install: copy the plist per its header, `chmod 600 ~/.restomatch/worker.env`, `launchctl bootstrap`.

## C. Live verification + backup (👤 Session 3, agent-prepared commands)
- [ ] `psql "$DATABASE_URL_DIRECT" -c "select id, hash, created_at from drizzle.__drizzle_migrations order by id desc limit 3;"` → expect the 0018 entry on top.
- [ ] `select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname='restomatch_app';` → `f, t`.
- [ ] Confirm the Supabase plan tier. If not Pro with PITR: `pg_dump -Fc "$DATABASE_URL_DIRECT" -f prod-$(date +%F).dump` and **prove a restore** into a scratch DB (`pg_restore -d …`).
- [ ] **Dress rehearsal on the restore**: `rehearse-cutover.ts` against the scratch DB, then `pnpm --filter @restomatch/db migrate` 0019→0026, both backfills, `provision-rls`, `verify-cutover`. Only proceed when green.

## D. Email + inbound domain (👤)
- [ ] Resend: verify the sending domain (SPF/DKIM) → `EMAIL_FROM=RestoMatch <auth@…>`; rotate the key that was once pasted in chat.
- [ ] Reserve the inbound domain for Wave 3 (`in.restomatch.co.il`): MX + provider verification (Resend inbound if available, else SES). DNS latency gates Wave 3's Playwright test.
- [ ] Email MarketMan's partner program: which plans expose API v3 access to a third-party integration for a restaurant customer? (gates Wave 4)

## E. Security-stack cutover (👤, detailed commands in `GO-LIVE-SECURITY-STACK.md` Phases 0–8)
- [ ] Phase 0: `AUTH_ENC_KEY` (`openssl rand -hex 32`), `APP_ROLE_PASSWORD`, `TRUSTED_PROXY_HOPS=1` in Vercel **Production**; the full secret set in **Preview** too.
- [ ] Phase 1: backup (step C).
- [ ] Phase 2: data repair — `backfill-product-supplier.ts --apply`, the PR1 unscoped-scan backfill (`PR1-storage-isolation-APPLY.md`).
- [ ] Phase 3: `DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db migrate` (0019→0026).
- [ ] Phase 4: `PROVISION_STORAGE_RLS=1 APP_ROLE_PASSWORD=… pnpm --filter @restomatch/db provision-rls` then `check-rls` (`RLS-PROVISIONING-RUNBOOK.md`).
- [ ] Phase 5: Vercel `DATABASE_URL_APP` → the printed `restomatch_app` URL. **Rollback** = revert the env var (the owner URL keeps working after the 0026 REVOKEs); bucket privacy rollback = `update storage.buckets set public=true where id='invoice-scans'`.
- [ ] Phase 6: merge PR #9 → `feat/supplier-catalog-cadence` → `main`; Vercel: set **Production Branch = main**; auto-deploy.
- [ ] Phase 7: `verify-cutover` against prod + smoke (magic-link login, set password, TOTP enrol, invoice upload → OCR → match, order email to "רום", `/privacy` `/terms` `/cookies` render anonymously, `/reset` reachable).
- [ ] Phase 8: CSP soak → `CSP_ENFORCE=1`.

## F. After cutover
- [ ] 👤 Delete `~/Desktop/restomatch` and `~/Desktop/restomatch-w45` (iCloud replicas; the canonical repo is `~/restomatch`).
- [ ] 👤 Branch protection on `main`: require `typecheck + test`, `worker tests`, `web build + typecheck`.
- [ ] 🤖 Update `STATE.md` → Wave 1.
