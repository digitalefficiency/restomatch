import { testDbUrl, type RestaurantSettings } from '@restomatch/db';
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
  claimLetters,
  consolidatedInvoiceLinks,
  createDb,
  discrepancies,
  emailInboxes,
  exportRunInvoices,
  exportRuns,
  leakMonthCorrections,
  leakMonthSnapshots,
  notificationPrefs,
  notificationSettings,
  pushSubscriptions,
  supplierBankAccountChanges,
  supplierBankAccounts,
  supplierCatalogItems,
  ensureRlsAppRole,
  eq,
  goodsReceipts,
  grLines,
  idempotencyKeys,
  invitations,
  invoiceLines,
  invoiceScans,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  passwordResetTokens,
  paymentDeductions,
  plans,
  poLines,
  priceAlertThresholds,
  priceAlerts,
  priceBaselines,
  priceHistory,
  procurementConnections,
  productAliases,
  products,
  purchaseOrders,
  recipeItems,
  recipes,
  restaurants,
  sessions,
  sql,
  subscriptions,
  supplierConfirmLinks,
  supplierContractPrices,
  supplierResponses,
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
import { createSupplierLink, loadSupplierOrder, resolveSupplierToken, submitSupplierAnswer } from '../supplierConfirm/service';
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
  testDbUrl();
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

