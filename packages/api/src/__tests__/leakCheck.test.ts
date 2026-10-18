import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  ensureRlsAppRole,
  eq,
  leakCheckOcrUsage,
  leakCheckSessions,
  sql,
  testDbUrl,
} from '@restomatch/db';
import {
  analyzeLeakCheck,
  getLeakCheckSession,
  issuePowChallenge,
  LeakCheckError,
  leakCheckOcrMode,
  leakCheckPublicEnabled,
  MAX_FILE_BYTES,
  purgeExpiredLeakChecks,
  reserveOcrBudget,
  runLeakCheck,
  SAMPLE_INVOICES,
  signResultLink,
  sniffMime,
  solvePow,
  toLeakCheckInvoice,
  validateUploads,
  verifyPow,
  verifyResultLink,
  type LeakCheckInvoice,
} from '../leakCheck';

const SECRET = 'leak-check-unit-test-secret-0123456789';
const pdf = (tag: string) => ({ name: `${tag}.pdf`, bytes: Buffer.from(`%PDF-1.4 leak check ${tag}`) });

function sampleInvoices(n: number): LeakCheckInvoice[] {
  return SAMPLE_INVOICES.slice(0, n).map((ocr, i) => toLeakCheckInvoice(i, { name: `f${i}` }, `hash${i}`, ocr));
}

describe('analyzeLeakCheck — every number traceable, agorot-exact', () => {
  it('finds exactly the four sample leaks (₪37.78) across the first four invoices', () => {
    const r = analyzeLeakCheck(sampleInvoices(4));
    const summary = r.findings.map((f) => [f.kind, f.invoiceIndex, f.lineIndex, f.amountAgorot]);
    expect(summary).toEqual([
      ['price_creep', 1, 0, 1400],
      ['price_creep', 3, 0, 1200],
      ['vat_overcharge', 2, null, 778],
      ['line_arithmetic', 1, 2, 400],
    ]);
    expect(r.leakAgorot).toBe(3778);
    // Σ totals 289.10 + 310.34 + 466.56 + 472.94
    expect(r.spendAgorot).toBe(153894);
    expect(r.analysedInvoices).toBe(4);
    const creep = r.findings[0]!;
    expect(creep).toMatchObject({ refInvoiceIndex: 0, refLineIndex: 0, expectedAgorot: 13000, actualAgorot: 14400, qty: 20 });
  });

  it('a re-sent invoice (same supplier + number) is one duplicate and is excluded from every other check', () => {
    const r = analyzeLeakCheck(sampleInvoices(5));
    const dup = r.findings.find((f) => f.kind === 'duplicate_invoice')!;
    expect(dup).toMatchObject({ invoiceIndex: 4, refInvoiceIndex: 2, amountAgorot: 46656 });
    // The duplicate's own VAT overcharge is NOT counted a second time.
    expect(r.findings.filter((f) => f.kind === 'vat_overcharge')).toHaveLength(1);
    expect(r.leakAgorot).toBe(3778 + 46656);
    expect(r.analysedInvoices).toBe(4);
  });

  it('the same FILE uploaded twice is a note, never a leak', () => {
    const inv = sampleInvoices(3);
    inv.push({ ...inv[2]!, index: 3, fileHash: inv[2]!.fileHash });
    const r = analyzeLeakCheck(inv);
    expect(r.findings.some((f) => f.kind === 'duplicate_invoice')).toBe(false);
    expect(r.notes).toContainEqual({ kind: 'same_file_twice', invoiceIndex: 3, refInvoiceIndex: 2 });
  });

  it('a price list wins over creep — a line gets at most one price finding', () => {
    const list = [
      { description: 'עגבניות', unit: 'ק"ג', unitPrice: 6.5 },
      { description: 'שמנת מתוקה 32%', unit: 'ליטר', unitPrice: 14.9 },
      { description: 'גבינה צהובה', unit: 'ק"ג', unitPrice: 40 },
    ];
    const r = analyzeLeakCheck(sampleInvoices(4), list);
    expect(r.findings.filter((f) => f.kind === 'price_creep')).toEqual([]);
    const listed = r.findings.filter((f) => f.kind === 'above_price_list').map((f) => [f.invoiceIndex, f.lineIndex, f.amountAgorot]);
    expect(listed.sort()).toEqual(
      [
        [1, 0, 1400], // tomatoes 20 × 0.70
        [2, 1, 1000], // cheese 5 × 2.00
        [3, 0, 1200], // cream 12 × 1.00
        [3, 1, 1000], // cheese 5 × 2.00
      ].sort(),
    );
    expect(r.leakAgorot).toBe(1400 + 1000 + 1200 + 1000 + 778 + 400);
  });

  it('errors in the restaurant’s favour and ≤ ₪1 rounding noise are never added', () => {
    const inv: LeakCheckInvoice = {
      index: 0, fileName: 'a', fileHash: 'h', supplierName: 'X', supplierBusinessId: null,
      invoiceNumber: '1', invoiceDate: null, subtotal: 99.5, vat: 17.91, total: 117.41,
      lines: [
        { description: 'a', qty: 3, unit: 'kg', unitPrice: 33.333, lineTotal: 100 }, // 99.999 → noise
        { description: 'b', qty: 1, unit: 'kg', unitPrice: 10, lineTotal: 0.5 }, // undercharged ₪9.50
      ],
    };
    const r = analyzeLeakCheck([inv]);
    expect(r.leakAgorot).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.notes).toContainEqual({ kind: 'undercharge', invoiceIndex: 0, lineIndex: 1, amountAgorot: 950 });
  });

  it('flags a subtotal above Σ lines and a total above subtotal + VAT', () => {
    const inv: LeakCheckInvoice = {
      index: 0, fileName: 'a', fileHash: 'h', supplierName: 'X', supplierBusinessId: null,
      invoiceNumber: '1', invoiceDate: null, subtotal: 110, vat: 19.8, total: 140,
      lines: [{ description: 'a', qty: 1, unit: 'kg', unitPrice: 100, lineTotal: 100 }],
    };
    const r = analyzeLeakCheck([inv]);
    expect(r.findings.map((f) => [f.kind, f.field, f.amountAgorot])).toEqual([
      ['total_arithmetic', 'total', 1020],
      ['total_arithmetic', 'subtotal', 1000],
    ]);
  });

  it('price creep compares the same supplier only', () => {
    const [a, b] = sampleInvoices(2);
    const other = { ...b!, supplierBusinessId: '599999999', supplierName: 'אחר' };
    const r = analyzeLeakCheck([a!, other]);
    expect(r.findings.filter((f) => f.kind === 'price_creep')).toEqual([]);
  });
});

