export const meta = {
  name: 'canary',
  description:
    'Post-deploy: browse-baseline diff -> Vercel logs -> Supabase advisors -> /benchmark -> the golden-fixture leak assertion (numbers-canary). PushNotification on anomaly.',
  phases: [
    { title: 'Browse', detail: '/canary live walk + baseline diff vs pre-deploy screenshots' },
    { title: 'Logs', detail: 'Vercel runtime logs + Supabase advisors (read-only against prod)' },
    { title: 'Numbers', detail: '/benchmark perf + golden-fixture leak-canary ₪ assertion; alert on drift' },
  ],
}

// ---- shared contract -----------------------------------------------------
//
// North Star: ≥1.5% of a restaurant's food spend surfaced as leak, in ₪, that
// one owner believes. This workflow PROTECTS that ₪ number after a deploy: it
// proves the live app still loads, performs, and surfaces the SAME leak figures
// to the agora. It does NOT manufacture/dramatize/deliver new ₪ — pure guard.
//
// Prime directives honored here:
//  (1) read STATE.md + AGENTS.md before acting (every agent is told to).
//  (2) autonomy is PR-ONLY and this run is stricter — READ-ONLY against prod:
//      no merge/deploy, no prod Supabase writes, no email, no spend. No code
//      edits at all; the only side effects are a PushNotification on anomaly
//      and an alert artifact file under .canary/.
//  (4) never edit the immutability list — the leak-canary
//      (packages/matching/src/__tests__/{leak-canary,fixtures}.ts) and money.ts
//      are RUN/READ here, never modified.
//  (6) always leave an artifact: clean run -> "ran, clean"; anomaly -> alert file.
//
// The ₪ figures live in the golden fixtures and are asserted to the agora by
// packages/matching/src/__tests__/leak-canary.test.ts. Money math is integer
// agorot (packages/matching/src/money.ts); display via formatIls
// (apps/web/lib/money.ts). A drift in either is an anomaly.

const PROD_URL = (args && (args.url || args.prodUrl)) || 'https://restomatch.vercel.app'

// ---- schemas -------------------------------------------------------------

const BROWSE_SCHEMA = {
  type: 'object',
  required: ['ok', 'pages', 'consoleErrors', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'status'],
        properties: {
          path: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'degraded', 'broken'] },
          httpStatus: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
    consoleErrors: { type: 'array', items: { type: 'string' } },
    baselineDiffs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'changed'],
        properties: {
          path: { type: 'string' },
          changed: { type: 'boolean' },
          detail: { type: 'string' },
        },
      },
    },
    anomaly: { type: 'boolean' },
    summary: { type: 'string' },
  },
}

const LOGS_SCHEMA = {
  type: 'object',
  required: ['ok', 'anomaly', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    vercel: {
      type: 'object',
      properties: {
        errorCount: { type: 'number' },
        sampledErrors: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
    supabase: {
      type: 'object',
      properties: {
        securityAdvisors: { type: 'array', items: { type: 'string' } },
        performanceAdvisors: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
    anomaly: { type: 'boolean' },
    summary: { type: 'string' },
  },
}

const PERF_SCHEMA = {
  type: 'object',
  required: ['ok', 'regression', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'value'],
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          baseline: { type: 'string' },
          regressed: { type: 'boolean' },
        },
      },
    },
    regression: { type: 'boolean' },
    summary: { type: 'string' },
  },
}

const NUMBERS_SCHEMA = {
  type: 'object',
  required: ['passed', 'drift', 'summary'],
  properties: {
    passed: { type: 'boolean' },
    leakFigures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fixture', 'ils'],
        properties: {
          fixture: { type: 'string' },
          ils: { type: 'string' },
          expectedIls: { type: 'string' },
          matchedToAgora: { type: 'boolean' },
        },
      },
    },
    drift: { type: 'boolean' },
    failingTests: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---- 1. Browse — live walk + baseline diff -------------------------------

