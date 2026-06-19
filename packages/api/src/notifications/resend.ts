/**
 * Resend email dispatcher.
 *
 * `resend` is an OPTIONAL dependency so dev/test runs without it. Install it in
 * the app that sends mail before enabling:
 *   pnpm --filter @restomatch/web add resend
 *
 * Usage:
 *   const notifier = new EmailNotifier(
 *     makeResendDispatcher({ apiKey: process.env.RESEND_API_KEY! }),
 *   );
 */

import { EmailNotifier } from './email';
import type { NotificationPayload } from './types';

export interface ResendConfig {
  apiKey: string;
  from?: string;
}

interface ResendClient {
  emails: {
    send(opts: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }>;
  };
}

export function makeResendDispatcher(
  config: ResendConfig,
): (payload: NotificationPayload) => Promise<{ externalId?: string }> {
  return async (payload) => {
    // Non-literal specifier: the SDK is not required at build time, and dev/test
    // runs (where it isn't installed) won't fail to bundle.
    const pkg = 'resend';
    let ResendCtor: new (apiKey: string) => ResendClient;
    try {
      ({ Resend: ResendCtor } = (await import(pkg)) as {
        Resend: new (apiKey: string) => ResendClient;
      });
    } catch {
      throw new Error(
        'Resend SDK not installed — run `pnpm --filter @restomatch/web add resend` to enable email sending.',
      );
    }

    const resend = new ResendCtor(config.apiKey);
    const result = await resend.emails.send({
      from: config.from ?? 'RestoMatch <auth@restomatch.co.il>',
      to: payload.target,
      subject: payload.subject ?? '(ללא נושא)',
      text: payload.body,
    });

    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message ?? 'unknown error'}`);
    }
    return { externalId: result.data?.id };
  };
}

/**
 * Production email notifier backed by Resend. Thin subclass of EmailNotifier
 * wired with the Resend dispatcher — writes to the outbox, sends via Resend,
 * and marks the row sent on success (failure leaves it for worker retry).
 *
 * `send()` is fully implemented via the inherited EmailNotifier.send + the
 * Resend dispatcher; no further work needed to enable it.
 */
export class ResendEmailNotifier extends EmailNotifier {
  constructor(config: ResendConfig) {
    super(makeResendDispatcher(config));
  }
}
