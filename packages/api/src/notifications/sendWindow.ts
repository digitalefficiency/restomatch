/**
 * When may a staff alert go out? (owner decision, pilot 2026-11)
 *
 *   - never during quiet hours, 23:00–06:00 local, any day;
 *   - never on Shabbat: Fri 15:00 → Sat 19:00 local by default, overridable
 *     with NOTIFY_SHABBAT_WINDOW="FRI15:00-SAT19:00";
 *   - at most STAFF_ALERT_DAILY_CAP alerts per person per local day.
 *
 * Pure: an instant in, an answer out. Wall-clock math goes through Intl in
 * Asia/Jerusalem, so it stays right across the DST changes (the next allowed
 * instant is resolved from local wall time, never by adding 24 h). The one DB
 * read — how many alerts a person already got today — is at the bottom
 * (staffAlertsSentToday / staffAlertHold), shared by the dispatcher and the
 * notifiers that send inline (email.ts, whatsappCloud.ts).
 *
 * Supplier-facing messages a user explicitly sent (a PO send) are exempt —
 * see isExemptFromSendWindow. Auth emails (reset, magic link, invite) never
 * enter the outbox: the web app sends them directly (apps/web/lib/email.ts).
 */
import { notificationsOutbox, sql, type Database } from '@restomatch/db';

export const SEND_WINDOW_TZ = 'Asia/Jerusalem';
export const QUIET_START_HOUR = 23;
export const QUIET_END_HOUR = 6;
export const STAFF_ALERT_DAILY_CAP = 6;
export const DEFAULT_SHABBAT_WINDOW = 'FRI15:00-SAT19:00';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const WEEK_MIN = 7 * 24 * 60;

/** A weekly window in local minutes-of-week (Sun 00:00 = 0). end may wrap past Sat. */
export interface WeeklyWindow {
  startMin: number;
  endMin: number;
}

export type ClosedReason = 'quiet' | 'shabbat';

export type SendWindowDecision =
  | { open: true }
  | { open: false; reason: ClosedReason; nextAllowedAt: Date };

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0 = Sunday
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SEND_WINDOW_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
});

function localParts(at: Date): LocalParts & { second: number } {
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(at)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    dow: DAYS.indexOf(p.weekday!.toUpperCase().slice(0, 3) as (typeof DAYS)[number]),
  };
}

/** The instant whose Israel wall time is y-m-d hh:mm (y-m-d may overflow; Date.UTC normalises it). */
export function localWallToInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  // Two refinements settle the offset on either side of a DST change.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wall - seen;
  }
  return new Date(guess);
}

const PATTERN = /^(SUN|MON|TUE|WED|THU|FRI|SAT)([01]\d|2[0-3]):([0-5]\d)-(SUN|MON|TUE|WED|THU|FRI|SAT)([01]\d|2[0-3]):([0-5]\d)$/;

function toWindow(spec: string): WeeklyWindow | null {
  const m = PATTERN.exec(spec.trim().toUpperCase());
  if (!m) return null;
  const at = (d: string, h: string, mi: string) =>
    DAYS.indexOf(d as (typeof DAYS)[number]) * 1440 + Number(h) * 60 + Number(mi);
  const startMin = at(m[1]!, m[2]!, m[3]!);
  let endMin = at(m[4]!, m[5]!, m[6]!);
  if (endMin === startMin) return null;
  if (endMin < startMin) endMin += WEEK_MIN; // e.g. SAT20:00-SUN01:00
  return { startMin, endMin };
}

const warned = new Set<string>();

/**
 * The Shabbat window from NOTIFY_SHABBAT_WINDOW, else the default. A malformed
 * value falls back to the default with one warning per distinct value.
 */
export function shabbatWindow(spec: string | undefined = process.env.NOTIFY_SHABBAT_WINDOW): WeeklyWindow {
  if (spec && spec.trim()) {
    const parsed = toWindow(spec);
    if (parsed) return parsed;
    if (!warned.has(spec)) {
      warned.add(spec);
      console.warn(
        `[send-window] NOTIFY_SHABBAT_WINDOW="${spec}" is not like ${DEFAULT_SHABBAT_WINDOW}; using the default`,
      );
    }
  }
  return toWindow(DEFAULT_SHABBAT_WINDOW)!;
}

