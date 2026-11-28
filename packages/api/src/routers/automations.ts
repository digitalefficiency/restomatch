import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SQL } from 'drizzle-orm';
import { and, auditLog, eq, notificationsOutbox, restaurants, sql, type Database } from '@restomatch/db';
import { recordAudit, type AuditAction } from '../audit';
import { appError } from '../errors';
import { featureEnabled, type FeatureKey } from '../lib/features';
import { localDateKeyInTz, startOfLocalDateInTz } from '../lib/time';
import { adminProcedure, financeProcedure, ownerProcedure, router } from '../trpc';
import {
  AUTOMATIONS,
  flagKilled,
  isAutomationOptionKey,
  isFeatureKey,
  isOwnerToggleable,
  type AutomationDef,
  type OutboxMatch,
} from '../automations/registry';
import { automationOption, storedAutomationOptions } from '../automations/options';

/**
 * AU-01 · the owner's "אוטומציות" page.
 *
 * - `list`: every registry row with its state, last run and runs this week
 *   (owner / manager / bookkeeper read; receiver and chef → FORBIDDEN).
 * - `setEnabled`: the owner switches an allow-listed flag (OWNER_TOGGLEABLE) or
 *   an AU option. One jsonb merge (the admin `setFeatures` shape) + one audit
 *   row. Never enqueues anything: the first message comes at the next slot.
 * - `listForAdmin`: the same shape for the platform console, read-only, audited.
 *
 * "Last run" reads `notifications_outbox` only — never `job_queue`, which is
 * revoked from the app role.
 */

const TZ = 'Asia/Jerusalem';

/**
 * Interim until G-05 adds 'automations.toggled' to the AuditAction union
 * (requested 7.11). The column is text; the value is the final one.
 */
const AUTOMATIONS_TOGGLED = 'automations.toggled' as AuditAction;

/** Start (UTC instant) of the Israel week (Sun 00:00 Asia/Jerusalem) containing `now`. */
export function israelWeekStart(now: Date): Date {
  const key = localDateKeyInTz(now, TZ);
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  const sunday = new Date(Date.UTC(y!, m! - 1, d! - dow));
  return startOfLocalDateInTz(sunday.toISOString().slice(0, 10), TZ);
}

function matchSql(m: Exclude<OutboxMatch, { kind: 'none' }>): SQL {
  switch (m.kind) {
    case 'anyOf':
      return sql`(${sql.join(
        m.matchers.map((x) => matchSql(x)),
        sql` or `,
      )})`;
    case 'prefix':
      // starts_with: no LIKE wildcards to escape in a literal prefix.
      return sql`starts_with(${notificationsOutbox.dedupeKey}, ${m.prefix})`;
    case 'like':
      return sql`${notificationsOutbox.dedupeKey} like ${m.like}`;
    case 'relatedEntityType':
      return sql`${notificationsOutbox.relatedEntityType} = ${m.type}`;
  }
}

interface RunStats {
  lastRunAt: Date | null;
  countThisWeek: number | null;
}

/**
 * Runs, not recipients: every producer writes one outbox row per recipient, so
 * a scheduled row counts distinct Israel days and an event row counts distinct
 * related entities. A row with no reliable matcher returns nulls ("עוד לא נמדד").
 */
async function runStats(db: Database, restaurantId: string, def: AutomationDef, weekStart: Date): Promise<RunStats> {
  if (def.outboxMatch.kind === 'none') return { lastRunAt: null, countThisWeek: null };
  const where = and(eq(notificationsOutbox.restaurantId, restaurantId), matchSql(def.outboxMatch));
  const runKey =
    def.slot === 'event'
      ? sql`${notificationsOutbox.relatedEntityId}`
      : sql`((${notificationsOutbox.createdAt} at time zone ${TZ})::date)`;
  const [row] = await db
    .select({
      last: sql<Date | string | null>`max(${notificationsOutbox.createdAt})`,
      week: sql<number>`count(distinct ${runKey}) filter (where ${notificationsOutbox.createdAt} >= ${weekStart.toISOString()}::timestamptz)`,
    })
    .from(notificationsOutbox)
    .where(where);
  const last = row?.last ? new Date(row.last) : null;
  return { lastRunAt: last, countThisWeek: Number(row?.week ?? 0) };
}

export interface AutomationRow {
  id: string;
  key: string;
  kind: 'flag' | 'option' | 'always';
  /** What `setEnabled({ key })` takes for this row: the flag or option key; null for 'always'. */
  controlKey: string | null;
  slot: AutomationDef['slot'];
  audience: AutomationDef['audience'];
  carriesIls: boolean;
  on: boolean;
  /** The owner may switch it here (allow-listed flag or option). */
  controllable: boolean;
  /** Off for every tenant by the FEATURES_OFF kill-switch. */
  killed: boolean;
  /** Inactive because a required channel flag is off (e.g. WhatsApp ingest). */
  blockedBy: FeatureKey | null;
  measured: boolean;
  lastRunAt: Date | null;
  countThisWeek: number | null;
}

