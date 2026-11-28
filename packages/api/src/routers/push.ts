import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Database, UserRole } from '@restomatch/db';
import { SKIPPED_NO_PROVIDER } from '../notifications/delivery';
import { memberProcedure, router } from '../trpc';

/**
 * Web-push subscriptions and per-event notification switches (W3-03b).
 *
 * Storage is H-03's `push_subscriptions` + `notification_prefs` (schema batch A,
 * docs/ux/wave2/H-03.md §3). Until that migration is deployed the router runs
 * over an injected `PushStore` whose rows mirror those two tables column for
 * column; with no store set, every read says `available: false` and every write
 * is refused with `PRECONDITION_FAILED` — nothing is ever pretended saved. The
 * DB adapter is a thin swap (`setPushStore(dbPushStore)`) once H-03 lands.
 *
 * Own data only: every call is scoped to the caller's (restaurant, user) from
 * the session — never an id from the input. Sending is H-05: until a provider
 * and credentials exist, a test push reports `skipped_no_provider`, never `sent`.
 * No ₪ anywhere in this router.
 */

/** `push_subscriptions` (H-03), the columns this router uses. */
export interface PushSubscriptionRecord {
  id: string;
  restaurantId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export const PREF_CHANNELS = ['email', 'whatsapp', 'push'] as const;
export type PrefChannel = (typeof PREF_CHANNELS)[number];

/** `notification_prefs` (H-03). No row = enabled (the column default). */
export interface NotificationPrefRecord {
  id: string;
  restaurantId: string;
  userId: string;
  channel: PrefChannel;
  eventKind: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Owner {
  restaurantId: string;
  userId: string;
}

export interface PushStore {
  /** Live (not revoked) subscriptions of this user in this restaurant. */
  listSubscriptions(db: Database, owner: Owner): Promise<PushSubscriptionRecord[]>;
  /** Insert, or refresh keys/user agent/last_seen and clear revoked_at, on (restaurant_id, endpoint). */
  upsertSubscription(
    db: Database,
    owner: Owner,
    sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
    now: Date,
  ): Promise<PushSubscriptionRecord>;
  /** Sets revoked_at on this user's own row; false when there was none. */
  revokeSubscription(db: Database, owner: Owner, endpoint: string, now: Date): Promise<boolean>;
  listPrefs(db: Database, owner: Owner): Promise<NotificationPrefRecord[]>;
  /** Upsert on UNIQUE (restaurant_id, user_id, channel, event_kind). */
  setPref(db: Database, owner: Owner, pref: { channel: PrefChannel; eventKind: string; enabled: boolean }, now: Date): Promise<NotificationPrefRecord>;
}

let store: PushStore | null = null;
/** Inject the store (tests; the H-03 DB adapter). `null` = not available. */
export function setPushStore(next: PushStore | null): void {
  store = next;
}

/**
 * The events a person can switch, by role (event_kind ≤ 48 chars). The receiver
 * gets field events only; nothing here carries ₪.
 */
export const PUSH_EVENTS = [
  { kind: 'receiver.morning_brief', roles: ['receiver', 'manager'] },
  { kind: 'delivery.late', roles: ['receiver', 'manager', 'owner'] },
  { kind: 'approval.waiting', roles: ['owner', 'manager'] },
  { kind: 'order.reminder', roles: ['owner', 'manager', 'chef'] },
  { kind: 'claim.overdue', roles: ['owner', 'manager', 'bookkeeper'] },
  { kind: 'invoice.ocr_failed', roles: ['owner', 'manager', 'receiver'] },
] as const satisfies ReadonlyArray<{ kind: string; roles: readonly UserRole[] }>;
export type PushEventKind = (typeof PUSH_EVENTS)[number]['kind'];
const EVENT_KINDS = PUSH_EVENTS.map((e) => e.kind) as [PushEventKind, ...PushEventKind[]];

export function eventsForRole(role: UserRole): PushEventKind[] {
  return PUSH_EVENTS.filter((e) => (e.roles as readonly UserRole[]).includes(role)).map((e) => e.kind);
}

/** The VAPID public key the browser subscribes with; null until H-05 provisions it. */
export function vapidPublicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const k = env.VAPID_PUBLIC_KEY?.trim();
  return k && /^[A-Za-z0-9_-]{40,200}$/.test(k) ? k : null;
}

const b64url = (max: number) => z.string().min(8).max(max).regex(/^[A-Za-z0-9_-]+=*$/);
const endpointSchema = z
  .string()
  .max(2048)
  .url()
  .refine((u) => u.startsWith('https://'), 'push endpoint must be https');

function need(): PushStore {
  if (!store) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'push storage is not available yet' });
  return store;
}

