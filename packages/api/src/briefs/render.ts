import { renderEmail } from '../notifications/templates';
import type { BriefLocale } from './types';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface BriefHtmlLine {
  text: string;
  /** Optional per-line link (rendered as a small link after the text). */
  href?: string;
  linkLabel?: string;
}

/**
 * The brief body inside the shared brand frame (`renderEmail`, read-only import):
 * a lead line, then one row per item, then one CTA. Everything is escaped here.
 */
export function briefHtml(args: {
  locale: BriefLocale;
  preview: string;
  heading: string;
  lead?: string;
  lines: BriefHtmlLine[];
  extraHtml?: string;
  cta?: { label: string; url: string };
}): string {
  const align = args.locale === 'en' ? 'left' : 'right';
  const rows = args.lines
    .map(
      (l) =>
        `<li style="margin:4px 0;text-align:${align}">${esc(l.text)}${
          l.href ? ` · <a href="${esc(l.href)}" style="color:#4f46e5">${esc(l.linkLabel ?? '')}</a>` : ''
        }</li>`,
    )
    .join('');
  return renderEmail({
    locale: args.locale,
    preview: args.preview,
    heading: args.heading,
    bodyHtml: `${args.lead ? `<p style="margin:0 0 6px">${esc(args.lead)}</p>` : ''}<ul style="margin:0;padding-inline-start:20px">${rows}</ul>${args.extraHtml ?? ''}`,
    cta: args.cta,
  });
}
