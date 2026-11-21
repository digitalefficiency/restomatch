/**
 * notify() — the one way to tell a PERSON something (G-06, deep-fix class 14).
 *
 *   notify(tx, { restaurantId, event, audience, template, vars, deepLink, entity })
 *
 * - resolves `audience` at enqueue, inside ONE restaurant, to real members at
 *   verified addresses (recipients.ts `resolveAudience`); `role:` targets do not
 *   compile (address.ts) and throw INVALID_TARGET at runtime;
 * - writes ONE outbox row per (user, channel) with
 *   `dedupeKey = ${event}:${restaurantId}:${entity.id}:${userId}:${channel}`, so a replay
 *   enqueues nothing, and `payload.{userId, event}`;
 * - applies the owner's alert rules now: quiet 23:00–06:00 and on Shabbat, at
 *   most 6 per person per day (the 7th+ move to the next slot, `payload.digest`);
 * - strips ₪ vars for roles without money view (receiver, chef);
 * - only ENQUEUES. It never calls a Notifier: only the dispatcher may say "sent";
 *   without a provider the dispatcher parks the row `failed + skipped_no_provider`.
 *
 * It never opens its own transaction: pass the caller's `tx` (G-05's emit()
 * savepoint once it merges). That is also what makes the `scheduled_at` UPDATE
 * race-free: the dispatcher cannot see the row before commit.
 */
import {
  and,
  eq,
  gte,
  invoices,
  notificationsOutbox,
  sql,
  suppliers,
  users,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { addressToTarget, type Address, type AddressChannel } from './address';
import {
  localDay,
  nextDayAllowedAt,
  SEND_WINDOW_TZ,
  STAFF_ALERT_DAILY_CAP,
  staffAlertWindow,
} from './sendWindow';
import { enqueueNotification } from './outbox';
import { invoiceOcrFailedEmail } from './templates';
import { MANAGER_ROLES, resolveAudience, type Audience, type AudienceMember } from './recipients';

export type { Address, AddressChannel } from './address';
export type { Audience, AudienceMember } from './recipients';
export { resolveAudience } from './recipients';

/* ── Owner alert rules: ONE implementation, sendWindow.ts (#173, on main) ──
 * Quiet 23:00–06:00, Shabbat Fri 15:00 → Sat 19:00 (NOTIFY_SHABBAT_WINDOW
 * overrides), at most STAFF_ALERT_DAILY_CAP per person per day, in
 * Asia/Jerusalem. notify() schedules with the same functions the dispatcher
 * and the inline notifiers use, so the rule cannot drift. The `tz` parameters
 * below are kept for call-site compatibility; sendWindow is Israel-only. */

export const ALERT_TZ_FALLBACK = SEND_WINDOW_TZ;
/** At most this many alerts per person per channel per local day; the rest go to the digest. */
export const MAX_ALERTS_PER_DAY = STAFF_ALERT_DAILY_CAP;

/** Is `at` inside quiet hours or Shabbat? */
export function isQuietAt(at: Date, _tz: string = ALERT_TZ_FALLBACK): boolean {
  return !staffAlertWindow(at).open;
}

/** The first allowed instant at or after `at` (itself when open). */
export function nextAllowedAt(at: Date, _tz: string = ALERT_TZ_FALLBACK): Date {
  const d = staffAlertWindow(at);
  return d.open ? at : d.nextAllowedAt;
}

/** Local midnight (Israel) of the day containing `at`, as a UTC instant. */
export function localDayStart(at: Date, _tz: string = ALERT_TZ_FALLBACK): Date {
  return localDay(at).start;
}

/** The next digest slot for an over-cap alert: the next day's 06:00, past Shabbat. */
export function nextDaySlot(at: Date, _tz: string = ALERT_TZ_FALLBACK): Date {
  return nextDayAllowedAt(at);
}

/**
 * When may this alert go out? `sentToday` = this person's alerts on this channel
 * already enqueued today (local day). Returns null scheduledAt for "now".
 */
export function planSchedule(input: { now: Date; tz?: string; sentToday: number }): {
  scheduledAt: Date | null;
  digest: boolean;
} {
  const tz = input.tz ?? ALERT_TZ_FALLBACK;
  if (input.sentToday >= MAX_ALERTS_PER_DAY) return { scheduledAt: nextDaySlot(input.now, tz), digest: true };
  const at = nextAllowedAt(input.now, tz);
  return { scheduledAt: at.getTime() === input.now.getTime() ? null : at, digest: false };
}

/* ── ₪ redaction ── */

export type PriceScope = 'orders' | 'recipes' | 'general';

/**
 * Interim for G-07's `canViewPrices(role, scope)` (lib/capabilities.ts, PR #182):
 * same table. Owner, manager, bookkeeper see ₪; the chef only on orders and
 * recipes; the receiver never. Swap to the import in one line when G-07 merges.
 */
export function canSeeMoney(role: UserRole, scope: PriceScope = 'general'): boolean {
  if (role === 'owner' || role === 'manager' || role === 'bookkeeper') return true;
  if (role === 'chef') return scope === 'orders' || scope === 'recipes';
  return false;
}

/** Drop every ₪ var for a recipient who may not see money. */
export function redactVars(
  vars: Record<string, unknown>,
  moneyVars: readonly string[],
  allowed: boolean,
): Record<string, unknown> {
  if (allowed || moneyVars.length === 0) return { ...vars };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) if (!moneyVars.includes(k)) out[k] = v;
  return out;
}

