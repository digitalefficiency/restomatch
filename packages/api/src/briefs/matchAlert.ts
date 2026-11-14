import { createHash } from 'node:crypto';
import { briefCopy } from './copy';
import { goLink } from './links';
import { briefIls } from './money';
import { briefHtml } from './render';
import type { BriefContext, BriefMessage } from './types';

/**
 * A1 · honest match alerts: a RE-match notifies only when it finds something NEW.
 *
 * "New" is NOT `persisted.rolesNeedingNotification` — that set holds every finding
 * with no prior DECISION, so an open, undecided finding carried over from the last
 * run would re-alert on every re-match (brief §8 trap). Instead the job loads the
 * previous run's finding identities (open AND decided) before it deletes that run,
 * and only identities absent from it are new.
 *
 * Identity = (invoice, type, po_line_id ?? invoice_line_id ?? gr_line_id).
 */
export interface FindingIdentityInput {
  invoiceId: string;
  type: string;
  poLineId?: string | null;
  invoiceLineId?: string | null;
  grLineId?: string | null;
}

export function findingIdentity(f: FindingIdentityInput): string {
  return `${f.invoiceId}|${f.type}|${f.poLineId ?? f.invoiceLineId ?? f.grLineId ?? '-'}`;
}

/** Sorted, unique identities of `current` that are absent from `previous`. */
export function newFindingKeys(previous: Iterable<string>, current: Iterable<string>): string[] {
  const before = new Set(previous);
  return [...new Set(current)].filter((k) => !before.has(k)).sort();
}

/** A short stable hash of a SORTED identity set: the dedupe tail (never the run id). */
export function identitySetHash(keys: readonly string[]): string {
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex').slice(0, 16);
}

export interface MatchAlertInput extends BriefContext {
  invoiceId: string;
  /** The supplier's invoice number as printed. */
  invoiceRef: string;
  supplierName: string;
  /** The new identities (from `newFindingKeys`). Empty → no alert. */
  newKeys: readonly string[];
  /**
   * The run's leak figure in integer agorot (#211 `persisted.leakIls`, then W2-04's
   * `claimableLines`). `null` = unknown → no ₪ line (unknown is never ₪0).
   */
  leakAgorot: number | null;
}

export function matchAlertBrief(input: MatchAlertInput): BriefMessage | null {
  if (input.newKeys.length === 0) return null;
  const locale = input.locale ?? 'he';
  const c = briefCopy(locale).matchAlert;
  const n = input.newKeys.length;
  const deepLink = goLink(input.baseUrl, input.restaurantId, `/dashboard/invoices/${encodeURIComponent(input.invoiceId)}`);
  const line = c.line(n, input.invoiceRef, input.supplierName);
  const ilsLine = input.leakAgorot != null && input.leakAgorot > 0 ? c.ils(briefIls(input.leakAgorot, locale, { agorot: true })) : null;
  const subject = c.subject(n, input.supplierName);
  const text = `${line}${ilsLine ? `\n${ilsLine}` : ''}\n\n${c.cta}: ${deepLink}`;
  const html = briefHtml({
    locale,
    preview: line,
    heading: subject,
    lines: [{ text: line }, ...(ilsLine ? [{ text: ilsLine }] : [])],
    cta: { label: c.cta, url: deepLink },
  });
  return { subject, text, html, deepLink, dedupeSuffix: `${input.invoiceId}:${identitySetHash(input.newKeys)}`, automationId: 'A1', invoiceId: input.invoiceId };
}
