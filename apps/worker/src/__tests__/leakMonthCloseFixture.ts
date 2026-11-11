import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  products,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';

/** H-07 test fixture: one restaurant, invoices with warn/block/info lines on dated months. */
export const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const created: string[] = [];

export type Line = {
  type?: (typeof discrepancies.$inferInsert)['type'];
  severity?: 'info' | 'warn' | 'block';
  delta: string;
};

export async function tenant(label: string) {
  const [r] = await db.insert(restaurants).values({ name: `h07 ${label} ${RUN}` }).returning();
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: `ספק ${label}` }).returning();
  const [p] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'עגבניה', defaultUnit: 'ק״ג' })
    .returning();
  created.push(r!.id);
  const restaurantId = r!.id;

  async function invoice(date: Date, inclVat: string, lines: Line[]) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId,
        supplierId: s!.id,
        invoiceNumber: `H07-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: date,
        invoiceDate: date,
        totalExclVat: inclVat,
        vatAmount: '0',
        totalInclVat: inclVat,
        status: 'matched',
        source: 'photo',
      })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({
        invoiceId: inv!.id,
        productId: p!.id,
        rawDescription: 'עגבניות',
        qtyBilled: '1',
        unit: 'ק״ג',
        unitPriceBilled: inclVat,
        lineTotal: inclVat,
      })
      .returning();
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId, invoiceId: inv!.id, overallStatus: 'major', totalDiscrepancyAmount: '0' })
      .returning();
    const add = async (l: Line) => {
      const [d] = await db
        .insert(discrepancies)
        .values({
          restaurantId,
          matchRunId: mr!.id,
          type: l.type ?? 'PRICE_HIGHER',
          severity: l.severity ?? 'warn',
          deltaAmount: l.delta,
          productId: p!.id,
          invoiceLineId: line!.id,
          resolutionStatus: 'open',
        })
        .returning();
      return d!.id;
    };
    for (const l of lines) await add(l);
    return { invoiceId: inv!.id, add, remove: (id: string) => db.delete(discrepancies).where(eq(discrepancies.id, id)) };
  }
  return { restaurantId, invoice };
}

export async function cleanup() {
  for (const id of created) await db.delete(restaurants).where(eq(restaurants.id, id));
  created.length = 0;
}