/* ── Rendering (an injected `render` until W2-13's templates slice) ── */

export interface RenderInput {
  template: string;
  channel: AddressChannel;
  locale: 'he' | 'en';
  role: UserRole;
  vars: Record<string, unknown>;
  deepLink?: string;
  canSeeMoney: boolean;
}
export interface Rendered {
  subject?: string;
  body: string;
  html?: string;
}
/** Return null to skip this channel for this person. */
export type RenderFn = (input: RenderInput) => Rendered | null;

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The app's public origin for links in notices (same precedence as the worker's appBaseUrl). */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_BASE_URL ?? env.AUTH_URL ?? 'https://app.restomatch.co.il').replace(/\/+$/, '');
}

/** An absolute link for a stored deep-link path; undefined when there is none. */
export function absoluteUrl(path: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${appBaseUrl(env)}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** A short, human reason for a failed read (no codes in a notice). */
export const OCR_REASON_TEXT: Record<'he' | 'en', Record<string, string>> = {
  he: {
    quota_exceeded: 'מכסת הקריאה החודשית נוצלה',
    unreadable: 'הצילום לא קריא',
    unsupported_format: 'סוג הקובץ לא נתמך',
    stalled: 'הקריאה נתקעה',
    provider_config: 'תקלה בשירות הקריאה',
    extraction_failed: 'לא הצלחנו לחלץ את הנתונים',
  },
  en: {
    quota_exceeded: 'the monthly reading quota is used up',
    unreadable: 'the photo is not readable',
    unsupported_format: 'the file type is not supported',
    stalled: 'the read got stuck',
    provider_config: 'a problem with the reading service',
    extraction_failed: 'we could not extract the data',
  },
};

export function ocrReasonText(reason: unknown, locale: 'he' | 'en'): string | null {
  return typeof reason === 'string' ? (OCR_REASON_TEXT[locale][reason] ?? OCR_REASON_TEXT[locale].extraction_failed!) : null;
}

/**
 * The renderers notify() knows. `invoiceOcrFailed` is W2-13's branded
 * template (HTML + the 'לחשבונית' CTA) with an ABSOLUTE link; the e-mail row
 * carries html (stored as payload.__html by the outbox), WhatsApp gets the
 * plain-text version. No ₪ in either.
 */
export const defaultRender: RenderFn = (i) => {
  if (i.template === 'invoiceOcrFailed') {
    const audience = i.vars.audience === 'managers' ? 'managers' : 'uploader';
    const email = invoiceOcrFailedEmail({
      audience,
      supplierName: s(i.vars.supplierName),
      fileName: s(i.vars.fileName),
      uploaderName: s(i.vars.uploaderName),
      reason: ocrReasonText(i.vars.reason, i.locale),
      showSupplier: audience === 'managers',
      url: absoluteUrl(i.deepLink),
      locale: i.locale,
    });
    return i.channel === 'email'
      ? { subject: email.subject, body: email.text, html: email.html }
      : { body: email.text };
  }
  throw new Error(`notify: no template "${i.template}" (inject a render)`);
};

/* ── notify() ── */

export interface NotifyInput {
  restaurantId: string;
  /** Stable event name, e.g. 'invoice.ocr_failed'. Part of the dedupe key. */
  event: string;
  audience: Audience;
  template: string;
  vars?: Record<string, unknown>;
  /** Keys of `vars` that carry ₪; stripped for recipients without money view. */
  moneyVars?: readonly string[];
  /** Which money capability applies (the chef sees ₪ on orders and recipes only). */
  moneyScope?: PriceScope;
  /** A path (stored in payload.deepLink), or one per recipient role. Rendered absolute. */
  deepLink?: string | ((role: UserRole) => string);
  entity: { type: string; id: string };
  /** Channels to try; each needs a matching verified address. Default: e-mail + WhatsApp. */
  channels?: readonly AddressChannel[];
  render?: RenderFn;
  now?: Date;
  /** Kept for compatibility; the send window is Asia/Jerusalem (sendWindow.ts). */
  timezone?: string;
  /**
   * Extra keys stored on each row's `payload` as given (e.g. `invoiceId`, so an
   * alert can be joined to its invoice for the "acted within 48h" KPI). The
   * reserved keys (userId, event, template, locale, deepLink, digest) always win.
   * Never put ₪ here: payload is not redacted per recipient.
   */
  payload?: Record<string, unknown>;
}

export interface NotifyRow {
  id: string | null;
  userId: string;
  channel: AddressChannel;
  deduped: boolean;
  scheduledAt: Date | null;
  digest: boolean;
}
export interface NotifyResult {
  enqueued: number;
  deduped: number;
  failed: number;
  rows: NotifyRow[];
}

export const DEFAULT_CHANNELS: readonly AddressChannel[] = ['email', 'whatsapp'];

/**
 * The outbox dedupe index is GLOBAL, so the key carries the restaurant: a user
 * who belongs to two restaurants can never have one tenant's notice suppressed
 * by (or deduped onto) the other's row (tenant-security-warden, #199).
 */
export function notifyDedupeKey(
  event: string,
  restaurantId: string,
  entityId: string,
  userId: string,
  channel: AddressChannel,
): string {
  return `${event}:${restaurantId}:${entityId}:${userId}:${channel}`;
}

async function sentTodayCount(
  tx: Database,
  restaurantId: string,
  userId: string,
  channel: AddressChannel,
  dayStart: Date,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsOutbox)
    .where(
      and(
        eq(notificationsOutbox.restaurantId, restaurantId),
        eq(notificationsOutbox.channel, channel),
        gte(notificationsOutbox.createdAt, dayStart),
        sql`${notificationsOutbox.payload}->>'userId' = ${userId}`,
      ),
    );
  return Number(row?.n ?? 0);
}

