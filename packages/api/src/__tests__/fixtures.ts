import {
  activityEvents,
  auditLog,
  billingAccounts,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  PLAN_SEED_LIST,
  plans,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  subscriptions,
  suppliers,
  usageCounters,
  users,
  type Database,
  type FeatureKey,
  type SubscriptionOverrides,
} from '@restomatch/db';

/** A fully-populated tenant graph for isolation/attack tests. */
export interface Tenant {
  restaurantId: string;
  ownerUserId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productAliasId: string;
  poId: string;
  poLineId: string;
  grId: string;
  grLineId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceLineId: string;
  matchRunId: string;
  discrepancyId: string;
}

export async function resetDb(db: Database): Promise<void> {
  await db.delete(activityEvents);
  await db.delete(auditLog);
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(usageCounters);
  await db.delete(subscriptions);
  // restaurants.billing_account_id → billing_accounts (set null), so null first.
  await db.update(restaurants).set({ billingAccountId: null });
  await db.delete(billingAccounts);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

/** Upsert the canonical plan catalog into the test DB. */
export async function seedPlans(db: Database): Promise<void> {
  for (const p of PLAN_SEED_LIST) {
    await db
      .insert(plans)
      .values({
        key: p.key,
        nameHe: p.nameHe,
        priceAgorotMonthly: p.priceAgorotMonthly,
        limits: p.limits,
        features: p.features,
        sortOrder: p.sortOrder,
      })
      .onConflictDoUpdate({
        target: plans.key,
        set: { limits: p.limits, features: p.features },
      });
  }
}

/**
 * Give a restaurant a billing account + subscription on `planKey`. Requires
 * seedPlans() to have run. Returns the billing account id.
 */
export async function attachSubscription(
  db: Database,
  restaurantId: string,
  opts: {
    planKey: 'trial' | 'basic' | 'pro' | 'chain';
    status?: 'trialing' | 'active' | 'past_due' | 'canceled';
    trialEndsAt?: Date | null;
    overrides?: SubscriptionOverrides;
  },
): Promise<string> {
  const [account] = await db
    .insert(billingAccounts)
    .values({ name: `acct ${restaurantId.slice(0, 8)}` })
    .returning();
  if (!account) throw new Error('attachSubscription: account');
  await db
    .update(restaurants)
    .set({ billingAccountId: account.id })
    .where(eq(restaurants.id, restaurantId));

  const [plan] = await db.select().from(plans).where(eq(plans.key, opts.planKey)).limit(1);
  if (!plan) throw new Error(`attachSubscription: plan ${opts.planKey} not seeded`);

  await db.insert(subscriptions).values({
    billingAccountId: account.id,
    planId: plan.id,
    status: opts.status ?? 'active',
    trialEndsAt: opts.trialEndsAt ?? null,
    overrides: opts.overrides ?? {},
  });
  return account.id;
}

export type { FeatureKey };

export async function seedTenant(db: Database, tag: string): Promise<Tenant> {
  const [restaurant] = await db.insert(restaurants).values({ name: `Resto ${tag}` }).returning();
  if (!restaurant) throw new Error('seed: restaurant');

  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${tag}@attack.test`, name: `Owner ${tag}`, emailVerified: new Date() })
    .returning();
  if (!owner) throw new Error('seed: user');
  await db
    .insert(memberships)
    .values({ userId: owner.id, restaurantId: restaurant.id, role: 'owner' });

  const supplierName = `ספק ${tag}`;
  const [supplier] = await db
    .insert(suppliers)
    .values({
      restaurantId: restaurant.id,
      name: supplierName,
      businessId: `51234567${tag === 'A' ? '1' : '2'}`,
    })
    .returning();
  if (!supplier) throw new Error('seed: supplier');

  const [product] = await db
    .insert(products)
    .values({
      restaurantId: restaurant.id,
      canonicalName: `עגבניה ${tag}`,
      category: 'ירקות',
      defaultUnit: 'ק״ג',
    })
    .returning();
  if (!product) throw new Error('seed: product');

  const [productAlias] = await db
    .insert(productAliases)
    .values({
      productId: product.id,
      supplierId: supplier.id,
      supplierNameRaw: `tomato-${tag}`,
      confidence: '1.0',
    })
    .returning();
  if (!productAlias) throw new Error('seed: productAlias');

  const today = new Date();
  today.setHours(11, 0, 0, 0);
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier.id,
      expectedDeliveryAt: today,
      status: 'sent',
      source: 'manual',
    })
    .returning();
  if (!po) throw new Error('seed: po');

  const [poLine] = await db
    .insert(poLines)
    .values({
      poId: po.id,
      rawDescription: `עגבניות ${tag}`,
      qtyOrdered: '10',
      unit: 'kg',
      unitPriceExpected: '8.5',
    })
    .returning();
  if (!poLine) throw new Error('seed: poLine');

  const [gr] = await db
    .insert(goodsReceipts)
    .values({ restaurantId: restaurant.id, poId: po.id, receivedBy: owner.id, status: 'pending' })
    .returning();
  if (!gr) throw new Error('seed: gr');

  const [grLine] = await db
    .insert(grLines)
    .values({ grId: gr.id, poLineId: poLine.id, qtyReceived: '5', qtyRejected: '0' })
    .returning();
  if (!grLine) throw new Error('seed: grLine');

  const invoiceNumber = `INV-${tag}-1`;
  const [invoice] = await db
    .insert(invoices)
    .values({
      restaurantId: restaurant.id,
      supplierId: supplier.id,
      invoiceNumber,
      invoiceDate: today,
      totalExclVat: '100.00',
      vatAmount: '17.00',
      totalInclVat: '117.00',
      status: 'matched',
      source: 'photo',
      createdBy: owner.id,
    })
    .returning();
  if (!invoice) throw new Error('seed: invoice');

  const [invoiceLine] = await db
    .insert(invoiceLines)
    .values({
      invoiceId: invoice.id,
      productId: product.id,
      rawDescription: `עגבניות ${tag}`,
      qtyBilled: '10',
      unit: 'kg',
      unitPriceBilled: '10.00',
      lineTotal: '100.00',
    })
    .returning();
  if (!invoiceLine) throw new Error('seed: invoiceLine');

  const [matchRun] = await db
    .insert(matchRuns)
    .values({
      restaurantId: restaurant.id,
      poId: po.id,
      grId: gr.id,
      invoiceId: invoice.id,
      overallStatus: 'major',
      totalDiscrepancyAmount: '100.00',
    })
    .returning();
  if (!matchRun) throw new Error('seed: matchRun');

  const [discrepancy] = await db
    .insert(discrepancies)
    .values({
      matchRunId: matchRun.id,
      restaurantId: restaurant.id,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: '100.00',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    })
    .returning();
  if (!discrepancy) throw new Error('seed: discrepancy');

  await db.insert(auditLog).values({
    restaurantId: restaurant.id,
    userId: owner.id,
    action: 'discrepancy.created',
    entityType: 'discrepancy',
    entityId: discrepancy.id,
    after: { tag },
  });

  await db.insert(activityEvents).values({
    restaurantId: restaurant.id,
    eventType: 'invoice_matched',
    title: `אירוע סודי של ${tag}`,
    entityType: 'match_run',
    entityId: matchRun.id,
  });

  return {
    restaurantId: restaurant.id,
    ownerUserId: owner.id,
    supplierId: supplier.id,
    supplierName,
    productId: product.id,
    productAliasId: productAlias.id,
    poId: po.id,
    poLineId: poLine.id,
    grId: gr.id,
    grLineId: grLine.id,
    invoiceId: invoice.id,
    invoiceNumber,
    invoiceLineId: invoiceLine.id,
    matchRunId: matchRun.id,
    discrepancyId: discrepancy.id,
  };
}
