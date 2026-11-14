import { briefCopy } from './copy';
import { supplierDelayEmail } from '../notifications/templates';
import { ilDayMonthDot, ilDayMonthSlash, ilTimeLabel } from './dates';
import { goLink, mailtoLink, waMeLink } from './links';
import type { BriefContext, BriefMessage } from './types';

/**
 * A6 · the 10:00 late-truck messages on chase days 1/3/7.
 *  - The MANAGER gets the late PO plus a ready-to-send, pre-addressed question to
 *    the supplier (wa.me / mailto). Nothing is sent to the supplier by the server.
 *  - On day 1 only, the RECEIVER hears the truck is late: no ₪, no supplier link
 *    (the manager owns the chase).
 * Both render through W2-13's `supplierDelayEmail` (one design); this file adds only
 * the supplier draft text and its pre-addressed links.
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

/** "02/11 08:00" (dd/MM HH:mm, Israel time): never readable as an amount. */
function plannedLabel(at: Date): string {
  return `${ilDayMonthSlash(at)} ${ilTimeLabel(at)}`;
}

/**
 * The manager's message: W2-13's reviewed `supplierDelayEmail` (one design) plus
 * the pre-addressed wa.me / mailto supplier drafts this file builds.
 */
export function lateTruckManagerBrief(input: LateTruckInput): LateTruckManagerMessage {
  const locale = input.locale ?? 'he';
  const supplierText = lateTruckSupplierText(input);
  const wa = waMeLink(input.contactWhatsapp, supplierText);
  const mail = mailtoLink(input.contactEmail, briefCopy('he').lateTruck.supplierSubject(input.poRef), supplierText);
  const deepLink = goLink(input.baseUrl, input.restaurantId, `/dashboard/receiving/${encodeURIComponent(input.poId)}`);
  const m = supplierDelayEmail({
    supplierName: input.supplierName,
    expectedAtLabel: plannedLabel(input.expectedAt),
    daysLate: input.daysLate,
    lineCount: input.lineCount,
    poUrl: deepLink,
    chase: { whatsapp: wa, mailto: mail },
    locale,
  });
  return {
    ...m,
    deepLink,
    dedupeSuffix: `${input.poId}:d${input.daysLate}`,
    automationId: 'A6',
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    whatsappLink: wa,
    mailtoLink: mail,
  };
}

/** Day 1 only; any other chase day → `null`. No ₪, no supplier contact (the manager owns the chase). */
export function lateTruckReceiverBrief(
  input: Pick<LateTruckInput, 'restaurantId' | 'baseUrl' | 'locale' | 'poId' | 'supplierName' | 'expectedAt' | 'daysLate' | 'lineCount' | 'invoiceId'>,
): BriefMessage | null {
  if (input.daysLate !== 1) return null;
  const deepLink = goLink(input.baseUrl, input.restaurantId, '/dashboard/receiving');
  const m = supplierDelayEmail({
    supplierName: input.supplierName,
    expectedAtLabel: ilDayMonthSlash(input.expectedAt),
    daysLate: input.daysLate,
    lineCount: input.lineCount,
    poUrl: deepLink,
    forReceiver: true,
    locale: input.locale ?? 'he',
  });
  return {
    ...m,
    deepLink,
    dedupeSuffix: `${input.poId}:d1`,
    automationId: 'A6',
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
  };
}
