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
 *   • weeklyLeakReportEmail — the Sunday "found in discrepancies / still open" digest
 *   • endOfDayReportEmail   — the evening open-credits digest
 *   • invoiceOcrFailedEmail — an uploaded invoice could not be read (no ₪, G-06)
 *   • taskNoticeEmail       — a generic act-now notice (₪ only when the caller passes it)
 *
 * Copy: every subject/body string lives in `./copy/{he,en}.ts` (EMAIL_COPY, W2-13),
 * filled by `fill()` (plurals with the Hebrew dual; values isolated with FSI…PDI in
 * text and <bdi> in HTML). This file only lays out markup.
 *
 * Design notes:
 *   - Inline styles + table layout: Gmail/Outlook strip <style> and flexbox.
 *   - dir="rtl" + text-align:right throughout (Hebrew-first product).
 *   - ₪ figures arrive pre-formatted and render with tabular figures; gold = caught,
 *     red = at-risk (mirrors the in-app "command center" semantics).
 *   - No external assets — everything self-contained for deliverability.
 */

import { EMAIL_COPY, escapeHtml, fill, type CopyVars, type EmailCopy } from './copy';

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
/** Tabular figures in the body font: ₪ columns align without a mono face (DoD-4). */
const NUMS = 'font-variant-numeric:tabular-nums';

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
  const copy = EMAIL_COPY[en ? 'en' : 'he'];
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
          <span style="font-size:13px;color:${COLORS.muted}">· ${escapeHtml(copy.frame.tagline)}</span>
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
            ${escapeHtml(copy.frame.footer)}
            ${
              layout.unsubscribeUrl
                ? `<br><a href="${escapeHtml(layout.unsubscribeUrl)}"
                       style="color:${COLORS.muted};text-decoration:underline">
                     ${escapeHtml(copy.frame.unsubscribe)}
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
  return `<span style="${NUMS};font-weight:800;color:${color}"><bdi>${escapeHtml(text)}</bdi></span>`;
}

/** A subtle callout box (amber for positive, red for at-risk). */
function callout(html: string, tone: 'gold' | 'danger', locale: EmailLocale = 'he'): string {
  const bg = tone === 'gold' ? COLORS.goldBg : COLORS.warnBg;
  const border = tone === 'gold' ? COLORS.gold : COLORS.danger;
  const side = locale === 'en' ? 'left' : 'right';
  return `<div style="background:${bg};border-${side}:4px solid ${border};border-radius:8px;
              padding:12px 14px;margin:12px 0;text-align:${side}">${html}</div>`;
}

/* ─────────────────────────── copy helpers ───────────────────────── */

function copyOf(locale: EmailLocale | undefined): EmailCopy {
  return EMAIL_COPY[locale === 'en' ? 'en' : 'he'] as EmailCopy;
}
function loc(locale: EmailLocale | undefined): EmailLocale {
  return locale === 'en' ? 'en' : 'he';
}
/** Plain text (subjects, previews, text bodies): values isolated with FSI…PDI where needed. */
function txt(locale: EmailLocale, template: string, vars: CopyVars = {}, raw?: readonly string[]): string {
  return fill(template, vars, { locale, raw });
}
/** Escaped HTML: values in <bdi> where needed, `strong` vars bold, `trusted` vars spliced as markup. */
function htm(
  locale: EmailLocale,
  template: string,
  vars: CopyVars = {},
  strong?: readonly string[],
  trusted?: readonly string[],
): string {
  return fill(template, vars, { locale, html: true, strong, trustedHtml: trusted });
}
const P = '<p style="margin:0 0 10px">';
const NOTE = `<p style="margin:0;color:${COLORS.muted};font-size:13px">`;
const lines = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join('\n');


/* ─────────────────────────── magic link ─────────────────────────── */

export function magicLinkEmail(args: { url: string; locale?: EmailLocale }): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).magicLink;
  return {
    subject: c.subject,
    html: renderEmail({
      locale: l,
      preview: c.preview,
      heading: c.heading,
      bodyHtml: `${P}${htm(l, c.body)}</p>${NOTE}${htm(l, c.note)}</p>`,
      cta: { label: c.cta, url: args.url },
    }),
    text: lines(c.heading, '', c.textIntro, args.url, '', c.ignore),
  };
}

/* ─────────────────────────── password reset ─────────────────────── */

