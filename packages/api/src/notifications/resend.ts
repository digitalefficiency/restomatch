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

/** Resend's attachment shape: `content` is the base64 file body. */
function resendAttachments(payload: NotificationPayload) {
  if (!payload.attachments?.length) return {};
  return {
    attachments: payload.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
      ...(a.contentType ? { contentType: a.contentType } : {}),
    })),
  };
}

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
      html?: string;
      attachments?: Array<{ filename: string; content: string; contentType?: string }>;
    }): Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }>;
  };
}

const DEFAULT_FROM = 'RestoMatch <auth@restomatch.co.il>';

/** Load the optional `resend` SDK constructor, or null if it isn't installed. */
async function loadResendCtor(): Promise<(new (apiKey: string) => ResendClient) | null> {
  try {
    // Non-literal specifier: the SDK is optional and not required at build time.
    const pkg = 'resend';
    const mod = (await import(pkg)) as { Resend: new (apiKey: string) => ResendClient };
    return mod.Resend;
  } catch {
    return null;
  }
}

/** Send via the Resend HTTP API directly — no SDK dependency (Node 20+ fetch). */
async function sendViaResendHttp(
  apiKey: string,
  from: string,
  payload: NotificationPayload,
): Promise<{ externalId?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: payload.target,
      subject: payload.subject ?? '(ללא נושא)',
      text: payload.body,
      ...(payload.html ? { html: payload.html } : {}),
      ...resendAttachments(payload),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend HTTP send failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { externalId: data.id };
}

export function makeResendDispatcher(
  config: ResendConfig,
): (payload: NotificationPayload) => Promise<{ externalId?: string }> {
  return async (payload) => {
    const from = config.from ?? DEFAULT_FROM;
    // Prefer the SDK when installed; otherwise fall back to the Resend HTTP API
    // so production email works WITHOUT adding the dependency (no `pnpm add` gate).
    const ResendCtor = await loadResendCtor();
    if (!ResendCtor) {
      return sendViaResendHttp(config.apiKey, from, payload);
    }

    const resend = new ResendCtor(config.apiKey);
    const result = await resend.emails.send({
      from,
      to: payload.target,
      subject: payload.subject ?? '(ללא נושא)',
      text: payload.body,
      ...(payload.html ? { html: payload.html } : {}),
      ...resendAttachments(payload),
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
