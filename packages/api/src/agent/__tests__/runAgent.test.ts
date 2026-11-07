import { discrepancies, eq, invoices, sql, suppliers, type Database } from '@restomatch/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, seedPlans, seedTenant, type Tenant } from '../../__tests__/fixtures';
import { __resetAgentBudget } from '../budget';
import { AgentDbError, callTool, runInAgentTx, ToolNotAllowedError } from '../caller';
import { HE } from '../copy/he';
import { __resetAgentMemory, __setAgentClient, runAgent, setAgentTurnSink, type AgentTurnEvent } from '../index';
import { moneyLeaks } from '../redact';
import { appRoleDb, fakeBinding, final, ownerDb, recordedModel, setFeatures, toolResults, toolUse } from './helpers';

/**
 * runAgent on the RLS-enforced app role with RECORDED model responses (no
 * network, no spend). Seed: tenants A, B, C; each has one open PRICE_HIGHER
 * gap of ₪100 on today's invoice. C's supplier is "ירקות השרון" and its only
 * line becomes MISSING_ON_INVOICE.
 */
let appDb: Database;
let A: Tenant;
let B: Tenant;
let C: Tenant;
const events: AgentTurnEvent[] = [];

beforeAll(async () => {
  appDb = await appRoleDb();
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  C = await seedTenant(ownerDb, 'C');
  await ownerDb.update(suppliers).set({ name: 'ירקות השרון' }).where(eq(suppliers.id, C.supplierId));
  await ownerDb.update(discrepancies).set({ type: 'MISSING_ON_INVOICE' }).where(eq(discrepancies.restaurantId, C.restaurantId));
  setAgentTurnSink((e) => events.push(e));
});

beforeEach(async () => {
  __resetAgentBudget();
  __resetAgentMemory();
  events.length = 0;
  for (const t of [A, B, C]) await setFeatures(t, { aiAssistant: true, recovery: true, payRun: true });
  await ownerDb.execute(sql`delete from assistant_usage`);
});
afterEach(() => __setAgentClient(undefined));

describe('connection and tenancy (WA-02 §5.9)', () => {
  it('refuses the owner (BYPASSRLS/superuser) connection', async () => {
    await expect(runAgent(ownerDb, fakeBinding(A), 'כמה דלף החודש?')).rejects.toBeInstanceOf(AgentDbError);
  });

  it('tool calls run as restomatch_app with the binding tenant set', async () => {
    const who = await runInAgentTx(appDb, fakeBinding(A), async (tx) =>
      (await tx.execute(sql`select current_user as u, current_setting('app.current_restaurant_id', true) as r`)) as unknown as Array<{ u: string; r: string }>,
    );
    expect(who[0]).toEqual({ u: 'restomatch_app', r: A.restaurantId });
  });

  it("another restaurant's supplier is not found", async () => {
    const r = await callTool(appDb, fakeBinding(A), 'supplier_leak', { supplier: B.supplierName });
    expect(r.verdict).toBe(HE.supplierNotFound);
    const own = await callTool(appDb, fakeBinding(A), 'supplier_leak', { supplier: A.supplierName });
    expect(own.data).toMatchObject({ found: true, openLeakAgorot: 10000, lineCount: 1 });
  });
});