export function passwordResetEmail(args: { url: string; locale?: EmailLocale }): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).passwordReset;
  return {
    subject: c.subject,
    html: renderEmail({
      locale: l,
      preview: c.preview,
      heading: c.heading,
      bodyHtml: `${P}${htm(l, c.body)}</p>${NOTE}${htm(l, c.note)}</p>`,
      cta: { label: c.cta, url: args.url },
    }),
    text: lines(c.heading, '', c.textIntro, args.url, '', c.ignore),
  };
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
  const l = loc(args.locale);
  const c = copyOf(l).invite;
  const vars = { restaurant: args.restaurantName, role: args.roleLabel, inviter: args.inviterName ?? '' };
  const by = Boolean(args.inviterName);
  return {
    subject: txt(l, c.subject, vars),
    html: renderEmail({
      locale: l,
      // renderEmail escapes the preview itself: pass plain text (no double escape).
      preview: txt(l, by ? c.previewBy : c.preview, vars),
      heading: c.heading,
      bodyHtml: `<p style="margin:0 0 8px">${htm(l, by ? c.bodyBy : c.body, vars, ['restaurant', 'role'])}</p>${NOTE}${htm(l, c.note)}</p>`,
      cta: { label: c.cta, url: args.url },
    }),
    text: lines(txt(l, c.text, vars), '', c.textIntro, args.url),
  };
}

/* ─────────────────────── supplier delivery delay ─────────────────── */

export function supplierDelayEmail(args: {
  supplierName: string;
  expectedAtLabel: string; // already formatted IL date/time
  daysLate: number;
  lineCount: number;
  poUrl?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).supplierDelay;
  const late = args.daysLate >= 1 ? txt(l, c.late, { days: args.daysLate }) : c.notOnTime;
  const vars = { supplier: args.supplierName, late, date: args.expectedAtLabel, lines: args.lineCount };
  const html = renderEmail({
    locale: l,
    accent: COLORS.danger,
    preview: txt(l, c.preview, vars),
    heading: txt(l, c.heading, vars),
    bodyHtml: `
      ${callout(
        `<strong style="color:${COLORS.danger}">${htm(l, c.callout, vars)}</strong><br>
         ${htm(l, c.expected, vars, ['date'])}`,
        'danger',
        l,
      )}
      <p style="margin:10px 0 0">${htm(l, c.body, vars)}</p>`,
    cta: args.poUrl ? { label: c.cta, url: args.poUrl } : undefined,
  });
  const text = lines(
    txt(l, c.subject, vars),
    '',
    txt(l, c.text, vars),
    args.poUrl && `\n${c.cta}: ${args.poUrl}`,
  );
  return { subject: txt(l, c.subject, vars), html, text };
}

/* ─────────────────────── order not placed (cadence) ─────────────── */

