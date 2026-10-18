export const meta = {
  name: 'weekly-product-growth',
  description:
    'Mon 07:00 IL: ship recap -> funnel snapshot -> metrics-review -> /office-hours forcing questions -> roadmap-update. Roadmap commit is human.',
  phases: [
    { title: 'Recap', detail: 'last 7 days of ships vs the ₪ North Star' },
    { title: 'Funnel', detail: '3-pilots->converts funnel (Amplitude when authed, else creds-pending)' },
    { title: 'Review', detail: 'metrics-review + /office-hours forcing questions' },
    { title: 'Roadmap', detail: 'propose deltas; write report artifact; never commit the roadmap' },
  ],
}

// ---- schemas -------------------------------------------------------------

const RECAP_SCHEMA = {
  type: 'object',
  required: ['ships', 'northStarLine'],
  properties: {
    ships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sha', 'subject', 'verdict'],
        properties: {
          sha: { type: 'string' },
          subject: { type: 'string' },
          // does this manufacture / dramatize / deliver / protect the ₪ leak number?
          verdict: { type: 'string', enum: ['manufacture', 'dramatize', 'deliver', 'protect', 'off-axis'] },
          note: { type: 'string' },
        },
      },
    },
    offAxisCount: { type: 'integer' },
    northStarLine: { type: 'string' },
  },
}

const FUNNEL_SCHEMA = {
  type: 'object',
  required: ['source', 'summary'],
  properties: {
    // 'amplitude' when authed; 'leads-table' for the local tRPC leads funnel; 'pending-creds' when neither is readable
    source: { type: 'string', enum: ['amplitude', 'leads-table', 'pending-creds'] },
    pilotsTargeted: { type: 'integer' },
    pilotsLive: { type: 'integer' },
    converts: { type: 'integer' },
    leadsLast7d: { type: 'integer' },
    believedLeakIls: { type: 'string' },
    summary: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'soWhat'],
        properties: {
          title: { type: 'string' },
          // the forcing answer: what it means for the ₪ North Star
          soWhat: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const ROADMAP_SCHEMA = {
  type: 'object',
  required: ['deltas', 'reportPath', 'committed'],
  properties: {
    deltas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['change', 'rationale', 'axis'],
        properties: {
          change: { type: 'string' },
          rationale: { type: 'string' },
          axis: { type: 'string', enum: ['manufacture', 'dramatize', 'deliver', 'protect'] },
          owner: { type: 'string' },
        },
      },
    },
    reportPath: { type: 'string' },
    committed: { type: 'boolean' },
    note: { type: 'string' },
  },
}

// ---- 0. ground truth -----------------------------------------------------

log('weekly-product-growth — read AGENTS.md + STATE.md before acting. PR-only autonomy; this workflow only writes a report artifact and NEVER commits the roadmap.')

// ---- 1. recap ------------------------------------------------------------

phase('Recap')
const recap = await agent(
  `You are running the Recap phase of the weekly product-growth cadence for the RestoMatch repo.
First read AGENTS.md and STATE.md (prime directive 1). Do not edit anything.
Pull the last 7 days of ships: \`git log --since='7 days ago' --oneline --no-merges\` (also skim STATE.md
"Last completed task" for context).
For each commit, classify against the North Star — "≥1.5% of a restaurant's food spend, surfaced as leak,
in ₪, that one owner believes" — using the forcing question: does this MANUFACTURE the ₪ number (produce
the leak figure — matching engine, OCR ingest, charts SQL), DRAMATIZE it (surface/explain it — dashboard,
landing ROI calc, alerts), DELIVER it (get a pilot to believe + act — funnel, onboarding, approvals), or
PROTECT it (tenant isolation, money-format correctness, the leak-canary, RLS)? Anything that does none of
these is 'off-axis'.
Return the ship list with per-commit verdict + note, offAxisCount, and a one-line northStarLine on whether
the week's work moved the ₪ number. If there were zero ships in 7 days, return an empty ships array and say
so in northStarLine.`,
  { label: 'recap', phase: 'Recap', schema: RECAP_SCHEMA }
)

if (!recap) {
  log('Recap agent failed — continuing with degraded report.')
} else {
  log(`Recap: ${recap.ships.length} ships, ${recap.offAxisCount || 0} off-axis. ${recap.northStarLine}`)
}