export async function notify(tx: Database, input: NotifyInput): Promise<NotifyResult> {
  const now = input.now ?? new Date();
  const render = input.render ?? defaultRender;
  const channels = input.channels ?? DEFAULT_CHANNELS;
  const result: NotifyResult = { enqueued: 0, deduped: 0, failed: 0, rows: [] };

  const members = await resolveAudience(tx, input.restaurantId, input.audience);
  if (members.length === 0) return result;
  const tz = input.timezone ?? ALERT_TZ_FALLBACK;
  const dayStart = localDayStart(now, tz);

  for (const m of members) {
    const money = canSeeMoney(m.role, input.moneyScope);
    const vars = redactVars(input.vars ?? {}, input.moneyVars ?? [], money);
    const deepLink = typeof input.deepLink === 'function' ? input.deepLink(m.role) : input.deepLink;
    for (const address of addressesFor(m, channels)) {
      const channel = address.channel;
      try {
        const rendered = render({
          template: input.template,
          channel,
          locale: m.locale,
          role: m.role,
          vars,
          deepLink,
          canSeeMoney: money,
        });
        if (!rendered) continue;
        const target = addressToTarget(address);
        const sentToday = await sentTodayCount(tx, input.restaurantId, m.userId, channel, dayStart);
        const plan = planSchedule({ now, tz, sentToday });
        const payload: Record<string, unknown> = {
          ...(input.payload ?? {}),
          userId: m.userId,
          event: input.event,
          template: input.template,
          locale: m.locale,
          ...(deepLink ? { deepLink } : {}),
          ...(plan.digest ? { digest: true } : {}),
        };
        const { id, deduped } = await enqueueNotification(tx, {
          restaurantId: input.restaurantId,
          channel,
          target,
          subject: rendered.subject,
          body: rendered.body,
          html: channel === 'email' ? rendered.html : undefined,
          payload,
          relatedEntityType: input.entity.type,
          relatedEntityId: input.entity.id,
          dedupeKey: notifyDedupeKey(input.event, input.restaurantId, input.entity.id, m.userId, channel),
        });
        if (deduped) {
          result.deduped += 1;
          result.rows.push({ id, userId: m.userId, channel, deduped, scheduledAt: null, digest: false });
          continue;
        }
        if (plan.scheduledAt) {
          await tx
            .update(notificationsOutbox)
            .set({ scheduledAt: plan.scheduledAt })
            .where(and(eq(notificationsOutbox.id, id), eq(notificationsOutbox.status, 'queued')));
        }
        result.enqueued += 1;
        result.rows.push({ id, userId: m.userId, channel, deduped, scheduledAt: plan.scheduledAt, digest: plan.digest });
      } catch (err) {
        // One bad row (e.g. enqueueNotification's "failed to enqueue") never aborts the others.
        result.failed += 1;
        result.rows.push({ id: null, userId: m.userId, channel, deduped: false, scheduledAt: null, digest: false });
        console.error(
          `[notify] ${input.event} entity=${input.entity.id} user=${m.userId} channel=${channel} failed`,
          err,
        );
      }
    }
  }
  return result;
}