export function orderNotPlacedEmail(args: {
  supplierName: string;
  orderDayLabel: string; // e.g. "יום ראשון"
  cutoffLabel?: string; // e.g. "12:00"
  ordersUrl?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).orderNotPlaced;
  const vars = { supplier: args.supplierName, day: args.orderDayLabel, cutoff: args.cutoffLabel ?? '' };
  const html = renderEmail({
    locale: l,
    accent: COLORS.gold,
    preview: txt(l, c.preview, vars),
    heading: txt(l, c.heading, vars),
    bodyHtml: `
      ${callout(
        `${htm(l, c.callout, vars, ['day', 'supplier'])}${args.cutoffLabel ? `<br>${htm(l, c.cutoff, vars, ['cutoff'])}` : ''}`,
        'gold',
        l,
      )}
      <p style="margin:10px 0 0">${htm(l, c.body)}</p>`,
    cta: args.ordersUrl ? { label: c.cta, url: args.ordersUrl } : undefined,
  });
  const text = lines(
    txt(l, c.heading, vars),
    '',
    txt(l, c.callout, vars) + (args.cutoffLabel ? ` ${txt(l, c.cutoff, vars)}.` : ''),
    args.ordersUrl && `\n${c.cta}: ${args.ordersUrl}`,
  );
  return { subject: txt(l, c.subject, vars), html, text };
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
 *
 * The strings live in EMAIL_COPY.{he,en}.decision (W2-13); this keeps the old shape.
 * The three masculine-singular verbs are W2-04's work item (pinned by its test).
 */
export const DECISION_COPY = {
  he: EMAIL_COPY.he.decision,
  en: EMAIL_COPY.en.decision,
} as const satisfies Record<EmailLocale, Record<string, string>>;

export function approvalNeededEmail(args: {
  supplierName: string;
  discrepancyCount: number;
  atRiskIls: string; // formatted ₪
  /** Formatted ₪ the owner can claim back (W2-04: Σ claimableLines). Replaces the at-risk line. */
  claimableIls?: string;
  approvalsUrl?: string;
  /** Deep link to this invoice's decision (W2-04). Preferred over `approvalsUrl` for the CTA. */
  invoiceUrl?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).approvalNeeded;
  const d = DECISION_COPY[l];
  const amount = args.claimableIls ?? args.atRiskIls;
  const vars = {
    supplier: args.supplierName,
    count: args.discrepancyCount,
    amount,
    approve: d.approve.replace(/\s*\{amount\}\s*/, ' ').trim(),
    reject: d.reject,
  };
  const amountHtml = ilsSpan(amount, 'danger');
  const html = renderEmail({
    locale: l,
    accent: COLORS.danger,
    preview: txt(l, c.preview, vars),
    heading: c.heading,
    bodyHtml: `
      ${callout(
        `${htm(l, c.found, vars, ['supplier'])}<br>
         ${htm(l, args.claimableIls ? c.claimable : c.atRisk, { amount: amountHtml }, [], ['amount'])}`,
        'danger',
        l,
      )}
      <p style="margin:10px 0 0">${htm(l, c.choices, vars, ['approve', 'reject'])}</p>`,
    cta: args.invoiceUrl
      ? { label: c.ctaInvoice, url: args.invoiceUrl }
      : args.approvalsUrl
        ? { label: c.cta, url: args.approvalsUrl }
        : undefined,
  });
  const link = args.invoiceUrl ?? args.approvalsUrl;
  const text = lines(
    txt(l, c.subject, vars),
    '',
    txt(l, c.found, vars),
    txt(l, args.claimableIls ? c.claimable : c.atRisk, vars),
    txt(l, c.choices, vars),
    link && `\n${args.invoiceUrl ? c.ctaInvoice : c.cta}: ${link}`,
  );
  return { subject: txt(l, c.subject, vars), html, text };
}

/* ─────────────────────── weekly digest ──────────────────────────── */

export function weeklyLeakReportEmail(args: {
  weekLabel: string; // e.g. "13–19 ביוני"
  savedIls: string; // formatted ₪ found in discrepancies this week
  leakedIls: string; // formatted ₪ still open (not decided)
  topSupplier?: string;
  dashboardUrl?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).weekly;
  const vars = { week: args.weekLabel, found: args.savedIls, open: args.leakedIls, supplier: args.topSupplier ?? '' };
  const html = renderEmail({
    locale: l,
    accent: COLORS.gold,
    preview: txt(l, c.preview, vars),
    heading: txt(l, c.heading, vars),
    bodyHtml: `
      ${callout(htm(l, c.found, { amount: ilsSpan(args.savedIls, 'gold') }, [], ['amount']), 'gold', l)}
      ${callout(htm(l, c.open, { amount: ilsSpan(args.leakedIls, 'danger') }, [], ['amount']), 'danger', l)}
      ${args.topSupplier ? `<p style="margin:10px 0 0">${htm(l, c.topSupplier, vars, ['supplier'])}</p>` : ''}`,
    cta: args.dashboardUrl ? { label: c.cta, url: args.dashboardUrl } : undefined,
  });
  const text = lines(
    txt(l, c.heading, vars),
    '',
    txt(l, c.found, { amount: args.savedIls }),
    txt(l, c.open, { amount: args.leakedIls }),
    args.topSupplier && txt(l, c.topSupplier, vars),
    args.dashboardUrl && `\n${c.cta}: ${args.dashboardUrl}`,
  );
  return { subject: txt(l, c.subject, vars), html, text };
}

/* ─────────────────────── end-of-day digest ──────────────────────── */

function statRow(label: string, valueHtml: string, locale: EmailLocale = 'he'): string {
  const start = locale === 'en' ? 'left' : 'right';
  const end = locale === 'en' ? 'right' : 'left';
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;text-align:${start}">${escapeHtml(label)}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:15px;text-align:${end};white-space:nowrap">${valueHtml}</td>
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
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).endOfDay;
  const nf = new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'he-IL');
  const vars = {
    count: args.openCreditsCount,
    amount: args.openCreditsIls,
    caught: args.todayCaughtCount,
    date: args.dateLabel,
  };
  const rows = [
    statRow(c.openLabel, `${ilsSpan(args.openCreditsIls, 'danger')} · ${nf.format(args.openCreditsCount)}`, l),
    statRow(c.caughtLabel, `${ilsSpan(args.todayCaughtIls, 'gold')} · ${nf.format(args.todayCaughtCount)}`, l),
    args.pendingApprovals != null
      ? statRow(c.pendingLabel, `<strong>${nf.format(args.pendingApprovals)}</strong>`, l)
      : '',
    args.topSupplier ? statRow(c.topLabel, `<strong><bdi>${escapeHtml(args.topSupplier)}</bdi></strong>`, l) : '',
  ].join('');

  const html = renderEmail({
    locale: l,
    accent: args.openCreditsCount > 0 ? COLORS.danger : COLORS.gold,
    preview: txt(l, c.preview, vars),
    heading: txt(l, c.heading, vars),
    bodyHtml: `
      <p style="margin:0 0 8px">${htm(l, c.intro)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">${rows}</table>
      ${
        args.openCreditsCount > 0
          ? `<p style="margin:12px 0 0;color:${COLORS.muted};font-size:13px">${htm(l, c.openNote)}</p>`
          : `<p style="margin:12px 0 0;color:${COLORS.gold};font-weight:700">${htm(l, c.clean)}</p>`
      }`,
    cta: args.approvalsUrl ? { label: c.cta, url: args.approvalsUrl } : undefined,
  });

  const text = lines(
    txt(l, c.heading, vars),
    '',
    `${c.openLabel}: ${txt(l, '{amount}', { amount: args.openCreditsIls })} (${nf.format(args.openCreditsCount)})`,
    `${c.caughtLabel}: ${txt(l, '{amount}', { amount: args.todayCaughtIls })} (${nf.format(args.todayCaughtCount)})`,
    args.pendingApprovals != null && `${c.pendingLabel}: ${nf.format(args.pendingApprovals)}`,
    args.topSupplier && `${c.topLabel}: ${txt(l, '{s}', { s: args.topSupplier })}`,
    args.approvalsUrl && `\n${c.cta}: ${args.approvalsUrl}`,
  );
  return { subject: txt(l, c.subject, vars), html, text };
}

