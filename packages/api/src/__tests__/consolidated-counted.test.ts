import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  poLines,
  products,
  purchaseOrders,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { claimSplit, consolidatedProposal, deliveryNoteNumberIn as reexported, readConsolidatedRaw } from '../match/consolidated';
import { deliveryNoteNumberIn, deliveryNoteNumberSql, normalizeDeliveryNoteNumber } from '../match/receiptTruth';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-04 · the consolidated cross-match (חשבונית מרכזת) reads only CLOSED receipts and
 * their COUNTED lines; a note the invoice bills with no closed receipt yet is
 * "not received yet" (T4 pending) — never "received 0" or a claimable shortfall.
 */
const db = createDb(testDbUrl());
const D0 = new Date('2026-06-10T09:00:00Z');

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
});
afterAll(() => resetDb(db));

describe('one delivery-note helper', () => {
  it('normalises ת.מ. / ת"מ / ת״מ / DN, alnum only, upper-case, no leading zeros', () => {
    expect(deliveryNoteNumberIn('ת.מ. 007702')).toBe('7702');
    expect(deliveryNoteNumberIn('ת"מ 7702 · חלב')).toBe('7702');
    expect(deliveryNoteNumberIn('ת״מ 7702')).toBe('7702');
    expect(deliveryNoteNumberIn('DN 7702')).toBe('7702');
    expect(deliveryNoteNumberIn('dn #07702')).toBe('7702');
    expect(deliveryNoteNumberIn('ת.מ 8801 לחמניות')).toBe('8801');
    expect(deliveryNoteNumberIn('תמר 7702 ק״ג')).toBeNull(); // a date (the fruit), not a note
    expect(deliveryNoteNumberIn('חלב 3% 24 ליטר')).toBeNull();
    expect(normalizeDeliveryNoteNumber('ת.מ. 007702')).toBe('7702');
    expect(normalizeDeliveryNoteNumber(' a-12/3 ')).toBe('A123');
    expect(normalizeDeliveryNoteNumber('000')).toBeNull();
    expect(reexported).toBe(deliveryNoteNumberIn); // consolidated.ts keeps its export, same function
  });

  it('keeps the range / list rules: a month line bills the pool', () => {
    expect(deliveryNoteNumberIn('ת.מ. 61036-61043 · חלב 3%')).toBeNull();
    expect(deliveryNoteNumberIn('ת"מ 61036 עד 61043')).toBeNull();
    expect(deliveryNoteNumberIn('DN 61036–61043')).toBeNull();
    expect(deliveryNoteNumberIn('ת.מ. 61036, 61037, 61038 · חלב')).toBeNull();
    expect(deliveryNoteNumberIn('DN 61036/61037')).toBeNull();
    expect(deliveryNoteNumberIn('ת.מ. 61036 ו-61037')).toBeNull();
    expect(deliveryNoteNumberIn('ת.מ. 61036 · חלב 3% 24-30')).toBe('61036');
  });

  it('the SQL twin reads a receipt’s notes exactly like the TS helper', async () => {
    const texts = [
      'ת.מ. 7702',
      'ת.מ. 007702',
      'ת"מ 7702',
      'ת״מ 7702',
      'ת.מ 8801 לחמניות',
      'DN 7702',
      'dn #07702',
      'הערה: ת.מ. 61036 נמסר בבוקר',
      'תמר 7702',
      'ארגז רטוב',
      '',
    ];
    for (const t of texts) {
      const raw = await db.execute(sql`select ${deliveryNoteNumberSql(sql`${t}::text`)} as n`);
      const rows = (Array.isArray(raw) ? raw : (raw as { rows: unknown[] }).rows) as Array<{ n: string | null }>;
      expect({ t, n: rows[0]!.n }).toEqual({ t, n: deliveryNoteNumberIn(t) });
    }
  });

  it('a ריכוז’s listed numbers are normalised the same way', () => {
    const raw = readConsolidatedRaw({ raw: { kind: 'consolidated', deliveryNotes: [{ number: '007702' }, { number: 7703 }, { number: 'x' }] } });
    expect(raw!.deliveryNoteNumbers).toEqual(['7702', '7703']);
  });
});

