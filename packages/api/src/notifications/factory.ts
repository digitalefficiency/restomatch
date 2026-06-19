/**
 * Notifier factory — env-gated selection of REAL vs MOCK providers.
 *
 * Selection is driven entirely by environment variables so tests stay
 * hermetic: with no keys present (the default in CI/unit tests) every
 * channel resolves to its mock/console notifier and NO real network send
 * can happen. The real providers light up only when their credentials are
 * provisioned in the deployment environment.
 *
 *   Email    -> ResendEmailNotifier   when RESEND_API_KEY is set
 *               (else EmailNotifier in dev/console mode)
 *   WhatsApp -> WhatsAppCloudNotifier  when WHATSAPP_PHONE_NUMBER_ID
 *               AND WHATSAPP_ACCESS_TOKEN are set
 *               (else MockWhatsAppNotifier)
 *   Push     -> MockPushNotifier       (no real provider wired yet)
 */

import { EmailNotifier } from './email';
import { MockPushNotifier } from './push';
import { ResendEmailNotifier } from './resend';
import type { Notifier } from './types';
import { MockWhatsAppNotifier } from './whatsapp';
import { WhatsAppCloudNotifier } from './whatsappCloud';

export interface NotifierFactoryEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_API_BASE?: string;
}

/** True when Resend email credentials are present. */
export function isResendConfigured(env: NotifierFactoryEnv = process.env as NotifierFactoryEnv): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** True when WhatsApp Cloud credentials are present. */
export function isWhatsAppCloudConfigured(env: NotifierFactoryEnv = process.env as NotifierFactoryEnv): boolean {
  return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Email notifier: real Resend when RESEND_API_KEY is set, else the existing
 * dev/console EmailNotifier (writes to outbox + logs, no real send).
 */
export function createEmailNotifier(env: NotifierFactoryEnv = process.env as NotifierFactoryEnv): EmailNotifier {
  if (isResendConfigured(env)) {
    return new ResendEmailNotifier({ apiKey: env.RESEND_API_KEY!, from: env.RESEND_FROM });
  }
  return new EmailNotifier();
}

/**
 * WhatsApp notifier: real WhatsApp Cloud API when phone-number-id + access
 * token are set, else the MockWhatsAppNotifier (writes to outbox + logs).
 */
export function createWhatsAppNotifier(env: NotifierFactoryEnv = process.env as NotifierFactoryEnv): Notifier {
  if (isWhatsAppCloudConfigured(env)) {
    return new WhatsAppCloudNotifier({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: env.WHATSAPP_ACCESS_TOKEN!,
      apiBase: env.WHATSAPP_API_BASE,
    });
  }
  return new MockWhatsAppNotifier();
}

/** Push notifier: mock only (no real provider wired yet). */
export function createPushNotifier(): Notifier {
  return new MockPushNotifier();
}

export interface Notifiers {
  email: EmailNotifier;
  whatsapp: Notifier;
  push: Notifier;
}

/** Resolve all channel notifiers from the environment. */
export function createNotifiers(env: NotifierFactoryEnv = process.env as NotifierFactoryEnv): Notifiers {
  return {
    email: createEmailNotifier(env),
    whatsapp: createWhatsAppNotifier(env),
    push: createPushNotifier(),
  };
}
