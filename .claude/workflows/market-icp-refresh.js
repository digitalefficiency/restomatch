export const meta = {
  name: 'market-icp-refresh',
  description:
    'Monthly: /deep-research the competitive landscape -> (SimilarWeb when authed) -> competitive-brief -> anti-ICP drift check. Gate only if a GTM change is proposed.',
  phases: [
    { title: 'Research', detail: 'Zester / Restigo / MarketMan landscape; SimilarWeb if authed' },
    { title: 'Brief', detail: 'competitive-brief artifact; does the GR-axis loss-recovery wedge still hold?' },
    { title: 'DriftCheck', detail: 'anti-ICP drift; gate (human) only if it proposes editing docs/GTM.md' },
  ],
}

// ---- schemas -------------------------------------------------------------

const RESEARCH_SCHEMA = {
  type: 'object',
  required: ['competitors', 'wedgeHolds', 'summary'],
  properties: {
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'lane', 'whatChanged'],
        properties: {
          name: { type: 'string' },
          lane: { type: 'string', description: 'their actual lane: procurement/ordering, food-cost/inventory, price-alerts, etc.' },
          whatChanged: { type: 'string', description: 'new since last refresh; "no material change" is a valid answer' },
          touchesGrAxis: { type: 'boolean', description: 'true ONLY if they now do automated PO<->GR<->invoice 3-way match for IL restaurants' },
          citations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    similarWeb: { type: 'string', enum: ['used', 'unauthed-skipped'] },
    wedgeHolds: { type: 'boolean', description: 'does the GR-axis loss-recovery wedge ("MarketMan מזמין, RestoMatch בודק") still hold?' },
    wedgeThreat: { type: 'string', description: 'the single most credible threat to the wedge, or "none material"' },
    summary: { type: 'string' },
  },
}

const DRIFT_SCHEMA = {
  type: 'object',
  required: ['driftDetected', 'proposesGtmEdit', 'detail'],
  properties: {
    driftDetected: { type: 'boolean', description: 'is the brief pulling us toward an Anti-ICP (dark kitchens, enterprise-ERP franchises, micro-cafes <₪80k) or off the GR-axis wedge?' },
    proposesGtmEdit: { type: 'boolean', description: 'does the brief recommend editing docs/GTM.md or docs/ICP.md (icp-keeper territory)?' },
    gtmEdits: { type: 'array', items: { type: 'string' }, description: 'one line per proposed GTM/ICP change' },
    detail: { type: 'string' },
  },
}

// ---- 1. research ---------------------------------------------------------

phase('Research')
const research = await agent(
  `Use the /deep-research skill to refresh RestoMatch's competitive landscape for Israeli restaurant procurement.
North Star context (AGENTS.md): RestoMatch is a loss-prevention product — the automated PO<->GR<->invoice 3-way
match, quantified in ₪, that surfaces ≥1.5% of a restaurant's food spend as leak. The wedge (docs/GTM.md §3):
"MarketMan מזמין, RestoMatch בודק שלא עבדו עליך" — we do NOT compete in ordering/inventory; we own the GR
(goods-receipt) axis nobody automates.

Research these three named competitors and confirm whether the GR-axis loss-recovery wedge still holds:
- **Zester** — supplier price-alerts / ordering for IL restaurants.
- **Restigo** — IL food-cost / back-of-house ops.
- **MarketMan** — procurement + inventory (the "they order, we check" reference point).
For each: their actual lane, anything new since the last refresh (pricing, a launched 3-way-match / GR /
delivery-verification feature, IL market moves), and crucially \`touchesGrAxis\` = true ONLY if they now do
automated PO<->GR<->invoice reconciliation for IL restaurants (which would attack our wedge). Cite sources.

If a SimilarWeb (or equivalent traffic) MCP/tool is AUTHENTICATED and available, pull a directional traffic
read on the three domains and set similarWeb="used"; if NOT authed, set similarWeb="unauthed-skipped" and do
not block on it (PR-only, never spend money or authenticate on your own — AGENTS.md prime directive 2).
Set wedgeHolds=false only if a competitor genuinely moved onto the GR 3-way-match axis.`,
  { label: 'research', phase: 'Research', schema: RESEARCH_SCHEMA, model: 'opus' }
)

