import { briefCopy } from './copy';
import { ilDayMonthDot, ilDayMonthSlash } from './dates';
import { goLink, mailtoLink, waMeLink } from './links';
import { briefHtml, esc } from './render';
import type { BriefContext, BriefMessage } from './types';

/**
 * A6 · the 10:00 late-truck messages on chase days 1/3/7.
 *  - The MANAGER gets the late PO plus a ready-to-send, pre-addressed question to
 *    the supplier (wa.me / mailto). Nothing is sent to the supplier by the server.
 *  - On day 1 only, the RECEIVER hears the truck is late: no ₪, no supplier link
 *    (the manager owns the chase).
 */
export interface LateTruckInput extends BriefContext {
  poId: string;
  /** The order number the supplier knows (customer_ref / source_ref), or a short id. */
  poRef: string;
  supplierName: string;
  restaurantName: string;
  expectedAt: Date;
  daysLate: number;
  lineCount: number;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  /** The PO's invoice, if one already arrived (AU-07 KPI join); usually absent for a late truck. */
  invoiceId?: string | null;
}

/** The supplier-facing question (Hebrew always: it is the supplier's text). */
export function lateTruckSupplierText(input: Pick<LateTruckInput, 'supplierName' | 'poRef' | 'expectedAt' | 'restaurantName'>): string {
  return briefCopy('he').lateTruck.supplierText(input.supplierName, input.poRef, ilDayMonthDot(input.expectedAt), input.restaurantName);
}

export interface LateTruckManagerMessage extends BriefMessage {
  /** The pre-addressed drafts; `null` when that contact is missing or unreadable. */
  whatsappLink: string | null;
  mailtoLink: string | null;
}

export function lateTruckManagerBrief(input: LateTruckInput): LateTruckManagerMessage {
  const locale = input.locale ?? 'he';
  const c = briefCopy(locale).lateTruck;
  const supplierText = lateTruckSupplierText(input);
  const wa = waMeLink(input.contactWhatsapp, supplierText);
  const mail = mailtoLink(input.contactEmail, c.supplierSubject(input.poRef), supplierText);
  const deepLink = goLink(input.baseUrl, input.restaurantId, `/dashboard/receiving/${encodeURIComponent(input.poId)}`);
  const line = c.managerLine(input.supplierName, input.poRef, ilDayMonthSlash(input.expectedAt), input.daysLate, input.lineCount);
  const links = [wa ? `${c.whatsapp}: ${wa}` : null, mail ? `${c.email}: ${mail}` : null].filter(Boolean);
  const chaseText = links.length > 0 ? `${c.sendToSupplier}\n${links.join('\n')}` : c.noContact;
  const chaseHtml =
    wa || mail
      ? `<p style="margin:10px 0 0">${esc(c.sendToSupplier)} ${[
          wa ? `<a href="${esc(wa)}" style="color:#4f46e5;font-weight:700">[${esc(c.whatsapp)}]</a>` : '',
          mail ? `<a href="${esc(mail)}" style="color:#4f46e5;font-weight:700">[${esc(c.email)}]</a>` : '',
        ]
          .filter(Boolean)
          .join(' ')}</p>`
      : `<p style="margin:10px 0 0">${esc(c.noContact)}</p>`;
  const subject = c.managerSubject(input.supplierName);
  const text = `${line}\n\n${chaseText}\n\n${c.openPo}: ${deepLink}`;
  const html = briefHtml({
    locale,
    preview: line,
    heading: subject,
    lines: [{ text: line }],
    extraHtml: chaseHtml,
    cta: { label: c.openPo, url: deepLink },
  });
  return {
    subject,
    text,
    html,
    deepLink,
    dedupeSuffix: `${input.poId}:d${input.daysLate}`,
    automationId: 'A6',
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    whatsappLink: wa,
    mailtoLink: mail,
  };
}

/** Day 1 only; any other chase day → `null`. No ₪, no supplier contact. */
export function lateTruckReceiverBrief(
  input: Pick<LateTruckInput, 'restaurantId' | 'baseUrl' | 'locale' | 'poId' | 'supplierName' | 'expectedAt' | 'daysLate' | 'invoiceId'>,
): BriefMessage | null {
  if (input.daysLate !== 1) return null;
  const locale = input.locale ?? 'he';
  const c = briefCopy(locale).lateTruck;
  const line = c.receiverLine(input.supplierName, ilDayMonthSlash(input.expectedAt));
  const deepLink = goLink(input.baseUrl, input.restaurantId, '/dashboard/receiving');
  const subject = c.receiverSubject(input.supplierName);
  const text = `${line}\n\n${c.receiverCta}: ${deepLink}`;
  const html = briefHtml({ locale, preview: line, heading: subject, lines: [{ text: line }], cta: { label: c.receiverCta, url: deepLink } });
  return { subject, text, html, deepLink, dedupeSuffix: `${input.poId}:d1`, automationId: 'A6', ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}) };
}
