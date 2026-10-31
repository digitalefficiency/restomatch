/**
 * RestoMatch transactional email templates — Hebrew RTL, inline-styled HTML.
 *
 * Every customer-facing email renders through `renderEmail()` so the brand
 * frame (header, footer, button, ₪ styling) is defined ONCE. Each kind exports
 * a builder that returns `{ subject, html, text }`:
 *
 *   • magicLinkEmail        — passwordless login link
 *   • supplierDelayEmail    — a placed PO is past its expected delivery
 *   • orderNotPlacedEmail   — today is an order-day but no PO was placed
 *   • approvalNeededEmail    — a discrepancy needs a manager decision
 *   • weeklyLeakReportEmail — the Sunday "₪X נחסכו / דלפו השבוע" digest
 *
 * Design notes:
 *   - Inline styles + table layout: Gmail/Outlook strip <style> and flexbox.
 *   - dir="rtl" + text-align:right throughout (Hebrew-first product).
 *   - ₪ figures use a tabular/mono stack so columns align; gold = saved,
 *     red = leaked/at-risk (mirrors the in-app "command center" semantics).
 *   - No external assets — everything self-contained for deliverability.
 */

/** Email language. Hebrew (RTL) is the default; English renders LTR. */
export type EmailLocale = 'he' | 'en';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const COLORS = {
  bg: '#0b0e14', // outer canvas (dark frame)
  card: '#ffffff',
  ink: '#0f172a', // near-black slate
  muted: '#64748b',
  line: '#e2e8f0',
  primary: '#4f46e5', // indigo CTA
  gold: '#b45309', // savings / positive (readable amber on white)
  danger: '#dc2626', // leak / delay / at-risk
  warnBg: '#fef2f2',
  goldBg: '#fffbeb',
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Rubik,Arial,sans-serif";
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,monospace";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EmailLayout {
  /** Pre-header / preview text shown in the inbox list (kept out of the body). */
  preview: string;
  /** Big headline at the top of the card. */
  heading: string;
  /** Inner HTML for the body (already escaped/trusted markup from a builder). */
  bodyHtml: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional accent color for the heading rule (defaults to primary). */
  accent?: string;
  /**
   * Marketing-only one-click opt-out (E.7 — Communications Law §30A). When set,
   * the footer renders an unsubscribe line. TRANSACTIONAL emails (magic-link,
   * supplier-delay, approval, reports) MUST NOT pass this — they are operational
   * and exempt from the marketing opt-out requirement.
   */
  unsubscribeUrl?: string;
  /** Language/direction of the frame (default Hebrew RTL). */
  locale?: EmailLocale;
}

