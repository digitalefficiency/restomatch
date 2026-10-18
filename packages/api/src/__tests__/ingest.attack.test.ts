import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  invoices,
  restaurants,
  sql,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import {
  DEV_EMAIL_WEBHOOK_SECRET,
  INGEST_LIMITS,
  StubIngestProvider,
  generateIngestToken,
  hashIngestToken,
  ingestConfig,
  signMeta,
  signStandardWebhook,
  stubDocumentBytes,
  tokenHint,
  type IngestChannelConfig,
} from '@restomatch/ingest';
import {
  handleEmailWebhook,
  handleWhatsAppVerify,
  handleWhatsAppWebhook,
  type IngestHttpDeps,
} from '../ingest/http';
import { checkRateLimit, MemoryRateLimitStore } from '../rateLimit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * PUBLIC WEBHOOK ATTACK SUITE — /api/ingest/** (S13).
 *
 * Drives the framework-free handlers the Next routes wrap, on the
 * RLS-ENFORCED app role (restomatch_app), exactly like production:
 *   forged / missing signature, replay, cross-tenant token, oversized payload,
 *   unknown / wrong-kind / revoked token, disabled feature, stale timestamp,
 *   disguised file types, rate limiting, fail-closed config, tenant id in the
 *   payload ignored, WhatsApp handshake.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
const tokens = { aWa: '', aEmail: '', bWa: '' };
const WA_SECRET = 'test-wa-secret';
const NOW = 1_800_000_000;
let waProvider: StubIngestProvider;

process.env.LOCAL_SCAN_DIR = mkdtempSync(join(tmpdir(), 'ingest-attack-'));

function waConfig(): IngestChannelConfig {
  return { ...ingestConfig('whatsapp', { NODE_ENV: 'test' }), secret: WA_SECRET, verifyToken: 'vt', provider: waProvider };
}
function emailConfig(): IngestChannelConfig {
  return { ...ingestConfig('email', { NODE_ENV: 'test' }), emailDomain: 'in.test' };
}

let store: MemoryRateLimitStore;
function deps(over: Partial<IngestHttpDeps> = {}): IngestHttpDeps {
  return {
    db: appDb,
    rateLimit: (id, opts) => checkRateLimit(store, id, opts),
    clientIp: '203.0.113.7',
    nowSec: NOW,
    ...over,
  };
}

