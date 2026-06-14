export const meta = {
  name: 'quality-gate-pr',
  description: 'Per-PR quality spine: gather diff context, run the mechanical gate, fan out review lenses, synthesize a merge verdict (human merges).',
  phases: [
    { title: 'Context', detail: 'changed files + risk flags' },
    { title: 'Mechanical', detail: 'migrate + turbo typecheck/test' },
    { title: 'Review', detail: '/review, /codex, /cso(daily), /qa(web only)' },
    { title: 'Verdict', detail: 'synthesize pass/block for a human' },
  ],
}

// ---- schemas -------------------------------------------------------------

const CONTEXT_SCHEMA = {
  type: 'object',
  required: ['files', 'touchesWeb', 'touchesMatching', 'touchesImmutable', 'summary'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    touchesWeb: { type: 'boolean' },
    touchesMatching: { type: 'boolean' },
    touchesImmutable: { type: 'boolean' },
    immutableHits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['passed', 'detail'],
  properties: {
    passed: { type: 'boolean' },
    typecheck: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
    test: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
    detail: { type: 'string' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'title'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
          file: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
}

// ---- 1. context ----------------------------------------------------------

phase('Context')
const ctx = await agent(
  `Gather PR review context for the RestoMatch repo on the current branch.
Run: \`git diff --name-only main...HEAD\` and \`git diff --stat main...HEAD\`.
Return the changed files and these risk flags:
- touchesWeb: any file under apps/web/
- touchesMatching: any file under packages/matching/
- touchesImmutable: any file in the AGENTS.md immutability list — the matching engine ₪-math
  (packages/matching/src/{engine,reconciliation,tolerances,units}.ts, index.ts), packages/db/src/schema.ts,
  packages/db/drizzle/** , packages/db/src/rls.ts, packages/db/drizzle/rls/**, packages/api/src/routers/leads.ts,
  packages/db/src/plans.ts, packages/billing/**, packages/api/src/approvals/engine.ts,
  packages/api/src/__tests__/{cross-tenant.attack,rls.attack}.test.ts, apps/web/app/api/trpc/[trpc]/route.ts,
  apps/web/lib/rateLimit.ts, .github/workflows/**, .claude/agents/**, AGENTS.md, OPERATING.md, the formatIls util.
List the specific immutable files hit in immutableHits. summary = one line.`,
  { label: 'context', phase: 'Context', schema: CONTEXT_SCHEMA }
)

if (!ctx) {
  log('Context agent failed — aborting gate.')
  return { passed: false, reason: 'context-failed' }
}
if (ctx.touchesImmutable) {
  log(`⚠️ Diff touches immutable files: ${(ctx.immutableHits || []).join(', ')}. These require a human-authored PR (AGENTS.md).`)
}

// ---- 2. mechanical gate --------------------------------------------------

phase('Mechanical')
const gate = await agent(
  `Run the RestoMatch mechanical gate exactly as CI does, and report results. Steps:
1. If DATABASE_URL_TEST is unset, the local test DB is postgres://<user>@localhost:5432/restomatch_test.
   Ensure schema: \`pnpm --filter @restomatch/db migrate\` (set DATABASE_URL to the test DB).
2. \`pnpm turbo run typecheck --concurrency=1 --filter='!@restomatch/web'\`
3. \`pnpm turbo run test --concurrency=1\`
Report typecheck/test as pass|fail and passed=true only if BOTH pass with zero skipped DB suites.
Put the failing output tail in detail if anything fails.`,
  { label: 'mechanical', phase: 'Mechanical', schema: GATE_SCHEMA }
)

if (!gate || !gate.passed) {
  log(`❌ Mechanical gate failed: ${gate ? gate.detail : 'agent error'}`)
  return { passed: false, reason: 'mechanical-gate', gate, ctx }
}
log('✅ Mechanical gate green (typecheck + test).')

// ---- 3. review lenses (fan out; /qa only when web changed) ---------------

phase('Review')
const lenses = [
  {
    key: 'review',
    prompt: `Use the /review skill to review the current branch diff against main for SQL safety, LLM trust-boundary issues, conditional side effects, and structural problems. Return findings.`,
  },
  {
    key: 'codex',
    prompt: `Use the /codex skill in review mode (codex review) for an independent second opinion on the current branch diff against main. Return findings.`,
  },
  {
    key: 'cso-daily',
    prompt: `Use the /cso skill in daily mode (zero-noise, high-confidence gate) on the current branch diff. Surface only security issues you are confident about. Return findings.`,
  },
]
if (ctx.touchesWeb) {
  lenses.push({
    key: 'qa',
    prompt: `The diff changes apps/web. Use the /qa skill (report-only is fine) on the affected web flows and return any bugs as findings.`,
  })
} else {
  log('Skipping /qa — no apps/web changes in this diff.')
}

const reviews = (
  await parallel(
    lenses.map((l) => () =>
      agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }).then(
        (r) => r && { ...r, lens: r.lens || l.key }
      )
    )
  )
).filter(Boolean)

// ---- 4. health + verdict -------------------------------------------------

phase('Verdict')
const health = await agent(
  `Use the /health skill to compute the codebase quality score for the current state and return a one-line summary with the composite score.`,
  { label: 'health', phase: 'Verdict' }
)

const allFindings = reviews.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
const blockers = allFindings.filter((f) => f.severity === 'blocker' || f.severity === 'high')

const verdict = {
  passed: gate.passed && blockers.length === 0 && !ctx.touchesImmutable,
  mechanical: gate,
  touchesImmutable: ctx.touchesImmutable,
  immutableHits: ctx.immutableHits || [],
  blockers,
  totalFindings: allFindings.length,
  health,
  note:
    ctx.touchesImmutable
      ? 'BLOCK: diff touches immutable files — requires a human-authored PR (AGENTS.md). Human merges regardless.'
      : blockers.length
        ? `BLOCK: ${blockers.length} blocker/high findings. Human merges regardless.`
        : 'Clean: mechanical gate green, no blocking findings. Human merges.',
}

log(verdict.note)
return verdict
