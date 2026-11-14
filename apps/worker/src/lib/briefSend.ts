/**
 * AU-04 · the ONE way a role brief leaves the worker: G-06 `notify()` (verified
 * member addresses only, never `role:` targets; quiet hours + Shabbat + ≤6 per
 * person per day via `scheduled_at` / digest). A morning brief is PERISHABLE: when
 * the send window would push it past 12:00 of the same Israel day it is skipped and
 * logged `skipped: quiet`, never queued (`isPerishableSkip`).
 *
 * Channel: e-mail now (AD3); the in-app bell reads `notify` rows once W2-08 does,
 * WhatsApp only after H-05's templates.
 */
import {
  briefPayload,
  isPerishableSkip,
  notify,
  staffAlertWindow,
  type Audience,
  type BriefMessage,
} from '@restomatch/api';
import type { Database, UserRole } from '@restomatch/db';

export interface SendBriefInput {
  restaurantId: string;
  now: Date;
  /** `au:<id>:<day or step>` — with entity + user + channel it is the outbox dedupe key. */
  event: string;
  audience: Audience;
  entity: { type: string; id: string };
  /** One message per recipient, built for their role and locale; `null` = nothing for them. */
  build: (member: { role: UserRole; locale: 'he' | 'en' }) => BriefMessage | null;
  /** 06:00 / 09:00 / 10:00 briefs: skip (never queue) past 12:00 of the same IL day. */
  perishable: boolean;
  /** automationId (+ invoiceId) stored on each row's payload for AU-07. */
  payload: { automationId: string; invoiceId?: string };
}

export interface SendBriefResult {
  enqueued: number;
  deduped: number;
  skipped: 'quiet' | null;
}

export async function sendBrief(db: Database, input: SendBriefInput): Promise<SendBriefResult> {
  const window = staffAlertWindow(input.now);
  const nextAllowed = window.open ? input.now : window.nextAllowedAt;
  if (input.perishable && isPerishableSkip(input.now, nextAllowed)) {
    console.log(`[${input.payload.automationId}] restaurant=${input.restaurantId} skipped: quiet`);
    return { enqueued: 0, deduped: 0, skipped: 'quiet' };
  }
  const res = await notify(db, {
    restaurantId: input.restaurantId,
    event: input.event,
    audience: input.audience,
    template: `brief:${input.payload.automationId}`,
    entity: input.entity,
    channels: ['email'],
    now: input.now,
    payload: briefPayload(input.payload),
    render: ({ role, locale, channel }) => {
      if (channel !== 'email') return null;
      const msg = input.build({ role, locale });
      return msg ? { subject: msg.subject, body: msg.text, html: msg.html } : null;
    },
  });
  return { enqueued: res.enqueued, deduped: res.deduped, skipped: null };
}
