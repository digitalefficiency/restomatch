export const meta = {
  name: 'ship-and-verify',
  description:
    'After SHIP-READY: /ship -> /land-and-deploy -> /canary + numbers-canary -> /document-release. Human deploys; a SECOND human gate fires on any Supabase migration in the diff.',
  phases: [
    { title: 'Ship', detail: '/ship opens the PR; detect migrations + second gate' },
    { title: 'Deploy', detail: '/land-and-deploy — human-merged + human-deployed only' },
    { title: 'Verify', detail: '/canary live watch + numbers-canary (leak-canary, ₪ to the agora)' },
    { title: 'Document', detail: '/document-release syncs docs + CHANGELOG' },
  ],
}

// ---- schemas -------------------------------------------------------------

const SHIP_SCHEMA = {
  type: 'object',
  required: ['opened', 'touchesMigration', 'touchesImmutable', 'summary'],
  properties: {
    opened: { type: 'boolean' },
    prUrl: { type: 'string' },
    touchesMigration: { type: 'boolean' },
    migrationFiles: { type: 'array', items: { type: 'string' } },
    touchesImmutable: { type: 'boolean' },
    immutableHits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const DEPLOY_SCHEMA = {
  type: 'object',
  required: ['merged', 'deployed', 'detail'],
  properties: {
    merged: { type: 'boolean' },
    deployed: { type: 'boolean' },
    prodUrl: { type: 'string' },
    detail: { type: 'string' },
  },
}

const NUMBERS_CANARY_SCHEMA = {
  type: 'object',
  required: ['passed', 'detail'],
  properties: {
    passed: { type: 'boolean' },
    leakCanary: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
    goldenIls: { type: 'string' },
    detail: { type: 'string' },
  },
}

const CANARY_SCHEMA = {
  type: 'object',
  required: ['healthy', 'detail'],
  properties: {
    healthy: { type: 'boolean' },
    consoleErrors: { type: 'integer' },
    detail: { type: 'string' },
  },
}

// ---- 1. ship -------------------------------------------------------------

phase('Ship')
const ship = await agent(
  `The current branch is SHIP-READY. Use the /ship skill to run tests, review the diff, bump VERSION,
update CHANGELOG, commit, push, and OPEN a PR against main. Per AGENTS.md prime directive #2 this is
PR-ONLY: open the PR and STOP — do NOT merge, do NOT deploy.

Before returning, inspect the diff that will land: \`git diff --name-only main...HEAD\` and
\`git diff --stat main...HEAD\`. Report:
- touchesMigration: true if the diff adds/edits ANY Supabase/drizzle migration —
  packages/db/drizzle/0000..NNNN_*.sql, packages/db/drizzle/meta/**, or packages/db/drizzle/rls/*.sql.
  List every such file in migrationFiles.
- touchesImmutable: true if the diff hits any AGENTS.md immutability-list file — the matching ₪-math
  (packages/matching/src/{engine,index,reconciliation,tolerances,units}.ts), the leak-canary
  (packages/matching/src/__tests__/{leak-canary.test,fixtures}.ts), formatIls (apps/web/lib/money.ts),
  packages/db/src/{schema,rls}.ts + drizzle.config.ts + drizzle/** + drizzle/rls/**,
  packages/api/src/__tests__/{cross-tenant.attack,rls.attack}.test.ts, packages/db/src/plans.ts,
  packages/billing/**, packages/api/src/approvals/engine.ts, packages/api/src/notifications/outbox.ts,
  apps/worker/src/cron.ts, packages/api/src/routers/leads.ts, apps/web/app/api/trpc/[trpc]/route.ts,
  apps/web/lib/rateLimit.ts, .github/workflows/**, .claude/agents/**, AGENTS.md, OPERATING.md.
  List the hits in immutableHits. NEVER auto-edit an immutable file — if /ship would, stop and report it.
Return prUrl + a one-line summary.`,
  { label: 'ship', phase: 'Ship', schema: SHIP_SCHEMA }
)

if (!ship || !ship.opened) {
  log(`❌ /ship did not open a PR: ${ship ? ship.summary : 'agent error'}. Halting before deploy.`)
  return { passed: false, reason: 'ship-failed', ship }
}
log(`✅ PR opened: ${ship.prUrl || '(see /ship output)'} — ${ship.summary}`)

if (ship.touchesImmutable) {
  log(
    `⚠️ Diff touches immutable files: ${(ship.immutableHits || []).join(', ')}. ` +
      'Per AGENTS.md these change only via a human-authored, human-reviewed PR.'
  )
}

// ---- SECOND HUMAN GATE: any Supabase/drizzle migration in the diff -------

if (ship.touchesMigration) {
  log(
    '🚨 SECOND HUMAN GATE — this PR contains a Supabase/drizzle migration:\n  ' +
      (ship.migrationFiles || []).join('\n  ') +
      '\n\nBLOCK: a migration is irreversible against prod data. A human must review the migration,' +
      ' plan apply ordering (drizzle then RLS 0001/0002), confirm it is forward-only, and run' +
      ' `pnpm --filter @restomatch/db migrate` against prod BEFORE the deploy. This workflow will NOT' +
      ' merge, deploy, or write prod Supabase. Stopping at the PR.'
  )
  return {
    passed: false,
    reason: 'migration-second-gate',
    blocked: true,
    prUrl: ship.prUrl,
    migrationFiles: ship.migrationFiles || [],
    touchesImmutable: ship.touchesImmutable,
    note:
      'BLOCK: Supabase migration present. PR is open and verified up to here; human reviews the migration,' +
      ' applies it, then deploys manually. Re-run verify (/canary + numbers-canary) after the human deploy.',
  }
}
log('No Supabase/drizzle migration in this diff — no second gate. Deploy is still human-only.')

// ---- 2. deploy (human-merged + human-deployed; we observe) ---------------

phase('Deploy')
const deploy = await agent(
  `Use the /land-and-deploy skill to take over after the PR was opened by /ship for the RestoMatch repo.

HARD CONSTRAINT (AGENTS.md prime directive #2 + OPERATING.md governance): autonomy is PR-ONLY. You may
NOT merge, deploy, write prod Supabase, send email/WhatsApp, or spend money. The HUMAN merges the PR and
runs the deploy. Your job is to WAIT for and OBSERVE the human action: poll PR/CI/deploy status (use the
gh CLI for GitHub), report whether the human has merged and whether the deploy completed, and surface the
production URL + any CI/deploy failures in detail.

If the PR is not yet merged by a human, return merged=false, deployed=false and say what the human still
needs to do — do NOT attempt to merge or deploy yourself.`,
  { label: 'land-and-deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA }
)

if (!deploy || !deploy.merged || !deploy.deployed) {
  log(
    `⏸️ Deploy not complete (merged=${deploy ? deploy.merged : '?'}, deployed=${
      deploy ? deploy.deployed : '?'
    }): ${deploy ? deploy.detail : 'agent error'}. ` +
      'A human must merge + deploy. Verify will not run against a stale prod.'
  )
  return { passed: false, reason: 'awaiting-human-deploy', prUrl: ship.prUrl, deploy }
}
log(`✅ Human merged + deployed. Prod: ${deploy.prodUrl || '(see /land-and-deploy output)'}`)

// ---- 3. verify: /canary (live) + numbers-canary (₪ to the agora) ---------
// Independent observations — run together at a barrier.

phase('Verify')
const [canary, numbers] = await parallel([
  () =>
    agent(
      `Use the /canary skill for post-deploy monitoring of the freshly deployed RestoMatch production app${
        deploy.prodUrl ? ` at ${deploy.prodUrl}` : ''
      }. Watch for console errors, page failures, and performance regressions vs the pre-deploy baseline;
take periodic screenshots. The app is Hebrew-first RTL. Return healthy=true only if zero page failures
and no new console errors; put the count in consoleErrors and any anomaly in detail.`,
      { label: 'canary', phase: 'Verify', schema: CANARY_SCHEMA }
    ),
  () =>
    agent(
      `Run the NUMBERS-CANARY: prove the leak ₪ math survived this ship to the agora.
1. Bootstrap the test DB: \`pnpm --filter @restomatch/db migrate\` (DATABASE_URL = the local test DB,
   default postgres://<user>@localhost:5432/restomatch_test).
2. Run the matching leak-canary specifically:
   \`pnpm --filter @restomatch/matching test -- leak-canary\`
   (this is packages/matching/src/__tests__/leak-canary.test.ts — it asserts the golden ₪ figures,
   computed in integer agorot via packages/matching/src/money.ts and displayed via formatIls).
3. Assert the golden ₪ figures match to the agora (no off-by-an-agora drift, VAT default 0.17,
   TOTAL_TOLERANCE_ILS unchanged). Report leakCanary=pass|fail, the asserted goldenIls figure, and
   passed=true only if the canary is green to the agora. Put any drift in detail.`,
      { label: 'numbers-canary', phase: 'Verify', schema: NUMBERS_CANARY_SCHEMA }
    ),
])

if (!numbers || !numbers.passed) {
  log(
    `❌ NUMBERS-CANARY failed: ${numbers ? numbers.detail : 'agent error'}. ` +
      'The leak ₪ figure drifted — this directly threatens the North Star (the ₪ an owner believes). ' +
      'Escalate to a human immediately; do NOT proceed to documentation.'
  )
  return { passed: false, reason: 'numbers-canary-fail', prUrl: ship.prUrl, deploy, numbers, canary }
}
log(`✅ Numbers-canary green — golden ₪ holds (${numbers.goldenIls || 'to the agora'}).`)

if (!canary || !canary.healthy) {
  log(
    `⚠️ Live /canary unhealthy: ${canary ? canary.detail : 'agent error'} ` +
      `(consoleErrors=${canary ? canary.consoleErrors : '?'}). Flagging for human — possible rollback.`
  )
}

// ---- 4. document the release ---------------------------------------------

phase('Document')
const docs = await agent(
  `Use the /document-release skill for the release just shipped. Cross-reference the diff that landed
(\`git diff --stat main...HEAD\` on the merge, or the PR ${ship.prUrl || ''}) against the repo docs:
update README/ARCHITECTURE/CONTRIBUTING, sync STATE.md's "Last completed task" + test count if changed,
polish the CHANGELOG voice, and clean stale TODOs. Do NOT edit any AGENTS.md immutability-list file
(.github/workflows/**, .claude/agents/**, AGENTS.md, OPERATING.md included) — propose any such change in
your artifact and stop. This is a doc-sync commit on a branch + PR only; a human merges. Return a one-line
summary of what you changed (or "ran, clean" if nothing needed updating).`,
  { label: 'document-release', phase: 'Document' }
)

// ---- result --------------------------------------------------------------

const result = {
  passed: numbers.passed && (!canary || canary.healthy),
  prUrl: ship.prUrl,
  prodUrl: deploy.prodUrl,
  migrationGate: 'none',
  numbersCanary: { passed: numbers.passed, goldenIls: numbers.goldenIls },
  liveCanary: canary ? { healthy: canary.healthy, consoleErrors: canary.consoleErrors } : null,
  touchesImmutable: ship.touchesImmutable,
  docs: docs || 'document-release: agent error',
  note:
    numbers.passed && canary && canary.healthy
      ? 'SHIPPED + VERIFIED: human-merged + human-deployed, numbers-canary green to the agora, live canary healthy, docs synced.'
      : numbers.passed
        ? 'Numbers-canary green, but live canary flagged anomalies — human reviews / consider rollback.'
        : 'Numbers-canary failed — escalated to human.',
}

log(result.note)
return result