/** Brand frame shared by every email. Builders supply only the inner body. */
export function renderEmail(layout: EmailLayout): string {
  const accent = layout.accent ?? COLORS.primary;
  const en = layout.locale === 'en';
  const dir = en ? 'ltr' : 'rtl';
  const align = en ? 'left' : 'right';
  const cta = layout.cta
    ? `<tr><td style="padding:8px 0 4px">
         <a href="${escapeHtml(layout.cta.url)}"
            style="display:inline-block;background:${COLORS.primary};color:#fff;
                   text-decoration:none;font-weight:700;font-size:16px;
                   padding:13px 28px;border-radius:10px;font-family:${FONT}">
           ${escapeHtml(layout.cta.label)}
         </a></td></tr>`
    : '';

  return `<!doctype html>
<html dir="${dir}" lang="${en ? 'en' : 'he'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:${FONT}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(layout.preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}"
             style="max-width:560px;background:${COLORS.card};border-radius:16px;overflow:hidden;
                    box-shadow:0 8px 28px rgba(0,0,0,.28)">
        <tr><td style="padding:22px 28px 0">
          <span style="font-size:18px;font-weight:800;color:${COLORS.ink}">RestoMatch</span>
          <span style="font-size:13px;color:${COLORS.muted}">· ${en ? 'Command center for your money' : 'מוקד הבקרה של הכסף'}</span>
        </td></tr>
        <tr><td style="padding:14px 28px 0">
          <div style="height:3px;width:44px;background:${accent};border-radius:2px"></div>
          <h1 style="margin:14px 0 4px;font-size:21px;line-height:1.35;color:${COLORS.ink};text-align:${align}">
            ${escapeHtml(layout.heading)}
          </h1>
        </td></tr>
        <tr><td style="padding:6px 28px 4px;color:${COLORS.ink};font-size:15px;line-height:1.7;text-align:${align}">
          ${layout.bodyHtml}
        </td></tr>
        ${cta ? `<tr><td style="padding:8px 28px 4px" align="${align}"><table role="presentation"><tr><td>${cta}</td></tr></table></td></tr>` : ''}
        <tr><td style="padding:22px 28px 24px">
          <div style="border-top:1px solid ${COLORS.line};margin-top:8px;padding-top:14px;
                      color:${COLORS.muted};font-size:12px;line-height:1.6;text-align:${align}">
            ${
              en
                ? 'This message was sent automatically by RestoMatch. If you don’t recognise it, you can ignore it.'
                : 'הודעה זו נשלחה אוטומטית מ-RestoMatch. אם אינך מזהה אותה, אפשר להתעלם.'
            }
            ${
              layout.unsubscribeUrl
                ? `<br><a href="${escapeHtml(layout.unsubscribeUrl)}"
                       style="color:${COLORS.muted};text-decoration:underline">
                     ${en ? 'Unsubscribe from this mailing list' : 'להסרה מרשימת הדיוור — לחצו כאן'}
                   </a>`
                : ''
            }
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Render a ₪ figure as a colored, mono, aligned span. */
export function ilsSpan(text: string, tone: 'gold' | 'danger' | 'ink' = 'ink'): string {
  const color = tone === 'gold' ? COLORS.gold : tone === 'danger' ? COLORS.danger : COLORS.ink;
  return `<span style="font-family:${MONO};font-weight:800;color:${color}">${escapeHtml(text)}</span>`;
}

/** A subtle callout box (amber for positive, red for at-risk). */
function callout(html: string, tone: 'gold' | 'danger'): string {
  const bg = tone === 'gold' ? COLORS.goldBg : COLORS.warnBg;
  const border = tone === 'gold' ? COLORS.gold : COLORS.danger;
  return `<div style="background:${bg};border-right:4px solid ${border};border-radius:8px;
              padding:12px 14px;margin:12px 0;text-align:right">${html}</div>`;
}

/* ─────────────────────────── magic link ─────────────────────────── */

export function magicLinkEmail(args: { url: string; locale?: EmailLocale }): RenderedEmail {
  if (args.locale === 'en') {
    return {
      subject: 'Your RestoMatch sign-in link',
      html: renderEmail({
        locale: 'en',
        preview: 'One click and you’re in — the link is valid for 24 hours.',
        heading: 'Sign in to RestoMatch',
        bodyHtml: `
      <p style="margin:0 0 10px">Hi, you asked to sign in to your account. Click the button to get in — no password needed.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">The link is valid for 24 hours and can be used once.</p>`,
        cta: { label: 'Sign in', url: args.url },
      }),
      text: `Sign in to RestoMatch\n\nTo sign in, open this link (valid for 24 hours, single use):\n${args.url}\n\nIf you didn't ask to sign in, you can ignore this message.`,
    };
  }
  const subject = 'הקישור שלך להתחברות ל-RestoMatch';
  const html = renderEmail({
    preview: 'לחיצה אחת ואתה בפנים — הקישור תקף ל-24 שעות.',
    heading: 'התחברות ל-RestoMatch',
    bodyHtml: `
      <p style="margin:0 0 10px">היי, ביקשת להתחבר לחשבון שלך. לחיצה על הכפתור תכניס אותך פנימה — בלי סיסמה.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">הקישור תקף ל-24 שעות וניתן לשימוש פעם אחת.</p>`,
    cta: { label: 'כניסה לחשבון', url: args.url },
  });
  const text = `התחברות ל-RestoMatch\n\nכדי להיכנס לחשבון, פתח את הקישור הבא (תקף ל-24 שעות, חד-פעמי):\n${args.url}\n\nאם לא ביקשת להתחבר, אפשר להתעלם מהודעה זו.`;
  return { subject, html, text };
}

