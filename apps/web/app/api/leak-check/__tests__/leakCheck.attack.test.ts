import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, leads, leakCheckOcrUsage, leakCheckSessions, testDbUrl } from '@restomatch/db';
import { leakCheck as lc } from '@restomatch/api';
import { handleChallenge, handleLead, handleSubmit } from '@/lib/leakCheck/handlers';

/**
 * LEAK-CHECK PUBLIC-ROUTE ATTACK SUITE (S15 wave 1).
 *
 * Drives the three public handlers the way an attacker would: with the gate
 * off, cross-origin, without / with a replayed proof of work, past the rate
 * limits, with a honeypot, with non-invoice bytes and oversize bodies, with
 * forged result links, and against the daily Claude budget. The in-memory
 * rate-limit store is per process, so each test uses its own client IP.
 */
const db = createDb(testDbUrl());
const ORIGIN = 'http://localhost:3000';
let ipSeq = 10;
const nextIp = () => `198.51.100.${ipSeq++}`;

function post(path: string, body: BodyInit | null, ip: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    body,
    headers: { origin: ORIGIN, host: 'localhost:3000', 'x-forwarded-for': ip, ...headers },
  });
}

async function solvedChallenge(ip: string) {
  const res = await handleChallenge(post('/api/leak-check/challenge', null, ip));
  expect(res.status).toBe(200);
  const c = (await res.json()) as { token: string; salt: string; bits: number };
  return { token: c.token, nonce: lc.solvePow(c.salt, c.bits) };
}

const pdfFile = (tag: string) => new File([`%PDF-1.4 attack ${tag}`], `${tag}.pdf`, { type: 'application/pdf' });

async function submitForm(
  ip: string,
  opts: { email?: string; files?: File[]; pow?: { token: string; nonce: string }; honeypot?: string } = {},
) {
  const pow = opts.pow ?? (await solvedChallenge(ip));
  const fd = new FormData();
  fd.set('email', opts.email ?? `p${ipSeq}@test.local`);
  fd.set('powToken', pow.token);
  fd.set('powNonce', pow.nonce);
  if (opts.honeypot) fd.set('website', opts.honeypot);
  for (const f of opts.files ?? [pdfFile('a'), pdfFile('b')]) fd.append('invoices', f);
  return handleSubmit(post('/api/leak-check/submit', fd, ip));
}

beforeAll(async () => {
  process.env.LEAK_CHECK_PUBLIC = '1';
  delete process.env.FEATURES_OFF;
  await db.delete(leakCheckOcrUsage);
});

beforeEach(() => {
  process.env.LEAK_CHECK_PUBLIC = '1';
  delete process.env.LEAK_CHECK_DAILY_OCR_CALLS;
});

afterAll(async () => {
  await db.delete(leakCheckOcrUsage);
  await db.delete(leads).where(eq(leads.source, 'leak-check'));
});

describe('leak-check public routes — attack suite', () => {
  it('every route is 404 when the gate is off or the kill-switch is on', async () => {
    for (const env of [{ LEAK_CHECK_PUBLIC: '0' }, { LEAK_CHECK_PUBLIC: '1', FEATURES_OFF: 'leakCheck' }]) {
      Object.assign(process.env, env);
      const ip = nextIp();
      expect((await handleChallenge(post('/api/leak-check/challenge', null, ip))).status).toBe(404);
      expect((await handleSubmit(post('/api/leak-check/submit', new FormData(), ip))).status).toBe(404);
      expect((await handleLead(post('/api/leak-check/lead', '{}', ip))).status).toBe(404);
      delete process.env.FEATURES_OFF;
    }
  });

  it('a cross-origin or origin-less POST is refused (CSRF / third-party driving)', async () => {
    const ip = nextIp();
    const evil = await handleChallenge(post('/api/leak-check/challenge', null, ip, { origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/leak-check/challenge`, { method: 'POST', headers: { host: 'localhost:3000' } });
    expect((await handleChallenge(noOrigin)).status).toBe(403);
  });

  it('submit without a valid proof of work is refused; a solved one works exactly once', async () => {
    const ip = nextIp();
    const forged = await submitForm(ip, { pow: { token: 'a.16.9999999999.b', nonce: '1' } });
    expect(forged.status).toBe(403);
    const pow = await solvedChallenge(ip);
    const ok = await submitForm(ip, { pow });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; token: string };
    expect(lc.verifyResultLink(lc.leakCheckSecret(), body.token)).toMatch(/^[0-9a-f-]{36}$/);
    const replay = await submitForm(nextIp(), { pow });
    expect(replay.status).toBe(403);
  });

  it('a filled honeypot silently succeeds and stores nothing', async () => {
    const before = (await db.select().from(leakCheckSessions)).length;
    const res = await submitForm(nextIp(), { honeypot: 'https://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, token: null });
    expect((await db.select().from(leakCheckSessions)).length).toBe(before);
  });

  it('non-invoice bytes, too many files and oversize bodies are refused before any OCR', async () => {
    const html = new File(['<html><script>alert(1)</script></html>'], 'invoice.pdf', { type: 'application/pdf' });
    expect((await submitForm(nextIp(), { files: [html] })).status).toBe(415);
    const eleven = Array.from({ length: 11 }, (_, i) => pdfFile(`f${i}`));
    expect((await submitForm(nextIp(), { files: eleven })).status).toBe(400);
    const huge = await handleSubmit(
      post('/api/leak-check/submit', new FormData(), nextIp(), { 'content-length': String(50 * 1024 * 1024) }),
    );
    expect(huge.status).toBe(413);
    const bigFile = new File([new Uint8Array(lc.MAX_FILE_BYTES + 10)], 'big.pdf');
    expect((await submitForm(nextIp(), { files: [bigFile] })).status).toBe(413);
  });

  it('per-IP limit: the 6th submission from one IP in a day is 429', async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      expect((await submitForm(ip, { email: `ip${i}@test.local` })).status).toBe(200);
    }
    expect((await submitForm(ip, { email: 'ip6@test.local' })).status).toBe(429);
  });

  it('per-email limit collapses +tag aliases: the 4th check for one mailbox is 429', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await submitForm(nextIp(), { email: `same+${i}@test.local` })).status).toBe(200);
    }
    expect((await submitForm(nextIp(), { email: 'Same+x@test.local' })).status).toBe(429);
  });

  it('the daily OCR (Claude) budget refuses the check with 503 once spent', async () => {
    process.env.LEAK_CHECK_DAILY_OCR_CALLS = '0';
    expect((await submitForm(nextIp())).status).toBe(503);
  });

  it('book-a-demo: forged links are refused; a valid link creates ONE lead, never more', async () => {
    const ip = nextIp();
    const forged = await handleLead(post('/api/leak-check/lead', JSON.stringify({ token: 'x.y.z' }), ip));
    expect(forged.status).toBe(400);
    const email = `lead${ipSeq}@test.local`;
    const res = await submitForm(nextIp(), { email });
    const { token } = (await res.json()) as { token: string };
    for (let i = 0; i < 2; i++) {
      const r = await handleLead(post('/api/leak-check/lead', JSON.stringify({ token, phone: '050-0000000' }), ip));
      expect(r.status).toBe(200);
    }
    const rows = await db.select().from(leads).where(eq(leads.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'leak-check', phone: '050-0000000' });
  });

  it('responses never carry another prospect’s data — only a link to one’s own session', async () => {
    const res = await submitForm(nextIp());
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['ok', 'token']);
  });
});
