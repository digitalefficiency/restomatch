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
import { buildMatchInputForInvoice } from '../match/buildMatchInput';
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
    at: Date = D0,
  ) => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: T.restaurantId, supplierId: s!.id, expectedDeliveryAt: at, status: 'closed', source: 'platform' })
      .returning();
    const [gr] = await db
      .insert(goodsReceipts)
      .values({ restaurantId: T.restaurantId, poId: po!.id, receivedAt: at, status, notes: `ת.מ. ${number}` })
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
  const consolidated = async (
    lines: Array<{ d: string; qty: number; price: number }>,
    listed: string[],
    opts: { number?: string; createdAt?: Date; extra?: Record<string, unknown> } = {},
  ) => {
    const exclAg = lines.reduce((a, l) => a + Math.round(l.qty * l.price * 100), 0);
    const vatAg = Math.round(exclAg * 0.18);
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: T.restaurantId,
        supplierId: s!.id,
        invoiceNumber: opts.number ?? `R-${listed.join('-')}`,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        invoiceDate: new Date('2026-06-30T09:00:00Z'),
        totalExclVat: (exclAg / 100).toFixed(2),
        vatAmount: (vatAg / 100).toFixed(2),
        totalInclVat: ((exclAg + vatAg) / 100).toFixed(2),
        status: 'parsed',
        source: 'email',
        ocrPayload: {
          provider: 'reconciled',
          raw: { kind: 'consolidated', periodStart: '2026-06-01', periodEnd: '2026-06-30', deliveryNotes: listed.map((number) => ({ number })) },
          ...opts.extra,
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
  return { supplierId: s!.id, milk, cream, note, consolidated };
}

describe('consolidatedProposal reads only closed receipts and counted lines', () => {
  it('a closed note is cross-matched; a pending note is "not received yet", a note with no receipt is note_not_in_system (neither claimed); an uncounted line is not "received 0"', async () => {
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
    // 7702 (a receipt still being counted): T4 pending, never claimed.
    expect(p.pendingNotes).toEqual([{ number: '7702', billedIls: 51 }]);
    const pending = p.findings.filter((f) => f.notReceivedYet);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((f) => !f.countsAsLeak && f.deliveryNoteNumber === '7702' && f.productId === milk)).toBe(true);
    // 7703 (no receipt in RestoMatch at all): §9 note_not_in_system — warn, blocks "תואמת", never claimed.
    expect(p.reviewItems).toEqual([
      { flag: 'note_not_in_system', tier: 'warn', noteNumber: '7703', amountIls: 42.5, otherInvoice: null, blocksMatched: true },
    ]);
    const missing = p.findings.filter((f) => f.noteNotInSystem);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((f) => !f.countsAsLeak && f.deliveryNoteNumber === '7703')).toBe(true);
  });

  it('a ריכוז billing its closed note at the PO price plus a not-yet-received note reads "matched", never a false alarm', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7701', 'partial', [{ productId: milk, qty: '4' }]);
    await note('7702', 'pending', [{ productId: milk, qty: '0' }]); // the truck is at the door
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
    expect(p.reviewItems).toEqual([]);
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

// ── G-04 §9 (owner decision 1.11): three consolidated flags — review items, never leak. ──
describe('§9 consolidated flags', () => {
  const items = (p: Awaited<ReturnType<typeof consolidatedProposal>>, flag: string) => p!.reviewItems!.filter((r) => r.flag === flag);

  it('note_other_month: a listed note received outside the stated period is flagged (warn), ₪ as context only; an in-period note is not', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7801', 'completed', [{ productId: milk, qty: '4' }]); // 10.6: in the period
    await note('7802', 'completed', [{ productId: milk, qty: '4' }], new Date('2026-07-05T09:00:00Z')); // 5.7: 5 days out
    const inv = await consolidated(
      [
        { d: 'ת.מ. 7801 · חלב', qty: 4, price: 8.5 },
        { d: 'ת.מ. 7802 · חלב', qty: 4, price: 8.5 },
      ],
      ['7801', '7802'],
    );
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(items(p, 'note_other_month')).toEqual([
      { flag: 'note_other_month', tier: 'warn', noteNumber: '7802', amountIls: 34, otherInvoice: null, receivedOn: '2026-07-05', daysOutside: 5, blocksMatched: false },
    ]);
    // Context only: no leak, no claim, and it does not block "תואמת".
    expect(p.totals.leakIls).toBe(0);
    expect(p.claim).toEqual({ exclIls: 0, inclIls: 0 });
    expect(p.status).toBe('matched');
  });

  it('note_other_month at the Asia/Jerusalem midnight edge: 00:30 on 1.7 is one day out (T4); 23:30 on 30.6 is inside', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7811', 'completed', [{ productId: milk, qty: '1' }], new Date('2026-06-30T20:30:00Z')); // 23:30 IL, 30.6
    await note('7812', 'completed', [{ productId: milk, qty: '1' }], new Date('2026-06-30T21:30:00Z')); // 00:30 IL, 1.7
    const inv = await consolidated(
      [
        { d: 'ת.מ. 7811 · חלב', qty: 1, price: 8.5 },
        { d: 'ת.מ. 7812 · חלב', qty: 1, price: 8.5 },
      ],
      ['7811', '7812'],
    );
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(items(p, 'note_other_month').map((r) => [r.noteNumber, r.tier, r.receivedOn, r.daysOutside])).toEqual([['7812', 'T4', '2026-07-01', 1]]);
  });

  it('note_not_in_system: a note listed with no receipt blocks "תואמת" (₪ unknown when no line bills it); a note with a receipt is not flagged', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7821', 'completed', [{ productId: milk, qty: '4' }]);
    const inv = await consolidated([{ d: 'ת.מ. 7821 · חלב', qty: 4, price: 8.5 }], ['7821', '007822']); // 7822: listed in the header only
    const p = (await consolidatedProposal(db, T.restaurantId, inv))!;
    expect(items(p, 'note_not_in_system')).toEqual([
      { flag: 'note_not_in_system', tier: 'warn', noteNumber: '7822', amountIls: null, otherInvoice: null, blocksMatched: true },
    ]);
    expect(p.totals.leakIls).toBe(0);
    expect(p.status).toBe('differences'); // blocked, though nothing differs in ₪
  });

  it('note_billed_twice: a month-total line (no note number) billed again by a later ריכוז of the same supplier and period → T2 with the overlapping ₪, never leak; the earlier one is not flagged', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7831', 'completed', [{ productId: milk, qty: '20' }]);
    const month = [{ d: 'חלב · סה״כ חודש יוני', qty: 20, price: 8.5 }];
    const first = await consolidated(month, [], { number: 'R-JUN-A', createdAt: new Date('2026-07-01T08:00:00Z') });
    const second = await consolidated(month, [], { number: 'R-JUN-B', createdAt: new Date('2026-07-02T08:00:00Z') });
    const p2 = (await consolidatedProposal(db, T.restaurantId, second))!;
    expect(items(p2, 'note_billed_twice')).toEqual([
      { flag: 'note_billed_twice', tier: 'T2', noteNumber: null, amountIls: 170, otherInvoice: { invoiceId: first, invoiceNumber: 'R-JUN-A' }, blocksMatched: true },
    ]);
    expect(p2.claim.exclIls + p2.claim.inclIls).toBe(0); // the overlap is never claimed through the leak
    expect(items((await consolidatedProposal(db, T.restaurantId, first))!, 'note_billed_twice')).toEqual([]);
  });

  it('note_billed_twice negative: a later ריכוז of the same period billing a DIFFERENT month total is not a duplicate', async () => {
    const T = await seedTenant(db, 'A');
    const { milk, note, consolidated } = await setup(T);
    await note('7841', 'completed', [{ productId: milk, qty: '20' }]);
    await consolidated([{ d: 'חלב · סה״כ חודש יוני', qty: 20, price: 8.5 }], [], { number: 'R-JUN-A', createdAt: new Date('2026-07-01T08:00:00Z') });
    const second = await consolidated([{ d: 'חלב · תוספת', qty: 3, price: 8.5 }], [], { number: 'R-JUN-B', createdAt: new Date('2026-07-02T08:00:00Z') });
    expect(items((await consolidatedProposal(db, T.restaurantId, second))!, 'note_billed_twice')).toEqual([]);
  });

  it('a ח.פ.-mismatch consolidated invoice stays out of single-PO matching', async () => {
    const T = await seedTenant(db, 'A');
    const { supplierId, milk, consolidated } = await setup(T);
    // An open PO of the supplier right in the invoice's window would attract it if it were single-PO matched.
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: T.restaurantId, supplierId, expectedDeliveryAt: new Date('2026-06-30T09:00:00Z'), status: 'sent', source: 'manual' })
      .returning();
    await db.insert(poLines).values({ poId: po!.id, productId: milk, rawDescription: 'x', qtyOrdered: '4', unit: 'kg', unitPriceExpected: '8.5' });
    const inv = await consolidated([{ d: 'חלב', qty: 4, price: 8.5 }], [], { number: 'R-BIZ', extra: { reviewReasons: ['supplier_id_mismatch'] } });
    expect(await buildMatchInputForInvoice(db, T.restaurantId, inv)).toBeNull();
    expect(await buildMatchInputForInvoice(db, T.restaurantId, inv, { pinnedPoId: po!.id })).toBeNull();
  });
});

