import { describe, expect, it } from 'vitest';
import {
  authVerdictFromHeaders,
  tokensFromRecipients,
  AttachmentTooLargeError,
  DEV_EMAIL_WEBHOOK_SECRET,
  INGEST_LIMITS,
  MetaCloudWhatsAppProvider,
  StubIngestProvider,
  generateIngestToken,
  hashIngestToken,
  ingestConfig,
  normalizeEmailAddress,
  normalizePhone,
  parseInboundEmail,
  parseIngestToken,
  parseWhatsAppWebhook,
  readLimited,
  signMeta,
  signStandardWebhook,
  sniffMime,
  stubDocumentBytes,
  tokenFromRecipients,
  verifyMetaSignature,
  verifyStandardWebhook,
} from '../index';

describe('tokens', () => {
  it('are 128-bit random, prefixed by kind, and hashed canonically', () => {
    const a = generateIngestToken('whatsapp');
    const b = generateIngestToken('whatsapp');
    expect(a).toMatch(/^wa_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(generateIngestToken('email')).toMatch(/^inv_[0-9a-f]{32}$/);
    expect(hashIngestToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIngestToken(a.toUpperCase())).toBe(hashIngestToken(a));
  });

  it('rejects malformed tokens', () => {
    expect(parseIngestToken('wa_123')).toBeNull();
    expect(parseIngestToken('xx_' + 'a'.repeat(32))).toBeNull();
    expect(parseIngestToken('../wa_' + 'a'.repeat(32))).toBeNull();
    expect(parseIngestToken('WA_' + 'A'.repeat(32))).toEqual({ kind: 'whatsapp', token: 'wa_' + 'a'.repeat(32) });
  });
});

describe('Meta X-Hub-Signature-256', () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  it('accepts the exact body and rejects any change', () => {
    const sig = signMeta(body, 's3cret');
    expect(verifyMetaSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyMetaSignature(body + ' ', sig, 's3cret')).toBe(false);
    expect(verifyMetaSignature(body, sig, 'other')).toBe(false);
    expect(verifyMetaSignature(body, null, 's3cret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', 's3cret')).toBe(false);
    expect(verifyMetaSignature(body, sig, '')).toBe(false);
  });
});

