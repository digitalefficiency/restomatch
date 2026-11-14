/**
 * deliverOutboxRow — the one honest send step for a claimed outbox row (H-05).
 *
 * Contract for the dispatcher (outboxDispatch.ts switches to this in slice b,
 * after AU-04 and #173 are on main):
 *   { outcome: 'sent', externalId }        → status 'sent', sent_at = now()
 *   { outcome: 'skipped', reason }         → status 'failed', last_error = reason (no retry)
 *   { outcome: 'rejected', reason }        → status 'failed', last_error = reason (no retry:
 *                                             the row itself is wrong)
 *   throws                                 → retry with backoff (provider/network error)
 *
 * It sends nothing it should not: quiet hours, Shabbat and the ≤6/day cap are
 * applied at enqueue by G-06 notify() (scheduled_at), and the dispatcher only
 * claims rows whose scheduled_at has passed. This step does not re-decide them.
 */
import { SKIPPED_NO_PROVIDER } from '../delivery';
import type { EmailAttachment, NotificationChannel } from '../types';
import type { DeliveryProviders } from './providers';
import { readWaTemplate, WaTemplateError } from './waTemplates';
import { pushMessageFromRow, PushGoneError } from './webPush';

/** A push row whose target has no stored subscription (or it expired). */
export const SKIPPED_NO_SUBSCRIPTION = 'skipped_no_subscription';

export interface DeliverableRow {
  id: string;
  restaurantId: string;
  channel: NotificationChannel;
  target: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  dedupeKey?: string | null;
}

export type DeliveryOutcome =
  | { outcome: 'sent'; externalId: string | null }
  | { outcome: 'skipped'; reason: typeof SKIPPED_NO_PROVIDER | typeof SKIPPED_NO_SUBSCRIPTION }
  | { outcome: 'rejected'; reason: string };

function readAttachments(payload: Record<string, unknown> | null): EmailAttachment[] | undefined {
  const raw = payload?.__attachments;
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (a): a is EmailAttachment =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as EmailAttachment).filename === 'string' &&
      typeof (a as EmailAttachment).contentBase64 === 'string',
  );
  return out.length ? out : undefined;
}

export async function deliverOutboxRow(row: DeliverableRow, providers: DeliveryProviders): Promise<DeliveryOutcome> {
  // G-06: a role is never an address. Such a row can never be delivered.
  if (row.target.startsWith('role:')) return { outcome: 'rejected', reason: 'invalid_target_role' };

  if (row.channel === 'email') {
    if (!providers.email) return { outcome: 'skipped', reason: SKIPPED_NO_PROVIDER };
    const html = row.payload?.__html;
    const { externalId } = await providers.email({
      restaurantId: row.restaurantId,
      channel: 'email',
      target: row.target,
      subject: row.subject ?? undefined,
      body: row.body,
      html: typeof html === 'string' ? html : undefined,
      attachments: readAttachments(row.payload),
      relatedEntityType: row.relatedEntityType ?? undefined,
      relatedEntityId: row.relatedEntityId ?? undefined,
    });
    return { outcome: 'sent', externalId: externalId ?? null };
  }

  if (row.channel === 'whatsapp') {
    if (!providers.whatsapp) return { outcome: 'skipped', reason: SKIPPED_NO_PROVIDER };
    try {
      const tpl = readWaTemplate(row.payload);
      const id = tpl
        ? await providers.whatsapp.sendTemplate(row.target, tpl)
        : await providers.whatsapp.sendText(row.target, row.body);
      return { outcome: 'sent', externalId: id ?? null };
    } catch (err) {
      if (err instanceof WaTemplateError) return { outcome: 'rejected', reason: `wa_${err.code.toLowerCase()}` };
      throw err;
    }
  }

  // push
  if (!providers.push) return { outcome: 'skipped', reason: SKIPPED_NO_PROVIDER };
  const sub = await providers.push.resolveSubscription(row.restaurantId, row.target);
  if (!sub) return { outcome: 'skipped', reason: SKIPPED_NO_SUBSCRIPTION };
  try {
    const { externalId } = await providers.push.provider.send(sub, pushMessageFromRow(row));
    return { outcome: 'sent', externalId: externalId ?? null };
  } catch (err) {
    if (err instanceof PushGoneError) return { outcome: 'skipped', reason: SKIPPED_NO_SUBSCRIPTION };
    throw err;
  }
}