// Tenant isolation of the §9 lookups on the RLS-BYPASSING service connection (the worker's):
// the explicit restaurant scoping is all that stands between two tenants here.
describe('§9 flags never read another tenant (service connection)', () => {
  it("B's identical month-total ריכוז for the same period never flags A's as billed twice", async () => {
    const A = await seedTenant(db, 'A');
    const B = await seedTenant(db, 'B');
    const a = await setup(A);
    const b = await setup(B);
    await b.note('7891', 'completed', [{ productId: b.milk, qty: '20' }]);
    await a.note('7891', 'completed', [{ productId: a.milk, qty: '20' }]);
    const month = [{ d: 'חלב · סה״כ חודש יוני', qty: 20, price: 8.5 }];
    await b.consolidated(month, [], { number: 'R-JUN-B1', createdAt: new Date('2026-07-01T08:00:00Z') });
    const mine = await a.consolidated(month, [], { number: 'R-JUN-A1', createdAt: new Date('2026-07-02T08:00:00Z') });
    const p = (await consolidatedProposal(db, A.restaurantId, mine))!;
    expect(p.reviewItems!.filter((r) => r.flag === 'note_billed_twice')).toEqual([]);
  });

  it("B's receipt carrying A's note number never hides A's note_not_in_system", async () => {
    const A = await seedTenant(db, 'A');
    const B = await seedTenant(db, 'B');
    const a = await setup(A);
    const b = await setup(B);
    await b.note('7901', 'completed', [{ productId: b.milk, qty: '4' }]);
    await a.note('7900', 'completed', [{ productId: a.milk, qty: '4' }]);
    const mine = await a.consolidated([{ d: 'ת.מ. 7900 · חלב', qty: 4, price: 8.5 }], ['7900', '7901'], { number: 'R-A-7901' });
    const p = (await consolidatedProposal(db, A.restaurantId, mine))!;
    expect(p.reviewItems!.filter((r) => r.flag === 'note_not_in_system').map((r) => r.noteNumber)).toEqual(['7901']);
    expect(p.deliveryNotes.every((n) => n.number !== '7901')).toBe(true);
  });
});