/** Test seam: forget which malformed values were already warned about. */
export function resetSendWindowWarnings(): void {
  warned.clear();
}

function inQuiet(p: LocalParts): boolean {
  return p.hour >= QUIET_START_HOUR || p.hour < QUIET_END_HOUR;
}

/** Minutes until the window ends, if `p` is inside it. */
function minutesLeftInWindow(p: LocalParts, w: WeeklyWindow): number | null {
  const mow = p.dow * 1440 + p.hour * 60 + p.minute;
  for (const t of [mow, mow + WEEK_MIN]) {
    if (t >= w.startMin && t < w.endMin) return w.endMin - t;
  }
  return null;
}

/**
 * May a staff alert be sent at `at`? If not: why, and the first instant at
 * which it may (outside quiet hours AND outside the Shabbat window).
 */
export function staffAlertWindow(at: Date, window: WeeklyWindow = shabbatWindow()): SendWindowDecision {
  let cursor = at;
  let reason: ClosedReason | null = null;
  // Quiet hours and Shabbat can chain (Sat 19:00 is open, but a window that
  // ends at 23:30 lands in quiet hours): walk until both are clear.
  for (let i = 0; i < 6; i++) {
    const p = localParts(cursor);
    const left = minutesLeftInWindow(p, window);
    if (left !== null) {
      reason ??= 'shabbat';
      // Resolve the end as local wall time (DST-safe), then drop seconds.
      const endMow = p.dow * 1440 + p.hour * 60 + p.minute + left;
      const dayOffset = Math.floor(endMow / 1440) - p.dow;
      const endOfDay = endMow % 1440;
      cursor = localWallToInstant(p.year, p.month, p.day + dayOffset, Math.floor(endOfDay / 60), endOfDay % 60);
      continue;
    }
    if (inQuiet(p)) {
      reason ??= 'quiet';
      const dayOffset = p.hour >= QUIET_START_HOUR ? 1 : 0;
      cursor = localWallToInstant(p.year, p.month, p.day + dayOffset, QUIET_END_HOUR, 0);
      continue;
    }
    break;
  }
  return reason === null ? { open: true } : { open: false, reason, nextAllowedAt: cursor };
}

/** The local calendar day of `at` as 'YYYY-MM-DD' plus its [start, end) instants. */
export function localDay(at: Date): { key: string; start: Date; end: Date } {
  const p = localParts(at);
  const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return {
    key,
    start: localWallToInstant(p.year, p.month, p.day, 0, 0),
    end: localWallToInstant(p.year, p.month, p.day + 1, 0, 0),
  };
}

/**
 * Where an alert over the day's cap goes: the next day's 06:00, pushed past
 * Shabbat when that lands inside it (it then counts toward that day's cap).
 */
export function nextDayAllowedAt(at: Date, window: WeeklyWindow = shabbatWindow()): Date {
  const p = localParts(at);
  const sixAm = localWallToInstant(p.year, p.month, p.day + 1, QUIET_END_HOUR, 0);
  const d = staffAlertWindow(sixAm, window);
  return d.open ? sixAm : d.nextAllowedAt;
}

/** The outbox fields that decide exemption. */
export interface OutboxKindFields {
  relatedEntityType: string | null;
  dedupeKey: string | null;
}

/**
 * Supplier-facing messages a user explicitly sent — exempt from quiet hours,
 * Shabbat and the cap (the user pressed "send"; the supplier is not staff).
 *
 *   - PO send (orders.placeOrder): related_entity_type 'purchase_order' with
 *     dedupe_key 'po:<id>:placed'. The supplier-DELAY alert shares the entity
 *     type ('po:<id>:delay:…') but goes to managers, so it is NOT exempt.
 *
 * Claim letters are not sent through the outbox today (the user sends the
 * letter; recovery only records letter_sent). A future claim-letter producer
 * must use dedupe_key 'claim:<id>:letter…' to be exempt.
 */
export const EXEMPT_DEDUPE_KEYS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: 'po-send', pattern: /^po:[^:]+:placed$/ },
  { kind: 'claim-letter-send', pattern: /^claim:[^:]+:letter(:|$)/ },
];

