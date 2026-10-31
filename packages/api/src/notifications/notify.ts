/**
 * notify() — the one way to tell a PERSON something (G-06, deep-fix class 14).
 *
 *   notify(tx, { restaurantId, event, audience, template, vars, deepLink, entity })
 *
 * - resolves `audience` at enqueue, inside ONE restaurant, to real members at
 *   verified addresses (recipients.ts `resolveAudience`); `role:` targets do not
 *   compile (address.ts) and throw INVALID_TARGET at runtime;
 * - writes ONE outbox row per (user, channel) with
 *   `dedupeKey = ${event}:${entity.id}:${userId}:${channel}`, so a replay
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
  restaurants,
  sql,
  suppliers,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { addressToTarget, type Address, type AddressChannel } from './address';
import { enqueueNotification } from './outbox';
import { MANAGER_ROLES, resolveAudience, type Audience, type AudienceMember } from './recipients';

export type { Address, AddressChannel } from './address';
export type { Audience, AudienceMember } from './recipients';
export { resolveAudience } from './recipients';

/* ── Owner alert rules (binding owner decision; H-05 may refine with holidays) ── */

export const ALERT_TZ_FALLBACK = 'Asia/Jerusalem';
/** Quiet every night, local time: [23:00, 06:00). */
export const QUIET_HOURS = { startHour: 23, endHour: 6 } as const;
/** Shabbat window, local time: Friday 15:00 → Saturday 21:00 (dow: 0 = Sunday). */
export const SHABBAT_WINDOW = { startDow: 5, startHour: 15, endDow: 6, endHour: 21 } as const;
/** At most this many alerts per person per channel per local day; the rest go to the digest. */
export const MAX_ALERTS_PER_DAY = 6;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  dow: number;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function safeTz(tz: string | null | undefined): string {
  if (!tz) return ALERT_TZ_FALLBACK;
  try {
    formatter(tz);
    return tz;
  } catch {
    return ALERT_TZ_FALLBACK;
  }
}

export function localParts(at: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const x of formatter(safeTz(tz)).formatToParts(at)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    dow: DOW[p.weekday ?? 'Sun'] ?? 0,
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

/** The UTC instant of a local wall-clock time in `tz` (DST-correct to the minute). */
export function zonedTime(tz: string, y: number, mo: number, d: number, h = 0, mi = 0): Date {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (seen === target) break;
    guess += target - seen;
  }
  return new Date(guess);
}

function inShabbat(p: LocalParts): boolean {
  const m = p.hour * 60 + p.minute;
  if (p.dow === SHABBAT_WINDOW.startDow) return m >= SHABBAT_WINDOW.startHour * 60;
  if (p.dow === SHABBAT_WINDOW.endDow) return m < SHABBAT_WINDOW.endHour * 60;
  return false;
}

function inNight(p: LocalParts): boolean {
  return p.hour >= QUIET_HOURS.startHour || p.hour < QUIET_HOURS.endHour;
}

/** Is `at` inside quiet hours or Shabbat (restaurant tz)? */
export function isQuietAt(at: Date, tz: string = ALERT_TZ_FALLBACK): boolean {
  const p = localParts(at, tz);
  return inNight(p) || inShabbat(p);
}

