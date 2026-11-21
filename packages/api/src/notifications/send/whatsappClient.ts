/**
 * Minimal WhatsApp Cloud API client for the send path: text (inside the 24 h
 * window only) and template messages. `fetch` is injectable so every test is
 * hermetic; no test ever reaches graph.facebook.com.
 */
import type { WaTemplateRequest } from './waTemplates';
import { buildTemplateMessage, waRecipient } from './waTemplates';

export interface WhatsAppClientConfig {
  phoneNumberId: string;
  accessToken: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

export interface WhatsAppSender {
  sendText(to: string, body: string): Promise<string | undefined>;
  sendTemplate(to: string, req: WaTemplateRequest): Promise<string | undefined>;
}

export function makeWhatsAppClient(config: WhatsAppClientConfig): WhatsAppSender {
  const apiBase = config.apiBase ?? 'https://graph.facebook.com/v20.0';
  const doFetch = config.fetch ?? fetch;

  async function post(body: unknown): Promise<string | undefined> {
    const res = await doFetch(`${apiBase}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WhatsApp ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }> };
    return data.messages?.[0]?.id;
  }

  return {
    sendText: (to, body) =>
      post({ messaging_product: 'whatsapp', to: waRecipient(to), type: 'text', text: { body } }),
    sendTemplate: (to, req) => post(buildTemplateMessage(to, req)),
  };
}
