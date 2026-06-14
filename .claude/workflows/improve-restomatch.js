export const meta = {
  name: 'improve-restomatch',
  description:
    'Tue/Thu 01:00 IL (enable LAST, post-pilot): rank backlog by value/risk -> /autoplan -> EnterWorktree + build -> quality-gate-pr -> self-repair (<=2 retries). Opens ONE PR; human merges.',
  phases: [
    { title: 'Rank', detail: 'budget-check + pick ONE highest value/risk, non-immutable, non-credential-gated item' },
    { title: 'Plan', detail: '/autoplan the chosen item inside its write boundary' },
    { title: 'Build', detail: 'EnterWorktree, implement, open ONE PR' },
    { title: 'Gate', detail: 'quality-gate-pr + self-repair (<=2 retries; 3rd fail -> error artifact + HALT)' },
  ],
}

// ---- guards (hard limits per shift, per AGENTS.md §Prime directives + OPERATING.md §Governance) ----

const MAX_RETRIES_PER_SHIFT = 2 // self-repair cap; 3rd quality-gate/CI failure => error artifact + HALT
const MAX_DIFF_LINES = 400 // diff-line budget: a shift ships ONE small, reviewable PR
const MIN_BUDGET_TO_START = 0.2 // abort the shift if <20% of the token budget remains

// ---- schemas -------------------------------------------------------------

