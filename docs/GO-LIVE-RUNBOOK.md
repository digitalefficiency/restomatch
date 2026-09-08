# Go-Live Runbook — SUPERSEDED (2026-09-08)

> The ordered, current checklist is **[`GO-LIVE.md`](./GO-LIVE.md)**. Detailed
> security-stack commands live in [`GO-LIVE-SECURITY-STACK.md`](./GO-LIVE-SECURITY-STACK.md).
>
> This file's June-26 body was retired because two of its "still missing" claims
> went stale within a day (Upstash `REDIS_URL`, `RESEND_API_KEY` + `EMAIL_FROM` were
> set in Vercel on 2026-06-26/27; Resend remains in sandbox mode). What is still
> true from it: migrations 0009–0018 are applied in production — **never re-run
> them**; the Fly worker was never deployed and, per the owner's decision, the worker
> stays on the owner's Mac for the pilot (supervised — see `GO-LIVE.md` §B).
