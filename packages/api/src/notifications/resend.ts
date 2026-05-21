/**
 * Resend email notifier — production scaffold.
 *
 * VERIFY: pending real credentials. When RESEND_API_KEY is set:
 *   `npm i resend` before enabling.
 *
 * Usage:
 *   const notifier = new EmailNotifier(makeResendDispatcher({ apiKey: process.env.RESEND_API_KEY! }));
 */

import type { NotificationPayload } from './types';

export interface ResendConfig {
  apiKey: string;
  from?: string;
}

export function makeResendDispatcher(
  config: ResendConfig,
): (payload: NotificationPayload) => Promise<{ externalId?: string }> {
  return async (_payload) => {
    // VERIFY: implementation pending — uses `resend` SDK
    // Pseudocode:
    //   const resend = new Resend(config.apiKey);
    //   const result = await resend.emails.send({
    //     from: config.from ?? 'RestoMatch <auth@restomatch.test>',
    //     to: payload.target,
    //     subject: payload.subject ?? '(no subject)',
    //     text: payload.body,
    //   });
    //   return { externalId: result.data?.id };
    throw new Error(
      `Resend dispatcher not yet wired — install \`resend\` and implement. apiKey configured: ${config.apiKey.slice(0, 4)}…`,
    );
  };
}