describe('claimSplit counts each finding once', () => {
  it('a duplicated finding (same stable key) is claimed once — never by array index', () => {
    const f = { type: 'PRICE_HIGHER' as const, severity: 'warn' as const, countsAsLeak: true, deltaAmount: 12, expected: 8.5, actual: 9.5, productId: 'p', key: 'PRICE_HIGHER|7701|p||' };
    expect(claimSplit([f, { ...f }], 1000).totalIls).toBe(12);
    expect(claimSplit([f, { ...f, key: 'PRICE_HIGHER|7702|p||' }], 1000).totalIls).toBe(24);
  });
});

// ── DB: the cross-match over closed / pending / missing receipts ──────────────

async function setup(T: Tenant) {
  const [s] = await db.insert(suppliers).values({ restaurantId: T.restaurantId, name: 'ספק ריכוז', businessId: '519900001' }).returning();
  const mk = async (name: string) =>
    (await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: name, category: 'חלב', defaultUnit: 'kg' }).returning())[0]!.id;
  const milk = await mk('חלב');
  const cream = await mk('שמנת');
  /** A delivery note: a closed PO + a receipt `ת.מ. <number>` with the given lines. */
  const note = async (
    number: string,
    status: 'pending' | 'partial' | 'completed',
    lines: Array<{ productId: string; qty: string }>,
  ) => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: T.restaurantId, supplierId: s!.id, expectedDeliveryAt: D0, status: 'closed', source: 'platform' })
      .returning();
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId: T.restaurantId, poId: po!.id, receivedAt: D0, status, notes: `ת.מ. ${number}` })
      .returning();
    for (const l of lines) {
      const [pl] = await db
        .insert(poLines)
        .values({ poId: po!.id, productId: l.productId, rawDescription: 'x', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' })
        .returning();
      await db.insert(grLines).values({ grId: gr!.id, poLineId: pl!.id, productId: l.productId, qtyReceived: l.qty, qtyRejected: '0' });
    }
    return gr!.id;
  };
  const consolidated = async (lines: Array<{ d: string; qty: number; price: number }>, listed: string[]) => {
    const exclAg = lines.reduce((a, l) => a + Math.round(l.qty * l.price * 100), 0);
    const vatAg = Math.round(exclAg * 0.18);
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: T.restaurantId,
        supplierId: s!.id,
        invoiceNumber: `R-${listed.join('-')}`,
        invoiceDate: new Date('2026-06-30T09:00:00Z'),
        totalExclVat: (exclAg / 100).toFixed(2),
        vatAmount: (vatAg / 100).toFixed(2),
        totalInclVat: ((exclAg + vatAg) / 100).toFixed(2),
        status: 'parsed',
        source: 'email',
        ocrPayload: {
          provider: 'reconciled',
          raw: { kind: 'consolidated', periodStart: '2026-06-01', periodEnd: '2026-06-30', deliveryNotes: listed.map((number) => ({ number })) },
        } as (typeof invoices.$inferInsert)['ocrPayload'],
      })
      .returning();
    for (const l of lines) {
      await db.insert(invoiceLines).values({
        invoiceId: inv!.id,
        productId: milk,
        rawDescription: l.d,
        qtyBilled: String(l.qty),
        unit: 'kg',
        unitPriceBilled: l.price.toFixed(2),
        lineTotal: (Math.round(l.qty * l.price * 100) / 100).toFixed(2),
      });
    }
    return inv!.id;
  };
  return { milk, cream, note, consolidated };
}