export function isExemptFromSendWindow(row: OutboxKindFields): boolean {
  const key = row.dedupeKey;
  if (!key) return false;
  return EXEMPT_DEDUPE_KEYS.some(({ pattern }) => pattern.test(key));
}

/**
 * The related_entity_type of every staff-alert producer (EOD report, order
 * reminders, supplier delays, price alerts, recovery reminders, monthly
 * report, match-run alert, health digest). Anything else — transactional mail
 * (reset, magic link, invite, 2FA, verification: no entity type) or an
 * unknown kind — is never held: a missed alert beats a missed login.
 */
export const STAFF_ALERT_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'restaurant',
  'supplier',
  'purchase_order',
  'price_alert',
  'monthly_report',
  'match_run',
  'health_digest',
]);

/** Is this outbox row a staff alert (held by quiet hours, Shabbat and the cap)? */
export function isStaffAlert(row: OutboxKindFields): boolean {
  if (!row.relatedEntityType || !STAFF_ALERT_ENTITY_TYPES.has(row.relatedEntityType)) return false;
  return !isExemptFromSendWindow(row);
}

/**
 * The per-person key the daily cap counts by. A real address is the person
 * (across restaurants). A symbolic target ('role:manager') is only a person
 * within its restaurant.
 */
export function capKey(row: { restaurantId: string; target: string }): string {
  const t = row.target.trim().toLowerCase();
  return t.startsWith('role:') ? `${row.restaurantId}:${t}` : t;
}

/** The demo tenant's email domain (packages/db DEMO_EMAIL_DOMAIN; repeated so this module stays pure). */
export const DEMO_EMAIL_DOMAIN_FOR_SENDING = 'kfar-hazeitim.test';

/**
 * An address no real provider should ever be handed: the demo tenant's domain
 * or any reserved .test TLD (RFC 2606). Each one is a bounce, and bounces burn
 * the Resend quota.
 */
export function isUndeliverableAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 0) return false;
  const domain = a.slice(at + 1).replace(/\.$/, '');
  return domain === DEMO_EMAIL_DOMAIN_FOR_SENDING || domain === 'test' || domain.endsWith('.test');
}

/**
 * Staff alerts already sent on `now`'s Israel day, per capKey, for `targets`.
 * Rows a mock notifier marked sent at enqueue count too: the person was told.
 */
export async function staffAlertsSentToday(db: Database, now: Date, targets: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const wanted = [...new Set(targets.map((t) => t.trim().toLowerCase()))];
  if (wanted.length === 0) return counts;
  const day = localDay(now);
  const sent = (await db.execute(sql`
    SELECT restaurant_id, target, related_entity_type, dedupe_key
    FROM ${notificationsOutbox}
    WHERE status = 'sent'
      AND sent_at >= ${day.start.toISOString()}::timestamptz
      AND sent_at < ${day.end.toISOString()}::timestamptz
      AND lower(btrim(target)) IN (${sql.join(wanted.map((t) => sql`${t}`), sql`, `)})
  `)) as unknown as Array<{ restaurant_id: string; target: string; related_entity_type: string | null; dedupe_key: string | null }>;
  for (const r of sent) {
    if (!isStaffAlert({ relatedEntityType: r.related_entity_type, dedupeKey: r.dedupe_key })) continue;
    const key = capKey({ restaurantId: r.restaurant_id, target: r.target });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * For a notifier about to send inline: null = send now; a Date = enqueue only,
 * due then (the dispatcher delivers it). Never holds a non-staff message.
 */
export async function staffAlertHold(
  db: Database,
  row: { restaurantId: string; target: string; relatedEntityType?: string | null; dedupeKey?: string | null },
  now: Date,
): Promise<Date | null> {
  if (!isStaffAlert({ relatedEntityType: row.relatedEntityType ?? null, dedupeKey: row.dedupeKey ?? null })) return null;
  const window = shabbatWindow();
  const gate = staffAlertWindow(now, window);
  if (!gate.open) return gate.nextAllowedAt;
  const sent = await staffAlertsSentToday(db, now, [row.target]);
  return (sent.get(capKey(row)) ?? 0) >= STAFF_ALERT_DAILY_CAP ? nextDayAllowedAt(now, window) : null;
}
