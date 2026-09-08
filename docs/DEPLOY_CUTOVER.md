# Pilot Cutover Runbook — HISTORICAL STUB (retired 2026-09-08)

> **Do not follow this document.** Its June-21 body instructed a forward-migrate of
> 0009–0018 and a re-apply of RLS against production. Both were verified as already
> applied on 2026-06-26; drizzle is forward-only and re-running them can fail or
> drift. The body was removed so nobody greps "0008" and re-runs it.
>
> Current checklist: [`GO-LIVE.md`](./GO-LIVE.md). Security-stack cutover (0019–0026):
> [`GO-LIVE-SECURITY-STACK.md`](./GO-LIVE-SECURITY-STACK.md). Env reference:
> [`ENV-PRODUCTION.md`](./ENV-PRODUCTION.md).
>
> Two facts from the old body that remain useful:
> - Migrations and RLS always run on the **owner/direct** connection (port 5432), never on
>   the pooler or the app role.
> - `ALTER TYPE … ADD VALUE` must live alone in its own migration file (the migrator wraps
>   each file in a transaction).