describe('Standard Webhooks (Resend/Svix)', () => {
  const body = '{"type":"email.received"}';
  const now = 1_800_000_000;
  const sig = signStandardWebhook({ id: 'msg_1', timestampSec: now, body, secret: DEV_EMAIL_WEBHOOK_SECRET });

  it('verifies id.timestamp.body with the base64 key', () => {
    expect(
      verifyStandardWebhook({ id: 'msg_1', timestamp: String(now), signature: sig, body, secret: DEV_EMAIL_WEBHOOK_SECRET, nowSec: now }),
    ).toEqual({ ok: true, id: 'msg_1', timestampSec: now });
  });

  it('accepts a rotated list containing one valid v1 entry', () => {
    const list = `v1,AAAA ${sig}`;
    expect(
      verifyStandardWebhook({ id: 'msg_1', timestamp: String(now), signature: list, body, secret: DEV_EMAIL_WEBHOOK_SECRET, nowSec: now }).ok,
    ).toBe(true);
  });

  it('rejects forged, re-targeted, stale and header-less deliveries', () => {
    const base = { id: 'msg_1', timestamp: String(now), signature: sig, body, secret: DEV_EMAIL_WEBHOOK_SECRET, nowSec: now };
    expect(verifyStandardWebhook({ ...base, body: body + 'x' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyStandardWebhook({ ...base, id: 'msg_2' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyStandardWebhook({ ...base, nowSec: now + 301 })).toMatchObject({ ok: false, reason: 'stale' });
    expect(verifyStandardWebhook({ ...base, timestamp: 'abc' })).toMatchObject({ ok: false, reason: 'bad_timestamp' });
    expect(verifyStandardWebhook({ ...base, signature: null })).toMatchObject({ ok: false, reason: 'missing_headers' });
    expect(verifyStandardWebhook({ ...base, secret: 'whsec_' + Buffer.from('x').toString('base64') })).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('sniffMime', () => {
  it('trusts bytes, not the declared type', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(stubDocumentBytes('x'))).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('<html><script>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00'))).toBeNull();
  });
});

describe('senders', () => {
  it('normalises e-mail and phone the same way on both sides', () => {
    expect(normalizeEmailAddress('"Tnuva" <Billing@Tnuva.CO.IL>')).toBe('billing@tnuva.co.il');
    expect(normalizeEmailAddress('not an address')).toBeNull();
    // Refuter #1: a fake <address> inside the display name must not win.
    expect(normalizeEmailAddress('"<bills@supplier-a.co.il>" <attacker@evil.example>')).toBe('attacker@evil.example');
    expect(normalizePhone('050-123-4567')).toBe('972501234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('972501234567');
    expect(normalizePhone('972501234567')).toBe('972501234567');
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('parseWhatsAppWebhook', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '97230000000', phone_number_id: 'PNID' },
              messages: [
                {
                  from: '972501234567',
                  id: 'wamid.AAA',
                  timestamp: '1800000000',
                  type: 'document',
                  document: { id: 'MEDIA1', mime_type: 'application/pdf', filename: 'inv.pdf', caption: 'חשבונית' },
                },
                { from: '972501234567', id: 'wamid.BBB', timestamp: '1800000001', type: 'text', text: { body: 'hi' } },
              ],
            },
          },
          { field: 'statuses', value: {} },
        ],
      },
    ],
  };

  it('extracts messages + media handles and ignores status callbacks', () => {
    const msgs = parseWhatsAppWebhook(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      providerMessageId: 'wamid.AAA',
      sender: '972501234567',
      phoneNumberId: 'PNID',
      subject: 'חשבונית',
      attachments: [{ providerRef: 'MEDIA1', declaredMime: 'application/pdf', filename: 'inv.pdf' }],
    });
    expect(msgs[1]!.attachments).toEqual([]);
  });

  it('rejects a message without a timestamp (no replay-window bypass)', () => {
    const noTs = JSON.parse(JSON.stringify(payload));
    delete noTs.entry[0].changes[0].value.messages[0].timestamp;
    expect(() => parseWhatsAppWebhook(noTs)).toThrow();
  });

  it('rejects a non-WhatsApp body', () => {
    expect(() => parseWhatsAppWebhook({ object: 'page', entry: [] })).toThrow();
  });
});

describe('parseInboundEmail + tokenFromRecipients', () => {
  const token = 'inv_' + 'b'.repeat(32);

  it('reads the Resend email.received shape', () => {
    const e = parseInboundEmail({
      type: 'email.received',
      data: {
        email_id: 'em_1',
        from: 'Supplier <bills@supplier.co.il>',
        to: [`${token}@in.example.com`],
        subject: 'Invoice 42',
        attachments: [{ id: 'att_1', filename: 'a.pdf', content_type: 'application/pdf', size: 1000 }],
      },
    });
    expect(e).toMatchObject({ providerMessageId: 'em_1', subject: 'Invoice 42' });
    expect(e.attachments[0]).toMatchObject({ providerRef: 'att_1', declaredSize: 1000 });
    expect(tokenFromRecipients(e.recipients, 'in.example.com')).toBe(token);
    expect(tokenFromRecipients(e.recipients, 'other.example.com')).toBeNull();
  });

  it('reads the Postmark inbound shape with inline content and plus-addressing', () => {
    const e = parseInboundEmail({
      MessageID: 'pm-1',
      From: 'bills@supplier.co.il',
      ToFull: [{ Email: `invoices+${token.toUpperCase()}@in.example.com` }],
      Subject: 'x',
      Attachments: [{ Name: 'a.pdf', Content: Buffer.from('%PDF-1.4').toString('base64'), ContentType: 'application/pdf' }],
    });
    expect(e.attachments[0]!.contentBase64).toBeTruthy();
    expect(tokenFromRecipients(e.recipients)).toBe(token);
  });

  it('returns every restaurant token among the recipients', () => {
    const t2 = 'inv_' + 'd'.repeat(32);
    expect(tokensFromRecipients([`${token}@in.x`, `${t2}@in.x`, `${token}@in.x`])).toEqual([token, t2]);
  });

  it('never accepts a WhatsApp token (or garbage) as an e-mail address token', () => {
    expect(tokenFromRecipients([`wa_${'c'.repeat(32)}@in.example.com`])).toBeNull();
    expect(tokenFromRecipients(['restaurant-1@in.example.com'])).toBeNull();
  });
});

