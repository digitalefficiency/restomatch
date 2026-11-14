import 'server-only';
import { isEmailConfigured, sendEmail } from '@/lib/email';

/** HTML-escape for the few dynamic values in the code e-mail. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function joinCodeEmail(input: { code: string; restaurantName: string | null; locale: 'he' | 'en' }) {
  const he = input.locale !== 'en';
  const where = input.restaurantName ?? '';
  const subject = he ? `הקוד שלכם להצטרפות: ${input.code}` : `Your join code: ${input.code}`;
  const lead = he
    ? `זה הקוד להצטרפות לצוות${where ? ` של ${where}` : ''} ב-RestoMatch:`
    : `Here is your code to join${where ? ` ${where}` : ' the team'} on RestoMatch:`;
  const tail = he
    ? 'הקוד תקף ל-10 דקות. לא ביקשתם? אפשר להתעלם מהמייל.'
    : "The code is valid for 10 minutes. Didn't ask for it? You can ignore this e-mail.";
  const dir = he ? 'rtl' : 'ltr';
  const html = `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:16px;color:#1a1d21">
<p>${esc(lead)}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px" dir="ltr">${esc(input.code)}</p>
<p style="color:#4a5058">${esc(tail)}</p></div>`;
  const text = `${lead}\n\n${input.code}\n\n${tail}`;
  return { subject, html, text };
}

/**
 * Deliver the code to the INVITED address. Without an e-mail provider (dev,
 * preview, the lab) it prints the code and writes JOIN_CODE_FILE for e2e —
 * never in production, where the provider is configured.
 *
 * The production decision is taken from the RUNTIME environment, read through
 * `env` (the way assertWebEnv reads it). `next build` inlines the literal
 * NODE_ENV member read on `process.env` to "production", so a built app served
 * with runtime NODE_ENV=development and no provider (the lab, demo-local.sh)
 * used to throw here instead of printing the code. A property read on the env
 * object is not inlined; keep every NODE_ENV read on `env`.
 */
export async function deliverJoinCode(
  input: {
    to: string;
    code: string;
    restaurantName: string | null;
    locale: 'he' | 'en';
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const production = env.NODE_ENV === 'production';
  // isEmailConfigured()'s contract (production + a Resend key), decided at
  // runtime. The helper is kept as a second condition so a provider sendEmail
  // would not actually use is never mistaken for a configured one.
  const configured = production && Boolean(env.RESEND_API_KEY) && isEmailConfigured();
  if (!configured) {
    // A production runtime without a provider must fail loudly, never log live codes.
    if (production) throw new Error('join code: e-mail provider not configured');
    console.log('\n──────── JOIN CODE ────────');
    console.log(`to: ${input.to}`);
    console.log(`code: ${input.code}`);
    console.log('───────────────────────────\n');
    // The e2e suite already sets MAGIC_LINK_FILE; the code lands beside it.
    const file = env.JOIN_CODE_FILE ?? env.MAGIC_LINK_FILE?.replace('magic-link', 'join-code');
    if (file) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, JSON.stringify({ to: input.to, code: input.code, at: Date.now() }), 'utf8');
    }
    return;
  }
  const { subject, html, text } = joinCodeEmail(input);
  await sendEmail({ to: input.to, subject, html, text });
}

/**
 * For an invited address that ALREADY has a RestoMatch account: no code (a code
 * never sets a password on an existing account, B5), just a link to sign in as
 * usual and finish joining. The /join page shows the same "we sent you an
 * e-mail" step either way, so the page is no account oracle (security review).
 */
export function joinSignInEmail(input: { url: string; restaurantName: string | null; locale: 'he' | 'en' }) {
  const he = input.locale !== 'en';
  const where = input.restaurantName ?? '';
  const subject = he
    ? `הוזמנתם להצטרף${where ? ` ל-${where}` : ' לצוות'} ב-RestoMatch`
    : `You're invited to join${where ? ` ${where}` : ' the team'} on RestoMatch`;
  const lead = he
    ? 'לכתובת הזו כבר יש חשבון ב-RestoMatch. היכנסו כרגיל, וההצטרפות תושלם מיד:'
    : 'This address already has a RestoMatch account. Sign in as usual to finish joining:';
  const cta = he ? 'כניסה והצטרפות' : 'Sign in and join';
  const tail = he ? 'לא ביקשתם? אפשר להתעלם מהמייל.' : "Didn't ask for it? You can ignore this e-mail.";
  const dir = he ? 'rtl' : 'ltr';
  const html = `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:16px;color:#1a1d21">
<p>${esc(lead)}</p>
<p><a href="${esc(input.url)}" style="display:inline-block;padding:12px 20px;background:#0b5cad;color:#ffffff;text-decoration:none;border-radius:8px">${esc(cta)}</a></p>
<p style="color:#4a5058">${esc(tail)}</p></div>`;
  const text = `${lead}\n\n${input.url}\n\n${tail}`;
  return { subject, html, text };
}

/** Same runtime rule as deliverJoinCode: dev/lab print + JOIN_SIGNIN_FILE; production needs a provider. */
export async function deliverJoinSignInLink(
  input: { to: string; url: string; restaurantName: string | null; locale: 'he' | 'en' },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const production = env.NODE_ENV === 'production';
  const configured = production && Boolean(env.RESEND_API_KEY) && isEmailConfigured();
  if (!configured) {
    if (production) throw new Error('join sign-in link: e-mail provider not configured');
    console.log(`\n──────── JOIN SIGN-IN LINK ────────\nto: ${input.to}\nurl: ${input.url}\n───────────────────────────────────\n`);
    const file = env.JOIN_SIGNIN_FILE ?? env.MAGIC_LINK_FILE?.replace('magic-link', 'join-signin');
    if (file) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, JSON.stringify({ to: input.to, url: input.url, at: Date.now() }), 'utf8');
    }
    return;
  }
  const { subject, html, text } = joinSignInEmail(input);
  await sendEmail({ to: input.to, subject, html, text });
}
