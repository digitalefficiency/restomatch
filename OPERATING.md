# OPERATING.md — running RAOS (the human's map)

This is the operator's guide to the RestoMatch Agent Operating System (RAOS). The agents' binding
contract is `AGENTS.md`; this file is **your** controls: how to invoke, what's scheduled, how to stop
everything, and how to keep costs sane.

## Mental model

RAOS is a fleet of project-native subagents (`.claude/agents/*.md`) + reusable workflows
(`.claude/workflows/*.js`) + (optional) scheduled loops. **You are the router and the only thing with
merge/deploy/spend authority.** Agents open PRs; you decide what lands.

## Invoking work

- **An agent, by name:** ask Claude to "use the `matching-engine-guardian` to …". The agent reads
  `AGENTS.md` + `STATE.md`, works inside its boundary, and reports.
- **A workflow:** run the `Workflow` tool with the script in `.claude/workflows/`. `quality-gate-pr` is
  the per-PR spine; the rest are listed below.
- **Heavy skills are manual-invoke only:** `/deep-research`, `/llm-council`, `/autoplan`, comprehensive
  `/cso`. They are not wired into any schedule.

## Cadence (the ramp — bring schedules up ONE at a time)

The machinery for all 7 workflows is built, but **scheduling is opt-in and minimal by default.**
Recommended order to enable (each via `CronCreate`, `Asia/Jerusalem`):

| Order | Workflow | Trigger | Risk | Enable when |
|---|---|---|---|---|
| 1 | `quality-gate-pr` | every push to a non-`main` branch | none (read+report) | now (the gate) |
| 2 | `weekly-eng-retro` | Fri 16:00 IL | none (report) | now |
| 3 | `market-icp-refresh` | monthly | low (docs only) | now |
| 4 | `canary` + numbers-canary | post-deploy | low | when deploying (Phase-6) |
| 5 | `weekly-product-growth` | Mon 07:00 IL | low | when there's a funnel to read |
| 6 | `ship-and-verify` | after SHIP-READY | medium (deploy gate) | when deploying (Phase-6) |
| 7 | `improve-restomatch` | Tue/Thu 01:00 IL | **highest** (autonomy) | **only after a pilot generates real signal** |

> `improve-restomatch` is the only agent that proposes its own work. Turning it on against a product
> with zero users burns tokens producing changes nobody asked for. **Build it now, schedule it last.**

## Governance (enforced, not advisory)

- **PR-only autonomy.** No agent merges, deploys, writes prod Supabase, sends email/WhatsApp, or spends
  money. You do.
- **`improve-restomatch` budget:** **1 PR per shift**, a hard diff-line budget, and a **retry cap = 2**
  (3rd CI failure → error artifact + halt). It budget-checks before each shift.
- **Per-workflow token ceilings.** Set a monthly $ ceiling (you pick the number) and keep heavy skills
  manual.
- **Second gate** on any Supabase migration inside `ship-and-verify`.

## Kill-switch

- `CronList` — see every scheduled job.
- `CronDelete <id>` — stop a schedule.
- `TaskStop <id>` — stop a running task/workflow now.
- Nuclear: delete the cron entries; the per-PR gate is just a GitHub Action you can disable in the repo.

## Clean silence

Every scheduled job **writes an artifact** — a short report, or a one-line "ran, clean." If a job runs
and you see nothing, treat that as a bug, not as "all good." The **numbers-canary** is what makes
"clean" mean *the ₪ figures stayed plausible to the agora*, not merely "no console errors."

## What's gated on credentials (Phase-6)

Production wiring is parked pending keys (`docs/PRODUCTION-UNBLOCK.md`, memory `restomatch-phase2-parked`).
Ordered unblock: **Supabase/RLS → Resend → Claude Vision OCR / MarketMan / WhatsApp → Sentry →
Vercel deploy → canary.** Never flip OCR to real Claude Vision before Supabase/RLS is live. **Put the
full credential set in `.env`/your secret store — not in chat.** A Supabase *publishable* key alone does
not unblock Phase-2; you also need the project URL, a secret/service-role key, and the `DATABASE_URL` /
`DATABASE_URL_APP` connection strings.

## CI / local quickstart

```sh
# bootstrap the test DB schema (idempotent)
DATABASE_URL='postgres://<user>@localhost:5432/restomatch_test' pnpm --filter @restomatch/db migrate
# run the same gate CI runs
DATABASE_URL_TEST='postgres://<user>@localhost:5432/restomatch_test' pnpm turbo run test --concurrency=1
pnpm turbo run typecheck --concurrency=1 --filter='!@restomatch/web'
```
