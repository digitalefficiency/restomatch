import 'server-only';
import { isEmailConfigured, sendEmail } from '@/lib/email';

/** The sign-in code e-mail (W3-07b slice b). Plain and short; the code is the subject too. */
export function loginCodeEmail(input: { code: string; locale: string }) {
  const he = input.locale !== 'en';
  const subject = he ? `קוד הכניסה שלכם: ${input.code}` : `Your sign-in code: ${input.code}`;
  const lead = he ? 'זה הקוד לכניסה ל-RestoMatch:' : 'Here is your RestoMatch sign-in code:';
  const tail = he
    ? 'הקוד תקף ל-10 דקות. לא ניסיתם להיכנס? אפשר להתעלם מהמייל, והחשבון נשאר מוגן.'
    : "The code is valid for 10 minutes. Didn't try to sign in? Ignore this e-mail; your account stays safe.";
  const html = `<div dir="${he ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;font-size:16px;color:#1a1d21">
<p>${lead}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px" dir="ltr">${input.code.replace(/\D/g, '')}</p>
<p style="color:#4a5058">${tail}</p></div>`;
  return { subject, html, text: `${lead}\n\n${input.code}\n\n${tail}` };
}

/** Without a provider (dev, lab, e2e) it writes the code beside MAGIC_LINK_FILE; production never logs it. */
export async function deliverLoginCode(input: { to: string; code: string; locale: string }): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === 'production') throw new Error('login code: e-mail provider not configured');
    console.log(`\n──────── LOGIN CODE ────────\nto: ${input.to}\ncode: ${input.code}\n────────────────────────────\n`);
    const file = process.env.LOGIN_CODE_FILE ?? process.env.MAGIC_LINK_FILE?.replace('magic-link', 'login-code');
    if (file) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, JSON.stringify({ to: input.to, code: input.code, at: Date.now() }), 'utf8');
    }
    return;
  }
  const { subject, html, text } = loginCodeEmail(input);
  await sendEmail({ to: input.to, subject, html, text });
}
