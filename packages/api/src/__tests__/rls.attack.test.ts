import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityEvents,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  approvalRules,
  auditLog,
  billingAccounts,
  catalogImports,
  createDb,
  discrepancies,
  emailInboxes,
  supplierCatalogItems,
  ensureRlsAppRole,
  eq,
  goodsReceipts,
  grLines,
  invitations,
  invoiceLines,
  invoiceScans,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  passwordResetTokens,
  plans,
  poLines,
  priceBaselines,
  priceHistory,
  procurementConnections,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  sessions,
  sql,
  subscriptions,
  supplierIntegrations,
  suppliers,
  usageCounters,
  userCredentials,
  userRecoveryCodes,
  users,
  withRestaurant,
  withUser,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { meterOcrScan } from '../entitlements';
import type { AppContext, Session } from '../context';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * RLS ATTACK SUITE — the database-level backstop.
 *
 * The cross-tenant suite proves the APP layer rejects foreign ids; this suite
 * proves the DATABASE rejects them even if the app layer is bypassed entirely
 * (raw SQL through a compromised code path). It applies the policies from
 * drizzle/rls/0002 and connects as `restomatch_app` — a non-owner role that
 * cannot bypass RLS — exactly like the production app role on Supabase.
 *
 * Owner-role connections (the rest of the test suite, the worker) bypass RLS
 * by design; this file is where the policies themselves are exercised.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const ownerDb = createDb(TEST_DB_URL);

let appDb: Database;
let A: Tenant;
let B: Tenant;
let billingAcctA: string;

function callerFor(tenant: Tenant, db: Database) {
  const session: Session = {
    userId: tenant.ownerUserId,
    restaurantId: tenant.restaurantId,
    role: 'owner',
  };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  // 0.4: split audit_log into append-only SELECT+INSERT + install the
  // immutability trigger. Must run after 0002 (it supersedes audit_log_tenant).
  await applyAuditImmutableRls(TEST_DB_URL);
  // Ensure the Epic B credential-auth identity tables exist BEFORE the app role
  // is provisioned, so ensureRlsAppRole's REVOKE ALL on them actually applies.
  await applyAuthCredentialTables(TEST_DB_URL);
  const appUrl = await ensureRlsAppRole(TEST_DB_URL);
  appDb = createDb(appUrl);
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  // A is a paying tenant with a billing account + a metered scan; B has none.
  billingAcctA = await attachSubscription(ownerDb, A.restaurantId, {
    planKey: 'pro',
    status: 'active',
  });
  await meterOcrScan(ownerDb, A.restaurantId);
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('harness sanity', () => {
  it('the app role genuinely cannot bypass RLS (guards role-config drift)', async () => {
    const rows = (await appDb.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    )) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });
});

