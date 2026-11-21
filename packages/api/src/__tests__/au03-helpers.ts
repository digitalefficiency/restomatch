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
      deltaAmount: '10.00',
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
  return c!.id;
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