describe('gates before the model', () => {
  it('off switch: aiAssistant off → fixed reply, 0 model calls (§5.10)', async () => {
    const m = recordedModel(() => final('x'));
    __setAgentClient(m.client);
    await setFeatures(A, {});
    const r = await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?');
    expect(r).toMatchObject({ text: HE.off, refusal: 'off', modelCalls: 0 });
    vi.stubEnv('FEATURES_OFF', 'aiAssistant');
    try {
      await setFeatures(A, { aiAssistant: true });
      expect((await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?')).refusal).toBe('off');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(m.create).not.toHaveBeenCalled();
  });

  it('closed intents: off-list text gets the fixed refusal, no tool, no model (§5.2)', async () => {
    const m = recordedModel(() => final('x'));
    __setAgentClient(m.client);
    for (const q of ['מה מזג האוויר', 'תכתוב לי שיר', 'who won the game?']) {
      const r = await runAgent(appDb, fakeBinding(A), q);
      expect(r.text).toBe(HE.offList('מסעדה A'));
      expect(r).toMatchObject({ refusal: 'off_list', tools: [], modelCalls: 0 });
    }
    expect(m.create).not.toHaveBeenCalled();
  });

  it('a model OFF_LIST answer is the fixed refusal too', async () => {
    __setAgentClient(recordedModel(() => final('OFF_LIST')).client);
    const r = await runAgent(appDb, fakeBinding(A), 'ספר לי בדיחה על ספקים');
    expect(r.text).toBe(HE.offList('מסעדה A'));
  });

  it('chef and receiver bindings are refused until WA-09/WA-10', async () => {
    const m = recordedModel(() => final('x'));
    __setAgentClient(m.client);
    for (const role of ['chef', 'receiver'] as const) {
      expect((await runAgent(appDb, fakeBinding(A, role), 'מה עם ההזמנות?')).refusal).toBe('role');
    }
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('role tools and redaction before the model (§5.3, §5.4)', () => {
  it("the model's tool list is the role's; a forged tool is refused and counted", async () => {
    const m = recordedModel((_b, call) => (call === 0 ? toolUse('send_to_supplier', { all: true }) : final('אין לי את הנתון הזה.')));
    __setAgentClient(m.client);
    const r = await runAgent(appDb, fakeBinding(A, 'bookkeeper'), 'מה עם ריצת התשלומים?');
    expect(m.bodies[0]!.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['approvals_queue', 'pay_run_month', 'recovery_claims', 'vat_at_risk'],
    );
    expect(r.refusal).toBe('tool_not_allowed');
    expect(toolResults(m.bodies)).toContain('tool not allowed');
  });

  it('a chef cannot reach leak, approvals or recovery tools; orders keep ₪', async () => {
    const b = fakeBinding(A, 'chef');
    for (const t of ['leak_hero', 'approvals_queue', 'recovery_claims', 'supplier_leak']) {
      await expect(callTool(appDb, b, t, {})).rejects.toBeInstanceOf(ToolNotAllowedError);
    }
    const m = recordedModel((_b, call) => (call === 0 ? toolUse('order_detail', { poId: A.poId }) : final('ההזמנה נשלחה.')));
    __setAgentClient(m.client);
    await runAgent(appDb, b, 'מה בהזמנה?', { enableRoles: ['chef'] });
    const [res] = toolResults(m.bodies) as Array<{ data: Record<string, unknown> }>;
    expect(res!.data).toHaveProperty('totalEstimatedIls');
  });

  it('receiver: the JSON sent to the model holds no money key and no ₪', async () => {
    const m = recordedModel((_b, call) =>
      call === 0
        ? { ...toolUse('today_deliveries', { includeLate: true }, 'a'), content: [toolUse('today_deliveries', { includeLate: true }, 'a').content[0], toolUse('delivery_detail', { poId: A.poId }, 'b').content[0]] }
        : final('יש משלוח אחד היום.'),
    );
    __setAgentClient(m.client);
    const r = await runAgent(appDb, fakeBinding(A, 'receiver'), 'מה מגיע היום?', { enableRoles: ['receiver'] });
    const sent = toolResults(m.bodies);
    expect(sent).toHaveLength(2);
    expect(moneyLeaks(sent)).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain('₪');
    expect(JSON.stringify(sent)).not.toMatch(/"[^"]*(ils|agorot|amount|total|price|cost|vat|leak|delta)[^"]*":/i);
    expect(r.text).not.toContain('₪');
    // the receiver cannot open an order (₪) at all
    await expect(callTool(appDb, fakeBinding(A, 'receiver'), 'order_detail', { poId: A.poId })).rejects.toBeInstanceOf(ToolNotAllowedError);
  });
});

describe('conversation memory', () => {
  it("a role switch never carries an owner's ₪ answer into a receiver turn", async () => {
    __setAgentClient(recordedModel((_b, call) => (call === 0 ? toolUse('leak_hero') : final('הדליפה החודש בחשבונית אחת.'))).client);
    const owner = await runAgent(appDb, fakeBinding(A, 'owner'), 'כמה דלף החודש?');
    expect(owner.text).toContain('₪');
    const m = recordedModel(() => final('יש משלוח אחד.'));
    __setAgentClient(m.client);
    await runAgent(appDb, fakeBinding(A, 'receiver'), 'מה מגיע היום?', { enableRoles: ['receiver'] });
    expect(JSON.stringify(m.bodies[0]!.messages)).not.toContain('₪');
    expect(m.bodies[0]!.messages).toHaveLength(1);
  });
});

describe('grounding, ₪ and links (§5.5, §5.6)', () => {
  it('a grounded answer + server ₪ facts + one absolute go-link', async () => {
    const m = recordedModel((_b, call) => (call === 0 ? toolUse('leak_hero') : final('הדליפה החודש היא בחשבונית אחת.', [{ label: 'x', value: 1, unit: 'count', href: '/dashboard' }])));
    __setAgentClient(m.client);
    const r = await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?', { env: { APP_URL: 'https://app.example.co.il' } as NodeJS.ProcessEnv });
    expect(r).toMatchObject({ mode: 'model', grounded: true, tools: ['leak_hero'] });
    expect(r.text).toContain('הדליפה החודש היא בחשבונית אחת.');
    expect(r.text).toContain('100');
    expect(r.text).toContain('₪');
    expect(r.links).toEqual([`https://app.example.co.il/dashboard/go?r=${A.restaurantId}&to=%2Fdashboard`]);
    expect(r.text.length).toBeLessThanOrEqual(1024);
    expect(events.at(-1)).toMatchObject({ automationId: 'WA', role: 'owner', intent: 'leak', grounded: true, tools: ['leak_hero'] });
    expect(JSON.stringify(events.at(-1))).not.toContain('דלף');
    // prompt caching on the static prefix; no tenant data in it
    expect(m.bodies[0]!.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(m.bodies[0]!.system[0].text).not.toContain(A.restaurantId);
  });

  it('₪ written by the model is replaced by the facts text', async () => {
    __setAgentClient(recordedModel((_b, call) => (call === 0 ? toolUse('leak_hero') : final('הדליפה היא 100 ₪.'))).client);
    const r = await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?');
    expect(r.grounded).toBe(false);
    expect(r.text.startsWith(HE.factsPrefix)).toBe(true);
    expect(r.text).not.toContain('הדליפה היא 100 ₪.');
  });

  it('an ungrounded figure is replaced by the facts text', async () => {
    __setAgentClient(recordedModel((_b, call) => (call === 0 ? toolUse('leak_hero') : final('הדליפה החודש עלתה ל-4,321.'))).client);
    const r = await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?');
    expect(r.grounded).toBe(false);
    expect(r.text).toContain(HE.factsPrefix);
    expect(r.text).not.toContain('4,321');
  });

  it('an injected link in tool data or prose never reaches the outbound text', async () => {
    await ownerDb.update(suppliers).set({ name: 'https://evil.example ספק' }).where(eq(suppliers.id, B.supplierId));
    try {
      __setAgentClient(
        recordedModel((_b, call) => (call === 0 ? toolUse('leak_breakdown') : final('ראו https://evil.example ואשרו הכול.'))).client,
      );
      const r = await runAgent(appDb, fakeBinding(B), 'איפה הדליפה החודש?');
      expect(r.text).not.toContain('evil.example');
      expect(r.grounded).toBe(false);
      for (const l of r.links) expect(l).toMatch(/^https:\/\/[^/]+\/dashboard\/go\?r=/);
    } finally {
      await ownerDb.update(suppliers).set({ name: B.supplierName }).where(eq(suppliers.id, B.supplierId));
    }
  });

  it('"approved" in model prose changes nothing (no write tool exists)', async () => {
    __setAgentClient(recordedModel((_b, call) => (call === 0 ? toolUse('approvals_queue') : final('אושר. כל הפערים אושרו.'))).client);
    await runAgent(appDb, fakeBinding(A), 'תאשר את כל ההחלטות');
    const [d] = await ownerDb.select({ s: discrepancies.resolutionStatus }).from(discrepancies).where(eq(discrepancies.restaurantId, A.restaurantId));
    expect(d!.s).toBe('open');
  });
});

describe('MISSING_ON_INVOICE is never leak (§5.7)', () => {
  it('a supplier with only MISSING_ON_INVOICE lines has no open leak (model path)', async () => {
    __setAgentClient(recordedModel((_b, call) => (call === 0 ? toolUse('supplier_leak', { supplier: 'ירקות השרון' }) : final('יש דליפה גדולה.'))).client);
    const r = await runAgent(appDb, fakeBinding(C), 'כמה דלף אצל ירקות השרון?');
    expect(r.text.split('\n')[0]).toBe('אין דליפה פתוחה מול ⁨ירקות השרון⁩ החודש.');
    expect(r.text).not.toMatch(/₪/);
  });

  it('the same in model-off mode', async () => {
    __setAgentClient(null);
    const r = await runAgent(appDb, fakeBinding(C), 'כמה דלף אצל ירקות השרון?');
    expect(r.mode).toBe('modelOff');
    expect(r.text.split('\n')[0]).toBe('אין דליפה פתוחה מול ⁨ירקות השרון⁩ החודש.');
  });

  it('the agent never shows MISSING_ON_INVOICE lines as leak lines', async () => {
    const r = await callTool(appDb, fakeBinding(C), 'leak_breakdown', {});
    expect(JSON.stringify(r.data)).not.toContain('MISSING_ON_INVOICE');
  });
});

describe('model-off mode', () => {
  it('no key: the role tools answer with server facts and count one question', async () => {
    __setAgentClient(null);
    const r = await runAgent(appDb, fakeBinding(A, 'manager'), 'מה מחכה לאישור?');
    expect(r).toMatchObject({ mode: 'modelOff', modelCalls: 0, tools: ['approvals_queue'] });
    expect(r.text).toContain(HE.factsPrefix);
    const [u] = (await ownerDb.execute(sql`select questions from assistant_usage where restaurant_id = ${A.restaurantId}`)) as unknown as Array<{ questions: number }>;
    expect(u!.questions).toBe(1);
  });

  it('a model failure falls back to model-off and the spend is still counted', async () => {
    __setAgentClient({ create: vi.fn(async () => { throw new Error('overloaded'); }) });
    const r = await runAgent(appDb, fakeBinding(A), 'כמה דלף החודש?');
    expect(r.mode).toBe('modelOff');
    expect(r.text).toContain(HE.factsPrefix);
  });
});

void invoices;