describe('raw SQL under the RLS-enforced role', () => {
  it('sees zero tenant rows when no GUC is set', async () => {
    const rows = await appDb.select({ id: suppliers.id }).from(suppliers);
    expect(rows).toHaveLength(0);
  });

  it('sees only its own restaurant row', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ id: restaurants.id }).from(restaurants),
    );
    expect(rows).toEqual([{ id: A.restaurantId }]);
  });

  it('sees only its own suppliers', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(A.supplierName);
  });

  it('child table without restaurant_id is scoped through its parent (gr_lines)', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ id: grLines.id }).from(grLines),
    );
    expect(rows).toEqual([{ id: A.grLineId }]);
  });

  it('blocks a cross-tenant UPDATE even with raw access (0 rows matched)', async () => {
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(grLines)
        .set({ qtyReceived: '999' })
        .where(eq(grLines.id, B.grLineId))
        .returning({ id: grLines.id }),
    );
    expect(updated).toHaveLength(0);

    const [line] = await ownerDb
      .select({ qtyReceived: grLines.qtyReceived })
      .from(grLines)
      .where(eq(grLines.id, B.grLineId));
    expect(line?.qtyReceived).toBe('5.000');
  });

  it('blocks any INSERT when no GUC is set (no bootstrap hole)', async () => {
    await expect(
      appDb.insert(restaurants).values({ name: 'no-guc probe' }),
    ).rejects.toThrow(/row-level security/);
  });

  it('blocks a cross-tenant INSERT (WITH CHECK violation)', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(discrepancies).values({
          matchRunId: B.matchRunId,
          restaurantId: B.restaurantId,
          type: 'PRICE_HIGHER',
          severity: 'warn',
          deltaAmount: '1.00',
          resolutionStatus: 'open',
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('every tenant table is invisible cross-tenant (raw probes)', () => {
  // Both tenants are fully seeded, so each probe must see A's rows (proving
  // the policy admits the right tenant) and exactly zero of B's.
  const PARENT_PROBES: Array<{
    name: string;
    probe: (tx: Database) => Promise<Array<{ rid: string | null }>>;
  }> = [
    { name: 'suppliers', probe: (tx) => tx.select({ rid: suppliers.restaurantId }).from(suppliers) },
    { name: 'products', probe: (tx) => tx.select({ rid: products.restaurantId }).from(products) },
    {
      name: 'purchase_orders',
      probe: (tx) => tx.select({ rid: purchaseOrders.restaurantId }).from(purchaseOrders),
    },
    {
      name: 'goods_receipts',
      probe: (tx) => tx.select({ rid: goodsReceipts.restaurantId }).from(goodsReceipts),
    },
    { name: 'invoices', probe: (tx) => tx.select({ rid: invoices.restaurantId }).from(invoices) },
    { name: 'match_runs', probe: (tx) => tx.select({ rid: matchRuns.restaurantId }).from(matchRuns) },
    {
      name: 'discrepancies',
      probe: (tx) => tx.select({ rid: discrepancies.restaurantId }).from(discrepancies),
    },
    { name: 'audit_log', probe: (tx) => tx.select({ rid: auditLog.restaurantId }).from(auditLog) },
    {
      name: 'activity_events',
      probe: (tx) => tx.select({ rid: activityEvents.restaurantId }).from(activityEvents),
    },
    {
      name: 'memberships',
      probe: (tx) => tx.select({ rid: memberships.restaurantId }).from(memberships),
    },
    {
      name: 'invitations',
      probe: (tx) => tx.select({ rid: invitations.restaurantId }).from(invitations),
    },
    // Epic 0.6: the seven tables the suite previously omitted. Several carry
    // secrets (vault refs, oauth tokens) or outbound PII (notification targets).
    {
      name: 'price_history',
      probe: (tx) => tx.select({ rid: priceHistory.restaurantId }).from(priceHistory),
    },
    {
      name: 'price_baselines',
      probe: (tx) => tx.select({ rid: priceBaselines.restaurantId }).from(priceBaselines),
    },
    {
      name: 'approval_rules',
      probe: (tx) => tx.select({ rid: approvalRules.restaurantId }).from(approvalRules),
    },
    {
      name: 'procurement_connections',
      probe: (tx) =>
        tx.select({ rid: procurementConnections.restaurantId }).from(procurementConnections),
    },
    {
      name: 'email_inboxes',
      probe: (tx) => tx.select({ rid: emailInboxes.restaurantId }).from(emailInboxes),
    },
    {
      name: 'supplier_integrations',
      probe: (tx) =>
        tx.select({ rid: supplierIntegrations.restaurantId }).from(supplierIntegrations),
    },
    {
      name: 'notifications_outbox',
      probe: (tx) =>
        tx.select({ rid: notificationsOutbox.restaurantId }).from(notificationsOutbox),
    },
  ];

  it.each(PARENT_PROBES.map((p) => [p.name, p] as const))(
    '%s: GUC=A sees only tenant-A rows',
    async (_name, entry) => {
      const rows = await withRestaurant(appDb, A.restaurantId, (tx) => entry.probe(tx));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.rid === A.restaurantId)).toBe(true);
    },
  );

  const CHILD_PROBES: Array<{
    name: string;
    probe: (tx: Database) => Promise<Array<{ id: string }>>;
    ownId: () => string;
  }> = [
    {
      name: 'po_lines',
      probe: (tx) => tx.select({ id: poLines.id }).from(poLines),
      ownId: () => A.poLineId,
    },
    {
      name: 'gr_lines',
      probe: (tx) => tx.select({ id: grLines.id }).from(grLines),
      ownId: () => A.grLineId,
    },
    {
      name: 'invoice_lines',
      probe: (tx) => tx.select({ id: invoiceLines.id }).from(invoiceLines),
      ownId: () => A.invoiceLineId,
    },
    {
      name: 'product_aliases',
      probe: (tx) => tx.select({ id: productAliases.id }).from(productAliases),
      ownId: () => A.productAliasId,
    },
  ];

  it.each(CHILD_PROBES.map((p) => [p.name, p] as const))(
    '%s: parent-join policy admits only tenant-A rows',
    async (_name, entry) => {
      const rows = await withRestaurant(appDb, A.restaurantId, (tx) => entry.probe(tx));
      expect(rows.map((r) => r.id)).toEqual([entry.ownId()]);
    },
  );

  it('invoice_scans: restaurant_id is NOT NULL (A.7) and scoped rows isolate per tenant', async () => {
    // A.7: the unscoped (NULL-tenant) scan class is gone — the column is NOT
    // NULL. Probe via raw SQL (drizzle now rejects a null restaurant_id at the
    // type level) so the DB constraint itself is what we exercise.
    await expect(
      ownerDb.execute(
        sql`insert into invoice_scans (invoice_id, restaurant_id, storage_path, mime_type)
            values (${B.invoiceId}, ${null}, ${`legacy/${B.invoiceId}.pdf`}, 'application/pdf')`,
      ),
    ).rejects.toThrow(/not[- ]null|null value/i);

    await ownerDb.insert(invoiceScans).values([
      { invoiceId: A.invoiceId, restaurantId: A.restaurantId, storagePath: `${A.restaurantId}/${A.invoiceId}.pdf`, mimeType: 'application/pdf' },
      { invoiceId: B.invoiceId, restaurantId: B.restaurantId, storagePath: `${B.restaurantId}/${B.invoiceId}.pdf`, mimeType: 'application/pdf' },
    ]);
    // GUC=A sees only A's scan row (table RLS), never B's.
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: invoiceScans.restaurantId }).from(invoiceScans),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
    await ownerDb.delete(invoiceScans);
  });
});