export const pushRouter = router({
  /** What this person's notification screen shows. Never throws for a missing store. */
  status: memberProcedure.query(async ({ ctx }) => {
    const owner: Owner = { restaurantId: ctx.session.restaurantId, userId: ctx.session.userId };
    const kinds = eventsForRole(ctx.session.role);
    const key = vapidPublicKey();
    if (!store) {
      return {
        available: false as const,
        vapidPublicKey: key,
        provider: SKIPPED_NO_PROVIDER,
        devices: 0,
        events: kinds.map((kind) => ({ kind, push: true, email: true, whatsapp: true })),
      };
    }
    const [subs, prefs] = await Promise.all([store.listSubscriptions(ctx.db, owner), store.listPrefs(ctx.db, owner)]);
    const on = (kind: string, channel: PrefChannel) =>
      prefs.find((p) => p.eventKind === kind && p.channel === channel)?.enabled ?? true;
    return {
      available: true as const,
      vapidPublicKey: key,
      provider: SKIPPED_NO_PROVIDER,
      devices: subs.length,
      events: kinds.map((kind) => ({ kind, push: on(kind, 'push'), email: on(kind, 'email'), whatsapp: on(kind, 'whatsapp') })),
    };
  }),

  /** Save this browser's subscription for the caller (from a tap; the page asked permission). */
  subscribe: memberProcedure
    .input(
      z.object({
        endpoint: endpointSchema,
        keys: z.object({ p256dh: b64url(200), auth: b64url(100) }),
        userAgent: z.string().max(300).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s = need();
      const owner: Owner = { restaurantId: ctx.session.restaurantId, userId: ctx.session.userId };
      await s.upsertSubscription(
        ctx.db,
        owner,
        { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null },
        new Date(),
      );
      return { ok: true as const };
    }),

  /** Remove this browser's subscription (only the caller's own row can match). */
  unsubscribe: memberProcedure.input(z.object({ endpoint: endpointSchema })).mutation(async ({ ctx, input }) => {
    const s = need();
    const removed = await s.revokeSubscription(
      ctx.db,
      { restaurantId: ctx.session.restaurantId, userId: ctx.session.userId },
      input.endpoint,
      new Date(),
    );
    return { removed };
  }),

  /** One switch: an event this role receives × a channel. */
  setPref: memberProcedure
    .input(z.object({ eventKind: z.enum(EVENT_KINDS), channel: z.enum(PREF_CHANNELS), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!eventsForRole(ctx.session.role).includes(input.eventKind)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'not an event for this role' });
      }
      const s = need();
      const row = await s.setPref(
        ctx.db,
        { restaurantId: ctx.session.restaurantId, userId: ctx.session.userId },
        { channel: input.channel, eventKind: input.eventKind, enabled: input.enabled },
        new Date(),
      );
      return { eventKind: row.eventKind, channel: row.channel, enabled: row.enabled };
    }),

  /** "Send me a test": no provider until H-05, so it is reported skipped — never sent. */
  test: memberProcedure.mutation(() => ({ status: SKIPPED_NO_PROVIDER })),
});
