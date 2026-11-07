import { describe, expect, it, vi } from 'vitest';
import {
  WA_TEMPLATES,
  WaTemplateError,
  buildTemplateMessage,
  renderTemplatePreview,
  waRecipient,
  waTemplatePayload,
  type WaTemplateRequest,
} from '../waTemplates';
import { makeWhatsAppClient } from '../whatsappClient';

const claimLetter: WaTemplateRequest = {
  name: 'rm_claim_letter',
  params: { contact: 'יוסי', restaurant: 'ציקטי', month: 'אוקטובר 2026', link: 'https://x.test/s/c/abc' },
};

describe('WhatsApp utility templates (H-05)', () => {
  it('registers the three H-05 templates and the two H-05a supplier templates, all utility, all Hebrew', () => {
    expect(Object.keys(WA_TEMPLATES).sort()).toEqual([
      'rm_claim_letter',
      'rm_claim_reminder',
      'rm_claim_reply',
      'rm_decision_needed',
      'rm_delivery_late',
    ]);
    for (const spec of Object.values(WA_TEMPLATES)) {
      expect(spec.category).toBe('UTILITY');
      expect(spec.language).toBe('he');
      const placeholders = spec.bodyHe.match(/\{\{\d+\}\}/g) ?? [];
      expect(placeholders).toEqual(spec.params.map((_, i) => `{{${i + 1}}}`));
    }
  });

  it('supplier-facing bodies use partner wording only (GLOSSARY §1–§2)', () => {
    const banned = ['דרישה', 'דרישת', 'תביעה', 'מחלוקת', 'חוב', 'באיחור', 'מכתב זיכוי '];
    for (const spec of Object.values(WA_TEMPLATES).filter((s) => s.audience === 'supplier')) {
      for (const word of banned) expect(spec.bodyHe).not.toContain(word);
      expect(spec.bodyHe).toContain('בקשת הזיכוי'.slice(0, 4));
      expect(spec.bodyHe).toContain('חשבונית זיכוי');
    }
    expect(WA_TEMPLATES.rm_claim_letter.bodyHe).toContain('מכתב בקשת זיכוי');
    expect(WA_TEMPLATES.rm_claim_reminder.bodyHe).toContain('תזכורת קטנה');
  });

  it('builds the Graph API template body with params in order and E.164 digits', () => {
    expect(buildTemplateMessage('+972501234567', claimLetter)).toEqual({
      messaging_product: 'whatsapp',
      to: '972501234567',
      type: 'template',
      template: {
        name: 'rm_claim_letter',
        language: { code: 'he' },
        components: [
          {
            type: 'body',
            parameters: ['יוסי', 'ציקטי', 'אוקטובר 2026', 'https://x.test/s/c/abc'].map((text) => ({ type: 'text', text })),
          },
        ],
      },
    });
    expect(renderTemplatePreview(claimLetter)).toContain('מכתב בקשת זיכוי מציקטי על פערים בחשבוניות אוקטובר 2026');
  });

  it('rejects unknown templates, missing params and Meta-invalid params (no free-text fallback)', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as WaTemplateError).code;
      }
      return 'none';
    };
    expect(code(() => waTemplatePayload({ name: 'rm_nope' as never, params: {} }))).toBe('UNKNOWN_TEMPLATE');
    expect(code(() => waTemplatePayload({ ...claimLetter, params: { ...claimLetter.params, link: '' } }))).toBe('MISSING_PARAM');
    expect(code(() => waTemplatePayload({ ...claimLetter, params: { ...claimLetter.params, month: 'a\nb' } }))).toBe('BAD_PARAM');
  });

  it('refuses a ₪ parameter for a receiver or chef, allows it for the owner', () => {
    const req: WaTemplateRequest = {
      name: 'rm_decision_needed',
      params: { supplier: 'תנובה', amount: '‏1,234.50 ₪', link: '/dashboard/approvals/1' },
    };
    expect(() => waTemplatePayload({ ...req, recipientRole: 'receiver' })).toThrow(/₪/);
    expect(() => waTemplatePayload({ ...req, recipientRole: 'chef' })).toThrow(WaTemplateError);
    expect(waTemplatePayload({ ...req, recipientRole: 'owner' }).__waTemplate.name).toBe('rm_decision_needed');
  });

  it('never accepts a role: target or a non-E.164 string as a WhatsApp recipient', () => {
    expect(() => waRecipient('role:manager')).toThrow(WaTemplateError);
    expect(() => waRecipient('050-1234567')).toThrow(WaTemplateError);
    expect(waRecipient('972501234567')).toBe('972501234567');
  });

  it('the client posts the template body with the bearer token (mock fetch, no network)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }));
    const client = makeWhatsAppClient({ phoneNumberId: 'PN', accessToken: 'TOKEN', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.sendTemplate('+972501234567', claimLetter)).resolves.toBe('wamid.1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v20.0/PN/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body as string).type).toBe('template');
  });

  it('the client throws on a non-2xx so the dispatcher retries', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = makeWhatsAppClient({ phoneNumberId: 'PN', accessToken: 'T', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.sendText('972501234567', 'hi')).rejects.toThrow(/WhatsApp 429/);
  });
});