describe('billing tables scoped through the restaurant→account link', () => {
  it('tenant A sees its own billing account / subscription / usage', async () => {
    const acct = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ id: billingAccounts.id }).from(billingAccounts),
    );
    expect(acct).toHaveLength(1);
    const sub = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions),
    );
    expect(sub).toHaveLength(1);
    const usage = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ used: usageCounters.used }).from(usageCounters),
    );
    expect(usage).toHaveLength(1);
  });

  it('tenant B sees none of A\'s billing rows', async () => {
    const acct = await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.select({ id: billingAccounts.id }).from(billingAccounts),
    );
    expect(acct).toHaveLength(0);
    const sub = await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions),
    );
    expect(sub).toHaveLength(0);
    const usage = await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.select({ used: usageCounters.used }).from(usageCounters),
    );
    expect(usage).toHaveLength(0);
  });

  it('no GUC ⇒ no billing rows visible at all', async () => {
    const acct = await appDb.select({ id: billingAccounts.id }).from(billingAccounts);
    expect(acct).toHaveLength(0);
  });

  it('the app role can READ the plans catalog but cannot rewrite pricing/limits', async () => {
    const cat = await appDb.select({ key: plans.key }).from(plans);
    expect(cat.length).toBeGreaterThan(0); // public reference data is readable
    // ...but a tenant must not be able to inflate limits / zero out pricing.
    await expect(
      appDb.update(plans).set({ priceAgorotMonthly: 1 }).where(eq(plans.key, 'pro')),
    ).rejects.toThrow(/permission denied/);
  });

  it('the app role cannot self-upgrade by writing subscriptions or usage', async () => {
    await expect(
      appDb
        .update(subscriptions)
        .set({ status: 'active' })
        .where(eq(subscriptions.billingAccountId, billingAcctA)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.update(usageCounters).set({ used: 0 }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('identity tables are a separate trust zone', () => {
  it('users: visible only as the self row under the user GUC', async () => {
    const noGuc = await appDb.select({ id: users.id }).from(users);
    expect(noGuc).toHaveLength(0);

    const self = await withUser(appDb, A.ownerUserId, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    expect(self).toEqual([{ id: A.ownerUserId }]);
  });

  it('sessions: the app role has no access at all', async () => {
    await expect(appDb.select().from(sessions)).rejects.toThrow(/permission denied/);
  });
});

// Epic B.1: the credential-auth tables are a separate identity trust zone —
// managed ONLY on the owner auth connection. A compromised tenant code path
// running as restomatch_app must not be able to read password hashes / TOTP
// secrets, replay reset tokens or recovery codes, or forge a tokenVersion bump.
describe('credential-auth tables are fully denied to the tenant app role', () => {
  it('user_credentials: select / insert / update / delete all permission-denied', async () => {
    await expect(appDb.select().from(userCredentials)).rejects.toThrow(/permission denied/);
    await expect(
      appDb.insert(userCredentials).values({ userId: A.ownerUserId, passwordHash: 'x' }),
    ).rejects.toThrow(/permission denied/);
    // A tokenVersion bump here would be a session-revocation bypass.
    await expect(
      appDb.update(userCredentials).set({ tokenVersion: 9999 }),
    ).rejects.toThrow(/permission denied/);
    await expect(appDb.delete(userCredentials)).rejects.toThrow(/permission denied/);
  });

  it('password_reset_tokens: the app role can neither read nor mint tokens', async () => {
    await expect(appDb.select().from(passwordResetTokens)).rejects.toThrow(/permission denied/);
    await expect(
      appDb.insert(passwordResetTokens).values({
        userId: A.ownerUserId,
        tokenHash: 'deadbeef',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('user_recovery_codes: the app role can neither read nor write codes', async () => {
    await expect(appDb.select().from(userRecoveryCodes)).rejects.toThrow(/permission denied/);
    await expect(
      appDb.insert(userRecoveryCodes).values({ userId: A.ownerUserId, codeHash: 'deadbeef' }),
    ).rejects.toThrow(/permission denied/);
  });
});

// NOTE: enforcement itself is proven by the raw-SQL probes above, which bypass
// the app layer. This block proves the OPPOSITE direction — the app keeps
// functioning when the connection role is RLS-enforced (GUC wiring complete,
// grants sufficient). Its negative cases are caught by the app layer first.
describe('tRPC functional regression through the RLS-enforced role', () => {
  it('onboarding.myMemberships works via the user GUC (no restaurant context)', async () => {
    const caller = callerFor(A, appDb);
    const rows = await caller.onboarding.myMemberships();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurantId: A.restaurantId, role: 'owner' });
  });

  it('own-tenant reads still work (GUC wiring keeps the app functional)', async () => {
    const caller = callerFor(A, appDb);
    const po = await caller.receiving.getPo({ poId: A.poId });
    expect(po.id).toBe(A.poId);
  });

  it('foreign-tenant read is NOT_FOUND', async () => {
    const caller = callerFor(A, appDb);
    await expect(caller.receiving.getPo({ poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('foreign-tenant write attack dies with zero mutation', async () => {
    const caller = callerFor(A, appDb);
    await expect(
      caller.receiving.markGrLine({ grLineId: B.grLineId, qtyReceived: 777 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [line] = await ownerDb
      .select({ qtyReceived: grLines.qtyReceived })
      .from(grLines)
      .where(eq(grLines.id, B.grLineId));
    expect(line?.qtyReceived).toBe('5.000');
  });

  it('approval queue contains only own-tenant discrepancies', async () => {
    const caller = callerFor(A, appDb);
    const queue = await caller.approvals.myQueue();
    expect(queue.map((q) => q.id)).toEqual([A.discrepancyId]);
  });

  it('own-tenant write path works under RLS (approve + audit + activity)', async () => {
    const caller = callerFor(A, appDb);
    const updated = await caller.approvals.approve({ discrepancyId: A.discrepancyId });
    expect(updated.resolutionStatus).toBe('accepted');
  });

  it('onboarding.createRestaurant works under the app role (bootstrap policies)', async () => {
    const caller = callerFor(A, appDb);
    const restaurant = await caller.onboarding.createRestaurant({ name: 'מסעדת RLS' });
    expect(restaurant.id).toBeTruthy();
    await ownerDb.delete(restaurants).where(eq(restaurants.id, restaurant.id));
  });
});

// Phase-2: the priced supplier catalog + import-audit tables are tenant-scoped
// by restaurant_id (added to the RLS policy array). These probes prove the
// policy admits the right tenant and rejects cross-tenant reads/writes.
describe('phase-2 catalog tables are tenant-isolated (raw probes)', () => {
  let aSupplierId: string;
  let bSupplierId: string;

  beforeAll(async () => {
    const [a] = await ownerDb
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.restaurantId, A.restaurantId));
    const [b] = await ownerDb
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.restaurantId, B.restaurantId));
    aSupplierId = a!.id;
    bSupplierId = b!.id;
    await ownerDb.insert(supplierCatalogItems).values([
      { restaurantId: A.restaurantId, supplierId: aSupplierId, supplierNameRaw: 'עגבניה A', listPrice: '8.5000' },
      { restaurantId: B.restaurantId, supplierId: bSupplierId, supplierNameRaw: 'עגבניה B', listPrice: '9.0000' },
    ]);
    await ownerDb.insert(catalogImports).values([
      { restaurantId: A.restaurantId, supplierId: aSupplierId, filename: 'a.csv', rowCount: 1 },
      { restaurantId: B.restaurantId, supplierId: bSupplierId, filename: 'b.csv', rowCount: 1 },
    ]);
  });

  afterAll(async () => {
    await ownerDb.delete(supplierCatalogItems);
    await ownerDb.delete(catalogImports);
  });

  it('supplier_catalog_items: GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: supplierCatalogItems.restaurantId }).from(supplierCatalogItems),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.rid === A.restaurantId)).toBe(true);
  });

  it('catalog_imports: GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: catalogImports.restaurantId }).from(catalogImports),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.rid === A.restaurantId)).toBe(true);
  });

  it('blocks a cross-tenant catalog INSERT (WITH CHECK violation)', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(supplierCatalogItems).values({
          restaurantId: B.restaurantId,
          supplierId: bSupplierId,
          supplierNameRaw: 'cross-tenant probe',
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

// Epic 0.4 — audit_log is append-only (immutable, tamper-evident). The tenant
// app role may INSERT + SELECT its own rows but never mutate/erase them.
describe('audit_log is append-only under the RLS-enforced role', () => {
  it('the app role can INSERT and SELECT its own audit rows', async () => {
    const inserted = await withRestaurant(appDb, A.restaurantId, async (tx) => {
      await tx.insert(auditLog).values({
        restaurantId: A.restaurantId,
        userId: A.ownerUserId,
        action: 'team.member_invited',
        entityType: 'invitation',
        after: { probe: 'append-only' },
      });
      return tx.select({ id: auditLog.id }).from(auditLog);
    });
    expect(inserted.length).toBeGreaterThan(0);
  });

  it('the app role cannot UPDATE audit rows (permission denied)', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.update(auditLog).set({ action: 'tampered' }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the app role cannot DELETE audit rows (permission denied)', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) => tx.delete(auditLog)),
    ).rejects.toThrow(/permission denied/);
  });

  it('the immutability trigger holds even if UPDATE/DELETE is re-granted (drift backstop)', async () => {
    // Simulate a future grant drift: re-grant the privilege AND add a permissive
    // policy so RLS would otherwise admit the rows. The trigger must still refuse.
    await ownerDb.execute(sql`grant update, delete on audit_log to restomatch_app`);
    await ownerDb.execute(sql`drop policy if exists audit_drift_probe on audit_log`);
    await ownerDb.execute(
      sql`create policy audit_drift_probe on audit_log using (restaurant_id = app.current_restaurant_id())`,
    );
    try {
      await expect(
        withRestaurant(appDb, A.restaurantId, (tx) =>
          tx.update(auditLog).set({ action: 'tampered' }),
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        withRestaurant(appDb, A.restaurantId, (tx) => tx.delete(auditLog)),
      ).rejects.toThrow(/append-only/);
    } finally {
      await ownerDb.execute(sql`drop policy if exists audit_drift_probe on audit_log`);
      await ownerDb.execute(sql`revoke update, delete on audit_log from restomatch_app`);
    }
  });
});

// Epic 0.5 — products.supplier_id is referentially same-tenant (composite FK).
// Enforced by the DB regardless of RLS, so it holds for owner/worker paths too.
describe('products.supplier_id cannot cross tenants (composite FK)', () => {
  it('rejects INSERT of a product owned by a foreign-tenant supplier', async () => {
    await expect(
      ownerDb.insert(products).values({
        restaurantId: A.restaurantId,
        supplierId: B.supplierId, // B's supplier under A's restaurant
        canonicalName: 'cross-tenant supplier probe',
      }),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('rejects UPDATE re-pointing a product at a foreign-tenant supplier', async () => {
    await expect(
      ownerDb
        .update(products)
        .set({ supplierId: B.supplierId })
        .where(eq(products.id, A.productId)),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('admits a product owned by a SAME-tenant supplier', async () => {
    const [p] = await ownerDb
      .insert(products)
      .values({
        restaurantId: A.restaurantId,
        supplierId: A.supplierId,
        canonicalName: 'same-tenant supplier ok',
      })
      .returning({ id: products.id });
    expect(p?.id).toBeTruthy();
    if (p) await ownerDb.delete(products).where(eq(products.id, p.id));
  });
});