function waBody(opts: { id: string; from?: string; media?: string; phoneNumberId?: string; restaurantId?: string; ts?: number }) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    // An attacker-supplied tenant id in the payload must be ignored.
    restaurant_id: opts.restaurantId,
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: opts.phoneNumberId ?? 'PNID-A' },
              messages: [
                {
                  from: opts.from ?? '972501111111',
                  id: opts.id,
                  timestamp: String(opts.ts ?? NOW - 10),
                  type: 'image',
                  image: { id: opts.media ?? `media-${opts.id}`, mime_type: 'image/jpeg' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function waRequest(token: string, body: string, signature = signMeta(body, WA_SECRET)) {
  return new Request(`http://localhost/api/ingest/whatsapp/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  });
}

function emailBody(opts: { id: string; to: string; from?: string; content?: string }) {
  return JSON.stringify({
    type: 'email.received',
    data: {
      email_id: opts.id,
      from: opts.from ?? 'Bills <bills@supplier-a.co.il>',
      to: [opts.to],
      subject: 'Invoice',
      attachments: [
        {
          filename: 'inv.pdf',
          content_type: 'application/pdf',
          content: opts.content ?? Buffer.from(`%PDF-1.4 ${opts.id}`).toString('base64'),
        },
      ],
    },
  });
}

function emailRequest(body: string, opts: { id?: string; ts?: number; secret?: string } = {}) {
  const id = opts.id ?? 'msg_' + Math.random().toString(36).slice(2);
  const ts = opts.ts ?? NOW;
  return new Request('http://localhost/api/ingest/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': signStandardWebhook({ id, timestampSec: ts, body, secret: opts.secret ?? DEV_EMAIL_WEBHOOK_SECRET }),
    },
    body,
  });
}

async function addChannel(db: Database, restaurantId: string, kind: 'whatsapp' | 'email', phoneNumberId?: string) {
  const token = generateIngestToken(kind);
  await db.insert(ingestChannels).values({
    restaurantId,
    kind,
    tokenHash: hashIngestToken(token),
    tokenHint: tokenHint(token),
    phoneNumberId: phoneNumberId ?? null,
  });
  return token;
}

async function messagesOf(restaurantId: string) {
  return ownerDb.select().from(ingestMessages).where(eq(ingestMessages.restaurantId, restaurantId));
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  for (const t of [A, B]) {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } })
      .where(eq(restaurants.id, t.restaurantId));
  }
  tokens.aWa = await addChannel(ownerDb, A.restaurantId, 'whatsapp', 'PNID-A');
  tokens.aEmail = await addChannel(ownerDb, A.restaurantId, 'email');
  tokens.bWa = await addChannel(ownerDb, B.restaurantId, 'whatsapp');
  // A allow-lists its supplier's WhatsApp number + billing address.
  await ownerDb.insert(ingestSenders).values([
    { restaurantId: A.restaurantId, kind: 'whatsapp', sender: '972501111111', supplierId: A.supplierId },
    { restaurantId: A.restaurantId, kind: 'email', sender: 'bills@supplier-a.co.il', supplierId: A.supplierId },
  ]);
});

beforeEach(() => {
  store = new MemoryRateLimitStore();
  waProvider = new StubIngestProvider('whatsapp');
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('WhatsApp webhook — happy path under RLS', () => {
  it('an allow-listed sender registers an ocr_pending whatsapp invoice in the TOKEN\'s restaurant', async () => {
    const res = await handleWhatsAppWebhook(waRequest(tokens.aWa, waBody({ id: 'wamid.ok1' })), tokens.aWa, deps({ config: waConfig() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ outcome: string }> };
    expect(body.results).toEqual([{ id: 'wamid.ok1', outcome: 'accepted' }]);
    const [doc] = await ownerDb
      .select()
      .from(ingestDocuments)
      .innerJoin(ingestMessages, eq(ingestMessages.id, ingestDocuments.messageId))
      .where(eq(ingestMessages.providerMessageId, 'wamid.ok1'));
    expect(doc!.ingest_documents).toMatchObject({ status: 'registered', mimeType: 'image/png', restaurantId: A.restaurantId });
    expect(doc!.ingest_documents.storagePath!.startsWith(`${A.restaurantId}/`)).toBe(true);
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, doc!.ingest_documents.invoiceId!));
    expect(inv).toMatchObject({ restaurantId: A.restaurantId, supplierId: A.supplierId, source: 'whatsapp', status: 'ocr_pending' });
  });

  it('an unknown sender lands in needs_review: stored, NOT registered (no OCR spend)', async () => {
    const res = await handleWhatsAppWebhook(
      waRequest(tokens.aWa, waBody({ id: 'wamid.unknown1', from: '972509999999' })),
      tokens.aWa,
      deps({ config: waConfig() }),
    );
    expect(res.status).toBe(200);
    const [m] = (await messagesOf(A.restaurantId)).filter((x) => x.providerMessageId === 'wamid.unknown1');
    expect(m).toMatchObject({ status: 'needs_review', senderAllowed: false });
    const docs = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.messageId, m!.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ status: 'needs_review', invoiceId: null });
  });
});

describe('WhatsApp webhook — attacks', () => {
  it('forged signature → 401, nothing stored', async () => {
    const body = waBody({ id: 'wamid.forged' });
    const before = (await messagesOf(A.restaurantId)).length;
    for (const sig of [signMeta(body, 'wrong-secret'), 'sha256=' + '0'.repeat(64), '', 'garbage']) {
      const res = await handleWhatsAppWebhook(waRequest(tokens.aWa, body, sig), tokens.aWa, deps({ config: waConfig() }));
      expect(res.status).toBe(401);
    }
    // A valid signature over a DIFFERENT body does not authorise this one.
    const res = await handleWhatsAppWebhook(
      waRequest(tokens.aWa, body, signMeta(waBody({ id: 'other' }), WA_SECRET)),
      tokens.aWa,
      deps({ config: waConfig() }),
    );
    expect(res.status).toBe(401);
    expect((await messagesOf(A.restaurantId)).length).toBe(before);
  });

  it('replay of a valid delivery is a no-op (one message, one invoice)', async () => {
    const body = waBody({ id: 'wamid.replay' });
    const r1 = await handleWhatsAppWebhook(waRequest(tokens.aWa, body), tokens.aWa, deps({ config: waConfig() }));
    const r2 = await handleWhatsAppWebhook(waRequest(tokens.aWa, body), tokens.aWa, deps({ config: waConfig() }));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { results: Array<{ outcome: string }> }).results[0]!.outcome).toBe('duplicate');
    const rows = (await messagesOf(A.restaurantId)).filter((m) => m.providerMessageId === 'wamid.replay');
    expect(rows).toHaveLength(1);
  });

  it('a message older than 7 days is ignored', async () => {
    const res = await handleWhatsAppWebhook(
      waRequest(tokens.aWa, waBody({ id: 'wamid.old', ts: NOW - 8 * 86400 })),
      tokens.aWa,
      deps({ config: waConfig() }),
    );
    expect(((await res.json()) as { results: Array<{ outcome: string }> }).results[0]!.outcome).toBe('rejected');
    expect((await messagesOf(A.restaurantId)).some((m) => m.providerMessageId === 'wamid.old')).toBe(false);
  });

  it("cross-tenant token: B's token routes to B ONLY — A's restaurant id in the payload is ignored", async () => {
    const body = waBody({ id: 'wamid.cross', restaurantId: A.restaurantId, phoneNumberId: 'PNID-B' });
    const res = await handleWhatsAppWebhook(waRequest(tokens.bWa, body), tokens.bWa, deps({ config: waConfig() }));
    expect(res.status).toBe(200);
    expect((await messagesOf(A.restaurantId)).some((m) => m.providerMessageId === 'wamid.cross')).toBe(false);
    const [inB] = (await messagesOf(B.restaurantId)).filter((m) => m.providerMessageId === 'wamid.cross');
    // A's allow-listed number is NOT allow-listed for B → review, no invoice.
    expect(inB).toMatchObject({ senderAllowed: false, status: 'needs_review' });
    const bInvoices = await ownerDb.select().from(invoices).where(and(eq(invoices.restaurantId, B.restaurantId), eq(invoices.source, 'whatsapp')));
    expect(bInvoices).toHaveLength(0);
  });

  it("a channel bound to a phone_number_id rejects another number's events", async () => {
    const res = await handleWhatsAppWebhook(
      waRequest(tokens.aWa, waBody({ id: 'wamid.othernumber', phoneNumberId: 'PNID-B' })),
      tokens.aWa,
      deps({ config: waConfig() }),
    );
    expect(((await res.json()) as { results: Array<{ outcome: string }> }).results[0]!.outcome).toBe('rejected');
    expect((await messagesOf(A.restaurantId)).some((m) => m.providerMessageId === 'wamid.othernumber')).toBe(false);
  });

  it('unknown, malformed, wrong-kind and revoked tokens → 404 (and a guessable restaurant id is not a token)', async () => {
    const body = waBody({ id: 'wamid.tok' });
    for (const t of [generateIngestToken('whatsapp'), 'not-a-token', A.restaurantId, tokens.aEmail]) {
      const res = await handleWhatsAppWebhook(waRequest(t, body), t, deps({ config: waConfig() }));
      expect(res.status).toBe(404);
    }
    const revoked = await addChannel(ownerDb, B.restaurantId, 'email');
    await ownerDb.update(ingestChannels).set({ active: false }).where(eq(ingestChannels.tokenHash, hashIngestToken(revoked)));
    const eb = emailBody({ id: 'em_revoked', to: `${revoked}@in.test` });
    expect((await handleEmailWebhook(emailRequest(eb), deps({ config: emailConfig() }))).status).toBe(404);
  });

  it('oversized payload → 413 before the signature is even checked', async () => {
    const huge = 'x'.repeat(INGEST_LIMITS.whatsappBodyBytes + 1);
    const res = await handleWhatsAppWebhook(waRequest(tokens.aWa, huge), tokens.aWa, deps({ config: waConfig() }));
    expect(res.status).toBe(413);
    const lying = new Request(`http://localhost/api/ingest/whatsapp/${tokens.aWa}`, {
      method: 'POST',
      headers: { 'content-length': String(INGEST_LIMITS.whatsappBodyBytes + 1) },
      body: '{}',
    });
    expect((await handleWhatsAppWebhook(lying, tokens.aWa, deps({ config: waConfig() }))).status).toBe(413);
  });

  it('oversized media and disguised file types are rejected per document', async () => {
    waProvider.register('big', { bytes: new Uint8Array(INGEST_LIMITS.attachmentBytes + 1), mimeType: 'image/jpeg' });
    waProvider.register('html', { bytes: new Uint8Array(Buffer.from('<html><script>alert(1)</script>')), mimeType: 'image/jpeg' });
    for (const [id, media] of [['wamid.big', 'big'], ['wamid.html', 'html']] as const) {
      const res = await handleWhatsAppWebhook(waRequest(tokens.aWa, waBody({ id, media })), tokens.aWa, deps({ config: waConfig() }));
      expect(res.status).toBe(200);
    }
    const msgs = (await messagesOf(A.restaurantId)).filter((m) => ['wamid.big', 'wamid.html'].includes(m.providerMessageId));
    expect(msgs.map((m) => m.status).sort()).toEqual(['rejected', 'rejected']);
    const docs = await ownerDb
      .select({ error: ingestDocuments.error, storagePath: ingestDocuments.storagePath, invoiceId: ingestDocuments.invoiceId })
      .from(ingestDocuments)
      .innerJoin(ingestMessages, eq(ingestMessages.id, ingestDocuments.messageId))
      .where(sql`${ingestMessages.providerMessageId} in ('wamid.big', 'wamid.html')`);
    expect(docs.map((d) => d.error).sort()).toEqual(['too_large', 'unsupported_type']);
    expect(docs.every((d) => d.storagePath === null && d.invoiceId === null)).toBe(true);
  });

  it('a disabled feature is invisible (404) and stores nothing', async () => {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: false, ingestEmail: true } } })
      .where(eq(restaurants.id, B.restaurantId));
    const res = await handleWhatsAppWebhook(
      waRequest(tokens.bWa, waBody({ id: 'wamid.disabled', phoneNumberId: 'PNID-B' })),
      tokens.bWa,
      deps({ config: waConfig() }),
    );
    expect(res.status).toBe(404);
    expect((await messagesOf(B.restaurantId)).some((m) => m.providerMessageId === 'wamid.disabled')).toBe(false);
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { ingestWhatsapp: true, ingestEmail: true } } })
      .where(eq(restaurants.id, B.restaurantId));
  });

  it('rate limit per IP → 429', async () => {
    let last = 0;
    for (let i = 0; i < 125; i++) {
      last = (await handleWhatsAppWebhook(waRequest(tokens.aWa, '{}', 'bad'), tokens.aWa, deps({ config: waConfig() }))).status;
    }
    expect(last).toBe(429);
  });

  it('fails closed without a secret (production) → 503', async () => {
    const cfg = ingestConfig('whatsapp', { NODE_ENV: 'production' });
    const body = waBody({ id: 'wamid.noconf' });
    expect((await handleWhatsAppWebhook(waRequest(tokens.aWa, body), tokens.aWa, deps({ config: cfg }))).status).toBe(503);
    expect((await handleEmailWebhook(emailRequest('{}'), deps({ config: ingestConfig('email', { NODE_ENV: 'production' }) }))).status).toBe(503);
  });

  it('GET handshake echoes the challenge only for the right verify token AND a live channel', async () => {
    const url = (t: string, vt: string, ch = '12345') =>
      new Request(`http://localhost/api/ingest/whatsapp/${t}?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=${ch}`);
    const ok = await handleWhatsAppVerify(url(tokens.aWa, 'vt'), tokens.aWa, deps({ config: waConfig() }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect((await handleWhatsAppVerify(url(tokens.aWa, 'nope'), tokens.aWa, deps({ config: waConfig() }))).status).toBe(403);
    const unknown = generateIngestToken('whatsapp');
    expect((await handleWhatsAppVerify(url(unknown, 'vt'), unknown, deps({ config: waConfig() }))).status).toBe(403);
    expect(
      (await handleWhatsAppVerify(url(tokens.aWa, 'vt', '<script>'), tokens.aWa, deps({ config: waConfig() }))).status,
    ).toBe(403);
  });
});

