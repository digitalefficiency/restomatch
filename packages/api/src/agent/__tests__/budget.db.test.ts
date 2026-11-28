import { randomUUID } from 'node:crypto';
import { sql, type Database } from '@restomatch/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ASK_QUESTIONS_PER_DAY } from '../../ask/budget';
import { resetDb, seedPlans, seedTenant, type Tenant } from '../../__tests__/fixtures';
import { __resetAgentBudget, AGENT_TURNS_PER_PERSON_PER_DAY } from '../budget';
import { HE } from '../copy/he';
import { __resetAgentMemory, __setAgentClient, runAgent, setAgentTurnSink } from '../index';
import { appRoleDb, fakeBinding, final, ownerDb, recordedModel, setFeatures } from './helpers';

/** Per-person budgets inside the restaurant's Ask budget (WA-02 §5.8), on the app role. */
let appDb: Database;
let A: Tenant;

beforeAll(async () => {
  appDb = await appRoleDb();
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  setAgentTurnSink(() => undefined);
});
beforeEach(async () => {
  __resetAgentBudget();
  __resetAgentMemory();
  await setFeatures(A, { aiAssistant: true });
  await ownerDb.execute(sql`delete from assistant_usage`);
});
afterEach(() => __setAgentClient(undefined));

describe('agent budgets', () => {
  it('the 31st model turn of a person gets the quota copy + model-off; a colleague is unaffected', async () => {
    const m = recordedModel(() => final('אין לי את הנתון הזה.'));
    __setAgentClient(m.client);
    const owner = fakeBinding(A, 'owner');
    for (let i = 0; i < AGENT_TURNS_PER_PERSON_PER_DAY; i += 1) {
      expect((await runAgent(appDb, owner, 'כמה דלף החודש?')).mode).toBe('model');
    }
    expect(m.create).toHaveBeenCalledTimes(AGENT_TURNS_PER_PERSON_PER_DAY);
    const over = await runAgent(appDb, owner, 'כמה דלף החודש?');
    expect(over).toMatchObject({ mode: 'modelOff', refusal: 'budget_person', modelCalls: 0 });
    expect(over.text.startsWith(HE.budgetPerson)).toBe(true);
    expect(over.text).toContain(HE.factsPrefix);
    expect(m.create).toHaveBeenCalledTimes(AGENT_TURNS_PER_PERSON_PER_DAY);

    const colleague = fakeBinding(A, 'manager', randomUUID());
    expect((await runAgent(appDb, colleague, 'כמה דלף החודש?')).mode).toBe('model');
  });

  it("once the restaurant's day is spent, every person gets model-off", async () => {
    await ownerDb.execute(
      sql`insert into assistant_usage (restaurant_id, day, questions) values (${A.restaurantId}, ${new Date().toISOString().slice(0, 10)}, ${ASK_QUESTIONS_PER_DAY})`,
    );
    const m = recordedModel(() => final('x'));
    __setAgentClient(m.client);
    const r = await runAgent(appDb, fakeBinding(A, 'manager', randomUUID()), 'מה מחכה לאישור?');
    expect(r).toMatchObject({ mode: 'modelOff', refusal: 'budget_restaurant' });
    expect(r.text.startsWith(HE.budgetRestaurant)).toBe(true);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('one in-flight model task per conversation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    __setAgentClient({
      create: async () => {
        await gate;
        return final('אין לי את הנתון הזה.') as never;
      },
    });
    const b = fakeBinding(A);
    const first = runAgent(appDb, b, 'כמה דלף החודש?');
    await new Promise((r) => setTimeout(r, 150));
    const second = await runAgent(appDb, b, 'כמה דלף החודש?');
    expect(second).toMatchObject({ text: HE.busy, refusal: 'busy', modelCalls: 0 });
    // another person's conversation is not blocked
    const other = runAgent(appDb, fakeBinding(A, 'manager', randomUUID()), 'כמה דלף החודש?');
    release();
    expect((await first).mode).toBe('model');
    expect((await other).mode).toBe('model');
  });
});
