import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_BRANCH_NAMES,
  DEMO_EMAIL_DOMAIN,
  DEMO_MAIN_BUSINESS_ID,
  DEMO_MAIN_NAME,
  deleteDemoTenants,
  demoTenantRowCounts,
  findDemoTenants,
} from '../demoTenants';
import { isLocalDbUrl, supabaseProjectRef } from '../seedGuard';
import { testDbUrl } from '../test-env';

/**
 * The production reseed wipes ONLY the demo tenants (apps/worker/scripts/reseed-demo.ts).
 * These tests pin who counts as demo, that a real tenant next to them survives
 * byte-identical, that a second run removes nothing, and every refusal rule.
 */
const sql = postgres(testDbUrl(), { max: 1, prepare: false, onnotice: () => undefined });
const REAL = '7e57e57e-0000-4000-8000-000000000001';
const REAL_USER = '7e57e57e-0000-4000-8000-000000000002';

async function clean() {
  await sql`delete from restaurants where business_id = ${DEMO_MAIN_BUSINESS_ID} or name in ${sql([DEMO_MAIN_NAME, ...DEMO_BRANCH_NAMES])} or id = ${REAL}`;
  await sql`delete from billing_accounts where name = 'demo-test chain'`;
  await sql`delete from users where lower(email) like ${'%@' + DEMO_EMAIL_DOMAIN} or id = ${REAL_USER}`;
}

/** main + two branches on one billing account, a demo owner in all three, and a real tenant. */
async function seedWorld() {
  const [owner] = await sql`insert into users (email, name) values (${'owner@' + DEMO_EMAIL_DOMAIN}, 'demo owner') returning id`;
  const [acct] = await sql`insert into billing_accounts (name, owner_user_id) values ('demo-test chain', ${owner!.id}) returning id`;
  const [main] = await sql`insert into restaurants (name, business_id, billing_account_id) values (${DEMO_MAIN_NAME}, ${DEMO_MAIN_BUSINESS_ID}, ${acct!.id}) returning id`;
  const branches = [];
  for (const name of DEMO_BRANCH_NAMES) {
    const [b] = await sql`insert into restaurants (name, billing_account_id) values (${name}, ${acct!.id}) returning id`;
    branches.push(b!.id as string);
  }
  for (const rid of [main!.id, ...branches]) {
    await sql`insert into memberships (user_id, restaurant_id, role) values (${owner!.id}, ${rid}, 'owner')`;
    await sql`insert into suppliers (restaurant_id, name) values (${rid}, 'demo supplier')`;
  }
  await sql`insert into users (id, email, name) values (${REAL_USER}, 'chef@real-bistro.example', 'real chef')`;
  await sql`insert into restaurants (id, name, business_id) values (${REAL}, 'ביסטרו אמיתי', '515000999')`;
  await sql`insert into memberships (user_id, restaurant_id, role) values (${REAL_USER}, ${REAL}, 'owner')`;
  await sql`insert into suppliers (restaurant_id, name) values (${REAL}, 'real supplier')`;
  return { owner: owner!.id as string, main: main!.id as string, branches };
}

const realSnapshot = async () =>
  (await sql`
    select md5(string_agg(x, '|' order by x)) as h from (
      select row(r.*)::text x from restaurants r where id = ${REAL}
      union all select row(s.*)::text from suppliers s where restaurant_id = ${REAL}
      union all select row(m.*)::text from memberships m where restaurant_id = ${REAL}
      union all select row(u.*)::text from users u where id = ${REAL_USER}) t`)[0]!.h as string;

beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