const BACKLOG_SCHEMA = {
  type: 'object',
  required: ['item', 'owningAgent', 'writeBoundary', 'valueRisk', 'touchesImmutable', 'credentialGated', 'rationale'],
  properties: {
    item: { type: 'string' }, // the single chosen task, one sentence
    owningAgent: { type: 'string' }, // the AGENTS.md ownership-map agent whose boundary this falls in
    writeBoundary: { type: 'array', items: { type: 'string' } }, // exact paths this PR may write
    valueRisk: { type: 'string', enum: ['high', 'medium', 'low'] },
    estDiffLines: { type: 'integer' },
    touchesImmutable: { type: 'boolean' }, // if true, this item is INELIGIBLE (route to human)
    immutableHits: { type: 'array', items: { type: 'string' } },
    credentialGated: { type: 'boolean' }, // if true, INELIGIBLE (Phase-2/Phase-6, no keys)
    northStar: { type: 'string' }, // how it manufactures/dramatizes/delivers/protects the ₪ leak number
    rationale: { type: 'string' },
    rejected: { type: 'array', items: { type: 'string' } }, // items considered + why skipped
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['planPath', 'inBoundary', 'summary'],
  properties: {
    planPath: { type: 'string' },
    inBoundary: { type: 'boolean' }, // false => abort (plan drifted outside the chosen write boundary)
    summary: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  required: ['branch', 'diffLines', 'stayedInBoundary', 'touchedImmutable', 'summary'],
  properties: {
    branch: { type: 'string' },
    prUrl: { type: 'string' },
    diffLines: { type: 'integer' },
    stayedInBoundary: { type: 'boolean' },
    touchedImmutable: { type: 'boolean' }, // a tripwire; if true we throw the work away and route to human
    immutableHits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['passed', 'detail'],
  properties: {
    passed: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
}

const REPAIR_SCHEMA = {
  type: 'object',
  required: ['fixed', 'diffLines', 'touchedImmutable', 'detail'],
  properties: {
    fixed: { type: 'boolean' }, // attempted a fix and pushed it
    diffLines: { type: 'integer' },
    touchedImmutable: { type: 'boolean' },
    detail: { type: 'string' },
  },
}

// ---- 0. pre-shift budget gate (OPERATING.md: budget-check before each shift) ----

phase('Rank')
if (budget.remaining() < MIN_BUDGET_TO_START) {
  log(`⛔ Aborting shift: only ${(budget.remaining() * 100).toFixed(0)}% of budget remains (< ${MIN_BUDGET_TO_START * 100}%). No work this shift.`)
  return { ran: true, shipped: false, reason: 'budget-low', remaining: budget.remaining() }
}
log(`Budget OK (${(budget.remaining() * 100).toFixed(0)}% remaining). Ranking backlog.`)

// ---- 1. rank: pick the SINGLE highest value/risk eligible item ----

const pick = await agent(
  `You are the improve-restomatch shift planner for the RestoMatch repo. FIRST read STATE.md and AGENTS.md
(prime directive #1). Then propose the single highest value/risk backlog item to ship as ONE small PR this shift.

Sources of backlog signal, in priority order:
1. STATE.md "Next planned task" + "Open blockers" + the per-line architecture TODOs (e.g. leak heatmap needs
   3+ price baselines to populate; optional per-IP rate-limit on leads.create; idempotent meterOcrScan when
   the ocr-invoice enqueuer is wired).
2. docs/REMAINING-SESSIONS.md (🟢 code-complete vs 🟡 cred-gated phase map).
3. TODO/FIXME comments in the tree: \`git grep -nE "TODO|FIXME" -- ':!**/*.md' | head -80\`.

HARD ELIGIBILITY FILTERS — an item is INELIGIBLE if ANY of these is true:
- credentialGated=true: needs a credential the repo lacks (Supabase/Resend/Anthropic Vision/MarketMan/WhatsApp/
  Sentry/Vercel — anything in OPERATING.md "What's gated on credentials" / Phase-2 / Phase-6). Pilot-blocking
  prod wiring is OUT — set credentialGated=true and reject it.
- touchesImmutable=true: it would edit any file on the AGENTS.md immutability list — the matching engine ₪-math
  (packages/matching/src/{engine,index,reconciliation,tolerances,units,money}.ts + its __tests__/{leak-canary,
  fixtures}.ts), the formatIls() util (apps/web/lib/money.ts), packages/db/src/schema.ts + drizzle/** + drizzle/rls/**
  + src/rls.ts + drizzle.config.ts, packages/api/src/__tests__/{cross-tenant.attack,rls.attack}.test.ts (the COVERAGE
  manifest), packages/db/src/plans.ts + packages/billing/**, packages/api/src/approvals/engine.ts,
  packages/api/src/notifications/outbox.ts + apps/worker/src/cron.ts, packages/api/src/routers/leads.ts +
  apps/web/app/api/trpc/[trpc]/route.ts + apps/web/lib/rateLimit.ts, .github/workflows/**, .claude/agents/**,
  AGENTS.md, OPERATING.md. List the hits in immutableHits, set touchesImmutable=true, and reject it (route to human).

Among ELIGIBLE items (credentialGated=false AND touchesImmutable=false), pick the ONE with the highest value/risk,
fitting the diff-line budget (estDiffLines must be <= ${MAX_DIFF_LINES}). Score by the North Star: ≥1.5% of a
restaurant's food spend surfaced as leak in ₪ that one owner believes — does this manufacture, dramatize, deliver,
or protect that ₪ number? Set northStar accordingly.

Identify owningAgent from the AGENTS.md ownership map and writeBoundary = the exact paths that agent may write.
Do NOT pick anything that would force writes outside one agent's boundary. List everything you considered and
why you skipped it in rejected[]. Do not edit any files in this phase.`,
  { label: 'rank', phase: 'Rank', schema: BACKLOG_SCHEMA }
)

if (!pick) {
  log('Rank agent failed to return a structured pick — aborting shift (ran, clean: nothing to do).')
  return { ran: true, shipped: false, reason: 'rank-failed' }
}
if (pick.touchesImmutable || pick.credentialGated) {
  // The picker should already have filtered these; if the best candidate is ineligible, there is no eligible work.
  log(`⛔ Best candidate is ineligible (${pick.touchesImmutable ? 'immutable' : 'credential-gated'}): ${pick.item}. Routing to human, no PR.`)
  return {
    ran: true,
    shipped: false,
    reason: pick.touchesImmutable ? 'immutable-route-to-human' : 'credential-gated',
    item: pick.item,
    immutableHits: pick.immutableHits || [],
    note: 'Proposed for a human-authored PR (AGENTS.md immutability list) or Phase-6 credential intake. No auto-edit.',
  }
}
if ((pick.estDiffLines || 0) > MAX_DIFF_LINES) {
  log(`⛔ Chosen item est ${pick.estDiffLines} diff lines > ${MAX_DIFF_LINES} budget. Too big for one shift — route to human to split.`)
  return { ran: true, shipped: false, reason: 'over-diff-budget', item: pick.item, estDiffLines: pick.estDiffLines }
}
log(`Picked (${pick.valueRisk} value/risk): ${pick.item} — owner: ${pick.owningAgent}, boundary: ${(pick.writeBoundary || []).join(', ')}.`)

// ---- 2. plan: /autoplan the chosen item inside its boundary ----

phase('Plan')
const plan = await agent(
  `Use the /autoplan skill to produce a fully-reviewed implementation plan for THIS one backlog item and nothing else:

  "${pick.item}"

Context: owning agent ${pick.owningAgent}; this PR may ONLY write these paths: ${(pick.writeBoundary || []).join(', ')}.
North Star tie: ${pick.northStar || pick.rationale}.

Constraints to bake into the plan:
- Stay strictly inside the write boundary above. If the plan needs writes outside it, set inBoundary=false and STOP.
- NEVER plan an edit to any AGENTS.md immutability-list file (engine ₪-math, formatIls util, schema.ts, drizzle/**,
  rls, attack-suite COVERAGE manifest, plans.ts, billing, approvals engine, notifications outbox, cron, leads.ts,
  trpc route, rateLimit, .github/workflows, .claude/agents, AGENTS.md, OPERATING.md). If you need one changed,
  set inBoundary=false and route to a human.
- Keep total diff under ${MAX_DIFF_LINES} lines. Tests must accompany the change (test-sentinel is a universal gate).
- Do not implement yet. Write the plan to a file under .claude/artifacts/ (or wherever /autoplan writes) and return planPath.`,
  { label: 'autoplan', phase: 'Plan', schema: PLAN_SCHEMA }
)

if (!plan || !plan.inBoundary) {
  log(`⛔ Plan failed or drifted out of boundary: ${plan ? plan.summary : 'agent error'}. No PR — routing to human.`)
  return { ran: true, shipped: false, reason: 'plan-out-of-boundary', item: pick.item, plan }
}
log(`Plan ready (${plan.planPath}): ${plan.summary}`)

// ---- 3. build: isolated worktree, implement, open ONE PR ----

phase('Build')
const build = await agent(
  `Implement the plan at ${plan.planPath} for the item "${pick.item}", then open EXACTLY ONE PR. Steps:
1. Use the EnterWorktree tool to get an isolated worktree on a fresh branch named improve/<short-slug-of-item>.
2. Implement the plan. Write ONLY inside this boundary: ${(pick.writeBoundary || []).join(', ')}. Add/extend tests.
3. TRIPWIRE: if at any point the change would touch a file on the AGENTS.md immutability list, STOP immediately,
   set touchedImmutable=true with immutableHits, do NOT commit those files, and return — this routes to a human.
4. Keep the diff under ${MAX_DIFF_LINES} lines (report diffLines from \`git diff --stat main...HEAD\`).
5. Commit (Co-Authored-By trailer) and open ONE PR with \`gh pr create\` against main. The PR body must state:
   the North Star tie, the write boundary, "human merges — autonomy is PR-only (AGENTS.md)", and the plan path.
   DO NOT merge, deploy, write the production Supabase DB, send email/WhatsApp, or spend money. Open the PR and STOP.
Return the branch, prUrl, diffLines, whether you stayedInBoundary, and the touchedImmutable tripwire state. When done,
call ExitWorktree to clean up the worktree (the branch/PR persist).`,
  { label: 'build', phase: 'Build', schema: BUILD_SCHEMA }
)

if (!build) {
  log('Build agent failed — no PR produced. Halting shift.')
  return { ran: true, shipped: false, reason: 'build-failed', item: pick.item, plan }
}
if (build.touchedImmutable) {
  log(`⛔ Build tripwire: change would touch immutable files ${(build.immutableHits || []).join(', ')}. Discarded — routing to human.`)
  return { ran: true, shipped: false, reason: 'immutable-tripwire', item: pick.item, immutableHits: build.immutableHits || [] }
}
if (!build.stayedInBoundary) {
  log(`⛔ Build drifted outside the write boundary. Discarded — routing to human.`)
  return { ran: true, shipped: false, reason: 'out-of-boundary-build', item: pick.item, build }
}
if ((build.diffLines || 0) > MAX_DIFF_LINES) {
  log(`⛔ Diff is ${build.diffLines} lines > ${MAX_DIFF_LINES} budget. PR ${build.prUrl || build.branch} exceeds the shift budget — flag for human review, no further work.`)
  return { ran: true, shipped: true, reason: 'over-diff-budget-after-build', item: pick.item, prUrl: build.prUrl, diffLines: build.diffLines }
}
log(`✅ ONE PR opened: ${build.prUrl || build.branch} (${build.diffLines} diff lines). Running the quality gate.`)

// ---- 4. gate + self-repair (<=2 retries; 3rd failure -> error artifact + HALT) ----

phase('Gate')

async function runGate(attemptLabel) {
  return agent(
    `Run the quality-gate-pr workflow's checks for the PR on branch ${build.branch} (against main), exactly as CI does:
1. Bootstrap schema: \`pnpm --filter @restomatch/db migrate\` against the local test DB
   (postgres://<user>@localhost:5432/restomatch_test if DATABASE_URL_TEST is unset).
2. \`pnpm turbo run typecheck --concurrency=1 --filter='!@restomatch/web'\`
3. \`pnpm turbo run test --concurrency=1\` (web typecheck/lint/build are NOT in the v1 gate).
Then apply the /review, /codex (review mode), and /cso (daily) lenses to the diff.
passed=true only if the mechanical gate is fully green AND there are zero blocker/high findings.
Put failing output tails and any blockers in detail/blockers.`,
    { label: attemptLabel, phase: 'Gate', schema: GATE_SCHEMA }
  )
}

let gate = await runGate('gate:initial')
let failures = gate && gate.passed ? 0 : 1
let lastDetail = gate ? gate.detail : 'gate agent error'

while (failures > 0 && failures <= MAX_RETRIES_PER_SHIFT) {
  log(`Quality gate red (failure #${failures}/${MAX_RETRIES_PER_SHIFT} allowed): ${lastDetail}. Self-repair attempt ${failures}.`)
  if (budget.remaining() < MIN_BUDGET_TO_START) {
    log('⛔ Budget too low to self-repair. Halting with the PR left red for a human.')
    break
  }
  const repair = await agent(
    `The quality gate failed for the PR on branch ${build.branch}. Failure detail:
${lastDetail}

This is self-repair attempt ${failures} of a maximum ${MAX_RETRIES_PER_SHIFT}. Fix the failure within the SAME write
boundary (${(pick.writeBoundary || []).join(', ')}), keep total diff under ${MAX_DIFF_LINES} lines, and push to ${build.branch}.
TRIPWIRE: never edit an AGENTS.md immutability-list file to make the gate pass — set touchedImmutable=true and stop.
Never weaken the CI gate, the leak-canary, or any attack-suite assertion to go green. Return whether you fixed and pushed.`,
    { label: `repair:${failures}`, phase: 'Gate', schema: REPAIR_SCHEMA }
  )

  if (repair && repair.touchedImmutable) {
    log('⛔ Self-repair would touch immutable files — refusing. Leaving the PR red for a human.')
    lastDetail = `self-repair blocked: would touch immutable files (${repair.detail})`
    break
  }
  if (!repair || !repair.fixed) {
    lastDetail = repair ? repair.detail : 'repair agent error (no push)'
    failures += 1
    continue
  }

  gate = await runGate(`gate:after-repair-${failures}`)
  if (gate && gate.passed) {
    failures = 0
    break
  }
  lastDetail = gate ? gate.detail : 'gate agent error'
  failures += 1
}

// 3rd failure (failures > MAX_RETRIES_PER_SHIFT) => error artifact + HALT, no more token spend.
if (failures > MAX_RETRIES_PER_SHIFT) {
  const artifact = await agent(
    `Write a concise error artifact to .claude/artifacts/improve-restomatch-FAILED-<date>.md. It MUST record:
the chosen item "${pick.item}", the PR (${build.prUrl || build.branch}), that the self-repair cap of ${MAX_RETRIES_PER_SHIFT}
was exhausted (3rd failure => HALT per AGENTS.md prime directive #4), the final failure detail below, and an explicit
"HUMAN ACTION NEEDED" line. Do NOT attempt any further fixes — the shift is halting to stop token spend.

Final failure detail:
${lastDetail}`,
    { label: 'error-artifact', phase: 'Gate' }
  )
  log(`⛔ Self-repair cap exhausted (${MAX_RETRIES_PER_SHIFT} retries). Halting. PR left red for a human.`)
  return {
    ran: true,
    shipped: true,
    gatePassed: false,
    halted: true,
    reason: 'retry-cap-exhausted',
    item: pick.item,
    prUrl: build.prUrl,
    diffLines: build.diffLines,
    errorArtifact: artifact,
    lastDetail,
    note: 'ONE PR is open but RED after 2 self-repair retries. Human reviews/fixes/merges. Autonomy is PR-only.',
  }
}

// ---- done: one green PR, human merges ----

const verdict = {
  ran: true,
  shipped: true,
  gatePassed: !!(gate && gate.passed),
  halted: false,
  item: pick.item,
  owningAgent: pick.owningAgent,
  prUrl: build.prUrl,
  branch: build.branch,
  diffLines: build.diffLines,
  planPath: plan.planPath,
  northStar: pick.northStar || pick.rationale,
  note:
    gate && gate.passed
      ? 'ONE PR open and green through the quality gate. Human reviews + merges — no auto-merge/deploy (AGENTS.md PR-only).'
      : 'ONE PR open; gate not fully green within the retry budget — human reviews. No merge/deploy.',
}
log(verdict.note)
return verdict