// ---- 2. funnel snapshot --------------------------------------------------

phase('Funnel')
const funnel = await agent(
  `You are running the Funnel phase. Summarize the 3-pilots -> converts pilot funnel for RestoMatch.
Read-only. Prefer Amplitude when authed; otherwise fall back to the local leads funnel; otherwise note
that funnel data is pending creds.
Resolution order:
1. If an Amplitude credential/MCP is available and authed, read the pilot funnel events from there and set
   source='amplitude'.
2. Otherwise inspect the local lead funnel: the public ingest is packages/api/src/routers/leads.ts
   (leads.create — IMMUTABLE, read only) and the marketing lead form under apps/web/app/(marketing)/.
   Count leads in the last 7 days from whatever local signal exists (seed/dev DB or the leads table if
   reachable) and set source='leads-table'. Note: production Supabase is Phase-2 PARKED pending creds
   (STATE.md) — do NOT write to or query prod.
3. If neither is readable, set source='pending-creds' and return the exact summary
   "funnel data pending creds" with the empty counts.
Frame it as the pilot reality: pilotsTargeted (goal is 3), pilotsLive, converts, leadsLast7d, and
believedLeakIls = the ₪ leak figure pilots have actually been shown/believe (formatted via formatIls
conventions, '—' if unknown). List gaps = what instrumentation is missing to read this funnel honestly.
NEVER spend money, send email/WhatsApp, or write to prod (AGENTS.md prime directive 2).`,
  { label: 'funnel', phase: 'Funnel', schema: FUNNEL_SCHEMA }
)

if (funnel && funnel.source === 'pending-creds') {
  log('Funnel data pending creds — Amplitude/prod not authed. Reporting on the leads-flow instrumentation gap.')
} else if (funnel) {
  log(`Funnel (${funnel.source}): ${funnel.summary}`)
}

const recapBlock = recap
  ? `Ships (7d): ${recap.ships.map((s) => `${s.sha} [${s.verdict}] ${s.subject}`).join(' | ')}. North star: ${recap.northStarLine}`
  : 'Recap unavailable.'
const funnelBlock = funnel
  ? `Funnel source=${funnel.source}; pilotsLive=${funnel.pilotsLive ?? '?'}/${funnel.pilotsTargeted ?? 3}; converts=${funnel.converts ?? '?'}; leads7d=${funnel.leadsLast7d ?? '?'}; believedLeak=${funnel.believedLeakIls ?? '—'}. ${funnel.summary}`
  : 'Funnel unavailable.'

// ---- 3. review — metrics-review + /office-hours (fan out) ----------------

phase('Review')
const reviews = (
  await parallel([
    () =>
      agent(
        `You are the metrics-review lens of the weekly product-growth cadence. Read AGENTS.md + STATE.md first.
Given this week's recap and funnel, do an honest metrics read for the ₪ North Star.
RECAP: ${recapBlock}
FUNNEL: ${funnelBlock}
Call out: is the leak ₪ figure actually reaching owners and being believed? Is the funnel moving toward
3 live pilots -> converts, or stalled? Which off-axis ships should have been deferred? What single metric,
if it moved, would matter most this week? For each finding, the 'soWhat' MUST translate to the ₪ North
Star (manufacture/dramatize/deliver/protect). Return findings with lens='metrics-review'. Read-only.`,
        { label: 'review:metrics', phase: 'Review', schema: REVIEW_SCHEMA }
      ),
    () =>
      agent(
        `You are the founder-forcing lens. Use the /office-hours skill (YC startup mode — the six forcing
questions: demand reality, status quo, desperate specificity, narrowest wedge, observation, future-fit)
against the RestoMatch ₪ North Star: "≥1.5% of a restaurant's food spend, surfaced as leak, in ₪, that one
owner believes."
Use this week's signal as the input, NOT a hypothetical:
RECAP: ${recapBlock}
FUNNEL: ${funnelBlock}
Pressure-test whether we are manufacturing/dramatizing/delivering/protecting that ₪ number for a real
Israeli restaurant owner (ICP in docs/ICP.md + docs/GTM.md), or fooling ourselves. Each finding's 'soWhat'
is the forcing answer. Return findings with lens='office-hours'. This is analysis only — do not write code,
do not commit, do not edit docs/ICP.md or docs/GTM.md (those belong to icp-keeper/growth-pmm-engineer via
a human-reviewed PR).`,
        { label: 'review:office-hours', phase: 'Review', schema: REVIEW_SCHEMA }
      ),
  ])
).filter(Boolean)

