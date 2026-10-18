import {
  MetaCloudWhatsAppProvider,
  ResendInboundProvider,
  StubIngestProvider,
  UnavailableIngestProvider,
  type IngestProvider,
} from './providers';
import type { IngestKind } from './tokens';

/**
 * Ingest configuration from the environment.
 *
 * FAIL CLOSED: in production a channel without its signing secret is DISABLED
 * (the webhook answers 503 and stores nothing). Outside production a fixed dev
 * secret keeps local demos and tests working with the stub provider.
 *
 * Live providers are used only when INGEST_PROVIDER=live AND the provider
 * credential is set; otherwise the deterministic stub fetches attachments.
 */
export const DEV_WHATSAPP_APP_SECRET = 'dev-whatsapp-app-secret';
export const DEV_WHATSAPP_VERIFY_TOKEN = 'dev-whatsapp-verify-token';
/** whsec_ + base64("dev-email-webhook-secret") */
export const DEV_EMAIL_WEBHOOK_SECRET = `whsec_${Buffer.from('dev-email-webhook-secret').toString('base64')}`;

export interface IngestChannelConfig {
  kind: IngestKind;
  /** null ⇒ the channel is disabled (production without a secret). */
  secret: string | null;
  /** WhatsApp GET-handshake verify token (Meta "Verify token"). */
  verifyToken: string | null;
  /** Inbound e-mail domain the token addresses live on (e.g. in.restomatch.co.il). */
  emailDomain: string | null;
  provider: IngestProvider;
  /** WhatsApp: events are accepted only on a channel bound to its phone_number_id (production). */
  requirePhoneNumberId: boolean;
}

export function ingestConfig(kind: IngestKind, env: NodeJS.ProcessEnv = process.env): IngestChannelConfig {
  const prod = env.NODE_ENV === 'production';
  const live = env.INGEST_PROVIDER === 'live';
  if (kind === 'whatsapp') {
    const secret = env.WHATSAPP_APP_SECRET || (prod ? null : DEV_WHATSAPP_APP_SECRET);
    const verifyToken = env.WHATSAPP_VERIFY_TOKEN || (prod ? null : DEV_WHATSAPP_VERIFY_TOKEN);
    // Production never fetches fake bytes: no live credentials ⇒ media fetch fails.
    const provider =
      live && env.WHATSAPP_ACCESS_TOKEN
        ? new MetaCloudWhatsAppProvider(env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_GRAPH_VERSION || 'v21.0')
        : prod
          ? new UnavailableIngestProvider('whatsapp')
          : new StubIngestProvider('whatsapp');
    return { kind, secret, verifyToken, emailDomain: null, provider, requirePhoneNumberId: prod };
  }
  const emailDomain = env.INGEST_EMAIL_DOMAIN || null;
  // Production also needs the inbound domain, or a token on ANY domain would route.
  const secret = prod && !emailDomain ? null : env.INGEST_EMAIL_WEBHOOK_SECRET || (prod ? null : DEV_EMAIL_WEBHOOK_SECRET);
  const provider =
    live && env.INGEST_RESEND_API_KEY
      ? new ResendInboundProvider(env.INGEST_RESEND_API_KEY)
      : prod
        ? new UnavailableIngestProvider('email')
        : new StubIngestProvider('email');
  return { kind, secret, verifyToken: null, emailDomain, provider, requirePhoneNumberId: false };
}

/** Public, display-only: the address/URL an owner configures (token appended). */
export function ingestEmailAddress(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${token}@${env.INGEST_EMAIL_DOMAIN || 'in.restomatch.local'}`;
}

export function ingestWhatsAppWebhookUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_URL ?? env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/api/ingest/whatsapp/${token}`;
}