function addDays(p: LocalParts, n: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** The first allowed minute at or after `at` (itself when not quiet). */
export function nextAllowedAt(at: Date, tz: string = ALERT_TZ_FALLBACK): Date {
  const zone = safeTz(tz);
  let t = at;
  for (let i = 0; i < 6; i++) {
    const p = localParts(t, zone);
    if (inShabbat(p)) {
      const end = p.dow === SHABBAT_WINDOW.endDow ? addDays(p, 0) : addDays(p, 1);
      t = zonedTime(zone, end.y, end.m, end.d, SHABBAT_WINDOW.endHour, 0);
      continue;
    }
    if (inNight(p)) {
      const morning = p.hour >= QUIET_HOURS.startHour ? addDays(p, 1) : addDays(p, 0);
      t = zonedTime(zone, morning.y, morning.m, morning.d, QUIET_HOURS.endHour, 0);
      continue;
    }
    return t;
  }
  return t;
}

/** Local midnight (restaurant tz) of the day containing `at`, as a UTC instant. */
export function localDayStart(at: Date, tz: string = ALERT_TZ_FALLBACK): Date {
  const zone = safeTz(tz);
  const p = localParts(at, zone);
  return zonedTime(zone, p.year, p.month, p.day, 0, 0);
}

/** The next digest slot for an over-cap alert: the first allowed minute of the next local day. */
export function nextDaySlot(at: Date, tz: string = ALERT_TZ_FALLBACK): Date {
  const zone = safeTz(tz);
  const n = addDays(localParts(at, zone), 1);
  return nextAllowedAt(zonedTime(zone, n.y, n.m, n.d, 0, 0), zone);
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

/**
 * PLACEHOLDER copy until W2-13's `invoiceOcrFailed` template lands (short,
 * he/en, no ₪). Swap `defaultRender` for the W2-13 renderer in one line.
 */
export const INTERIM_TEMPLATES: Record<string, (i: RenderInput) => Rendered> = {
  invoiceOcrFailed: (i) => {
    const supplier = s(i.vars.supplierName);
    const file = s(i.vars.fileName);
    const quota = i.vars.reason === 'quota_exceeded';
    const forUploader = i.vars.audience === 'uploader';
    if (i.locale === 'en') {
      const subject = 'We could not read an invoice';
      const body = forUploader
        ? `We could not read the invoice you uploaded${file ? ` (${file})` : ''}. A manager was told; you can carry on with the order.`
        : `Invoice read failed${supplier ? `: ${supplier}` : ''}${file ? ` (${file})` : ''}. ${quota ? 'The monthly reading quota is used up. ' : ''}It waits for a manual check.`;
      return { subject, body };
    }
    const subject = 'לא הצלחנו לקרוא חשבונית';
    const body = forUploader
      ? `לא הצלחנו לקרוא את החשבונית שהעליתם${file ? ` (${file})` : ''}. המנהל קיבל הודעה, ואפשר להמשיך מול ההזמנה.`
      : `קריאת חשבונית נכשלה${supplier ? `: ${supplier}` : ''}${file ? ` (${file})` : ''}. ${quota ? 'מכסת הקריאה החודשית נוצלה. ' : ''}החשבונית ממתינה לבדיקה ידנית.`;
    return { subject, body };
  },
};

export const defaultRender: RenderFn = (i) => {
  const t = INTERIM_TEMPLATES[i.template];
  if (!t) throw new Error(`notify: no template "${i.template}" (inject render until W2-13)`);
  return t(i);
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
  deepLink?: string;
  entity: { type: string; id: string };
  /** Channels to try; each needs a matching verified address. Default: e-mail + WhatsApp. */
  channels?: readonly AddressChannel[];
  render?: RenderFn;
  now?: Date;
  /** Restaurant tz; read from `restaurants.timezone` when omitted. */
  timezone?: string;
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

export function notifyDedupeKey(event: string, entityId: string, userId: string, channel: AddressChannel): string {
  return `${event}:${entityId}:${userId}:${channel}`;
}

async function restaurantTz(tx: Database, restaurantId: string): Promise<string> {
  const [r] = await tx
    .select({ tz: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return safeTz(r?.tz);
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
  const tz = input.timezone ? safeTz(input.timezone) : await restaurantTz(tx, input.restaurantId);
  const dayStart = localDayStart(now, tz);

  for (const m of members) {
    const money = canSeeMoney(m.role, input.moneyScope);
    const vars = redactVars(input.vars ?? {}, input.moneyVars ?? [], money);
    for (const address of addressesFor(m, channels)) {
      const channel = address.channel;
      try {
        const rendered = render({
          template: input.template,
          channel,
          locale: m.locale,
          role: m.role,
          vars,
          deepLink: input.deepLink,
          canSeeMoney: money,
        });
        if (!rendered) continue;
        const target = addressToTarget(address);
        const sentToday = await sentTodayCount(tx, input.restaurantId, m.userId, channel, dayStart);
        const plan = planSchedule({ now, tz, sentToday });
        const payload: Record<string, unknown> = {
          userId: m.userId,
          event: input.event,
          template: input.template,
          locale: m.locale,
          ...(input.deepLink ? { deepLink: input.deepLink } : {}),
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
          dedupeKey: notifyDedupeKey(input.event, input.entity.id, m.userId, channel),
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
    })
    .from(invoices)
    .leftJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, input.restaurantId)))
    .limit(1);
  const total: NotifyResult = { enqueued: 0, deduped: 0, failed: 0, rows: [] };
  if (!inv) return total;
  const fileName = fileNameOf(inv.rawPdfUrl ?? inv.rawImageUrl);
  const base = {
    restaurantId: input.restaurantId,
    event: 'invoice.ocr_failed',
    template: 'invoiceOcrFailed',
    entity: { type: 'invoice', id: input.invoiceId },
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
        deepLink: '/dashboard/receiving',
      }),
    );
  }
  // The uploader may also be a manager: the per-user dedupe key keeps it to one notice.
  merge(
    await notify(tx, {
      ...base,
      audience: { roles: MANAGER_ROLES },
      vars: { audience: 'managers', reason: input.reason, fileName, supplierName: inv.supplierName },
      deepLink: `/dashboard/invoices/${input.invoiceId}`,
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