/* ─────────────────────────── password reset ─────────────────────── */

export function passwordResetEmail(args: { url: string; locale?: EmailLocale }): RenderedEmail {
  if (args.locale === 'en') {
    return {
      subject: 'Reset your RestoMatch password',
      html: renderEmail({
        locale: 'en',
        preview: 'Your password reset link — valid for one hour.',
        heading: 'Reset your password',
        bodyHtml: `
      <p style="margin:0 0 10px">We received a request to reset your account password. Click the button to choose a new one.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">The link is valid for one hour and can be used once. If you didn't ask for a reset, ignore this message — your current password stays as it is.</p>`,
        cta: { label: 'Choose a new password', url: args.url },
      }),
      text: `Reset your RestoMatch password\n\nTo choose a new password, open this link (valid for one hour, single use):\n${args.url}\n\nIf you didn't ask for a reset, you can ignore this message.`,
    };
  }
  const subject = 'איפוס הסיסמה שלך ב-RestoMatch';
  const html = renderEmail({
    preview: 'קישור לאיפוס הסיסמה — תקף לשעה אחת.',
    heading: 'איפוס סיסמה',
    bodyHtml: `
      <p style="margin:0 0 10px">קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך. לחיצה על הכפתור תאפשר לבחור סיסמה חדשה.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">הקישור תקף לשעה אחת וניתן לשימוש פעם אחת. אם לא ביקשת לאפס סיסמה — אפשר להתעלם מהודעה זו, הסיסמה הנוכחית תישאר בתוקף.</p>`,
    cta: { label: 'בחירת סיסמה חדשה', url: args.url },
  });
  const text = `איפוס סיסמה ב-RestoMatch\n\nכדי לבחור סיסמה חדשה, פתח את הקישור (תקף לשעה, חד-פעמי):\n${args.url}\n\nאם לא ביקשת לאפס סיסמה, אפשר להתעלם מהודעה זו.`;
  return { subject, html, text };
}

/* ─────────────────────────── team invite ────────────────────────── */

export function inviteEmail(args: {
  url: string;
  restaurantName: string;
  roleLabel: string;
  inviterName?: string | null;
  /** Invitee's language (chosen by the inviter). Default Hebrew. */
  locale?: EmailLocale;
}): RenderedEmail {
  if (args.locale === 'en') {
    const who = args.inviterName ? `${args.inviterName} invited you` : 'You’ve been invited';
    return {
      subject: `You're invited to join ${args.restaurantName} on RestoMatch`,
      html: renderEmail({
        locale: 'en',
        preview: `${who} to join the ${args.restaurantName} team.`,
        heading: 'You’re invited to the team',
        bodyHtml: `
      <p style="margin:0 0 8px">${escapeHtml(who)} to join the team at <strong>${escapeHtml(args.restaurantName)}</strong>
        as <strong>${escapeHtml(args.roleLabel)}</strong>.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">The link is valid for 7 days. RestoMatch will open in English for you.</p>`,
        cta: { label: 'Join the team', url: args.url },
      }),
      text: `You're invited to join ${args.restaurantName} on RestoMatch (role: ${args.roleLabel}).\n\nJoin via this link (valid for 7 days):\n${args.url}`,
    };
  }
  const subject = `הוזמנת לצוות של ${args.restaurantName} ב-RestoMatch`;
  const inviterPlain = args.inviterName ? `${args.inviterName} הזמין/ה אותך` : 'הוזמנת';
  const inviter = escapeHtml(inviterPlain);
  const html = renderEmail({
    // renderEmail escapes the preview itself — pass the plain text (no double escape).
    preview: `${inviterPlain} להצטרף לצוות של ${args.restaurantName}.`,
    heading: 'הוזמנת לצוות',
    bodyHtml: `
      <p style="margin:0 0 8px">${inviter} להצטרף לצוות של <strong>${escapeHtml(args.restaurantName)}</strong>
        בתפקיד <strong>${escapeHtml(args.roleLabel)}</strong>.</p>
      <p style="margin:0;color:${COLORS.muted};font-size:13px">הקישור תקף ל-7 ימים.</p>`,
    cta: { label: 'הצטרפות לצוות', url: args.url },
  });
  const text = `הוזמנת לצוות של ${args.restaurantName} ב-RestoMatch (תפקיד: ${args.roleLabel}).\n\nהצטרפו דרך הקישור (תקף 7 ימים):\n${args.url}`;
  return { subject, html, text };
}