phase('Browse')
const browse = await agent(
  `Read STATE.md and AGENTS.md first. You are the post-deploy canary for RestoMatch and you are READ-ONLY against production — never sign anything destructive, never write prod data, never trigger a redeploy.
Use the /canary skill to walk the live deployed app at ${PROD_URL} (Hebrew-first RTL dark "command center for money"). Visit at minimum: the marketing landing (/), the pricing section, the lead form, and the dashboard surfaces that render ₪ KPIs/leaks (the owner overview, leaks, suppliers, approvals queue). Use the browse daemon to take screenshots and diff them against the pre-deploy baseline if one exists (establish a baseline if none).
For each page report status ok|degraded|broken with httpStatus. Collect EVERY console error verbatim. List any pages whose screenshot meaningfully differs from baseline (baselineDiffs), ignoring expected dynamic data.
Set anomaly=true if ANY page is broken, returns a non-2xx/3xx, or emits a console error. summary = one line. Do not edit any files.`,
  { label: 'browse', phase: 'Browse', schema: BROWSE_SCHEMA, model: 'sonnet' }
)

if (!browse) {
  log('Browse agent failed — cannot establish live baseline. Treating as anomaly.')
} else {
  log(`Browse: ${browse.summary} (${(browse.pages || []).length} pages, ${(browse.consoleErrors || []).length} console errors)`)
}

// ---- 2. Logs — Vercel runtime + Supabase advisors (read-only) ------------

phase('Logs')
const logsResult = await agent(
  `Read STATE.md and AGENTS.md first. READ-ONLY against production — observe only, change nothing.
For the RestoMatch prod deploy:
1. Pull the most recent Vercel runtime logs for the production deployment (latest deploy of the web project). Count error-level entries since the deploy timestamp and sample up to 5 distinct error messages.
2. Run the Supabase advisors against the prod project: fetch SECURITY advisors and PERFORMANCE advisors (read-only — do NOT run any migration, do NOT write rows, do NOT change RLS). Summarize any new/critical advisors.
Set anomaly=true if there are runtime errors attributable to this deploy OR any new critical security/performance advisor. summary = one line.`,
  { label: 'logs', phase: 'Logs', schema: LOGS_SCHEMA, model: 'sonnet' }
)

if (!logsResult) {
  log('Logs agent failed — Vercel/Supabase observability unavailable this run.')
} else {
  log(`Logs: ${logsResult.summary}`)
}

// ---- 3. Numbers — /benchmark perf + golden-fixture leak ₪ canary ---------
//
// Two independent probes, run in parallel (barrier): live perf regression and
// the offline ₪-figure assertion. The leak-canary is in the immutability list
// — RUN it, never edit it.

phase('Numbers')
const [perf, numbers] = await parallel([
  () =>
    agent(
      `Read STATE.md and AGENTS.md first. READ-ONLY against production.
Use the /benchmark skill (browse-daemon performance regression detection) against the live deploy at ${PROD_URL}. Measure page load time, Core Web Vitals (LCP/CLS/INP), and resource/bundle sizes for the landing (/) and the heaviest dashboard ₪ screen. Compare against the stored pre-deploy baseline; if no baseline exists, record this run as the baseline and report regressed=false.
Set regression=true only for a real degradation beyond normal noise (e.g. LCP or TTFB materially worse than baseline). summary = one line. Do not edit any files.`,
      { label: 'benchmark', phase: 'Numbers', schema: PERF_SCHEMA, model: 'sonnet' }
    ),
  () =>
    agent(
      `Read STATE.md and AGENTS.md first. This is the NUMBERS-CANARY: prove the leak ₪ figures are unchanged to the agora after this deploy.
The golden fixtures and the assertion live in the IMMUTABILITY LIST — RUN them, never edit them: packages/matching/src/__tests__/leak-canary.test.ts and fixtures.ts, and packages/matching/src/money.ts (integer-agorot math: toAgorot/quantizeIls/mulIls/sumIls).
Steps (the repo's serial test protocol):
1. Bootstrap the test DB schema: with DATABASE_URL pointed at the local test DB (postgres://romkoren@localhost:5432/restomatch_test) run \`pnpm --filter @restomatch/db migrate\`.
2. Run the canary only: \`pnpm --filter @restomatch/matching test -- leak-canary\` (or \`pnpm turbo run test --concurrency=1 --filter=@restomatch/matching\` if needed). These tests assert the surfaced leak in ₪ to the agora.
For each golden fixture report the surfaced leak ils, the expectedIls baked into the fixture, and matchedToAgora (true iff equal to the agora — no rounding slack). passed=true only if the leak-canary suite is fully green. Set drift=true if ANY ₪ figure differs from its expected fixture value or any leak-canary assertion fails; list failing test names. summary = one line. Do NOT modify the fixtures, money.ts, or the assertion to make it pass.`,
      { label: 'numbers-canary', phase: 'Numbers', schema: NUMBERS_SCHEMA, model: 'sonnet' }
    ),
])

