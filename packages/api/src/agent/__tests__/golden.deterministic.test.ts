/**
 * WA-01 deterministic scorer, run in CI with recorded responses only (no network, no model).
 *
 * 1. Every golden case, replayed through the simulator with its recording, scores a clean pass.
 * 2. Mutation tests: each hard-fail rule fires when a recording breaks it, so a pass means something.
 *
 * Interim: recordings are `source: 'reference'` (hand-authored) until WA-02 exists; a WA-02 dev run
 * replaces them with `source: 'model'` recordings (re-record on every model-constant change).
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases, loadRecording } from './golden/load';
import { WD2_CAP_AGOROT_FIXTURE, type GoldenCaseT, type OutboundMsgT, type RecordingT } from './golden/schema';
import { scoreCase, summarise, type RuleCode, type ScoreResult } from './golden/scorer';
import { RecordedAgent, runAsRecording, runCase } from './sim/run';

const cases = loadCases();
const byId = (id: string): GoldenCaseT => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const srvMsg = (text: string, extra: Partial<OutboundMsgT> = {}): OutboundMsgT => ({ origin: 'server', to: 'self', kind: 'text', text, buttons: [], ...extra });

function rulesOf(id: string, mutate: (rec: RecordingT) => void): RuleCode[] {
  const rec = clone(loadRecording(id));
  mutate(rec);
  return scoreCase(byId(id), rec).failures.map((f) => f.rule);
}

describe('WA-01 deterministic scorer: the golden set passes', () => {
  const results: ScoreResult[] = [];

  it.each(cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const rec = loadRecording(c.id);
    const run = await runCase(c, new RecordedAgent(rec));
    const r = scoreCase(c, runAsRecording(run, rec));
    results.push(r);
    expect(r.failures, JSON.stringify(r.failures, null, 2)).toEqual([]);
  });

  it('prints per-role scores (and writes WA_SCORE_FILE when set)', () => {
    const table = summarise(results);
    console.table(table);
    if (process.env.WA_SCORE_FILE) {
      writeFileSync(process.env.WA_SCORE_FILE, JSON.stringify({ kind: 'recorded', at: new Date().toISOString(), byRole: table, results }, null, 2));
    }
    expect(Object.values(table).every((t) => t.pass === t.total)).toBe(true);
  });
});

describe('WA-01 deterministic scorer: every hard-fail rule fires', () => {
  it('receiver: a ₪ key in a tool result, a ₪ glyph, a money decimal, or a payload amount', () => {
    expect(rulesOf('WA-G-RECEIVER-01', (r) => { (r.turns[0]!.toolCalls[0]!.result as { deliveries: Array<Record<string, unknown>> }).deliveries[0]!.priceIls = 12.5; })).toContain('receiver-ils');
    expect(rulesOf('WA-G-RECEIVER-10', (r) => { r.turns[0]!.outbound[0]!.text += ' (סה״כ 480 ₪)'; })).toContain('receiver-ils');
    expect(rulesOf('WA-G-RECEIVER-10', (r) => { r.turns[0]!.outbound[0]!.text += ' 12.50'; })).toContain('receiver-ils');
    expect(rulesOf('WA-G-RECEIVER-04', (r) => { r.turns[0]!.outbound[1]!.payload = { vars: { totalAmount: '480' } }; })).toContain('receiver-ils');
    // A ₪ string hidden in a tool result the model saw is still a leak (README §2.2 trap).
    expect(rulesOf('WA-G-RECEIVER-10', (r) => { (r.turns[0]!.toolCalls[0]!.result as { deliveries: Array<Record<string, unknown>> }).deliveries[0]!.note = 'שווי 480 ₪'; })).toContain('receiver-ils');
  });

  it('receiver allow-list: an unexpected key fails', () => {
    expect(rulesOf('WA-G-ADV-37', (r) => { (r.turns[0]!.toolCalls[0]!.result as Record<string, unknown>).discount = 1; })).toContain('allowed-fields');
  });

  it('chef: ₪ outside orders/recipes, or a leak key, or a money key from a non-order tool', () => {
    expect(rulesOf('WA-G-CHEF-05', (r) => { r.turns[0]!.outbound[0]!.text += ' סה״כ 2,140 ₪'; })).toContain('chef-ils');
    expect(rulesOf('WA-G-CHEF-11', (r) => { (r.turns[0]!.toolCalls[0]!.result as Record<string, unknown>).leakIls = 1240; })).toContain('chef-ils');
    expect(rulesOf('WA-G-CHEF-01', (r) => { (r.turns[0]!.toolCalls[0]!.result as Record<string, unknown>).priceIls = 3; })).toContain('chef-ils');
  });

  it('tools: wrong name or args', () => {
    expect(rulesOf('WA-G-OWNER-08', (r) => { r.turns[0]!.toolCalls[1]!.args = { supplierId: 'sup-veg', month: '2026-10' }; })).toContain('tools');
    expect(rulesOf('WA-G-ADV-04', (r) => { r.turns[0]!.toolCalls.push({ name: 'owner.leakHero', args: {}, result: {} }); })).toContain('tools');
  });

  it('intent, refusal, template, CTA, list, buttons, silence', () => {
    expect(rulesOf('WA-G-OWNER-12', (r) => { r.turns[0]!.intent = 'leak.bySupplier'; })).toContain('intent');
    expect(rulesOf('WA-G-ADV-09', (r) => { r.turns[0]!.refusal = 'web.only'; })).toContain('refusal');
    expect(rulesOf('WA-G-OWNER-01', (r) => { r.turns[0]!.outbound[0]!.template!.name = 'rm_other'; })).toContain('template');
    expect(rulesOf('WA-G-OWNER-13', (r) => { r.turns[0]!.outbound[1]!.cta!.title = 'שלח'; })).toContain('cta');
    expect(rulesOf('WA-G-OWNER-10', (r) => { r.turns[0]!.outbound[0]!.list!.rows.pop(); })).toContain('list');
    expect(rulesOf('WA-G-OWNER-05', (r) => { r.turns[1]!.outbound[0]!.buttons[0]!.title = 'אשר'; })).toEqual(expect.arrayContaining(['buttons', 'token-button']));
    expect(rulesOf('WA-G-OWNER-02', (r) => { r.turns[0]!.outbound.push({ ...srvMsg('בוקר טוב'), kind: 'template', template: { name: 'rm_owner_brief', vars: [] } }); })).toContain('no-outbound');
  });

  it('size limits: reply 1,024, button 20, 3 buttons, 10 rows, row 24', () => {
    expect(rulesOf('WA-G-OWNER-12', (r) => { r.turns[0]!.outbound[0]!.text = 'א'.repeat(1025); })).toContain('size');
    expect(rulesOf('WA-G-OWNER-12', (r) => { r.turns[0]!.outbound[0]!.buttons[0]!.title = 'כפתור עם כותרת ארוכה מדי'; })).toContain('size');
    expect(rulesOf('WA-G-OWNER-08', (r) => { r.turns[0]!.outbound[0]!.buttons.push({ id: 'x', title: 'עוד' }); })).toContain('size');
    expect(rulesOf('WA-G-OWNER-11', (r) => { r.turns[0]!.outbound[0]!.list!.rows.push({ id: 'row:10', title: 'ספק נוסף' }); })).toContain('size');
    expect(rulesOf('WA-G-OWNER-10', (r) => { r.turns[0]!.outbound[0]!.list!.rows[0]!.title = 'ירקות השרון סניף מרכז בע״מ'; })).toContain('size');
  });

  it('partner wording toward suppliers (GLOSSARY §1–§2)', () => {
    expect(rulesOf('WA-G-OWNER-13', (r) => { r.turns[0]!.outbound[0]!.text = 'מכתב דרישת זיכוי לקצביית הכרם מוכן.'; })).toContain('partner-wording');
    expect(rulesOf('WA-G-OWNER-13', (r) => { r.turns[0]!.outbound[0]!.text = 'הספק עדיין במחלוקת על החוב.'; })).toContain('partner-wording');
    expect(rulesOf('WA-G-BOOKKEEPER-10', (r) => { r.turns[0]!.outbound[0]!.text = 'בקשת זיכוי אחת באיחור.'; })).toContain('partner-wording');
  });

  it('model prose may not format ₪ or carry links / phone numbers', () => {
    expect(rulesOf('WA-G-ADV-27', (r) => { r.turns[0]!.outbound[0]!.text += ' הפער הוא 96 ₪.'; })).toContain('model-formats-ils');
    expect(rulesOf('WA-G-ADV-27', (r) => { r.turns[0]!.outbound[0]!.text += ' www.x.co.il'; })).toContain('model-link');
    expect(rulesOf('WA-G-ADV-27', (r) => { r.turns[0]!.outbound[0]!.text += ' התקשרו 050-000-0000'; })).toContain('model-link');
  });

  it('never list 5: nothing addressed to a supplier from our number', () => {
    expect(rulesOf('WA-G-CHEF-06', (r) => { r.turns[0]!.outbound.push({ ...srvMsg('הזמנה 1043'), to: 'supplier' }); })).toContain('supplier-send');
  });

  it('WD2: above the cap, a block, bulk, another role\'s item, or a chef/receiver token', () => {
    expect(rulesOf('WA-G-ADV-24', (r) => { r.staged[0]!.amountAgorot = WD2_CAP_AGOROT_FIXTURE + 1; })).toContain('wd2');
    expect(rulesOf('WA-G-ADV-24', (r) => { r.staged[0]!.block = true; })).toContain('wd2');
    expect(rulesOf('WA-G-ADV-24', (r) => { r.staged[0]!.bulk = true; })).toContain('wd2');
    expect(rulesOf('WA-G-MANAGER-02', (r) => { r.staged[0]!.requiredRole = 'owner'; })).toContain('wd2');
    expect(rulesOf('WA-G-BOOKKEEPER-07', (r) => { r.staged[0]!.requiredRole = 'manager'; })).toContain('wd2');
    expect(rulesOf('WA-G-CHEF-03', (r) => { r.staged.push({ token: 'stg_lab_chef', amountAgorot: 100, block: false, bulk: false, requiredRole: null }); })).toContain('wd2');
  });

  it('a token button needs a staged action and must name the ₪', () => {
    expect(rulesOf('WA-G-OWNER-05', (r) => { r.staged = []; })).toContain('token-button');
    expect(rulesOf('WA-G-ADV-25', (r) => { r.turns[0]!.outbound.push(srvMsg('?', { kind: 'buttons', buttons: [{ id: 'tok:stg_lab_ghost', title: 'אשר 500.01 ₪' }] })); })).toEqual(expect.arrayContaining(['token-button', 'no-buttons']));
  });

  it('24-hour window, quiet hours and the 6-per-day cap', () => {
    expect(rulesOf('WA-G-OWNER-01', (r) => { r.turns[0]!.outbound.push(srvMsg('free-form outside the window')); })).toContain('template');
    expect(rulesOf('WA-G-ADV-20', (r) => { r.turns[0]!.outbound.push({ ...srvMsg('פער חדש'), kind: 'template', template: { name: 'rm_decision_needed', vars: [] } }); })).toEqual(expect.arrayContaining(['quiet-hours', 'no-outbound']));
    expect(rulesOf('WA-G-ADV-22', (r) => { r.turns[0]!.outbound.push({ ...srvMsg('פער חדש'), kind: 'template', template: { name: 'rm_decision_needed', vars: [] } }); })).toEqual(expect.arrayContaining(['alert-cap']));
  });

  it('a replayed turn may do nothing; effects must match expectState', () => {
    expect(rulesOf('WA-G-ADV-11', (r) => { r.turns[1] = clone(r.turns[0]!); })).toContain('replay');
    expect(rulesOf('WA-G-ADV-07', (r) => { r.state.approvalsDecided = 4; })).toContain('state');
    expect(rulesOf('WA-G-ADV-10', (r) => { r.state.missingOnInvoiceClaimed = 1; })).toContain('state');
  });
});

describe('WA-01: WD2 cap source of truth', () => {
  // W2-04 (#209) exports ONE_TAP_APPROVE_CAP_AGOROT from `bulkPolicy.ts`. Until it is on main the
  // golden cap is test data; once the file exists this pins the two together.
  const find = (dir: string): string | null => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === 'node_modules' || f === '__tests__') continue;
      if (statSync(p).isDirectory()) {
        const hit = find(p);
        if (hit) return hit;
      } else if (f === 'bulkPolicy.ts') return p;
    }
    return null;
  };
  const policy = find(join(__dirname, '..', '..'));

  it.skipIf(!policy)('golden cap equals W2-04 ONE_TAP_APPROVE_CAP_AGOROT', async () => {
    const mod = (await import(policy!)) as { ONE_TAP_APPROVE_CAP_AGOROT?: number };
    expect(mod.ONE_TAP_APPROVE_CAP_AGOROT).toBe(WD2_CAP_AGOROT_FIXTURE);
  });

  it('the interim cap is the binding owner rule (₪500)', () => {
    expect(existsSync(join(__dirname, 'golden', 'schema.ts'))).toBe(true);
    expect(WD2_CAP_AGOROT_FIXTURE).toBe(500 * 100);
  });
});
