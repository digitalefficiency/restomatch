/**
 * The provider set the send path delivers through. Every slot is null until
 * its Phase-6 credentials exist; a null slot means "no provider" and the row
 * is parked `failed + skipped_no_provider` — never reported as `sent`. Unlike
 * the legacy `Mock*Notifier`s there is no mock that pretends to deliver.
 */
import { makeResendDispatcher } from '../resend';
import type { NotificationPayload } from '../types';
import { vapidConfig, type PushProvider, type PushSubscriptionRecord, type VapidEnv } from './webPush';
import { makeWhatsAppClient, type WhatsAppSender } from './whatsappClient';

export interface DeliveryEnv extends VapidEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  EMAIL_FROM?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_API_BASE?: string;
}

export type EmailSender = (payload: NotificationPayload) => Promise<{ externalId?: string }>;

export interface PushSlot {
  provider: PushProvider;
  /** Resolve an outbox `target` (G-06 PushSubscriptionId) to the stored subscription, inside one restaurant. */
  resolveSubscription(restaurantId: string, target: string): Promise<PushSubscriptionRecord | null>;
}

export interface DeliveryProviders {
  email: EmailSender | null;
  whatsapp: WhatsAppSender | null;
  push: PushSlot | null;
}

export interface ProviderOverrides {
  fetch?: typeof fetch;
  /** The real Web Push provider (needs the `web-push` dependency, W3-03's lane). */
  pushProvider?: PushProvider;
  /** Subscription lookup (needs the H-03/H-04 table). */
  resolvePushSubscription?: PushSlot['resolveSubscription'];
}

/** Resolve providers from the environment. With no keys every slot is null. */
export function providersFromEnv(
  env: DeliveryEnv = process.env as DeliveryEnv,
  overrides: ProviderOverrides = {},
): DeliveryProviders {
  const email: EmailSender | null = env.RESEND_API_KEY
    ? makeResendDispatcher({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM ?? env.EMAIL_FROM })
    : null;

  const whatsapp =
    env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN
      ? makeWhatsAppClient({
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
          apiBase: env.WHATSAPP_API_BASE,
          fetch: overrides.fetch,
        })
      : null;

  // Push needs all three: VAPID keys, a provider implementation and the subscription store.
  const push =
    vapidConfig(env) && overrides.pushProvider && overrides.resolvePushSubscription
      ? { provider: overrides.pushProvider, resolveSubscription: overrides.resolvePushSubscription }
      : null;

  return { email, whatsapp, push };
}

/** Which channels can actually deliver right now (ops / admin status). */
export function deliveryReadiness(p: DeliveryProviders): Record<'email' | 'whatsapp' | 'push', boolean> {
  return { email: p.email !== null, whatsapp: p.whatsapp !== null, push: p.push !== null };
}