describe('recipes / recipe_items (0057) are tenant-isolated under the app role', () => {
  let aRecipe: string;
  let bRecipe: string;

  beforeAll(async () => {
    const [a] = await ownerDb.insert(recipes).values({ restaurantId: A.restaurantId, name: 'rls A dish' }).returning();
    const [b] = await ownerDb.insert(recipes).values({ restaurantId: B.restaurantId, name: 'rls B dish' }).returning();
    aRecipe = a!.id;
    bRecipe = b!.id;
    await ownerDb.insert(recipeItems).values([
      { restaurantId: A.restaurantId, recipeId: aRecipe, productId: A.productId, quantity: '1', unit: 'ק״ג' },
      { restaurantId: B.restaurantId, recipeId: bRecipe, productId: B.productId, quantity: '1', unit: 'ק״ג' },
    ]);
  });

  afterAll(async () => {
    await ownerDb.delete(recipeItems);
    await ownerDb.delete(recipes);
    await ownerDb.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
  });

  it('GUC=A sees only tenant-A recipes and lines; no GUC sees none', async () => {
    const [r, l] = await withRestaurant(appDb, A.restaurantId, async (tx) => [
      await tx.select({ rid: recipes.restaurantId }).from(recipes),
      await tx.select({ rid: recipeItems.restaurantId }).from(recipeItems),
    ]);
    expect(r!.map((x) => x.rid)).toEqual([A.restaurantId]);
    expect(l!.map((x) => x.rid)).toEqual([A.restaurantId]);
    expect(await appDb.select({ id: recipes.id }).from(recipes)).toEqual([]);
  });

  it('blocks a cross-tenant recipe INSERT and UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) => tx.insert(recipes).values({ restaurantId: B.restaurantId, name: 'probe' })),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.update(recipes).set({ name: 'pwned' }).where(eq(recipes.id, bRecipe)).returning({ id: recipes.id }),
    );
    expect(updated).toEqual([]);
  });

  it('recipes.list works through the app role once the flag is on (grants + GUC wiring)', async () => {
    await ownerDb.update(restaurants).set({ settings: { features: { recipes: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, A.restaurantId));
    const res = await callerFor(A, appDb).recipes.list();
    expect(res.recipes.map((x) => x.name)).toEqual(['rls A dish']);
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

describe('wave 1 (S11) tables: supplier_contract_prices / price_alert_thresholds / price_alerts (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(supplierContractPrices).values({
        restaurantId: t.restaurantId,
        supplierId: t.supplierId,
        productId: t.productId,
        contractPrice: '9.0000',
        validFrom: '2026-01-01',
      });
      await ownerDb.insert(priceAlertThresholds).values({ restaurantId: t.restaurantId, thresholdPct: '0.1000' });
      await ownerDb.insert(priceAlerts).values({
        restaurantId: t.restaurantId,
        productId: t.productId,
        supplierId: t.supplierId,
        windowDays: 21,
        thresholdPct: '0.1000',
        startPrice: '6',
        endPrice: '7',
        pctChange: '0.1667',
        startAt: new Date('2026-09-27'),
        endAt: new Date('2026-10-17'),
        observations: 4,
        dedupeKey: `rls-${t.restaurantId}`,
      });
    }
  });

  afterAll(async () => {
    await ownerDb.delete(supplierContractPrices);
    await ownerDb.delete(priceAlertThresholds);
    await ownerDb.delete(priceAlerts);
  });

  it('GUC=A sees only tenant-A rows in all three tables', async () => {
    const [c, th, al] = await withRestaurant(appDb, A.restaurantId, async (tx) => [
      await tx.select({ rid: supplierContractPrices.restaurantId }).from(supplierContractPrices),
      await tx.select({ rid: priceAlertThresholds.restaurantId }).from(priceAlertThresholds),
      await tx.select({ rid: priceAlerts.restaurantId }).from(priceAlerts),
    ]);
    for (const rows of [c, th, al]) {
      expect(rows).toEqual([{ rid: A.restaurantId }]);
    }
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(priceAlertThresholds).values({ restaurantId: B.restaurantId, category: 'x', thresholdPct: '0.5' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(supplierContractPrices)
        .set({ contractPrice: '0.0100' })
        .where(eq(supplierContractPrices.restaurantId, B.restaurantId))
        .returning({ id: supplierContractPrices.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('wave 1 (S11) supplier portal under the RLS app role', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.update(restaurants).set({ settings: { features: { supplierConfirm: true } } as never }).where(eq(restaurants.id, t.restaurantId));
      await ownerDb.update(purchaseOrders).set({ status: 'sent' }).where(eq(purchaseOrders.id, t.poId));
    }
  });
  afterAll(async () => {
    await ownerDb.delete(supplierResponses);
    await ownerDb.delete(supplierConfirmLinks);
    for (const t of [A, B]) await ownerDb.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, t.restaurantId));
  });

  it('the public flow works end-to-end as restomatch_app (resolve on owner, read/write under the link tenant)', async () => {
    const link = await withRestaurant(appDb, A.restaurantId, (tx) => createSupplierLink(tx, A.restaurantId, A.poId));
    const resolved = await resolveSupplierToken(ownerDb, link!.token);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const view = await withRestaurant(appDb, resolved.link.restaurantId, (tx) => loadSupplierOrder(tx, resolved.link));
    expect(view!.lines.map((l) => l.id)).toEqual([A.poLineId]);
    const res = await withRestaurant(appDb, resolved.link.restaurantId, (tx) =>
      submitSupplierAnswer(tx, resolved.link, { lines: [{ poLineId: A.poLineId, qtyAvailable: 4 }] }),
    );
    expect(res).toEqual({ ok: true, status: 'changes' });
  });

  it('GUC=B sees none of A’s links/responses; a forged cross-tenant link object reads nothing', async () => {
    const [links, resps] = await withRestaurant(appDb, B.restaurantId, async (tx) => [
      await tx.select({ rid: supplierConfirmLinks.restaurantId }).from(supplierConfirmLinks),
      await tx.select({ rid: supplierResponses.restaurantId }).from(supplierResponses),
    ]);
    expect(links.every((r) => r.rid === B.restaurantId)).toBe(true);
    expect(resps.every((r) => r.rid === B.restaurantId)).toBe(true);
    const forged = { linkId: '00000000-0000-0000-0000-000000000000', restaurantId: A.restaurantId, poId: A.poId, expiresAt: new Date() };
    // Under B's tenant GUC, even a link object naming A's order can't read or write it.
    expect(await withRestaurant(appDb, B.restaurantId, (tx) => loadSupplierOrder(tx, forged))).toBeNull();
    await expect(
      withRestaurant(appDb, B.restaurantId, (tx) =>
        tx.insert(supplierResponses).values({ restaurantId: A.restaurantId, poId: A.poId, linkId: forged.linkId, status: 'confirmed' }),
      ),
    ).rejects.toThrow();
  });
});

// ── 0071 (wave 2, G-03): the three new tenant tables. Add-only probes, one block per
// table, same template as the S11 block: GUC=A sees only A; a cross-tenant INSERT is
// refused; an UPDATE aimed at B's rows touches nothing.

