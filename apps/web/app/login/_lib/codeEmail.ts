import 'server-only';
import { isEmailConfigured, sendEmail } from '@/lib/email';

/**
 * The sign-in code e-mail (W3-07b slice b), in the page language (he/en and
 * the receiver languages ar/ru/th/ti — security review M7). Plain and short.
 * The code stays out of the subject (lock-screen previews). The tail no longer
 * promises "your account stays safe": repeated unrequested codes mean someone
 * is trying the address, so it says what to do (M1).
 */
const COPY: Record<string, { subject: string; lead: string; tail: string; dir: 'rtl' | 'ltr' }> = {
  he: {
    subject: 'קוד הכניסה שלכם ל-RestoMatch',
    lead: 'זה הקוד לכניסה ל-RestoMatch:',
    tail: 'הקוד תקף ל-10 דקות. לא ביקשתם קוד? אל תמסרו אותו לאיש, ואל תזינו אותו בשום מקום. אם ממשיכים להגיע קודים שלא ביקשתם, ספרו לבעלי המסעדה.',
    dir: 'rtl',
  },
  en: {
    subject: 'Your RestoMatch sign-in code',
    lead: 'Here is your RestoMatch sign-in code:',
    tail: "The code is valid for 10 minutes. Didn't ask for it? Don't share it or type it in anywhere. If codes you didn't request keep arriving, tell the restaurant owner.",
    dir: 'ltr',
  },
  ar: {
    subject: 'رمز الدخول إلى RestoMatch',
    lead: 'هذا رمز الدخول إلى RestoMatch:',
    tail: 'الرمز صالح لمدة 10 دقائق. لم تطلب رمزًا؟ لا تشاركه ولا تُدخله في أي مكان. إذا استمرت رموز لم تطلبها بالوصول، أبلغ صاحب المطعم.',
    dir: 'rtl',
  },
  ru: {
    subject: 'Ваш код входа в RestoMatch',
    lead: 'Ваш код для входа в RestoMatch:',
    tail: 'Код действует 10 минут. Не запрашивали код? Никому его не сообщайте и нигде не вводите. Если такие коды приходят снова, сообщите владельцу ресторана.',
    dir: 'ltr',
  },
  th: {
    subject: 'รหัสเข้าสู่ระบบ RestoMatch ของคุณ',
    lead: 'นี่คือรหัสเข้าสู่ระบบ RestoMatch ของคุณ:',
    tail: 'รหัสใช้ได้ 10 นาที หากคุณไม่ได้ขอรหัส อย่าบอกหรือกรอกรหัสนี้ที่ใด หากยังได้รับรหัสที่ไม่ได้ขอ ให้แจ้งเจ้าของร้าน',
    dir: 'ltr',
  },
  ti: {
    subject: 'ናይ RestoMatch መእተዊ ኮድካ',
    lead: 'እዚ ናይ RestoMatch መእተዊ ኮድካ እዩ:',
    tail: 'እቲ ኮድ ን10 ደቒቕ ይሰርሕ። ኮድ ኣይሓተትካን? ንማንም ኣይትሃቦ፡ ኣብ ዝኾነ ቦታ ድማ ኣይተእትዎ። ዘይሓተትካዮ ኮድታት እንተ ቐጺሎም መጺኦም፡ ንወናኒ ቤት መግቢ ሓብር።',
    dir: 'ltr',
  },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function loginCodeEmail(input: { code: string; locale: string }) {
  const c = COPY[input.locale] ?? COPY.he!;
  const code = input.code.replace(/\D/g, '');
  const html = `<div dir="${c.dir}" style="font-family:Arial,sans-serif;font-size:16px;color:#1a1d21">
<p>${esc(c.lead)}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px" dir="ltr">${esc(code)}</p>
<p style="color:#4a5058">${esc(c.tail)}</p></div>`;
  return { subject: c.subject, html, text: `${c.lead}\n\n${code}\n\n${c.tail}` };
}

/**
 * Without a provider (dev, lab, e2e) it writes the code beside MAGIC_LINK_FILE;
 * production never logs it. The production decision is read at RUNTIME through
 * `env` (same rule as the /join code e-mail, train C r8): `next build` inlines a literal NODE_ENV
 * read on process.env, so a built app served with runtime
 * NODE_ENV=development and no provider would throw instead of printing the code.
 * Keep every NODE_ENV read on `env`.
 */
export async function deliverLoginCode(
  input: { to: string; code: string; locale: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const production = env.NODE_ENV === 'production';
  const configured = production && Boolean(env.RESEND_API_KEY) && isEmailConfigured();
  if (!configured) {
    if (production) throw new Error('login code: e-mail provider not configured');
    console.log(`\n──────── LOGIN CODE ────────\nto: ${input.to}\ncode: ${input.code}\n────────────────────────────\n`);
    const file = env.LOGIN_CODE_FILE ?? env.MAGIC_LINK_FILE?.replace('magic-link', 'login-code');
    if (file) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, JSON.stringify({ to: input.to, code: input.code, at: Date.now() }), 'utf8');
    }
    return;
  }
  const { subject, html, text } = loginCodeEmail(input);
  await sendEmail({ to: input.to, subject, html, text });
}
