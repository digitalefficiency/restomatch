import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, testDbUrl, type UserRole } from '@restomatch/db';
import { appRouter } from '../index';
import { __setAskClient } from '../ask';
import { __resetAskBurst } from '../ask/budget';
import { AskToolForbidden, canUseTool, redactForRole, stripIls, TOOL_ROLES } from '../ask/roles';
import { runTool, TOOL_DEFINITIONS, type ToolOutput } from '../ask/tools';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-06 · Ask's role table is the second lock behind the router gate. Receiver
 * and chef never reach Ask (router) and never run a tool (table); a role
 * without money view never receives a ₪ field.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function caller(role: Session['role']) {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
beforeEach(async () => {
  __resetAskBurst();
  __setAskClient(null);
  await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, A.restaurantId));
});
afterEach(() => __setAskClient(undefined));
afterAll(async () => {
  await resetDb(db);
});

const NO_ASK: UserRole[] = ['receiver', 'chef'];

describe('server: ask.* stays FORBIDDEN for receiver and chef', () => {
  it.each(NO_ASK)('%s → FORBIDDEN on ask.status and ask.ask (incl. the new questions)', async (role) => {
    await expect(caller(role).ask.status()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const question of ['מי חייב לי זיכויים?', 'כמה מע״מ בסיכון?', 'מה מחכה להחלטה שלי?']) {
      await expect(caller(role).ask.ask({ question, locale: 'he' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('server: bookkeeper reads Ask (owner I3, read-only)', () => {
  it('bookkeeper → ask.status and the new questions answer; still no write tool exists', async () => {
    await expect(caller('bookkeeper').ask.status()).resolves.toMatchObject({ enabled: true });
    const r = await caller('bookkeeper').ask.ask({ question: 'מי חייב לי זיכויים?', locale: 'he' });
    expect(r.intent).toBe('whoOwesMe');
  });
});

describe('role table (ask/roles.ts)', () => {
  it('covers every defined tool, and gives no tool to receiver or chef', () => {
    expect(Object.keys(TOOL_ROLES).sort()).toEqual(TOOL_DEFINITIONS.map((t) => t.name).sort());
    for (const roles of Object.values(TOOL_ROLES)) for (const r of NO_ASK) expect(roles).not.toContain(r);
  });

  it.each(NO_ASK)('runTool refuses every tool for %s with a FORBIDDEN-shaped tool error', async (role) => {
    for (const t of TOOL_DEFINITIONS) {
      expect(canUseTool(t.name, role)).toBe(false);
      const err = await runTool(t.name, {}, { db, restaurantId: A.restaurantId, role }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AskToolForbidden);
      expect((err as AskToolForbidden).code).toBe('FORBIDDEN');
    }
  });

  it('an unknown tool is never allowed', async () => {
    expect(canUseTool('drop_tables', 'owner')).toBe(false);
    await expect(runTool('drop_tables', {}, { db, restaurantId: A.restaurantId, role: 'owner' })).rejects.toThrow(/unknown tool/);
  });

  it('owner / manager / bookkeeper may use every tool (read-only; there is no write tool)', () => {
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      for (const t of TOOL_DEFINITIONS) expect(canUseTool(t.name, role)).toBe(true);
    }
  });

  it('redactForRole strips every …Ils / …Price field and figures.ils for receiver and chef', () => {
    const out: ToolOutput = {
      data: {
        available: true,
        outstandingIls: 120,
        count: 2,
        suppliers: [{ supplier: 'X', outstandingIls: 120, overdueIls: 0, oldestWaitingDays: 9, beforePrice: 3.5 }],
      },
      links: [{ screen: 'recovery', href: '/dashboard/recovery' }],
      figures: { ils: [120, 120, 0, 3.5], pct: [], count: [2, 9] },
    };
    for (const role of NO_ASK) {
      const r = redactForRole(out, role);
      expect(JSON.stringify(r.data)).not.toMatch(/Ils|Price/);
      expect(r.figures.ils).toEqual([]);
      expect(r.figures.count).toEqual([2, 9]);
      expect(r.data).toEqual({ available: true, count: 2, suppliers: [{ supplier: 'X', oldestWaitingDays: 9 }] });
    }
    expect(redactForRole(out, 'owner')).toBe(out);
    expect(stripIls([{ aIls: 1, b: { cPrice: 2, d: 3 } }])).toEqual([{ b: { d: 3 } }]);
  });
});

describe('fails closed on a missing role (warden review, add-only)', () => {
  it('runTool, canUseTool and redactForRole give nothing to a caller that forgets the role', async () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(canUseTool(t.name, undefined)).toBe(false);
      await expect(runTool(t.name, {}, { db, restaurantId: A.restaurantId })).rejects.toBeInstanceOf(AskToolForbidden);
    }
    const out: ToolOutput = { data: { aIls: 5, n: 1 }, links: [], figures: { ils: [5], pct: [], count: [1] } };
    expect(redactForRole(out, undefined)).toEqual({ data: { n: 1 }, links: [], figures: { ils: [], pct: [], count: [1] } });
  });

  it('the offline path uses the same table: runAsk without a role refuses an ops intent', async () => {
    const { runAsk } = await import('../ask');
    await expect(runAsk(db, A.restaurantId, 'מי חייב לי זיכויים?', 'he')).rejects.toBeInstanceOf(AskToolForbidden);
  });
});
