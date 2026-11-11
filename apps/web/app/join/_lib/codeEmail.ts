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
 */
export async function deliverJoinCode(input: {
  to: string;
  code: string;
  restaurantName: string | null;
  locale: 'he' | 'en';
}): Promise<void> {
  if (!isEmailConfigured()) {
    // A production deploy without a provider must fail loudly, never log live codes.
    if (process.env.NODE_ENV === 'production') throw new Error('join code: e-mail provider not configured');
    console.log('\n──────── JOIN CODE ────────');
    console.log(`to: ${input.to}`);
    console.log(`code: ${input.code}`);
    console.log('───────────────────────────\n');
    // The e2e suite already sets MAGIC_LINK_FILE; the code lands beside it.
    const file =
      process.env.JOIN_CODE_FILE ?? process.env.MAGIC_LINK_FILE?.replace('magic-link', 'join-code');
    if (file) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, JSON.stringify({ to: input.to, code: input.code, at: Date.now() }), 'utf8');
    }
    return;
  }
  const { subject, html, text } = joinCodeEmail(input);
  await sendEmail({ to: input.to, subject, html, text });
}
