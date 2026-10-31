# UI/UX review — 2026-10-25

A page-by-page UI/UX and functional review of RestoMatch, run after the 2026-10-25 demo at the owner's request.
The bar is world-class, benchmarked against the newest ERP, ordering and AP products. Most staff work happens on
mobile and the bosses work on desktop.

## Start here

| File | What it is |
| --- | --- |
| `REVIEW-REPORT.he.md` | The owner's report, in Hebrew: scores, headline moves, mobile and desktop strategy, IA, decisions needed, waves. |
| `IMPLEMENTATION-PLAN.md` | The engineering plan: 51 work packages in 4 waves. Each has exact paths, so packages in one wave never overlap, plus acceptance criteria, owning agent and a human-PR flag. |
| `RUBRIC.md` | The 90-criterion review rubric that every page was scored against. |

## Inputs

| Folder | Contents |
| --- | --- |
| `research/` | Benchmark research: fintech (Stripe, Ramp, Brex), design systems (Polaris, Carbon, Material 3, HIG), restaurant ops (Toast, R365, MarketMan), RTL/Hebrew and IS 5568, AI-native triage (Linear, Superhuman), mobile ordering (Choco, Rekki, Supy), next-gen ERP/AP (Odoo, Ramp, Zip, Rillet, Ottimate), exec desktop efficiency, PWA field tech. Also the IA map of all 71 routes and the functional gap analysis. |
| `review/` | 12 area reviews (every page, both devices, every role) and 8 cross-cutting lenses (IA/nav, mobile field, exec desktop, design system, a11y, copy/RTL, functional flows, perf/states). |

## How the review was run

- Main was checked out at `8fef118c` and seeded locally with `reseed:demo --today 2026-10-25`, the same data as
  production.
- The app ran from a production build. Every route was captured per role, at desktop 1440 and phone 390, in Hebrew
  and English: 225 full-page screenshots, each with axe-core, overflow, tap-target and console checks.
- Reviewers read the code and the screenshots. Every P0/P1 finding was then adversarially re-checked by a separate
  verifier: 633 findings kept, 0 dropped.
- Screenshot file names cited as evidence (`<route>__<role>__<device>-<locale>.png`) came from that lab run and are
  not committed. To reproduce them, re-run the same seed and capture.

Governance: AGENTS.md applies. Packages flagged `humanPR` touch immutable files (money math, schema, RLS, pricing,
cron/outbox, CI) and are proposals for a human-authored PR only.