/* ─────────────────────── supplier delivery delay ─────────────────── */

export function supplierDelayEmail(args: {
  supplierName: string;
  expectedAtLabel: string; // already formatted IL date/time
  daysLate: number;
  lineCount: number;
  poUrl?: string;
}): RenderedEmail {
  const subject = `⏰ איחור באספקה — ${args.supplierName}`;
  const lateText =
    args.daysLate >= 1 ? `באיחור של ${args.daysLate} ימים` : 'לא סופקה במועד';
  const html = renderEmail({
    accent: COLORS.danger,
    preview: `הזמנה מ-${args.supplierName} ${lateText}.`,
    heading: `אספקה מ-${args.supplierName} מתעכבת`,
    bodyHtml: `
      ${callout(
        `<strong style="color:${COLORS.danger}">ההזמנה ${lateText}.</strong><br>
         מועד אספקה צפוי: <span style="font-family:${MONO}">${escapeHtml(args.expectedAtLabel)}</span>`,
        'danger',
      )}
      <p style="margin:10px 0 0">ההזמנה כוללת <strong>${args.lineCount}</strong> פריטים ועדיין לא נקלטה במערכת.
      כדאי ליצור קשר עם הספק או לעדכן את הסטטוס.</p>`,
    cta: args.poUrl ? { label: 'צפייה בהזמנה', url: args.poUrl } : undefined,
  });
  const text = `איחור באספקה — ${args.supplierName}\n\nההזמנה ${lateText}. מועד צפוי: ${args.expectedAtLabel}. ${args.lineCount} פריטים, טרם נקלטה.${args.poUrl ? `\n\nצפייה בהזמנה: ${args.poUrl}` : ''}`;
  return { subject, html, text };
}

/* ─────────────────────── order not placed (cadence) ─────────────── */

export function orderNotPlacedEmail(args: {
  supplierName: string;
  orderDayLabel: string; // e.g. "יום ראשון"
  cutoffLabel?: string; // e.g. "12:00"
  ordersUrl?: string;
}): RenderedEmail {
  const subject = `📋 לא בוצעה הזמנה — ${args.supplierName}`;
  const cutoffLine = args.cutoffLabel
    ? `<br>מועד אחרון להזמנה היום: <span style="font-family:${MONO}">${escapeHtml(args.cutoffLabel)}</span>`
    : '';
  const html = renderEmail({
    accent: COLORS.gold,
    preview: `היום (${args.orderDayLabel}) יום הזמנה ל-${args.supplierName} — עדיין לא הוזמן.`,
    heading: `תזכורת: הזמנה ל-${args.supplierName}`,
    bodyHtml: `
      ${callout(
        `היום <strong>${escapeHtml(args.orderDayLabel)}</strong> — יום הזמנה קבוע ל-<strong>${escapeHtml(args.supplierName)}</strong>,
         אך עדיין לא נוצרה הזמנה.${cutoffLine}`,
        'gold',
      )}
      <p style="margin:10px 0 0">כדי שלא להחמיץ את חלון האספקה, אפשר ליצור את ההזמנה עכשיו.</p>`,
    cta: args.ordersUrl ? { label: 'יצירת הזמנה', url: args.ordersUrl } : undefined,
  });
  const text = `תזכורת הזמנה — ${args.supplierName}\n\nהיום (${args.orderDayLabel}) יום הזמנה קבוע ל-${args.supplierName}, אך עדיין לא נוצרה הזמנה.${args.cutoffLabel ? ` מועד אחרון: ${args.cutoffLabel}.` : ''}${args.ordersUrl ? `\n\nיצירת הזמנה: ${args.ordersUrl}` : ''}`;
  return { subject, html, text };
}

/* ─────────────────────── approval needed ─────────────────────────── */