describe('0071 (G-03) idempotency_keys (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(idempotencyKeys).values({ restaurantId: t.restaurantId, key: `rls-${t.restaurantId}`, procedure: 'receiving.complete' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(idempotencyKeys);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: idempotencyKeys.restaurantId }).from(idempotencyKeys),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(idempotencyKeys).values({ restaurantId: B.restaurantId, key: 'forged', procedure: 'x' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(idempotencyKeys)
        .set({ response: { forged: true } })
        .where(eq(idempotencyKeys.restaurantId, B.restaurantId))
        .returning({ id: idempotencyKeys.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0071 (G-03) claim_letters (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(claimLetters).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, seqNo: 1 });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(claimLetters);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: claimLetters.restaurantId }).from(claimLetters),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(claimLetters).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, seqNo: 2 }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(claimLetters)
        .set({ status: 'closed' })
        .where(eq(claimLetters.restaurantId, B.restaurantId))
        .returning({ id: claimLetters.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0071 (G-03) payment_deductions (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(paymentDeductions).values({ restaurantId: t.restaurantId, invoiceId: t.invoiceId, amountAgorot: 1000 });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(paymentDeductions);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: paymentDeductions.restaurantId }).from(paymentDeductions),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(paymentDeductions).values({ restaurantId: B.restaurantId, invoiceId: B.invoiceId, amountAgorot: 1 }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(paymentDeductions)
        .set({ amountAgorot: 999_999 })
        .where(eq(paymentDeductions.restaurantId, B.restaurantId))
        .returning({ id: paymentDeductions.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

// ── 0072 (wave 2, H-03): the ten new tenant tables. Add-only probes, one block per
// table, same template as the 0071 blocks: GUC=A sees only A; a cross-tenant INSERT
// is refused; an UPDATE aimed at B's rows touches nothing. Parent rows (export run,
// snapshot, bank account) are seeded per tenant on the owner connection. Tables with
// own-user RESTRICTIVE policies run as a member (restaurant + user GUC, as
// memberProcedure does) and also refuse a row for another user. The frozen months
// are owner-written only (rls.ts revoke), so the tenant role gets "permission denied".
type H03Tx = Parameters<Parameters<typeof withRestaurant<unknown>>[2]>[0];
const asMember = <T>(restaurantId: string, userId: string, fn: (tx: H03Tx) => Promise<T>) =>
  withRestaurant(appDb, restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });

describe('0072 (H-03) export_runs (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(exportRuns).values({ restaurantId: t.restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', format: 'hashavshevet', mode: 'new_only' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(exportRuns);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: exportRuns.restaurantId }).from(exportRuns),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(exportRuns).values({ restaurantId: B.restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', format: 'csv', mode: 'all' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(exportRuns)
        .set({ invoiceCount: 999 })
        .where(eq(exportRuns.restaurantId, B.restaurantId))
        .returning({ id: exportRuns.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0072 (H-03) export_run_invoices (raw RLS)', () => {
  const runs = new Map<string, string>();
  beforeAll(async () => {
    for (const t of [A, B]) {
      const [run] = await ownerDb.insert(exportRuns).values({ restaurantId: t.restaurantId, rangeFrom: '2026-10-01', rangeTo: '2026-10-31', format: 'hashavshevet', mode: 'new_only' }).returning();
      runs.set(t.restaurantId, run!.id);
      await ownerDb.insert(exportRunInvoices).values({ restaurantId: t.restaurantId, exportRunId: run!.id, invoiceId: t.invoiceId });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(exportRunInvoices);
    await ownerDb.delete(exportRuns);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: exportRunInvoices.restaurantId }).from(exportRunInvoices),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(exportRunInvoices).values({ restaurantId: B.restaurantId, exportRunId: runs.get(B.restaurantId)!, invoiceId: B.invoiceId }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(exportRunInvoices)
        .set({ invoiceId: A.invoiceId })
        .where(eq(exportRunInvoices.restaurantId, B.restaurantId))
        .returning({ id: exportRunInvoices.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0072 (H-03) consolidated_invoice_links (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(consolidatedInvoiceLinks).values({ restaurantId: t.restaurantId, invoiceId: t.invoiceId, goodsReceiptId: t.grId, source: 'manual' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(consolidatedInvoiceLinks);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: consolidatedInvoiceLinks.restaurantId }).from(consolidatedInvoiceLinks),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(consolidatedInvoiceLinks).values({ restaurantId: B.restaurantId, invoiceId: B.invoiceId, goodsReceiptId: B.grId, source: 'proposal_accept' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(consolidatedInvoiceLinks)
        .set({ source: 'proposal_accept' })
        .where(eq(consolidatedInvoiceLinks.restaurantId, B.restaurantId))
        .returning({ id: consolidatedInvoiceLinks.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0072 (H-03) leak_month_snapshots (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(leakMonthSnapshots).values({ restaurantId: t.restaurantId, month: '2026-09-01', leakAgorot: 35500 });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(leakMonthSnapshots);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: leakMonthSnapshots.restaurantId }).from(leakMonthSnapshots),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(leakMonthSnapshots).values({ restaurantId: B.restaurantId, month: '2026-08-01', leakAgorot: 1 }),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
    // Revoked for the tenant role (rls.ts): an UPDATE is refused outright.
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.update(leakMonthSnapshots).set({ leakAgorot: 0 }).where(eq(leakMonthSnapshots.restaurantId, B.restaurantId)),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the tenant role cannot write a frozen month even for its own restaurant (owner-written only)', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-07-01', leakAgorot: 1 }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('0072 (H-03) leak_month_corrections (raw RLS)', () => {
  const snaps = new Map<string, string>();
  beforeAll(async () => {
    for (const t of [A, B]) {
      const [snap] = await ownerDb.insert(leakMonthSnapshots).values({ restaurantId: t.restaurantId, month: '2026-09-01', leakAgorot: 35500 }).returning();
      snaps.set(t.restaurantId, snap!.id);
      await ownerDb.insert(leakMonthCorrections).values({ restaurantId: t.restaurantId, snapshotId: snap!.id, deltaAgorot: 100, reason: 'late credit note' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(leakMonthCorrections);
    await ownerDb.delete(leakMonthSnapshots);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: leakMonthCorrections.restaurantId }).from(leakMonthCorrections),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(leakMonthCorrections).values({ restaurantId: B.restaurantId, snapshotId: snaps.get(B.restaurantId)!, deltaAgorot: -1, reason: 'forged' }),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
    // Revoked for the tenant role (rls.ts): an UPDATE is refused outright.
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.update(leakMonthCorrections).set({ deltaAgorot: 999_999 }).where(eq(leakMonthCorrections.restaurantId, B.restaurantId)),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('0072 (H-03) supplier_bank_accounts (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(supplierBankAccounts).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, bankCode: '12', branchCode: '345', accountNumberEnc: 'v1:ct', accountLast4: '6789' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(supplierBankAccountChanges); // the audit rows the insert trigger wrote
    await ownerDb.delete(supplierBankAccounts);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: supplierBankAccounts.restaurantId }).from(supplierBankAccounts),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(supplierBankAccounts).values({ restaurantId: B.restaurantId, supplierId: B.supplierId, bankCode: '99', branchCode: '999', accountNumberEnc: 'v1:forged', accountLast4: '0000', active: false }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(supplierBankAccounts)
        .set({ holderName: 'forged' })
        .where(eq(supplierBankAccounts.restaurantId, B.restaurantId))
        .returning({ id: supplierBankAccounts.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0072 (H-03) supplier_bank_account_changes (raw RLS)', () => {
  const accts = new Map<string, string>();
  beforeAll(async () => {
    for (const t of [A, B]) {
      // The insert trigger writes exactly one masked change row per account.
      const [acct] = await ownerDb.insert(supplierBankAccounts).values({ restaurantId: t.restaurantId, supplierId: t.supplierId, bankCode: '12', branchCode: '345', accountNumberEnc: 'v1:ct', accountLast4: '6789' }).returning();
      accts.set(t.restaurantId, acct!.id);
    }
  });
  afterAll(async () => {
    await ownerDb.delete(supplierBankAccountChanges);
    await ownerDb.delete(supplierBankAccounts);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.select({ rid: supplierBankAccountChanges.restaurantId }).from(supplierBankAccountChanges),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(supplierBankAccountChanges).values({ restaurantId: B.restaurantId, bankAccountId: accts.get(B.restaurantId)!, after: { account_last4: '0000' } }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(supplierBankAccountChanges)
        .set({ changedBy: null })
        .where(eq(supplierBankAccountChanges.restaurantId, B.restaurantId))
        .returning({ id: supplierBankAccountChanges.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe('0072 (H-03) push_subscriptions (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(pushSubscriptions).values({ restaurantId: t.restaurantId, userId: t.ownerUserId, endpoint: `https://push.test/${t.restaurantId}`, p256dh: 'k', auth: 'a' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(pushSubscriptions);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx.select({ rid: pushSubscriptions.restaurantId }).from(pushSubscriptions),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.insert(pushSubscriptions).values({ restaurantId: B.restaurantId, userId: B.ownerUserId, endpoint: 'https://push.test/forged', p256dh: 'k', auth: 'a' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx
        .update(pushSubscriptions)
        .set({ revokedAt: new Date() })
        .where(eq(pushSubscriptions.restaurantId, B.restaurantId))
        .returning({ id: pushSubscriptions.id }),
    );
    expect(updated).toHaveLength(0);
  });

  it('a member sees and writes only their OWN devices, even in their own restaurant', async () => {
    // Another person's device in restaurant A (B's owner stands in for a second member).
    const [other] = await ownerDb
      .insert(pushSubscriptions)
      .values({ restaurantId: A.restaurantId, userId: B.ownerUserId, endpoint: 'https://push.test/a-other', p256dh: 'k', auth: 'a' })
      .returning();
    const seen = await asMember(A.restaurantId, A.ownerUserId, (tx) => tx.select({ uid: pushSubscriptions.userId }).from(pushSubscriptions));
    expect(seen).toEqual([{ uid: A.ownerUserId }]);
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.insert(pushSubscriptions).values({ restaurantId: A.restaurantId, userId: B.ownerUserId, endpoint: 'https://push.test/x', p256dh: 'k', auth: 'a' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const touched = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx.update(pushSubscriptions).set({ revokedAt: new Date() }).where(eq(pushSubscriptions.id, other!.id)).returning({ id: pushSubscriptions.id }),
    );
    expect(touched).toHaveLength(0);
    await ownerDb.delete(pushSubscriptions).where(eq(pushSubscriptions.id, other!.id));
  });
});

describe('0072 (H-03) notification_prefs (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(notificationPrefs).values({ restaurantId: t.restaurantId, userId: t.ownerUserId, channel: 'email', eventKind: 'claim_overdue' });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(notificationPrefs);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx.select({ rid: notificationPrefs.restaurantId }).from(notificationPrefs),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.insert(notificationPrefs).values({ restaurantId: B.restaurantId, userId: B.ownerUserId, channel: 'push', eventKind: 'forged' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx
        .update(notificationPrefs)
        .set({ enabled: false })
        .where(eq(notificationPrefs.restaurantId, B.restaurantId))
        .returning({ id: notificationPrefs.id }),
    );
    expect(updated).toHaveLength(0);
  });

  it('a member writes only their OWN row, even in their own restaurant', async () => {
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) => tx.insert(notificationPrefs).values({ restaurantId: A.restaurantId, userId: B.ownerUserId, channel: 'push', eventKind: 'someone_else' })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.update(notificationPrefs).set({ userId: B.ownerUserId }).where(eq(notificationPrefs.restaurantId, A.restaurantId)),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('0072 (H-03) notification_settings (raw RLS)', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      await ownerDb.insert(notificationSettings).values({ restaurantId: t.restaurantId, userId: t.ownerUserId });
    }
  });
  afterAll(async () => {
    await ownerDb.delete(notificationSettings);
  });

  it('GUC=A sees only tenant-A rows', async () => {
    const rows = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx.select({ rid: notificationSettings.restaurantId }).from(notificationSettings),
    );
    expect(rows).toEqual([{ rid: A.restaurantId }]);
  });

  it('blocks a cross-tenant INSERT and leaves B rows untouched by UPDATE', async () => {
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.insert(notificationSettings).values({ restaurantId: B.restaurantId, userId: B.ownerUserId, dailyCap: 50 }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx
        .update(notificationSettings)
        .set({ dailyCap: 50 })
        .where(eq(notificationSettings.restaurantId, B.restaurantId))
        .returning({ id: notificationSettings.id }),
    );
    expect(updated).toHaveLength(0);
  });

  it('a member writes only their OWN row, even in their own restaurant', async () => {
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) => tx.insert(notificationSettings).values({ restaurantId: A.restaurantId, userId: B.ownerUserId })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asMember(A.restaurantId, A.ownerUserId, (tx) =>
        tx.update(notificationSettings).set({ userId: B.ownerUserId }).where(eq(notificationSettings.restaurantId, A.restaurantId)),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('0072 (H-03) append-only tables under the RLS app role', () => {
  it('the tenant role cannot UPDATE or DELETE even its own frozen month, correction or bank audit', async () => {
    const [snap] = await ownerDb.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-04-01', leakAgorot: 100 }).returning();
    const [corr] = await ownerDb
      .insert(leakMonthCorrections)
      .values({ restaurantId: A.restaurantId, snapshotId: snap!.id, deltaAgorot: 5, reason: 'late credit note' })
      .returning();
    const [acct] = await ownerDb
      .insert(supplierBankAccounts)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, bankCode: '12', branchCode: '345', accountNumberEnc: 'v1:ct', accountLast4: '6789' })
      .returning();
    const auto = await ownerDb.select().from(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.bankAccountId, acct!.id));
    expect(auto).toHaveLength(1); // written by the insert trigger
    // An audit row with a real actor, so "wipe changed_by" would be an actual change.
    const [ch] = await ownerDb
      .insert(supplierBankAccountChanges)
      .values({ restaurantId: A.restaurantId, bankAccountId: acct!.id, changedBy: A.ownerUserId, after: { account_last4: '6789' } })
      .returning();
    const asA = (fn: Parameters<typeof withRestaurant<unknown>>[2]) => withRestaurant(appDb, A.restaurantId, fn);
    const DENIED = /append-only|permission denied/;
    await expect(asA((tx) => tx.delete(leakMonthCorrections).where(eq(leakMonthCorrections.id, corr!.id)))).rejects.toThrow(DENIED);
    await expect(asA((tx) => tx.delete(leakMonthSnapshots).where(eq(leakMonthSnapshots.id, snap!.id)))).rejects.toThrow(DENIED);
    await expect(asA((tx) => tx.update(leakMonthSnapshots).set({ leakAgorot: 1 }).where(eq(leakMonthSnapshots.id, snap!.id)))).rejects.toThrow(DENIED);
    await expect(asA((tx) => tx.delete(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.id, ch!.id)))).rejects.toThrow(DENIED);
    // The actor exemption is for referential actions only: the tenant cannot wipe who changed the bank details.
    await expect(
      asA((tx) => tx.update(supplierBankAccountChanges).set({ changedBy: null }).where(eq(supplierBankAccountChanges.id, ch!.id))),
    ).rejects.toThrow(DENIED);
    // Bank details are immutable for the tenant role too; a change of account is a new row.
    await expect(asA((tx) => tx.update(supplierBankAccounts).set({ accountLast4: '0000' }).where(eq(supplierBankAccounts.id, acct!.id)))).rejects.toThrow(
      /immutable/,
    );
    // A snapshot with no corrections can't be deleted and re-inserted with another figure either.
    const [lone] = await ownerDb.insert(leakMonthSnapshots).values({ restaurantId: A.restaurantId, month: '2026-03-01', leakAgorot: 100 }).returning();
    await expect(asA((tx) => tx.delete(leakMonthSnapshots).where(eq(leakMonthSnapshots.id, lone!.id)))).rejects.toThrow(DENIED);
    await ownerDb.delete(supplierBankAccountChanges);
    await ownerDb.delete(supplierBankAccounts);
    await ownerDb.delete(leakMonthCorrections);
    await ownerDb.delete(leakMonthSnapshots);
  });

  it('a bank change made through the app is audited with the session user as changed_by', async () => {
    const [acct] = await ownerDb
      .insert(supplierBankAccounts)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, bankCode: '12', branchCode: '345', accountNumberEnc: 'v1:ct', accountLast4: '6789' })
      .returning();
    await asMember(A.restaurantId, A.ownerUserId, (tx) =>
      tx.update(supplierBankAccounts).set({ active: false }).where(eq(supplierBankAccounts.id, acct!.id)),
    );
    const log = await ownerDb.select().from(supplierBankAccountChanges).where(eq(supplierBankAccountChanges.bankAccountId, acct!.id));
    expect(log.map((r) => r.changedBy).sort()).toEqual([A.ownerUserId, null].sort());
    await ownerDb.delete(supplierBankAccountChanges);
    await ownerDb.delete(supplierBankAccounts);
  });
});