if (!research) {
  log('Research agent failed — aborting refresh.')
  return { ran: false, reason: 'research-failed' }
}
const grThreats = (research.competitors || []).filter((c) => c.touchesGrAxis)
if (grThreats.length) {
  log(`⚠️ GR-axis encroachment flagged: ${grThreats.map((c) => c.name).join(', ')}. Wedge holds=${research.wedgeHolds}.`)
}
log(`SimilarWeb: ${research.similarWeb}. Wedge holds: ${research.wedgeHolds}.`)

// ---- 2. competitive brief ------------------------------------------------

phase('Brief')
const brief = await agent(
  `Write the monthly RestoMatch competitive brief as a markdown artifact at docs/competitive-brief-${args.month || new Date().toISOString().slice(0, 7)}.md.
You are scoped to docs/ only — do NOT touch docs/GTM.md or docs/ICP.md here (those are icp-keeper / human-PR
territory; you only PROPOSE changes to them, you never edit them).

Ground it in this refresh data (verbatim, do not invent competitors):
${JSON.stringify(research, null, 2)}

The brief must explicitly answer, with citations: does the GR-axis loss-recovery wedge still hold? Structure:
1. TL;DR (one line: wedge holds / at risk, and why).
2. Per-competitor (Zester, Restigo, MarketMan): lane, what changed, GR-axis encroachment yes/no.
3. Wedge integrity — is "MarketMan מזמין, RestoMatch בודק" still uncontested on the GR axis?
4. Anti-ICP watch — anything pulling us toward dark kitchens / enterprise-ERP franchises / micro-cafes (<₪80k
   food spend), the three Anti-ICP segments in docs/GTM.md §2.3.
5. Recommendations — separate "no GTM change needed" from any proposed edit to docs/GTM.md or docs/ICP.md, and
   if you propose a GTM/ICP edit, say so loudly (it triggers a human gate). Tie every recommendation back to the
   North Star (does it manufacture, dramatize, deliver, or protect the ₪ leak number?).
Open a PR with just this brief (PR-only, never merge — AGENTS.md). Return the artifact path + the TL;DR line +
whether the brief proposes any docs/GTM.md or docs/ICP.md edit.`,
  { label: 'brief', phase: 'Brief' }
)

if (!brief) {
  log('Brief agent failed — research stands but no artifact produced.')
  return { ran: false, reason: 'brief-failed', research }
}

// ---- 3. anti-ICP drift check (gate only on a proposed GTM edit) ----------

phase('DriftCheck')
const drift = await agent(
  `Use the /cso mindset of an adversary, but for STRATEGY not security: act as the icp-keeper drift sentinel on
the competitive brief just produced. Read docs/GTM.md (the ICP, Anti-ICP §2.3, and the wedge §3) and the new
brief, then judge:
- driftDetected: is the brief's reasoning or recommendations pulling RestoMatch off the GR-axis loss-recovery
  wedge, or toward an Anti-ICP segment (dark kitchens, enterprise-ERP franchises, micro-cafes <₪80k food spend)?
- proposesGtmEdit: does the brief recommend editing docs/GTM.md or docs/ICP.md? List each proposed change.
Be strict: a competitive move is only a reason to change GTM if it actually contests the GR 3-way-match axis or
the "≥1.5% of food spend as leak, in ₪" North Star. "Add a feature MarketMan shipped" is usually drift, not strategy.

Brief result: ${JSON.stringify(brief)}`,
  { label: 'drift', phase: 'DriftCheck', schema: DRIFT_SCHEMA }
)

const gate = !!(drift && (drift.proposesGtmEdit || drift.driftDetected))
const verdict = {
  ran: true,
  month: args.month || new Date().toISOString().slice(0, 7),
  similarWeb: research.similarWeb,
  wedgeHolds: research.wedgeHolds,
  grAxisThreats: grThreats.map((c) => c.name),
  briefArtifact: brief,
  drift: drift || { error: 'drift-check-failed' },
  gate,
  note: !drift
    ? 'Drift check failed — escalate to a human to read the brief before merge.'
    : gate
      ? `GATE (human required): brief ${drift.proposesGtmEdit ? 'proposes a docs/GTM.md / docs/ICP.md edit' : 'shows anti-ICP drift'} — that is icp-keeper / human-authored-PR territory (immutability list). Do NOT auto-edit GTM/ICP; the brief PR stands for a human to review and decide.`
      : 'No GTM change proposed and no anti-ICP drift — wedge holds. Brief PR is informational; a human can merge at leisure.',
}

log(verdict.note)
return verdict
