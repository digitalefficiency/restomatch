import { describe, expect, it } from 'vitest';
import { DEMO_EXTRA_STEPS, scriptIsDemoScoped } from '../lib/demoExtras';

// reseed:demo runs the feature seeds on the shared production DB: a seed that picks
// "the oldest restaurant" / "every flagged restaurant" / "any restaurant" there
// writes into a real tenant, so on a remote DB it must be refused.
describe('feature seeds: demo-tenant scope gate', () => {
  it('accepts a seed that reads the scope reseed-demo hands it', () => {
    expect(scriptIsDemoScoped("const only = process.env.DEMO_RESTAURANT_ID;")).toBe(true);
    expect(scriptIsDemoScoped("const ids = process.env.DEMO_RESTAURANT_IDS?.split(',');")).toBe(true);
    expect(scriptIsDemoScoped('const t = await findDemoTenants(sql);')).toBe(true);
    expect(scriptIsDemoScoped('eq(restaurants.businessId, DEMO_MAIN_BUSINESS_ID)')).toBe(true);
  });

  it('refuses the unscoped selections that hit real tenants', () => {
    expect(scriptIsDemoScoped('await db.select().from(restaurants).orderBy(asc(restaurants.createdAt)).limit(1)')).toBe(false);
    expect(scriptIsDemoScoped("await db.select().from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1)")).toBe(false);
    expect(scriptIsDemoScoped('await db.select({ id: restaurants.id }).from(restaurants)')).toBe(false);
  });

  it('lists each feature seed once, with a table to gate on', () => {
    const keys = DEMO_EXTRA_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of DEMO_EXTRA_STEPS) {
      expect(s.scripts.length).toBeGreaterThan(0);
      expect(s.requiresTable).toMatch(/^[a-z_]+$/);
    }
  });
});