/* ─────────────────────── invoice could not be read (G-06) ───────── */

/**
 * A terminal OCR failure, for the uploader and the owner/manager members (G-06).
 * Carries no ₪ at all, so it is safe for every role. Pass `supplierName`/`fileName`
 * only to recipients who may see them.
 */
export function invoiceOcrFailedEmail(args: {
  supplierName?: string | null;
  fileName?: string | null;
  /** Short, human reason (already localised by the caller), e.g. "הצילום מטושטש". */
  reason?: string | null;
  url?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).invoiceOcrFailed;
  const vars = { supplier: args.supplierName ?? '', file: args.fileName ?? '', reason: args.reason ?? '' };
  const subject = args.supplierName ? txt(l, c.subjectSupplier, vars) : c.subject;
  const body = args.fileName ? c.bodyFile : c.body;
  const html = renderEmail({
    locale: l,
    accent: COLORS.danger,
    preview: txt(l, body, vars),
    heading: c.heading,
    bodyHtml: `${P}${htm(l, body, vars, ['file'])}</p>${args.reason ? `${NOTE}${htm(l, c.reason, vars)}</p>` : ''}`,
    cta: args.url ? { label: c.cta, url: args.url } : undefined,
  });
  const text = lines(
    subject,
    '',
    txt(l, body, vars),
    args.reason && txt(l, c.reason, vars),
    args.url && `\n${c.cta}: ${args.url}`,
  );
  return { subject, html, text };
}

/* ─────────────────────── generic task notice (G-06) ─────────────── */

/**
 * A generic act-now notice: the caller supplies the (already localised) title and
 * body. `amountIls` renders only when passed, so callers omit it for roles without
 * `money.view` (receiver, chef).
 */
export function taskNoticeEmail(args: {
  title: string;
  body?: string | null;
  amountIls?: string | null;
  url?: string;
  locale?: EmailLocale;
}): RenderedEmail {
  const l = loc(args.locale);
  const c = copyOf(l).taskNotice;
  const html = renderEmail({
    locale: l,
    accent: COLORS.primary,
    preview: args.body ?? args.title,
    heading: args.title,
    bodyHtml: [
      args.body ? `${P}${escapeHtml(args.body)}</p>` : '',
      args.amountIls ? `${P}${htm(l, c.amount, { amount: ilsSpan(args.amountIls, 'ink') }, [], ['amount'])}</p>` : '',
    ].join(''),
    cta: args.url ? { label: c.cta, url: args.url } : undefined,
  });
  const text = lines(
    args.title,
    args.body && `\n${args.body}`,
    args.amountIls && txt(l, c.amount, { amount: args.amountIls }),
    args.url && `\n${c.cta}: ${args.url}`,
  );
  return { subject: args.title, html, text };
}
