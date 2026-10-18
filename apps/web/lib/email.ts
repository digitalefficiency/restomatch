import 'server-only';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Sender address. Must be a Resend-verified domain in production. */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'RestoMatch <auth@restomatch.co.il>';
}

/**
 * Whether real email delivery is wired. We only send for real in production
 * with a Resend API key; everywhere else (dev, preview, tests) callers fall
 * back to printing the link to stdout so login/invites still work without an
 * email provider.
 */
export function isEmailConfigured(): boolean {
  return process.env.NODE_ENV === 'production' && Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send a transactional email via Resend's REST API (no SDK dependency). When
 * email is not configured this is a no-op aside from a stdout breadcrumb — the
 * caller is responsible for logging the actual link when that matters.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<void> {
  if (!isEmailConfigured()) {
    console.log('\n──────── EMAIL (not sent — no provider) ────────');
    console.log(`to: ${to}`);
    console.log(`subject: ${subject}`);
    console.log('────────────────────────────────────────────────\n');
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddress(), to, subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${detail}`);
  }
}