describe('E-mail webhook — attacks', () => {
  it('a signed delivery to A\'s address from an allow-listed sender registers an e-mail invoice', async () => {
    const res = await handleEmailWebhook(emailRequest(emailBody({ id: 'em_ok', to: `${tokens.aEmail}@in.test` })), deps({ config: emailConfig() }));
    expect(res.status).toBe(200);
    const [m] = (await messagesOf(A.restaurantId)).filter((x) => x.providerMessageId === 'em_ok');
    expect(m).toMatchObject({ status: 'accepted', senderAllowed: true, supplierId: A.supplierId });
    const [d] = await ownerDb.select().from(ingestDocuments).where(eq(ingestDocuments.messageId, m!.id));
    const [inv] = await ownerDb.select().from(invoices).where(eq(invoices.id, d!.invoiceId!));
    expect(inv).toMatchObject({ source: 'email', restaurantId: A.restaurantId });
  });

  it('forged signature, wrong secret and a stale (replayed later) timestamp → 401', async () => {
    const body = emailBody({ id: 'em_forged', to: `${tokens.aEmail}@in.test` });
    const wrongSecret = `whsec_${Buffer.from('attacker').toString('base64')}`;
    expect((await handleEmailWebhook(emailRequest(body, { secret: wrongSecret }), deps({ config: emailConfig() }))).status).toBe(401);
    expect((await handleEmailWebhook(emailRequest(body, { ts: NOW - 3600 }), deps({ config: emailConfig() }))).status).toBe(401);
    const tampered = emailRequest(body);
    const resigned = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: body.replace('Invoice', 'Invoic3') });
    expect((await handleEmailWebhook(resigned, deps({ config: emailConfig() }))).status).toBe(401);
    expect((await messagesOf(A.restaurantId)).some((m) => m.providerMessageId === 'em_forged')).toBe(false);
  });

  it('replay inside the window (new delivery id, same e-mail) is a no-op', async () => {
    const body = emailBody({ id: 'em_replay', to: `${tokens.aEmail}@in.test` });
    await handleEmailWebhook(emailRequest(body), deps({ config: emailConfig() }));
    const r2 = await handleEmailWebhook(emailRequest(body), deps({ config: emailConfig() }));
    expect(((await r2.json()) as { results: Array<{ outcome: string }> }).results[0]!.outcome).toBe('duplicate');
    expect((await messagesOf(A.restaurantId)).filter((m) => m.providerMessageId === 'em_replay')).toHaveLength(1);
  });

  it('the same document re-sent in a NEW e-mail is linked as duplicate, not re-OCR\'d', async () => {
    const content = Buffer.from('%PDF-1.4 same-bytes').toString('base64');
    await handleEmailWebhook(emailRequest(emailBody({ id: 'em_d1', to: `${tokens.aEmail}@in.test`, content })), deps({ config: emailConfig() }));
    await handleEmailWebhook(emailRequest(emailBody({ id: 'em_d2', to: `${tokens.aEmail}@in.test`, content })), deps({ config: emailConfig() }));
    const docs = await ownerDb
      .select({ status: ingestDocuments.status, invoiceId: ingestDocuments.invoiceId })
      .from(ingestDocuments)
      .innerJoin(ingestMessages, eq(ingestMessages.id, ingestDocuments.messageId))
      .where(sql`${ingestMessages.providerMessageId} in ('em_d1', 'em_d2')`);
    expect(docs.map((d) => d.status).sort()).toEqual(['duplicate', 'registered']);
    expect(docs[0]!.invoiceId).toBe(docs[1]!.invoiceId);
  });

  it('an address on another domain, a WhatsApp token as address, or no token → 404', async () => {
    for (const to of [`${tokens.aEmail}@evil.test`, `${tokens.aWa}@in.test`, 'invoices@in.test']) {
      const res = await handleEmailWebhook(emailRequest(emailBody({ id: `em_${to}`, to })), deps({ config: emailConfig() }));
      expect(res.status).toBe(404);
    }
  });

  it('oversized e-mail body → 413; an oversized inline attachment is rejected', async () => {
    const huge = new Request('http://localhost/api/ingest/email', {
      method: 'POST',
      headers: { 'content-length': String(INGEST_LIMITS.emailBodyBytes + 1) },
      body: '{}',
    });
    expect((await handleEmailWebhook(huge, deps({ config: emailConfig() }))).status).toBe(413);
    const big = Buffer.alloc(INGEST_LIMITS.attachmentBytes + 10, 0x41);
    big.write('%PDF-');
    const res = await handleEmailWebhook(
      emailRequest(emailBody({ id: 'em_bigatt', to: `${tokens.aEmail}@in.test`, content: big.toString('base64') })),
      deps({ config: emailConfig() }),
    );
    expect(res.status).toBe(200);
    const [m] = (await messagesOf(A.restaurantId)).filter((x) => x.providerMessageId === 'em_bigatt');
    expect(m!.status).toBe('rejected');
  });

  it('stub provider bytes are deterministic (same media → same stored object)', () => {
    expect(Buffer.from(stubDocumentBytes('m1')).equals(Buffer.from(stubDocumentBytes('m1')))).toBe(true);
  });
});
