import type { Sql } from 'postgres';

/**
 * The demo tenants ("כפר הזיתים" + its Haifa / Jerusalem branches) and how to wipe
 * ONLY them — used by the base seed's demo-only mode and the production reseed
 * (apps/worker/scripts/reseed-demo.ts, docs/client-ready/RESEED-PROD.md).
 *
 * Demo tenants are found by identity, never by age or position:
 *   - the main restaurant: the seed's business id AND the demo name;
 *   - the branches (seed-chain-demo): the exact branch names AND the main
 *     restaurant's billing account (branches carry no business id).
 * Before anything is deleted, `findDemoTenants` refuses if the demo set is mixed
 * with real data in any way:
 *   - the demo business id under another name (someone reused the number),
 *   - a non-demo user who is a member of a demo restaurant,
 *   - a demo user (@kfar-hazeitim.test) who is a member of a non-demo restaurant,
 *   - a billing account shared between a demo and a non-demo restaurant.
 */
export const DEMO_EMAIL_DOMAIN = 'kfar-hazeitim.test';
export const DEMO_MAIN_BUSINESS_ID = '514778123';
export const DEMO_MAIN_NAME = 'כפר הזיתים';
export const DEMO_BRANCH_NAMES: readonly string[] = ['כפר הזיתים — חיפה', 'כפר הזיתים — ירושלים'];

export interface DemoTenants {
  restaurants: Array<{ id: string; name: string; businessId: string | null }>;
  userIds: string[];
  billingAccountIds: string[];
}

const demoEmail = (email: string) => email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

export async function findDemoTenants(sql: Sql): Promise<DemoTenants> {
  const problems: string[] = [];
  const mains = (await sql`
    select id::text, name, business_id, billing_account_id::text from restaurants where business_id = ${DEMO_MAIN_BUSINESS_ID}
  `) as unknown as Array<{ id: string; name: string; business_id: string; billing_account_id: string | null }>;
  for (const r of mains) if (r.name !== DEMO_MAIN_NAME) problems.push(`restaurant ${r.id} uses the demo business id ${r.business_id} but is named "${r.name}"`);
  if (mains.length > 1) problems.push(`${mains.length} restaurants carry the demo business id ${DEMO_MAIN_BUSINESS_ID}`);
  const main = mains.find((r) => r.name === DEMO_MAIN_NAME);
  const branches = main?.billing_account_id
    ? ((await sql`
        select id::text, name, business_id from restaurants
        where billing_account_id = ${main.billing_account_id} and name in ${sql(DEMO_BRANCH_NAMES as string[])} and id <> ${main.id}
      `) as unknown as Array<{ id: string; name: string; business_id: string | null }>)
    : [];
  const restaurants = [...(main ? [main] : []), ...branches];
  const rids = restaurants.map((r) => r.id);

  const demoUsers = (await sql`
    select id::text, email from users where lower(email) like ${'%@' + DEMO_EMAIL_DOMAIN}
  `) as unknown as Array<{ id: string; email: string }>;
  const uids = demoUsers.map((u) => u.id);

  if (rids.length) {
    const outsiders = (await sql`
      select u.email, r.name from memberships m join users u on u.id = m.user_id join restaurants r on r.id = m.restaurant_id
      where m.restaurant_id in ${sql(rids)}
    `) as unknown as Array<{ email: string; name: string }>;
    for (const o of outsiders) if (!demoEmail(o.email)) problems.push(`non-demo user ${o.email} is a member of demo restaurant "${o.name}"`);
  }
  if (uids.length) {
    const leaks = (await sql`
      select u.email, r.name, r.id::text as rid from memberships m join users u on u.id = m.user_id join restaurants r on r.id = m.restaurant_id
      where m.user_id in ${sql(uids)}
    `) as unknown as Array<{ email: string; name: string; rid: string }>;
    for (const l of leaks) if (!rids.includes(l.rid)) problems.push(`demo user ${l.email} is a member of non-demo restaurant "${l.name}"`);
  }

  // Billing accounts: those of the demo restaurants + those a demo user owns (the chain account).
  const accounts = (await sql`
    select distinct b.id::text from billing_accounts b
    where b.id in (select billing_account_id from restaurants where id in ${sql(rids.length ? rids : ['00000000-0000-0000-0000-000000000000'])} and billing_account_id is not null)
       or b.owner_user_id in ${sql(uids.length ? uids : ['00000000-0000-0000-0000-000000000000'])}
  `) as unknown as Array<{ id: string }>;
  const billingAccountIds = accounts.map((a) => a.id);
  if (billingAccountIds.length) {
    const shared = (await sql`
      select r.name from restaurants r where r.billing_account_id in ${sql(billingAccountIds)} and not (r.id::text in ${sql(rids.length ? rids : [''])})
    `) as unknown as Array<{ name: string }>;
    for (const s of shared) problems.push(`billing account shared with non-demo restaurant "${s.name}"`);
  }

  if (problems.length) throw new Error(`refusing: the demo tenants are mixed with real data —\n  - ${problems.join('\n  - ')}`);
  return { restaurants: restaurants.map((r) => ({ id: r.id, name: r.name, businessId: r.business_id })), userIds: uids, billingAccountIds };
}

/**
 * Rows that wiping the demo tenants removes, per table: every table with a
 * restaurant_id (scoped to the demo restaurants), tables that hang off those
 * through a cascading FK (invoice_lines, gr_lines …), every table with a
 * cascading FK to users (scoped to the demo users), and the demo billing accounts.
 */