describe('providers', () => {
  it('stub is deterministic and offline', async () => {
    const p = new StubIngestProvider('whatsapp');
    const a = await p.fetchAttachment({ providerMessageId: 'm', ref: 'MEDIA1' });
    const b = await p.fetchAttachment({ providerMessageId: 'm', ref: 'MEDIA1' });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    p.register('BIG', { bytes: new Uint8Array(INGEST_LIMITS.attachmentBytes + 1), mimeType: 'image/png' });
    await expect(p.fetchAttachment({ providerMessageId: 'm', ref: 'BIG' })).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  it('readLimited aborts past the cap', async () => {
    await expect(readLimited(new Response(new Uint8Array(11)), 10)).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect((await readLimited(new Response(new Uint8Array(10)), 10)).byteLength).toBe(10);
  });

  it('Meta provider refuses a non-Meta media URL (no SSRF) — mocked fetch', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ url: 'http://169.254.169.254/latest', mime_type: 'image/png' }));
    }) as unknown as typeof fetch;
    const p = new MetaCloudWhatsAppProvider('token', 'v21.0', fake);
    await expect(p.fetchAttachment({ providerMessageId: 'm', ref: 'MEDIA1' })).rejects.toThrow(/unexpected media url/);
    expect(calls).toEqual(['https://graph.facebook.com/v21.0/MEDIA1']);
    await expect(p.fetchAttachment({ providerMessageId: 'm', ref: '../me' })).rejects.toThrow(/invalid media id/);
  });

  it('Meta provider downloads from the CDN with the bearer token — mocked fetch', async () => {
    const png = stubDocumentBytes('cdn');
    const fake = (async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
      if (String(url).startsWith('https://graph.facebook.com/')) {
        return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/png' }));
      }
      return new Response(png);
    }) as unknown as typeof fetch;
    const got = await new MetaCloudWhatsAppProvider('token', 'v21.0', fake).fetchAttachment({ providerMessageId: 'm', ref: 'MEDIA1' });
    expect(Buffer.from(got.bytes).equals(Buffer.from(png))).toBe(true);
  });
});