function addressesFor(m: AudienceMember, channels: readonly AddressChannel[]): Address[] {
  const out: Address[] = [];
  for (const ch of channels) {
    const a = m.addresses.find((x) => x.channel === ch);
    if (a) out.push(a);
  }
  return out;
}

/* ── The OCR-failure hand-off ── */

export type OcrFailureReason = 'extraction_failed' | 'quota_exceeded' | (string & {});

/**
 * A failed invoice read reaches the uploader (no ₪) and the owner/manager
 * members (with supplier and file). Idempotent through the dedupe keys: a retry
 * or replay creates no second notice.
 */
export async function notifyInvoiceOcrFailed(
  tx: Database,
  input: { restaurantId: string; invoiceId: string; reason: OcrFailureReason; uploaderId?: string | null; now?: Date; render?: RenderFn },
): Promise<NotifyResult> {
  const [inv] = await tx
    .select({
      createdBy: invoices.createdBy,
      rawImageUrl: invoices.rawImageUrl,
      rawPdfUrl: invoices.rawPdfUrl,
      supplierName: suppliers.name,
      uploaderName: users.name,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .leftJoin(users, eq(users.id, invoices.createdBy))
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, input.restaurantId)))
    .limit(1);
  const total: NotifyResult = { enqueued: 0, deduped: 0, failed: 0, rows: [] };
  if (!inv) return total;
  const fileName = fileNameOf(inv.rawPdfUrl ?? inv.rawImageUrl);
  const invoiceLink = `/dashboard/invoices/${input.invoiceId}`;
  const base = {
    restaurantId: input.restaurantId,
    event: 'invoice.ocr_failed',
    template: 'invoiceOcrFailed',
    entity: { type: 'invoice', id: input.invoiceId },
    payload: { invoiceId: input.invoiceId },
    channels: DEFAULT_CHANNELS,
    now: input.now,
    render: input.render,
  };
  const merge = (r: NotifyResult) => {
    total.enqueued += r.enqueued;
    total.deduped += r.deduped;
    total.failed += r.failed;
    total.rows.push(...r.rows);
  };
  const uploaderId = input.uploaderId ?? inv.createdBy;
  if (uploaderId) {
    merge(
      await notify(tx, {
        ...base,
        audience: { userIds: [uploaderId] },
        vars: { audience: 'uploader', reason: input.reason, fileName },
        // A receiver (or chef) has no invoice screen: back to receiving. Finance roles open the invoice.
        deepLink: (role) => (role === 'receiver' || role === 'chef' ? '/dashboard/receiving' : invoiceLink),
      }),
    );
  }
  // The uploader may also be a manager: the per-user dedupe key keeps it to one notice.
  merge(
    await notify(tx, {
      ...base,
      audience: { roles: MANAGER_ROLES },
      vars: { audience: 'managers', reason: input.reason, fileName, supplierName: inv.supplierName, uploaderName: inv.uploaderName },
      deepLink: invoiceLink,
    }),
  );
  return total;
}

function fileNameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const last = url.split(/[?#]/)[0]!.split('/').pop();
  return last ? decodeURIComponent(last) : null;
}

/* ── The G-05 effect seam ── */

/** Structural subset of G-05's `DomainEvent` this handler reads. */
export interface NotifyEffectEvent {
  type: string;
  restaurantId: string;
  entityId: string;
  at: Date;
  payload: Record<string, unknown>;
}

/**
 * The `notify` effect handler. When G-05 merges this registers as
 * `registerEffectHandler('notify', notifyEffect)`; until then the worker's
 * `onOcrFailed()` calls it directly. Events this package does not route yet are
 * a no-op (their owners switch: W2-04 escalate, W2-05 dock exception, W3-09
 * supplier answer).
 */
export async function notifyEffect(db: Database, event: NotifyEffectEvent): Promise<void> {
  if (event.type === 'invoice.ocr_failed') {
    await notifyInvoiceOcrFailed(db, {
      restaurantId: event.restaurantId,
      invoiceId: event.entityId,
      reason: typeof event.payload.reason === 'string' ? event.payload.reason : 'extraction_failed',
      uploaderId: typeof event.payload.uploaderId === 'string' ? event.payload.uploaderId : null,
      now: event.at,
    });
  }
}
