import {
  discrepancies,
  invoiceLines,
  invoices,
  memberships,
  recoveryClaims,
  restaurants,
  suppliers,
  users,
  eq,
  sql,
  type Database,
} from '@restomatch/db';
import type { Tenant } from './fixtures';

/** AU-03 test helpers: one claim per fresh discrepancy (claims are unique per discrepancy). */
export async function addClaim(
  db: Database,
  T: Tenant,
  over: Partial<typeof recoveryClaims.$inferInsert> & { type?: string },
): Promise<string> {
  const { type, ...claim } = over;
  const [d] = await db
    .insert(discrepancies)
    .values({
      matchRunId: T.matchRunId,
      restaurantId: T.restaurantId,
      type: (type ?? 'PRICE_HIGHER') as never,
      severity: 'block',
      // The finding is what the claim asks back (syncClaims never claims more than |Δ|): the claims
      // tracker reads a claim's capped share of its finding (G-14 Q3 R4-2).
      deltaAmount: ((claim.amountAgorot ?? 1000) / 100).toFixed(2),
      resolutionStatus: 'accepted',
    })
    .returning({ id: discrepancies.id });
  const [c] = await db
    .insert(recoveryClaims)
    .values({
      restaurantId: T.restaurantId,
      discrepancyId: d!.id,
      supplierId: T.supplierId,
      invoiceId: T.invoiceId,
      amountAgorot: 1000,
      status: 'claimed',
      ...claim,
    })
    .returning({ id: recoveryClaims.id });
  await coverClaim(db, T.invoiceId, claim.amountAgorot ?? 1000);
  return c!.id;
}

/**
 * The claim's invoice carries its finding: grow the seeded invoice's total by the claimed ₪, so
 * Σ claims never exceeds the invoice cap (syncClaims guarantees that in production; the tracker
 * reads each claim's capped share — G-14 Q3 R4-2).
 */
export async function coverClaim(db: Database, invoiceId: string, agorot: number) {
  await db
    .update(invoices)
    .set({ totalInclVat: sql`${invoices.totalInclVat} + ${(agorot / 100).toFixed(2)}::numeric` })
    .where(eq(invoices.id, invoiceId));
}

/** A later invoice of `supplierId` carrying one credit (negative) line. */
export async function addCreditLine(
  db: Database,
  T: Tenant,
  opts: { supplierId?: string; agorot: number; date: string; number: string },
): Promise<string> {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: T.restaurantId,
      supplierId: opts.supplierId ?? T.supplierId,
      invoiceNumber: opts.number,
      invoiceDate: new Date(`${opts.date}T08:00:00Z`),
      totalExclVat: '0.00',
      vatAmount: '0.00',
      totalInclVat: '0.00',
      status: 'matched',
      source: 'photo',
      createdBy: T.ownerUserId,
    })
    .returning({ id: invoices.id });
  const ils = (opts.agorot / 100).toFixed(2);
  const [line] = await db
    .insert(invoiceLines)
    .values({
      invoiceId: inv!.id,
      productId: T.productId,
      rawDescription: 'זיכוי',
      qtyBilled: '1',
      unit: 'unit',
      unitPriceBilled: `-${ils}`,
      lineTotal: `-${ils}`,
    } as never)
    .returning({ id: invoiceLines.id });
  return line!.id;
}

export async function addMember(db: Database, T: Tenant, role: 'manager' | 'bookkeeper' | 'receiver' | 'chef', tag: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${role}-${tag}@au03.test`, name: `${role} ${tag}`, emailVerified: new Date() })
    .returning({ id: users.id });
  await db.insert(memberships).values({ userId: u!.id, restaurantId: T.restaurantId, role });
  return u!.id;
}

export async function addSupplier(db: Database, T: Tenant, name: string, contact: { whatsapp?: string; email?: string } = {}) {
  const [s] = await db
    .insert(suppliers)
    .values({ restaurantId: T.restaurantId, name, contactWhatsapp: contact.whatsapp ?? null, contactEmail: contact.email ?? null } as never)
    .returning({ id: suppliers.id });
  return s!.id;
}

export async function setSettings(db: Database, T: Tenant, settings: Record<string, unknown>) {
  await db.update(restaurants).set({ settings: settings as never }).where(eq(restaurants.id, T.restaurantId));
}