const reviewFindings = reviews.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
const highFindings = reviewFindings.filter((f) => f.severity === 'high')
log(`Review: ${reviewFindings.length} findings across ${reviews.length} lenses (${highFindings.length} high).`)

// ---- 4. roadmap deltas + report artifact (NEVER commit the roadmap) ------

phase('Roadmap')
const reviewBlock = reviewFindings.length
  ? reviewFindings.map((f) => `(${f.lens}/${f.severity || 'med'}) ${f.title} -> ${f.soWhat}`).join(' | ')
  : 'No review findings.'

const roadmap = await agent(
  `You are running the Roadmap phase of the weekly product-growth cadence. Read AGENTS.md + STATE.md first.
Synthesize the week into proposed roadmap deltas for RestoMatch and WRITE A REPORT ARTIFACT — but DO NOT
commit, edit, or open a PR against the roadmap itself.
Inputs:
RECAP: ${recapBlock}
FUNNEL: ${funnelBlock}
REVIEW: ${reviewBlock}

Hard rules (AGENTS.md):
- PR-only autonomy, and for THIS workflow even that is out of scope: you only write a report artifact.
- The roadmap source-of-truth files (STATE.md "Next planned task", docs/REMAINING-SESSIONS.md) are owned
  by icp-keeper / growth-pmm-engineer and change ONLY via a human-authored, human-reviewed commit. Propose
  deltas in the report; the human edits the roadmap. committed MUST be false.
- Never auto-edit the immutability list or anything governing (.github/workflows, .claude/agents, AGENTS.md,
  OPERATING.md). If a delta needs one of those, write it as a proposal and stop.
- Never spend money / send email / write prod Supabase.

For each proposed delta give: change, rationale, axis (which North-Star verb it serves —
manufacture/dramatize/deliver/protect), and a suggested owner from the AGENTS.md ownership map
(e.g. growth-pmm-engineer for funnel/pilot, web-feature-engineer for dashboard, matching-engine-guardian
for ₪-math, icp-keeper for scope). Rank by ₪ impact.

Write the report to docs/reports/weekly-product-growth-<YYYY-MM-DD>.md (use today's date; create the
docs/reports/ directory if needed). The report must contain: the ship recap with North-Star verdicts, the
funnel snapshot (state clearly if it was 'funnel data pending creds'), the metrics-review + office-hours
findings, and the ranked roadmap-delta proposals with a "Human action required" header noting the roadmap
commit is the human's call.
Return the deltas array, the reportPath you wrote, committed=false, and a one-line note. If you truly had
nothing to add, still write a one-line "ran, clean" report and say so (AGENTS.md prime directive 6).`,
  { label: 'roadmap', phase: 'Roadmap', schema: ROADMAP_SCHEMA }
)

// ---- summary -------------------------------------------------------------

const summary = {
  ranAt: new Date().toISOString(),
  shipsLast7d: recap ? recap.ships.length : null,
  offAxisShips: recap ? recap.offAxisCount || 0 : null,
  funnelSource: funnel ? funnel.source : null,
  pilotsLive: funnel ? funnel.pilotsLive ?? null : null,
  converts: funnel ? funnel.converts ?? null : null,
  reviewFindings: reviewFindings.length,
  highFindings: highFindings.length,
  roadmapDeltas: roadmap ? (roadmap.deltas || []).length : 0,
  reportPath: roadmap ? roadmap.reportPath : null,
  roadmapCommitted: roadmap ? roadmap.committed : false,
  note: roadmap
    ? `${roadmap.note} — roadmap commit is HUMAN-ONLY (AGENTS.md). Report artifact written; nothing merged.`
    : 'Roadmap agent failed — see logs. No artifact may mean the shift errored; treat as a bug (OPERATING.md §Clean silence).',
}

// belt-and-suspenders: this workflow must never claim to have committed the roadmap
if (roadmap && roadmap.committed) {
  log('⚠️ Roadmap agent reported committed=true — VIOLATION. The roadmap commit is human-only; flag for human review.')
  summary.violation = 'roadmap-auto-committed'
}

log(summary.note)
return summary