/**
 * The approval decision vocabulary (W1-07), named by what happens to the money.
 * ONE map for the queue buttons (apps/web approvals i18n + vocab.ts — a web unit
 * test locks them equal to this), the activity titles the approvals router
 * writes and the approval e-mail below. The procedure each verb calls is fixed:
 *
 *   approve()  → resolution 'accepted' → the ₪ is claimed from the supplier;
 *   reject()   → resolution 'rejected' → waived, the invoice is paid as billed;
 *   escalate() → resolution 'escalated', routed to the owner.
 *
 * Never swap a label onto the other procedure (functional-flows-08): "אשר" used
 * to mean "claim" and every AP tool reads it as "pay".
 */
export const DECISION_COPY = {
  he: {
    approve: 'דרוש {amount} מהספק',
    reject: 'שלם כפי שחויב',
    escalate: 'העבר לבעלים',
    approved: 'נדרש מהספק',
    rejected: 'שולם כפי שחויב',
    escalated: 'הועבר לבעלים',
    reopened: 'ההחלטה בוטלה',
    duplicateHeld: 'העותק מוחזק · לא ישולם',
    reviewed: 'סומן כנבדק',
  },
  en: {
    approve: 'Claim {amount} back',
    reject: 'Pay as billed',
    escalate: 'Send to owner',
    approved: 'Claimed from supplier',
    rejected: 'Paid as billed',
    escalated: 'Sent to owner',
    reopened: 'Decision undone',
    duplicateHeld: 'Copy held · not paid',
    reviewed: 'Marked as checked',
  },
} as const satisfies Record<EmailLocale, Record<string, string>>;

export function approvalNeededEmail(args: {
  supplierName: string;
  discrepancyCount: number;
  atRiskIls: string; // formatted ₪
  approvalsUrl?: string;
}): RenderedEmail {
  const subject = `דרושה החלטה — ${args.discrepancyCount} פערים בחשבונית מ-${args.supplierName}`;
  const html = renderEmail({
    accent: COLORS.danger,
    preview: `${args.discrepancyCount} פערים בסכום של ${args.atRiskIls} ממתינים לאישור.`,
    heading: 'דרושה החלטה לחשבונית',
    bodyHtml: `
      ${callout(
        `נמצאו <strong>${args.discrepancyCount}</strong> פערים בחשבונית מ-<strong>${escapeHtml(args.supplierName)}</strong>.<br>
         סכום בסיכון: ${ilsSpan(args.atRiskIls, 'danger')}`,
        'danger',
      )}
      <p style="margin:10px 0 0">לכל פער שתי אפשרויות: <strong>«${DECISION_COPY.he.approve.replace(' {amount}', '')}»</strong> או <strong>«${DECISION_COPY.he.reject}»</strong>.</p>`,
    cta: args.approvalsUrl ? { label: 'מעבר לתור האישורים', url: args.approvalsUrl } : undefined,
  });
  const text = `דרושה החלטה — ${args.supplierName}\n\n${args.discrepancyCount} פערים, סכום בסיכון ${args.atRiskIls}.\n${DECISION_COPY.he.approve.replace(' {amount}', '')} / ${DECISION_COPY.he.reject}${args.approvalsUrl ? `\n\nתור האישורים: ${args.approvalsUrl}` : ''}`;
  return { subject, html, text };
}

/* ─────────────────────── weekly leak digest ─────────────────────── */

export function weeklyLeakReportEmail(args: {
  weekLabel: string; // e.g. "13–19 ביוני"
  savedIls: string; // formatted ₪ caught/prevented
  leakedIls: string; // formatted ₪ still leaking
  topSupplier?: string;
  dashboardUrl?: string;
}): RenderedEmail {
  const subject = `הסיכום השבועי שלך — ${args.savedIls} נחסכו`;
  const html = renderEmail({
    accent: COLORS.gold,
    preview: `${args.savedIls} נחסכו השבוע · ${args.leakedIls} עדיין דולפים.`,
    heading: `הסיכום השבועי · ${escapeHtml(args.weekLabel)}`,
    bodyHtml: `
      ${callout(`נחסך/נמנע השבוע: ${ilsSpan(args.savedIls, 'gold')}`, 'gold')}
      ${callout(`עדיין דולף (לא טופל): ${ilsSpan(args.leakedIls, 'danger')}`, 'danger')}
      ${args.topSupplier ? `<p style="margin:10px 0 0">הספק עם הכי הרבה פערים השבוע: <strong>${escapeHtml(args.topSupplier)}</strong>.</p>` : ''}`,
    cta: args.dashboardUrl ? { label: 'פתיחת הדשבורד', url: args.dashboardUrl } : undefined,
  });
  const text = `הסיכום השבועי · ${args.weekLabel}\n\nנחסך/נמנע: ${args.savedIls}\nעדיין דולף: ${args.leakedIls}${args.topSupplier ? `\nספק בולט: ${args.topSupplier}` : ''}${args.dashboardUrl ? `\n\nדשבורד: ${args.dashboardUrl}` : ''}`;
  return { subject, html, text };
}