describe('consolidatedProposal reads only closed receipts and counted lines', () => {
  it('a closed note is cross-matched; a pending note and a missing one are pending (no claim ₪); an uncounted line is not "received 0"', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, cream, note, consolidated } = await setup(T);
    // 7701: closed, 4 kg milk counted; the cream line was never touched (0/0).
    const gr7701 = await note('7701', 'completed', [{ productId: milk, qty: '4' }, { productId: cream, qty: '0' }]);
    // 7702: the receiver is still counting (pending) — 6 kg autosaved.
    await note('7702', 'pending', [{ productId: milk, qty: '6' }]);
    // 7703: no receipt at all yet.
    const inv = await consolidated(
      [
        { d: 'ת.מ. 7701 · חלב', qty: 4, price: 9 }, // ₪2 over the PO's ₪8.50
        { d: 'ת"מ 007702 · חלב', qty: 6, price: 8.5 },
        { d: 'DN 7703 · חלב', qty: 5, price: 8.5 },
      ],
      ['7701', '007702', '7703'],
    );
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(p.deliveryNotes.map((n) => n.grId)).toEqual([gr7701]);
    // The untouched cream line is unknown — not a delivered-but-unbilled 0.
    expect(p.products.some((r) => r.productId === cream)).toBe(false);
    const leak = p.findings.filter((f) => f.countsAsLeak);
    expect(leak.map((f) => [f.type, f.deliveryNoteNumber, f.deltaAmount])).toEqual([['PRICE_HIGHER', '7701', 2]]);
    expect(p.claim).toEqual({ exclIls: 2, inclIls: 0 });
    expect(p.totals.leakIls).toBe(2);
    // The two not-received notes: pending, never claimed.
    expect(p.pendingNotes).toEqual([
      { number: '7702', billedIls: 51 },
      { number: '7703', billedIls: 42.5 },
    ]);
    const pending = p.findings.filter((f) => f.notReceivedYet);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((f) => !f.countsAsLeak)).toBe(true);
    expect(new Set(pending.map((f) => f.deliveryNoteNumber))).toEqual(new Set(['7702', '7703']));
    expect(pending.every((f) => f.productId === milk)).toBe(true);
  });

  it('a ריכוז billing its closed note at the PO price plus a not-yet-received note reads "matched", never a false alarm', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7701', 'partial', [{ productId: milk, qty: '4' }]);
    const inv = await consolidated(
      [
        { d: 'ת.מ. 7701 · חלב', qty: 4, price: 8.5 },
        { d: 'ת.מ. 7702 · חלב', qty: 6, price: 8.5 },
      ],
      ['7701', '7702'],
    );
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(p.findings.filter((f) => f.countsAsLeak)).toEqual([]);
    expect(p.claim).toEqual({ exclIls: 0, inclIls: 0 });
    expect(p.pendingNotes).toEqual([{ number: '7702', billedIls: 51 }]);
    expect(p.status).toBe('matched');
  });

  it('once the pending note is closed it is cross-matched like any other', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7701', 'completed', [{ productId: milk, qty: '4' }]);
    const gr7702 = await note('7702', 'pending', [{ productId: milk, qty: '2' }]);
    const inv = await consolidated(
      [
        { d: 'ת.מ. 7701 · חלב', qty: 4, price: 8.5 },
        { d: 'ת.מ. 7702 · חלב', qty: 6, price: 8.5 }, // billed 6, counted 2
      ],
      ['7701', '7702'],
    );
    expect((await consolidatedProposal(db, T.restaurantId, inv))!.claim.exclIls).toBe(0);
    await db.update(goodsReceipts).set({ status: 'partial' }).where(sql`${goodsReceipts.id} = ${gr7702}`);
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(p.pendingNotes).toEqual([]);
    expect(p.deliveryNotes).toHaveLength(2);
    expect(p.findings.filter((f) => f.countsAsLeak).map((f) => [f.type, f.deliveryNoteNumber, f.deltaAmount])).toEqual([
      ['QTY_OVER', '7702', 34],
    ]);
  });
});
