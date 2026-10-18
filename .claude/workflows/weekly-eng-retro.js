export const meta = {
  name: 'weekly-eng-retro',
  description: 'Fri 16:00 IL: /retro -> /health -> /learn. Report only, no gate.',
  phases: [
    { title: 'Retro', detail: 'week of commits + quality trend' },
    { title: 'Health', detail: 'composite code-quality score' },
    { title: 'Learn', detail: 'persist learnings from the week' },
  ],
}

// ---- schemas -------------------------------------------------------------

const RETRO_SCHEMA = {
  type: 'object',
  required: ['shipped', 'summary', 'trend'],
  properties: {
    commitCount: { type: 'integer' },
    shipped: { type: 'array', items: { type: 'string' } },
    immutableProposals: { type: 'array', items: { type: 'string' } },
    trend: { type: 'string', enum: ['up', 'flat', 'down', 'unknown'] },
    risks: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const HEALTH_SCHEMA = {
  type: 'object',
  required: ['score', 'summary'],
  properties: {
    score: { type: 'number' },
    typecheck: { type: 'string', enum: ['pass', 'fail', 'skipped', 'unknown'] },
    test: { type: 'string', enum: ['pass', 'fail', 'skipped', 'unknown'] },
    deltaVsLast: { type: 'string' },
    weakest: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const LEARN_SCHEMA = {
  type: 'object',
  required: ['persisted', 'summary'],
  properties: {
    persisted: { type: 'array', items: { type: 'string' } },
    pruned: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// This is a REPORT cadence, not a gate. It reads STATE.md + AGENTS.md, analyzes
// the week, computes the health score, and persists learnings. It opens NO PR,
// changes NO code, and never touches the AGENTS.md immutability list. Per the
// prime directives it leaves an artifact (this verdict) and stops.

// ---- 1. retro ------------------------------------------------------------

phase('Retro')
const retro = await agent(
  `You are running the weekly RestoMatch engineering retro. First read STATE.md and AGENTS.md so the
retro is grounded in the current plan and the prime directives (this is REPORT-ONLY: no PR, no merge,
no prod writes, never edit the immutability list).
Use the /retro skill to analyze the last 7 days of work. Concretely:
- \`git log --since='7 days ago' --pretty=format:'%h %s' --no-merges\` and \`git log --since='7 days ago' --stat --no-merges\`
  to enumerate what shipped (e.g. recent work spans the dark "command center for money" overhaul,
  the Hebrew marketing landing, the admin pilot console, and the deterministic ₪ ROI calculator).
- Classify each shippable commit into a one-line 'shipped' entry.
- Flag any commit that PROPOSED a change to an immutability-list file (matching engine/₪-math,
  formatIls, db schema/drizzle/rls, plans/billing, approvals engine, notifications outbox/cron,
  leads router/trpc route/rateLimit, .github/workflows, .claude/agents, AGENTS.md, OPERATING.md) into
  immutableProposals — these only ever move via a human-authored PR.
- trend = direction of the quality/velocity trend vs the prior retro (up|flat|down|unknown).
- risks = anything that threatens the North Star: ≥1.5% of a restaurant's food spend surfaced as a
  believable ₪ leak. For each shipped item ask: does it manufacture, dramatize, deliver, or protect
  that ₪ number? Call out work that does none of those.
Return the structured retro. Do NOT modify any files.`,
  { label: 'retro', phase: 'Retro', schema: RETRO_SCHEMA }
)

if (!retro) {
  log('Retro agent failed — continuing to health/learn so the cadence still leaves an artifact.')
} else {
  log(`Retro: ${retro.commitCount ?? '?'} commits, trend=${retro.trend}. ${retro.summary}`)
  if ((retro.immutableProposals || []).length) {
    log(`Immutability-list proposals this week (human-PR only): ${retro.immutableProposals.join(', ')}`)
  }
}

// ---- 2. health -----------------------------------------------------------

phase('Health')
const health = await agent(
  `Use the /health skill to compute the RestoMatch composite code-quality score (0-10) for the current
state of the repo, and persist it to the health trend history. Run the real project tools the way CI does:
1. Ensure the test DB schema: \`pnpm --filter @restomatch/db migrate\` (DATABASE_URL pointed at the local
   test DB, e.g. postgres://<user>@localhost:5432/restomatch_test).
2. \`pnpm turbo run typecheck --concurrency=1 --filter='!@restomatch/web'\` (web typecheck/lint/build are
   NOT in the v1 CI gate — note them but do not let them sink the score).
3. \`pnpm turbo run test --concurrency=1\` (tests are serial). Confirm the matching leak-canary suite ran
   and that no DB-backed suite was skipped.
Report the composite score, typecheck/test status, the delta vs the last recorded health run, and the
weakest 1-3 dimensions. This is report-only: do NOT fix anything, open a PR, or edit code.`,
  { label: 'health', phase: 'Health', schema: HEALTH_SCHEMA }
)

if (!health) {
  log('Health agent failed — recording unknown score for this week.')
} else {
  log(`Health: ${health.score}/10 (typecheck=${health.typecheck}, test=${health.test}, ${health.deltaVsLast || 'no prior'}). ${health.summary}`)
}

// ---- 3. learn ------------------------------------------------------------

phase('Learn')
const learn = await agent(
  `Use the /learn skill to persist this week's learnings for the RestoMatch project so future sessions
benefit. Base them on the retro and health results below — capture durable patterns, recurring pitfalls,
and anything that protects the North Star ₪ figure or the immutability discipline. Prune stale or
superseded learnings. This is report-only: persist learnings ONLY (no code changes, no PR).

RETRO: ${retro ? retro.summary : '(retro failed this run)'}
TREND: ${retro ? retro.trend : 'unknown'}
RISKS: ${retro && (retro.risks || []).length ? retro.risks.join('; ') : 'none flagged'}
HEALTH: ${health ? `${health.score}/10, weakest: ${(health.weakest || []).join(', ') || 'n/a'}` : '(health failed this run)'}

Return what you persisted and what you pruned.`,
  { label: 'learn', phase: 'Learn', schema: LEARN_SCHEMA }
)

if (!learn) {
  log('Learn agent failed — no learnings persisted this run.')
} else {
  log(`Learnings: +${(learn.persisted || []).length} persisted, -${(learn.pruned || []).length} pruned. ${learn.summary}`)
}

// ---- report (no gate) ----------------------------------------------------

const report = {
  kind: 'report',
  gate: false,
  week: new Date().toISOString().slice(0, 10),
  budgetSpent: budget.spent(),
  retro: retro || { error: 'retro-failed' },
  health: health || { error: 'health-failed' },
  learn: learn || { error: 'learn-failed' },
  note:
    'Weekly eng retro — report only, no gate, no code changes, no PR. ' +
    (retro && health
      ? `${retro.commitCount ?? '?'} commits, trend ${retro.trend}, health ${health.score}/10.`
      : 'One or more phases failed; see per-phase errors.'),
}

log(report.note)
return report
