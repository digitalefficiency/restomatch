import { describe, expect, it } from 'vitest';
import {
  createEmailNotifier,
  createPushNotifier,
  createWhatsAppNotifier,
  isResendConfigured,
  isWhatsAppCloudConfigured,
} from '../notifications/factory';
import { EmailNotifier } from '../notifications/email';
import { ResendEmailNotifier } from '../notifications/resend';
import { MockPushNotifier } from '../notifications/push';
import { MockWhatsAppNotifier } from '../notifications/whatsapp';
import { WhatsAppCloudNotifier } from '../notifications/whatsappCloud';

/**
 * Hermetic: every assertion passes an explicit env object, so the factory
 * never reads process.env and no real provider is ever constructed unless the
 * test itself supplies fake keys. No network calls happen — we only check
 * which notifier class is selected, not send().
 */

describe('notifier factory — env gating', () => {
  it('isResendConfigured flips on RESEND_API_KEY', () => {
    expect(isResendConfigured({})).toBe(false);
    expect(isResendConfigured({ RESEND_API_KEY: '' })).toBe(false);
    expect(isResendConfigured({ RESEND_API_KEY: 're_test' })).toBe(true);
  });

  it('isWhatsAppCloudConfigured requires BOTH phone id and token', () => {
    expect(isWhatsAppCloudConfigured({})).toBe(false);
    expect(isWhatsAppCloudConfigured({ WHATSAPP_PHONE_NUMBER_ID: '123' })).toBe(false);
    expect(isWhatsAppCloudConfigured({ WHATSAPP_ACCESS_TOKEN: 'tok' })).toBe(false);
    expect(
      isWhatsAppCloudConfigured({ WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok' }),
    ).toBe(true);
  });

  it('email: mock EmailNotifier with no key, Resend when RESEND_API_KEY set', () => {
    const mock = createEmailNotifier({});
    expect(mock).toBeInstanceOf(EmailNotifier);
    expect(mock).not.toBeInstanceOf(ResendEmailNotifier);

    const real = createEmailNotifier({ RESEND_API_KEY: 're_test' });
    expect(real).toBeInstanceOf(ResendEmailNotifier);
  });

  it('whatsapp: mock with no creds, Cloud notifier when both creds set', () => {
    expect(createWhatsAppNotifier({})).toBeInstanceOf(MockWhatsAppNotifier);
    // Only one of the two creds present -> still mock.
    expect(createWhatsAppNotifier({ WHATSAPP_PHONE_NUMBER_ID: '123' })).toBeInstanceOf(
      MockWhatsAppNotifier,
    );

    const real = createWhatsAppNotifier({
      WHATSAPP_PHONE_NUMBER_ID: '123',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });
    expect(real).toBeInstanceOf(WhatsAppCloudNotifier);
  });

  it('push: always mock (no real provider wired)', () => {
    expect(createPushNotifier()).toBeInstanceOf(MockPushNotifier);
  });
});