describe('demo tenants (production reseed scope)', () => {
  it('finds the main restaurant by business id + name and the branches by name + billing account — not the real tenant', async () => {
    const w = await seedWorld();
    const t = await findDemoTenants(sql);
    expect(t.restaurants.map((r) => r.id).sort()).toEqual([w.main, ...w.branches].sort());
    expect(t.userIds).toEqual([w.owner]);
    const counts = await demoTenantRowCounts(sql, t);
    expect(counts).toMatchObject({ restaurants: 3, suppliers: 3, memberships: 3, users: 1, billing_accounts: 1 });
  });

  it('deletes only the demo tenants; the real tenant stays byte-identical; a second run removes nothing', async () => {
    await seedWorld();
    const before = await realSnapshot();
    const first = await deleteDemoTenants(sql);
    expect(first.removed).toMatchObject({ restaurants: 3, suppliers: 3, users: 1 });
    expect(await realSnapshot()).toBe(before);
    const [left] = await sql`select count(*)::int as n from restaurants where business_id = ${DEMO_MAIN_BUSINESS_ID} or name in ${sql([...DEMO_BRANCH_NAMES])}`;
    expect(left!.n).toBe(0);
    const second = await deleteDemoTenants(sql);
    expect(second.removed).toEqual({});
    expect(await realSnapshot()).toBe(before);
  });

  it('a branch-named restaurant that is NOT on the demo billing account is not demo', async () => {
    await seedWorld();
    const [other] = await sql`insert into restaurants (name) values (${DEMO_BRANCH_NAMES[0]!}) returning id`;
    const t = await findDemoTenants(sql);
    expect(t.restaurants.map((r) => r.id)).not.toContain(other!.id);
    await sql`delete from restaurants where id = ${other!.id}`;
  });

  it('refuses when a real user is a member of a demo restaurant', async () => {
    const w = await seedWorld();
    await sql`insert into memberships (user_id, restaurant_id, role) values (${REAL_USER}, ${w.main}, 'manager')`;
    await expect(findDemoTenants(sql)).rejects.toThrow(/non-demo user chef@real-bistro\.example is a member of demo restaurant/);
    await expect(deleteDemoTenants(sql)).rejects.toThrow(/refusing/);
    const [still] = await sql`select count(*)::int as n from restaurants where id = ${w.main}`;
    expect(still!.n).toBe(1); // nothing deleted
  });

  it('refuses when a demo user is a member of a real restaurant', async () => {
    const w = await seedWorld();
    await sql`insert into memberships (user_id, restaurant_id, role) values (${w.owner}, ${REAL}, 'manager')`;
    await expect(findDemoTenants(sql)).rejects.toThrow(/demo user owner@kfar-hazeitim\.test is a member of non-demo restaurant/);
  });

  it('refuses when the demo business id is reused under another name, or the billing account is shared', async () => {
    await seedWorld();
    await sql`update restaurants set billing_account_id = (select id from billing_accounts where name = 'demo-test chain') where id = ${REAL}`;
    await expect(findDemoTenants(sql)).rejects.toThrow(/billing account shared with non-demo restaurant "ביסטרו אמיתי"/);
    await sql`update restaurants set billing_account_id = null where id = ${REAL}`;
    await sql`update restaurants set name = 'משהו אחר' where business_id = ${DEMO_MAIN_BUSINESS_ID}`;
    await expect(findDemoTenants(sql)).rejects.toThrow(/uses the demo business id 514778123 but is named "משהו אחר"/);
  });

  it('a database with no demo tenants yet (first seed) finds nothing and deletes nothing', async () => {
    const t = await findDemoTenants(sql);
    expect(t.restaurants).toEqual([]);
    expect((await deleteDemoTenants(sql)).removed).toEqual({});
  });
});

describe('seed guard helpers for the remote reseed', () => {
  it('reads the Supabase project ref from a pooler user or a direct host', () => {
    expect(supabaseProjectRef('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres')).toBe('abcdefghijklmnopqrst');
    expect(supabaseProjectRef('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres')).toBe('abcdefghijklmnopqrst');
    expect(supabaseProjectRef('postgres://postgres:postgres@localhost:5432/x')).toBeNull();
  });

  it('only a local host counts as local', () => {
    expect(isLocalDbUrl('postgres://postgres:postgres@localhost:5432/x')).toBe(true);
    expect(isLocalDbUrl('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres')).toBe(false);
  });
});