describe('security primitives', () => {
  it('proof of work: a solved challenge verifies; tampering, expiry and missing work do not', () => {
    const c = issuePowChallenge(SECRET, { bits: 8 });
    const nonce = solvePow(c.salt, 8);
    expect(verifyPow(SECRET, c.token, nonce, { minBits: 8 })).toEqual({ ok: true, salt: c.salt });
    expect(verifyPow('another-secret-0123456789', c.token, nonce, { minBits: 8 })).toMatchObject({ ok: false, reason: 'signature' });
    const lowered = c.token.replace('.8.', '.1.');
    expect(verifyPow(SECRET, lowered, nonce, { minBits: 1 })).toMatchObject({ ok: false, reason: 'signature' });
    expect(verifyPow(SECRET, c.token, nonce, { minBits: 8, now: Date.now() + 3600_000 })).toMatchObject({ ok: false, reason: 'expired' });
    // a challenge issued below the server's minimum is rejected even if signed
    expect(verifyPow(SECRET, c.token, nonce, { minBits: 16 })).toMatchObject({ ok: false, reason: 'malformed' });
    let bad = 0;
    while (verifyPow(SECRET, c.token, String(bad), { minBits: 8 }).ok) bad++;
    expect(verifyPow(SECRET, c.token, String(bad), { minBits: 8 })).toMatchObject({ ok: false, reason: 'work' });
    expect(verifyPow(SECRET, c.token, 'abc', { minBits: 8 })).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('result links: valid → id; tampered / expired / other-secret / wrong-domain → null', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const t = signResultLink(SECRET, id);
    expect(verifyResultLink(SECRET, t)).toBe(id);
    expect(verifyResultLink(SECRET, t.replace(id, '11111111-2222-4333-8444-555555555556'))).toBeNull();
    expect(verifyResultLink('another-secret-0123456789', t)).toBeNull();
    expect(verifyResultLink(SECRET, signResultLink(SECRET, id, { ttlSec: -10 }))).toBeNull();
    // A PoW token can never be replayed as a result link (domain separation).
    expect(verifyResultLink(SECRET, issuePowChallenge(SECRET).token)).toBeNull();
    expect(verifyResultLink(SECRET, 'x'.repeat(500))).toBeNull();
  });

  it('mime is sniffed from bytes; a renamed executable/HTML is rejected', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 hello world'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00 not an invoice....'))).toBeNull();
  });

  it('validateUploads enforces count, per-file size, total size and type before any spend', () => {
    expect(() => validateUploads({ invoices: [] })).toThrow(LeakCheckError);
    const eleven = Array.from({ length: 11 }, (_, i) => pdf(String(i)));
    expect(() => validateUploads({ invoices: eleven })).toThrow(/too_many_files/);
    const big = { name: 'big.pdf', bytes: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_FILE_BYTES)]) };
    expect(() => validateUploads({ invoices: [big] })).toThrow(/file_too_large/);
    const threeMb = () => ({ name: 'm.pdf', bytes: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3 * 1024 * 1024)]) });
    expect(() => validateUploads({ invoices: [threeMb(), threeMb()] })).toThrow(/body_too_large/);
    expect(() => validateUploads({ invoices: [{ name: 'x.pdf', bytes: Buffer.from('<svg onload=alert(1)>....') }] })).toThrow(/bad_file_type/);
  });

  it('gates: public only with LEAK_CHECK_PUBLIC=1 and not killed; sample OCR never silently in production', () => {
    expect(leakCheckPublicEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(leakCheckPublicEnabled({ LEAK_CHECK_PUBLIC: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(leakCheckPublicEnabled({ LEAK_CHECK_PUBLIC: '1', FEATURES_OFF: 'all' } as NodeJS.ProcessEnv)).toBe(false);
    expect(leakCheckPublicEnabled({ LEAK_CHECK_PUBLIC: '1', FEATURES_OFF: 'recipes,leakCheck' } as NodeJS.ProcessEnv)).toBe(false);
    expect(leakCheckOcrMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('stub');
    expect(leakCheckOcrMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(leakCheckOcrMode({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBeNull();
    expect(leakCheckOcrMode({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k', LEAK_CHECK_REAL_OCR: '1' } as NodeJS.ProcessEnv)).toBe('claude');
    expect(leakCheckOcrMode({ NODE_ENV: 'production', LEAK_CHECK_ALLOW_SAMPLE: '1' } as NodeJS.ProcessEnv)).toBe('stub');
  });
});

describe('sandbox store (DB)', () => {
  const url = testDbUrl();
  const db = createDb(url);
  const deps = { mode: 'stub' as const, secret: SECRET, dailyOcrBudget: 10_000 };
  const req = { email: 'p@test.local', locale: 'en' as const, ip: '198.51.100.7' };

  beforeAll(async () => {
    await db.delete(leakCheckOcrUsage);
  });
  afterAll(async () => {
    await db.delete(leakCheckOcrUsage);
  });

  it('runs end to end on the sample OCR: result readable by its signed link only', async () => {
    const out = await runLeakCheck(db, { ...req, invoices: ['a', 'b', 'c', 'd'].map(pdf) }, deps);
    expect(out.report.leakAgorot).toBe(3778);
    const id = verifyResultLink(SECRET, out.token)!;
    expect(id).toBe(out.sessionId);
    const view = (await getLeakCheckSession(db, id))!;
    expect(view.report.leakAgorot).toBe(3778);
    expect(view.ocrMode).toBe('stub');
    expect(view.invoices).toHaveLength(4);
    // The raw IP is never stored.
    const [row] = await db.select().from(leakCheckSessions).where(eq(leakCheckSessions.id, id));
    expect(row!.ipHash).not.toContain('198.51.100.7');
    expect(row!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('the same bytes twice map to the same sample (a note), not a duplicate leak', async () => {
    const out = await runLeakCheck(db, { ...req, invoices: [pdf('same'), pdf('same')] }, deps);
    expect(out.report.leakAgorot).toBe(0);
    expect(out.report.notes[0]).toMatchObject({ kind: 'same_file_twice' });
  });

  it('the daily OCR budget is atomic and refuses the check once exhausted', async () => {
    await db.delete(leakCheckOcrUsage);
    expect(await reserveOcrBudget(db, 3, 5)).toBe(true);
    expect(await reserveOcrBudget(db, 3, 5)).toBe(false);
    expect(await reserveOcrBudget(db, 2, 5)).toBe(true);
    const [u] = await db.select().from(leakCheckOcrUsage);
    expect(u!.calls).toBe(5);
    await expect(runLeakCheck(db, { ...req, invoices: [pdf('z')] }, { ...deps, dailyOcrBudget: 5 })).rejects.toThrow(
      /budget_exhausted/,
    );
  });

  it('expired sessions are purged and unreadable', async () => {
    const out = await runLeakCheck(db, { ...req, invoices: [pdf('old')] }, deps);
    await db.execute(sql`update leak_check_sessions
      set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = ${out.sessionId}`);
    expect(await getLeakCheckSession(db, out.sessionId)).toBeNull();
    expect(await purgeExpiredLeakChecks(db)).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(leakCheckSessions).where(eq(leakCheckSessions.id, out.sessionId));
    expect(rows).toEqual([]);
  });

  it('a retention longer than 7 days is rejected by the table itself', async () => {
    const out = await runLeakCheck(db, { ...req, invoices: [pdf('ttl')] }, deps);
    await expect(
      db.execute(sql`update leak_check_sessions set expires_at = created_at + interval '30 days' where id = ${out.sessionId}`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('the tenant app role (RLS) sees and writes ZERO sandbox rows', async () => {
    await runLeakCheck(db, { ...req, invoices: [pdf('rls')] }, deps);
    const appUrl = await ensureRlsAppRole(url);
    const appDb = createDb(appUrl);
    const seen = await appDb.select().from(leakCheckSessions).catch((e: { code?: string }) => e);
    // Either no privilege at all, or RLS with no policy ⇒ zero rows.
    if (Array.isArray(seen)) expect(seen).toEqual([]);
    else expect((seen as { code?: string }).code).toBe('42501');
    await expect(
      appDb.insert(leakCheckSessions).values({ email: 'x@y.z', ipHash: 'h', ocrMode: 'stub', invoiceCount: 1 }),
    ).rejects.toBeTruthy();
    const usage = await appDb.select().from(leakCheckOcrUsage).catch(() => []);
    expect(usage).toEqual([]);
  });
});
