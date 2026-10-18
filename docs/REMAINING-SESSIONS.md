# RestoMatch — Remaining Sessions Orchestration (Phases 2–8)

Status pointer lives in `STATE.md`. Master plan: `~/.claude/plans/lovely-scribbling-pony.md`.
Phase 1 (security: tenant sweep, RLS, auth/storage hardening) is COMPLETE across Sessions 1–3.

This doc is the execution map for the rest. Each session is either **code-complete**
(fully buildable + testable locally now) or **cred-gated** (code is written and
ready-to-activate, but needs an external credential / live service to verify).
Cred-gated work is still done in code; only the live verification waits.

## Legend
- 🟢 code-complete — build + test in this repo now
- 🟡 cred-gated — write the real implementation; activation needs a secret/live service
- 📋 deliverable is a document, not code

---

## Phase 2 — Production wiring

| Session | Item | Kind | External need |
|---|---|---|---|
| 2.1 | `packages/env` Zod env validation (web + worker schemas, fail-fast) | 🟢 | — |
| 2.2 | Supabase consolidation: migrations + RLS apply + `restomatch_app` role provisioning script | 🟡 | Supabase 'orel' project creds |
| 2.3 | Real OCR — `ClaudeVision.extract()` (anthropic SDK) + Document AI; real `EmbeddingProvider` | 🟡 | ANTHROPIC_API_KEY / GCP / Voyage key |
| 2.4 | `makeResendDispatcher` + swap Auth.js email provider to Resend (Hebrew RTL template) | 🟡 | RESEND_API_KEY |
| 2.5 | Wire Sentry (web instrumentation + worker) + PostHog funnel events; `error.tsx`/`global-error.tsx`/`not-found.tsx` | 🟢 (pages) / 🟡 (DSN/keys) | SENTRY_DSN / POSTHOG_KEY |
| 2.6 | CI `.github/workflows/ci.yml` (typecheck+lint+test, PG+Redis services); `apps/worker/fly.toml`+Dockerfile; rewrite `docs/DEPLOY.md` | 🟢 | (deploy run needs Fly/Vercel tokens) |

## Phase 3 — Entitlements & subscriptions (HIGHEST-VALUE pure-code phase)

| Session | Item | Kind |
|---|---|---|
| 3.1 | Schema: `billing_accounts`, `plans`, `subscriptions`, `usage_counters` (atomic), `billing_events`, `leads` + RLS + seed default plans | 🟢 |
| 3.2 | `packages/api/src/entitlements/`: `getEntitlements`, `entitledProcedure(feature)`, `assertWithinQuota`/`recordUsage`; gate exports/integrations/WhatsApp/analytics/seats/branches; OCR metering at the worker | 🟢 |
| 3.3 | `packages/billing` provider-agnostic adapter + `NoopBillingProvider`; Grow(Meshulam) skeleton + webhook route | 🟢 (Noop) / 🟡 (Grow live) |
| 3.4 | Entitlement-bypass test suite (tRPC, worker enqueue, race increments, expired trial, past_due) | 🟢 |

## Phase 4 — Admin panel

| Session | Item | Kind |
|---|---|---|
| 4 | `users.is_platform_admin` + `adminProcedure`; `adminRouter` (restaurants/usage/plan-assign/users/leads); `apps/web/app/admin/*`; audit-log admin mutations; extend attack suite (non-admin → FORBIDDEN) | 🟢 |

**>>> PILOT GATE after Phase 4 — see plan §8a <<<**

## Phase 5 — UX/design polish (during pilot)
- 16 approval-rules editor 🟢 · 17 pagination + pg_trgm search 🟢 · 18 empty/loading/error + axe a11y 🟢 · 19 mobile resilience + 1 E2E 🟢

## Phase 6 — Hebrew marketing landing (during pilot)
- 20 `(marketing)` route group + ROI calculator 🟢 · 21 pricing from live `plans` + lead form (rate-limited) 🟢 · 22 screenshots + Lighthouse 🟢

## Phase 7 — GTM doc 📋 → `docs/GTM.md`

## Phase 8 — Gates
- 8a Pilot gate (after P4) · 8b Commercial gate (test target 330+, Lighthouse, load sanity, billing live-fire 🟡)

---

## Orchestration approach

Each phase is driven by a dedicated `Workflow` invocation that fans out the build,
then an adversarial-review workflow (the pattern proven in Sessions 1–2) verifies
before commit. Per-phase loop:

1. **Build** — parallel agents implement the phase's files against this spec.
2. **Typecheck + test** — `pnpm typecheck && pnpm test` must stay green; add the
   phase's new tests.
3. **Adversarial review** — multi-lens refutation of the new trust boundaries
   (especially entitlements: a paying-tier gate that can be bypassed is a revenue
   leak the same way a tenant gate is a data leak).
4. **Commit** per phase; update `STATE.md`.

Cred-gated items ship as real implementations behind an env check that throws a
clear "not configured" error (the existing notifier/OCR scaffold pattern), so the
pilot can flip them on by adding a secret — no code change at activation.