/* ─────────────────────── end-of-day digest ──────────────────────── */

function statRow(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;text-align:right">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:15px;text-align:left;white-space:nowrap">${valueHtml}</td>
  </tr>`;
}

export function endOfDayReportEmail(args: {
  dateLabel: string; // e.g. "21.6.2026"
  openCreditsCount: number; // open/escalated discrepancies awaiting recovery
  openCreditsIls: string; // formatted ₪ owed back / at risk
  todayCaughtCount: number; // discrepancies detected today
  todayCaughtIls: string; // formatted ₪ flagged today
  pendingApprovals?: number; // items waiting for a manager decision
  topSupplier?: string; // supplier with the most open credits
  approvalsUrl?: string;
}): RenderedEmail {
  const subject = `סיכום יומי · ${args.openCreditsCount} זיכויים פתוחים (${args.openCreditsIls})`;
  const rows = [
    statRow('זיכויים פתוחים לגבייה', `${ilsSpan(args.openCreditsIls, 'danger')} · ${args.openCreditsCount}`),
    statRow('פערים שזוהו היום', `${ilsSpan(args.todayCaughtIls, 'gold')} · ${args.todayCaughtCount}`),
    args.pendingApprovals != null
      ? statRow('ממתינים להחלטה', `<strong>${args.pendingApprovals}</strong>`)
      : '',
    args.topSupplier
      ? statRow('ספק עם הכי הרבה זיכויים', `<strong>${escapeHtml(args.topSupplier)}</strong>`)
      : '',
  ].join('');

  const html = renderEmail({
    accent: args.openCreditsCount > 0 ? COLORS.danger : COLORS.gold,
    preview: `${args.openCreditsCount} זיכויים פתוחים בסך ${args.openCreditsIls} · ${args.todayCaughtCount} פערים זוהו היום.`,
    heading: `סיכום סוף יום · ${escapeHtml(args.dateLabel)}`,
    bodyHtml: `
      <p style="margin:0 0 8px">תמונת מצב לסוף היום — מה פתוח לטיפול ומה נתפס היום:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">${rows}</table>
      ${
        args.openCreditsCount > 0
          ? `<p style="margin:12px 0 0;color:${COLORS.muted};font-size:13px">זיכויים פתוחים הם כסף שעדיין אפשר לגבות חזרה מהספקים. כדאי לסגור אותם לפני התשלום הבא.</p>`
          : `<p style="margin:12px 0 0;color:${COLORS.gold};font-weight:700">כל הכבוד — אין זיכויים פתוחים. 🎉</p>`
      }`,
    cta: args.approvalsUrl ? { label: 'מעבר לתור האישורים', url: args.approvalsUrl } : undefined,
  });

  const text =
    `סיכום סוף יום · ${args.dateLabel}\n\n` +
    `זיכויים פתוחים לגבייה: ${args.openCreditsIls} (${args.openCreditsCount})\n` +
    `פערים שזוהו היום: ${args.todayCaughtIls} (${args.todayCaughtCount})\n` +
    (args.pendingApprovals != null ? `ממתינים להחלטה: ${args.pendingApprovals}\n` : '') +
    (args.topSupplier ? `ספק בולט: ${args.topSupplier}\n` : '') +
    (args.approvalsUrl ? `\nתור האישורים: ${args.approvalsUrl}` : '');
  return { subject, html, text };
}