describe('ingestConfig', () => {
  it('production never falls back to stub bytes, binds WhatsApp numbers and needs the e-mail domain', () => {
    const wa = ingestConfig('whatsapp', { NODE_ENV: 'production', WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v' });
    expect(wa.provider.name).toBe('unavailable');
    expect(wa.requirePhoneNumberId).toBe(true);
    expect(ingestConfig('email', { NODE_ENV: 'production', INGEST_EMAIL_WEBHOOK_SECRET: 'whsec_eA==' }).secret).toBeNull();
    const em = ingestConfig('email', { NODE_ENV: 'production', INGEST_EMAIL_WEBHOOK_SECRET: 'whsec_eA==', INGEST_EMAIL_DOMAIN: 'in.x.co' });
    expect(em.secret).toBeTruthy();
    expect(em.provider.name).toBe('unavailable');
  });

  it('fails closed in production without secrets and uses the stub unless live', () => {
    const prod = ingestConfig('whatsapp', { NODE_ENV: 'production' });
    expect(prod.secret).toBeNull();
    expect(prod.verifyToken).toBeNull();
    expect(ingestConfig('email', { NODE_ENV: 'production' }).secret).toBeNull();
    expect(ingestConfig('whatsapp', { NODE_ENV: 'test' }).secret).toBeTruthy();
    expect(ingestConfig('whatsapp', { NODE_ENV: 'production', WHATSAPP_APP_SECRET: 's', WHATSAPP_ACCESS_TOKEN: 't' }).provider.name).toBe('unavailable');
    expect(ingestConfig('whatsapp', { NODE_ENV: 'test' }).provider.name).toBe('stub');
    expect(
      ingestConfig('whatsapp', { NODE_ENV: 'production', WHATSAPP_APP_SECRET: 's', WHATSAPP_ACCESS_TOKEN: 't', INGEST_PROVIDER: 'live' }).provider.name,
    ).toBe('meta-cloud');
  });
});

describe('authVerdictFromHeaders (S4 I2)', () => {
  const h = (value: string) => [{ name: 'Authentication-Results', value }];
  it('trusts ONLY our authserv-id and ONLY an aligned dmarc=pass', () => {
    expect(authVerdictFromHeaders(h('mx.ours; spf=pass; dkim=pass; dmarc=pass header.from=s.co.il'), 'mx.ours')).toBe('pass');
    expect(authVerdictFromHeaders(h('MX.Ours ;  dmarc = pass'), 'mx.ours')).toBe('pass');
    expect(authVerdictFromHeaders(h('mx.ours; dmarc=fail header.from=s.co.il'), 'mx.ours')).toBe('fail');
  });
  it('refuter #2: spf+dkim pass for the ATTACKER domain without DMARC is not trusted', () => {
    expect(
      authVerdictFromHeaders(
        h('mx.ours; dkim=pass header.d=evil.example; spf=pass smtp.mailfrom=evil.example; dmarc=none header.from=s.co.il'),
        'mx.ours',
      ),
    ).toBe('none');
  });
  it('refuter #1: a "dmarc=pass" inside a property value, comment or quoted string never counts', () => {
    for (const v of [
      'mx.ours; spf=pass smtp.mailfrom=dmarc=pass@evil.example; dkim=none; dmarc=fail header.from=s.co.il',
      'mx.ours; spf=pass (domain of dmarc=pass@evil.example designates 1.2.3.4) smtp.mailfrom=evil.example; dmarc=fail (p=reject) header.from=s.co.il',
      'mx.ours; spf=pass smtp.mailfrom="x; dmarc=pass"@evil.example; dmarc=fail',
      'mx.ours; spf=pass (nested (dmarc=pass) comment; dmarc=pass) smtp.mailfrom=evil.example',
      'mx.ours; dmarc=passing',
    ]) {
      expect(authVerdictFromHeaders(h(v), 'mx.ours')).not.toBe('pass');
    }
  });
  it('a forged header, no configured id, two of ours, or two dmarc results → none', () => {
    expect(authVerdictFromHeaders(h('evil.example; dmarc=pass'), 'mx.ours')).toBe('none');
    expect(authVerdictFromHeaders(h('mx.ours.evil; dmarc=pass'), 'mx.ours')).toBe('none');
    expect(authVerdictFromHeaders(h('mx.ours; dmarc=pass'), null)).toBe('none');
    expect(authVerdictFromHeaders([...h('mx.ours; dmarc=pass'), ...h('mx.ours; dmarc=pass')], 'mx.ours')).toBe('none');
    expect(authVerdictFromHeaders(h('mx.ours; dmarc=fail; dmarc=pass'), 'mx.ours')).toBe('none');
  });
  it('WhatsApp messages are authenticated by Meta', () => {
    const [m] = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '1', id: 'w', timestamp: '1', type: 'text', text: { body: 'x' } }] } }] }],
    });
    expect(m!.authVerdict).toBe('pass');
  });
});