export async function demoTenantRowCounts(sql: Sql, t: DemoTenants): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n > 0) counts[k] = (counts[k] ?? 0) + n;
  };
  const rids = t.restaurants.map((r) => r.id);
  add('restaurants', rids.length);
  add('users', t.userIds.length);
  add('billing_accounts', t.billingAccountIds.length);

  const scoped = (await sql`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and c.relname <> 'restaurants' order by 1
  `) as unknown as Array<{ t: string }>;
  const scopedSet = new Set(scoped.map((s) => s.t));
  if (rids.length) for (const { t: tbl } of scoped) add(tbl, Number((await sql`select count(*)::int as n from ${sql(tbl)} where restaurant_id in ${sql(rids)}`)[0]!.n));

  // One level of cascading children without their own restaurant_id (lines tables).
  const children = (await sql`
    select c.conrelid::regclass::text as child, p.relname as parent, ca.attname as col
    from pg_constraint c
    join pg_class p on p.oid = c.confrelid
    join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
    where c.contype = 'f' and c.confdeltype = 'c' and array_length(c.conkey, 1) = 1
      and c.conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  `) as unknown as Array<{ child: string; parent: string; col: string }>;
  if (rids.length) {
    for (const ch of children) {
      if (scopedSet.has(ch.child) || ch.child === 'restaurants' || !scopedSet.has(ch.parent)) continue;
      add(ch.child, Number((await sql`
        select count(*)::int as n from ${sql(ch.child)} x join ${sql(ch.parent)} p on p.id = x.${sql(ch.col)} where p.restaurant_id in ${sql(rids)}
      `)[0]!.n));
    }
  }
  if (t.userIds.length) {
    for (const ch of children) {
      if (ch.parent !== 'users' || scopedSet.has(ch.child)) continue;
      add(ch.child, Number((await sql`select count(*)::int as n from ${sql(ch.child)} where ${sql(ch.col)} in ${sql(t.userIds)}`)[0]!.n));
    }
  }
  if (t.billingAccountIds.length) {
    for (const ch of children) {
      if (ch.parent !== 'billing_accounts' || scopedSet.has(ch.child)) continue;
      add(ch.child, Number((await sql`select count(*)::int as n from ${sql(ch.child)} where ${sql(ch.col)} in ${sql(t.billingAccountIds)}`)[0]!.n));
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Restaurant-scoped tables that are infrastructure, not tenant data, and change
 * on their own while the reseed runs. `job_queue` (0061): the running worker's
 * cron adds a row every 60 s (outbox-dispatch) and every 5 min (ocr-sweep) with
 * restaurant_id NULL, an ocr-sweep retry carries the stuck tenant's id, and
 * maintenance prunes finished jobs after 7 days. Counting it made a reseed that
 * crossed a cron tick fail "NON-demo row counts changed" with nothing changed.
 */
export const FINGERPRINT_SKIPPED_TABLES: readonly string[] = ['job_queue'];

/**
 * Row counts of every restaurant-scoped table OUTSIDE the demo tenants (+ users,
 * restaurants), taken before and after the production reseed: they must match.
 * The worker's own queue is left out (FINGERPRINT_SKIPPED_TABLES).
 */
export async function nonDemoFingerprint(sql: Sql, demoRids: string[], demoUids: string[]): Promise<Record<string, number>> {
  const rids = demoRids.length ? demoRids : ['00000000-0000-0000-0000-000000000000'];
  const uids = demoUids.length ? demoUids : ['00000000-0000-0000-0000-000000000000'];
  const tables = (await sql`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
    where c.relkind in ('r', 'p') order by 1
  `) as unknown as Array<{ t: string }>;
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    if (FINGERPRINT_SKIPPED_TABLES.includes(t)) continue;
    out[t] = Number((await sql`select count(*)::int as n from ${sql(t)} where restaurant_id is null or restaurant_id not in ${sql(rids)}`)[0]!.n);
  }
  out.restaurants = Number((await sql`select count(*)::int as n from restaurants where id not in ${sql(rids)}`)[0]!.n);
  out.users = Number((await sql`select count(*)::int as n from users where id not in ${sql(uids)}`)[0]!.n);
  return out;
}

/**
 * Delete the demo tenants, their users and billing accounts in ONE transaction
 * (cascading FKs remove everything under them). Re-checks the safety rules inside
 * the transaction. Returns the counts that were removed. A second call finds
 * nothing and removes nothing (idempotent).
 */
export async function deleteDemoTenants(sql: Sql): Promise<{ tenants: DemoTenants; removed: Record<string, number> }> {
  return (await sql.begin(async (tx) => {
    const tenants = await findDemoTenants(tx as unknown as Sql);
    const removed = await demoTenantRowCounts(tx as unknown as Sql, tenants);
    const rids = tenants.restaurants.map((r) => r.id);
    if (rids.length) await tx`delete from restaurants where id in ${tx(rids)}`;
    if (tenants.billingAccountIds.length) await tx`delete from billing_accounts where id in ${tx(tenants.billingAccountIds)}`;
    if (tenants.userIds.length) await tx`delete from users where id in ${tx(tenants.userIds)}`;
    await tx`delete from verification_tokens where lower(identifier) like ${'%@' + DEMO_EMAIL_DOMAIN}`;
    return { tenants, removed };
  })) as { tenants: DemoTenants; removed: Record<string, number> };
}