function rowState(def: AutomationDef, settings: unknown) {
  const c = def.control;
  if (c.kind === 'flag') {
    return {
      kind: 'flag' as const,
      on: featureEnabled(settings, c.flag),
      controllable: isOwnerToggleable(c.flag),
      killed: flagKilled(c.flag),
    };
  }
  if (c.kind === 'option') {
    return { kind: 'option' as const, on: automationOption(settings, c.option), controllable: true, killed: false };
  }
  return { kind: 'always' as const, on: true, controllable: false, killed: false };
}

export async function listAutomations(db: Database, restaurantId: string, now = new Date()): Promise<AutomationRow[]> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'restaurant not found' });
  const weekStart = israelWeekStart(now);
  const out: AutomationRow[] = [];
  for (const def of AUTOMATIONS) {
    const st = rowState(def, r.settings);
    const blockedBy = def.requires && !featureEnabled(r.settings, def.requires) ? def.requires : null;
    const stats = await runStats(db, restaurantId, def, weekStart);
    out.push({
      id: def.id,
      key: def.key,
      controlKey: def.control.kind === 'flag' ? def.control.flag : def.control.kind === 'option' ? def.control.option : null,
      slot: def.slot,
      audience: def.audience,
      carriesIls: def.carriesIls,
      ...st,
      on: st.on && !blockedBy,
      blockedBy,
      measured: def.outboxMatch.kind !== 'none',
      ...stats,
    });
  }
  return out;
}

const SetEnabledInput = z.object({
  key: z.string().min(1).max(64),
  on: z.boolean(),
  clientMutationId: z.string().uuid(),
});

export const automationsRouter = router({
  /** Interim role gate until G-07 `can()`: owner / manager / bookkeeper. */
  list: financeProcedure.query(async ({ ctx }) => {
    const rows = await listAutomations(ctx.db, ctx.session.restaurantId);
    return { rows, canEdit: ctx.session.role === 'owner' };
  }),

  setEnabled: ownerProcedure.input(SetEnabledInput).mutation(async ({ ctx, input }) => {
    const restaurantId = ctx.session.restaurantId;
    const isOption = isAutomationOptionKey(input.key);
    if (!isOption && !(isFeatureKey(input.key) && isOwnerToggleable(input.key))) {
      throw appError('FORBIDDEN', 'automations.notOwnerToggleable', `"${input.key}" אינו ניתן להפעלה על ידי הבעלים`, {
        key: input.key,
      });
    }
    const bucket = isOption ? 'automations' : 'features';
    const automationId =
      AUTOMATIONS.find((a) =>
        a.control.kind === 'flag' ? a.control.flag === input.key : a.control.kind === 'option' && a.control.option === input.key,
      )?.id ?? null;
    const killed = !isOption && flagKilled(input.key as FeatureKey);

    return ctx.db.transaction(async (tx) => {
      const [r] = await tx
        .select({ id: restaurants.id, settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .for('update')
        .limit(1);
      if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'restaurant not found' });

      // Replay of the same clientMutationId: nothing new is written.
      const [seen] = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, restaurantId),
            eq(auditLog.action, AUTOMATIONS_TOGGLED),
            sql`${auditLog.after}->>'clientMutationId' = ${input.clientMutationId}`,
          ),
        )
        .limit(1);
      const current = (s: unknown) =>
        isOption
          ? automationOption(s, input.key as never)
          : featureEnabled(s, input.key as FeatureKey);
      if (seen) {
        return { key: input.key, on: current(r.settings), killed, replayed: true as const };
      }

      const before = isOption
        ? { [input.key]: storedAutomationOptions(r.settings)[input.key as never] ?? null }
        : { [input.key]: (r.settings as { features?: Record<string, boolean> } | null)?.features?.[input.key] ?? null };
      const patch = JSON.stringify({ [input.key]: input.on });
      const path = `{${bucket}}`;
      // The admin setFeatures shape: one jsonb merge; every other settings key and
      // every other flag stays as it was. An explicit false survives features.all.
      const [updated] = await tx
        .update(restaurants)
        .set({
          settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), ${path}::text[], (case when jsonb_typeof(${restaurants.settings}->${bucket}) = 'object' then ${restaurants.settings}->${bucket} else '{}'::jsonb end) || ${patch}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, r.id))
        .returning({ settings: restaurants.settings });

      await recordAudit(tx, {
        restaurantId,
        userId: ctx.session.userId,
        action: AUTOMATIONS_TOGGLED,
        entityType: 'restaurant',
        entityId: restaurantId,
        before,
        after: { [input.key]: input.on, automationId, bucket, clientMutationId: input.clientMutationId },
      });
      return { key: input.key, on: current(updated?.settings), killed, replayed: false as const };
    });
  }),

  /** Platform console: the same rows for one tenant, read-only, audited like the other admin reads. */
  listForAdmin: adminProcedure
    .input(z.object({ restaurantId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await listAutomations(ctx.db, input.restaurantId);
      await recordAudit(ctx.db, {
        restaurantId: input.restaurantId,
        userId: ctx.session.userId,
        action: 'admin.viewed',
        entityType: 'restaurant',
        entityId: input.restaurantId,
        after: { view: 'automations' },
      });
      return { rows };
    }),
});