if (perf) log(`Benchmark: ${perf.summary}`)
else log('Benchmark agent failed — perf not verified this run.')
if (numbers) log(`Numbers-canary: ${numbers.summary}`)
else log('Numbers-canary agent failed — ₪ figures NOT verified this run (treat as anomaly).')

// ---- verdict + anomaly handling ------------------------------------------

const reasons = []
if (!browse || browse.anomaly) reasons.push('browse: ' + (browse ? browse.summary : 'agent failed'))
if (!logsResult || logsResult.anomaly) reasons.push('logs: ' + (logsResult ? logsResult.summary : 'agent failed'))
if (!perf || perf.regression) reasons.push('perf: ' + (perf ? perf.summary : 'agent failed'))
if (!numbers || numbers.drift || !numbers.passed)
  reasons.push('numbers: ' + (numbers ? numbers.summary : 'agent failed — ₪ unverified'))

const anomaly = reasons.length > 0
const driftedFigures = numbers
  ? (numbers.leakFigures || []).filter((f) => f.matchedToAgora === false || (f.expectedIls && f.ils !== f.expectedIls))
  : []

const verdict = {
  url: PROD_URL,
  ok: !anomaly,
  reasons,
  browse,
  logs: logsResult,
  perf,
  numbers,
  driftedFigures,
  note: anomaly
    ? `CANARY ANOMALY (${reasons.length}) — ${reasons.join(' | ')}`
    : 'ran, clean — live app loads, no console/runtime errors, perf within baseline, leak ₪ figures unchanged to the agora.',
}

if (anomaly) {
  // Anomaly => fire a PushNotification AND write an alert artifact. Still
  // READ-ONLY against prod: no rollback, no redeploy — alert a human.
  log(verdict.note)
  await agent(
    `A post-deploy CANARY ANOMALY was detected for the RestoMatch production deploy at ${PROD_URL}.
Do exactly two things and nothing else (you are read-only against prod — do NOT roll back, redeploy, merge, or write any data):
1. Fire a PushNotification to alert a human on call. Title: "RestoMatch canary anomaly". Body: a tight summary of these reasons:
${reasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}
${driftedFigures.length ? `   ₪ DRIFT — ${driftedFigures.map((f) => `${f.fixture}: ${f.ils} (expected ${f.expectedIls})`).join('; ')}` : ''}
2. Write a timestamped alert artifact to .canary/alert-<ISO8601-timestamp>.md in the repo containing: the prod URL, the deploy/run time, the full reason list, any console errors, any Vercel/Supabase advisor hits, perf metrics vs baseline, and the per-fixture leak ₪ table (surfaced vs expected). This is the read-only ₪-protection record. Confirm both done in one line.`,
    { label: 'alert', phase: 'Numbers', model: 'sonnet' }
  )
} else {
  log(verdict.note)
}

return verdict
