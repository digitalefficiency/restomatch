import { TRPCError } from '@trpc/server';
import { and, auditLog, desc, eq, inArray, users, type Database } from '@restomatch/db';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { recordAudit, type AuditAction } from '../audit';
import { emit, type EmitResult } from '../events';
import type { TransitionEventType } from '../events/types';

/**
 * THE LIFECYCLE KERNEL (G-05) — the one transition authority for invoice,
 * discrepancy and recovery-claim state.
 *
 * A move is ONE guarded statement:
 *
 *   UPDATE <table> SET <status> = <to>, …
 *   WHERE id = $id AND restaurant_id = $rid AND <status> = ANY(<from>)
 *   RETURNING id
 *
 * so a stale screen, a double tap or a concurrent colleague can never move a
 * row out of a state it is no longer in. Then, in the same tenant transaction:
 * exactly one `audit_log` row, the machine's history hook, and `emit()` of the
 * domain event (each effect in its own savepoint).
 *
 * Zero rows updated means one of two things:
 *   - REPLAY: the row already sits in the target and its last move was this
 *     same event with an equal payload → success, no second audit row;
 *   - CONFLICT otherwise → `TRPCError CONFLICT` naming the current status and
 *     who moved it last, and when. Nothing is written.
 *
 * Callers pass `ctx.db` (already the RLS tenant transaction) as `tx`. Never a
 * new connection and never `adminDb`: RLS must apply.
 */

export type EdgeKind = 'forward' | 'side' | 'terminal' | 'reopen';

export interface EdgeSpec<S extends string> {
  /** States the event may leave. */
  from: readonly S[];
  /**
   * Target state. An array means the caller picks one (`input.to`, e.g. a match
   * that ends `matched` or `disputed`); null means a record-only edge: the row
   * is locked and audited but its status stays.
   */
  to: S | readonly S[] | null;
  kind: EdgeKind;
  /** A non-empty `payload.reason` is required. */
  requiresReason?: boolean;
  /** The UI may offer an undo (another edge returns the row). */
  undoable?: boolean;
  /** Only this entry path may take the edge (e.g. `credit_note` for → credited). */
  via?: string;
  audit: AuditAction;
  domainEvent: TransitionEventType;
  /**
   * A business precondition checked on the locked row (e.g. "no decision and
   * no claim"). Return a reason to refuse (PRECONDITION_FAILED, nothing
   * written), or null to allow.
   */
  precondition?: (tx: Database, c: MoveContext<S, string>) => Promise<string | null>;
  /**
   * The edge name and guard are defined but the edge is not enabled yet (e.g.
   * its target needs a schema change). The text names what enables it; every
   * call is refused with PRECONDITION_FAILED.
   */
  reserved?: string;
}

export interface MoveContext<S extends string, E extends string> {
  id: string;
  restaurantId: string;
  event: E;
  from: S;
  to: S;
  actorId: string | null;
  payload: Record<string, unknown>;
  at: Date;
}

export interface MachineConfig<S extends string, E extends string> {
  /** Machine name, also the prefix of its domain events. */
  name: string;
  /** `audit_log.entity_type` of its rows. */
  entityType: string;
  table: PgTable;
  idColumn: PgColumn;
  restaurantColumn: PgColumn;
  statusColumn: PgColumn;
  /** Every value of the status column. */
  states: readonly S[];
  /** States a row may be created in (no edge enters them). */
  initial: readonly S[];
  edges: { readonly [K in E]: EdgeSpec<S> };
  /** Extra columns set by the guarded UPDATE (drizzle property names). */
  patch?: (c: MoveContext<S, E>) => Record<string, unknown>;
  /** Writes after the guarded UPDATE, in the same tx (the row is locked): optional columns, side tables. */
  afterMove?: (tx: Database, c: MoveContext<S, E>) => Promise<void>;
  /** Extra fields for the audit row's `after`. */
  auditAfter?: (c: MoveContext<S, E>) => Record<string, unknown>;
  /** Per-machine history (e.g. `recovery_events`), in the same tx. */
  history?: (tx: Database, c: MoveContext<S, E>) => Promise<void>;
}

export type Machine<S extends string, E extends string> = Readonly<MachineConfig<S, E>> & {
  readonly events: readonly E[];
  /** Every state some edge can enter. */
  readonly targets: readonly S[];
};

export type StateOf<M> = M extends Machine<infer S, string> ? S : never;
export type EventOf<M> = M extends Machine<string, infer E> ? E : never;

export function edgeTargets<S extends string>(edge: EdgeSpec<S>): readonly S[] {
  if (edge.to === null) return [];
  return typeof edge.to === 'string' ? [edge.to] : edge.to;
}

export function defineMachine<S extends string, E extends string>(config: MachineConfig<S, E>): Machine<S, E> {
  const events = Object.keys(config.edges) as E[];
  const targets = new Set<S>();
  for (const e of events) {
    const edge = config.edges[e];
    for (const f of edge.from) if (!config.states.includes(f)) throw new Error(`${config.name}.${e}: unknown from-state ${f}`);
    for (const t of edgeTargets(edge)) {
      if (!config.states.includes(t)) throw new Error(`${config.name}.${e}: unknown target ${t}`);
      targets.add(t);
    }
  }
  return Object.freeze({ ...config, events, targets: [...targets] });
}

/** May `event` leave `from` (ignoring `via` and payload rules)? */
export function canFire<S extends string, E extends string>(machine: Machine<S, E>, from: S, event: E): boolean {
  return machine.edges[event]?.from.includes(from) ?? false;
}

// ── errors ────────────────────────────────────────────────────────────────

export const TRANSITION_CONFLICT_PREFIX = 'lifecycle.conflict:';

export interface TransitionConflictParams {
  [k: string]: string | number;
  machine: string;
  event: string;
  entityId: string;
  currentStatus: string;
  /** Name of whoever moved the row last ('' when unknown or not visible). */
  actorName: string;
  /** ISO time of that move ('' when unknown). */
  at: string;
}

/** The `cause` of a transition CONFLICT; clients read `appParams` (or parse the message). */
export class TransitionConflictCause extends Error {
  readonly appCode = 'lifecycle.conflict';
  constructor(readonly appParams: TransitionConflictParams) {
    super('lifecycle.conflict');
    this.name = 'TransitionConflictCause';
  }
}

export function isTransitionConflict(err: unknown): err is TRPCError & { cause: TransitionConflictCause } {
  return err instanceof TRPCError && err.code === 'CONFLICT' && err.cause instanceof TransitionConflictCause;
}

async function lastMove(tx: Database, entityType: string, restaurantId: string, id: string) {
  const [a] = await tx
    .select({ action: auditLog.action, after: auditLog.after, at: auditLog.at, name: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.entityType, entityType), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  return a ?? null;
}

async function conflictError(
  tx: Database,
  machine: Machine<string, string>,
  input: { id: string; restaurantId: string; event: string },
  currentStatus: string,
): Promise<TRPCError> {
  const last = await lastMove(tx, machine.entityType, input.restaurantId, input.id);
  const params: TransitionConflictParams = {
    machine: machine.name,
    event: input.event,
    entityId: input.id,
    currentStatus,
    actorName: last?.name ?? '',
    at: last?.at ? last.at.toISOString() : '',
  };
  return new TRPCError({
    code: 'CONFLICT',
    message: TRANSITION_CONFLICT_PREFIX + JSON.stringify(params),
    cause: new TransitionConflictCause(params),
  });
}

// ── payload equality (replay detection) ───────────────────────────────────

/** Stable JSON: sorted keys, Dates as ISO, undefined dropped. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value) ?? null);
}

// ── transition ────────────────────────────────────────────────────────────

export interface TransitionInput<S extends string, E extends string> {
  id: string;
  restaurantId: string;
  event: E;
  /** The status the caller's screen showed. Omit only for system moves. */
  expectedFrom?: S;
  /** Required when the edge has several targets. */
  to?: S;
  actorId: string | null;
  payload?: Record<string, unknown>;
  /** Entry path for `via` edges (e.g. `credit_note`). */
  via?: string;
  /** Extra columns for the guarded UPDATE (drizzle property names), e.g. `requiresRole` on escalate. */
  set?: Record<string, unknown>;
  /** Extra guard conditions (e.g. the routing the role check saw). A miss is a CONFLICT. */
  where?: SQL;
  /** Event time; defaults to now. */
  at?: Date;
}

export interface TransitionResult<S extends string> {
  id: string;
  from: S;
  to: S;
  /** True when this call was a replay of a move that already committed. */
  replayed: boolean;
  at: Date;
  effects: EmitResult | null;
}

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message });
}

export const TRANSITION_REFUSED_PREFIX = 'lifecycle.refused:';

/** The `cause` of a PRECONDITION_FAILED refusal: `appParams.reason` is machine-readable. */
export class TransitionRefusedCause extends Error {
  readonly appCode = 'lifecycle.refused';
  constructor(readonly appParams: { reason: string }) {
    super('lifecycle.refused');
    this.name = 'TransitionRefusedCause';
  }
}

function refused(message: string, reason: string): TRPCError {
  return new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `${TRANSITION_REFUSED_PREFIX}${reason}: ${message}`,
    cause: new TransitionRefusedCause({ reason }),
  });
}

export function isTransitionRefused(err: unknown): err is TRPCError & { cause: TransitionRefusedCause } {
  return err instanceof TRPCError && err.code === 'PRECONDITION_FAILED' && err.cause instanceof TransitionRefusedCause;
}

interface Prepared<S extends string> {
  edge: EdgeSpec<S>;
  from: readonly S[];
  to: S | null;
  payload: Record<string, unknown>;
  at: Date;
}

function prepare<S extends string, E extends string>(machine: Machine<S, E>, input: TransitionInput<S, E>): Prepared<S> {
  const edge = machine.edges[input.event] as EdgeSpec<S> | undefined;
  if (!edge) throw badRequest(`${machine.name}: unknown event ${String(input.event)}`);
  if (edge.reserved) throw refused(`${machine.name}.${String(input.event)} is reserved: ${edge.reserved}`, 'reserved');
  if (edge.via && input.via !== edge.via) {
    throw badRequest(`${machine.name}.${input.event} is entered only via ${edge.via}`);
  }
  let to: S | null;
  if (edge.to === null) to = null;
  else if (typeof edge.to === 'string') {
    if (input.to !== undefined && input.to !== edge.to) throw badRequest(`${machine.name}.${input.event} goes to ${edge.to}`);
    to = edge.to as S;
  } else {
    if (input.to === undefined || !edge.to.includes(input.to)) {
      throw badRequest(`${machine.name}.${input.event} needs a target: ${edge.to.join('|')}`);
    }
    to = input.to;
  }
  const payload = input.payload ?? {};
  if (edge.requiresReason) {
    const reason = payload.reason;
    if (typeof reason !== 'string' || reason.trim() === '') throw badRequest(`${machine.name}.${input.event} requires a reason`);
  }
  let from = edge.from;
  if (input.expectedFrom !== undefined) {
    if (!edge.from.includes(input.expectedFrom)) {
      // The screen claims a state the event cannot leave: still a guarded
      // statement (it matches nothing), so a replay or a CONFLICT follows.
      from = [];
    } else from = [input.expectedFrom];
  }
  return { edge, from, to, payload, at: input.at ?? new Date() };
}

async function lockRow(tx: Database, machine: Machine<string, string>, id: string, restaurantId: string) {
  const rows = (await tx
    .select({ status: machine.statusColumn })
    .from(machine.table)
    .where(and(eq(machine.idColumn, id), eq(machine.restaurantColumn, restaurantId)))
    .for('update')) as Array<{ status: string }>;
  return rows[0] ?? null;
}

/** Was the row's last audited move this same event, to this target, with an equal payload? */
async function isReplay(
  tx: Database,
  machine: Machine<string, string>,
  input: { id: string; restaurantId: string; event: string },
  prepared: Prepared<string>,
  current: string,
): Promise<boolean> {
  if (prepared.to === null || current !== prepared.to) return false;
  const last = await lastMove(tx, machine.entityType, input.restaurantId, input.id);
  if (!last || last.action !== prepared.edge.audit) return false;
  const after = (last.after ?? {}) as { machine?: string; event?: string; to?: string; payload?: unknown };
  return (
    after.machine === machine.name &&
    after.event === input.event &&
    after.to === prepared.to &&
    canonicalJson(after.payload ?? {}) === canonicalJson(prepared.payload)
  );
}

/** The guarded UPDATE + audit + history + emit, for a row already locked in `current`. */
async function move<S extends string, E extends string>(
  tx: Database,
  machine: Machine<S, E>,
  input: TransitionInput<S, E>,
  prepared: Prepared<S>,
  current: S,
): Promise<TransitionResult<S> | null> {
  const to = (prepared.to ?? current) as S;
  const ctx: MoveContext<S, E> = {
    id: input.id,
    restaurantId: input.restaurantId,
    event: input.event,
    from: current,
    to,
    actorId: input.actorId,
    payload: prepared.payload,
    at: prepared.at,
  };
  if (prepared.from.length === 0) return null;
  if (prepared.edge.precondition) {
    const reason = await prepared.edge.precondition(tx, ctx as unknown as MoveContext<S, string>);
    if (reason) throw refused(`${machine.name}.${input.event} refused`, reason);
  }
  const statusKey = Object.entries(machine.table).find(([, col]) => col === machine.statusColumn)?.[0];
  if (!statusKey) throw new Error(`${machine.name}: status column is not a column of its table`);
  const set = { ...(machine.patch?.(ctx) ?? {}), ...(input.set ?? {}), [statusKey]: to };
  const conds = [
    eq(machine.idColumn, input.id),
    eq(machine.restaurantColumn, input.restaurantId),
    inArray(machine.statusColumn, [...prepared.from]),
  ];
  if (input.where) conds.push(input.where);
  const updated = (await tx
    .update(machine.table)
    .set(set as never)
    .where(and(...conds))
    .returning({ id: machine.idColumn })) as Array<{ id: string }>;
  if (updated.length === 0) return null;

  await machine.afterMove?.(tx, ctx);
  await recordAudit(tx, {
    restaurantId: input.restaurantId,
    userId: input.actorId,
    action: prepared.edge.audit,
    entityType: machine.entityType,
    entityId: input.id,
    before: { status: current },
    after: {
      machine: machine.name,
      event: input.event,
      from: current,
      to,
      kind: prepared.edge.kind,
      payload: prepared.payload,
      at: prepared.at.toISOString(),
      ...(machine.auditAfter?.(ctx) ?? {}),
    },
  });
  await machine.history?.(tx, ctx);
  const effects = await emit(tx, {
    type: prepared.edge.domainEvent,
    restaurantId: input.restaurantId,
    actorId: input.actorId,
    at: prepared.at,
    entityType: machine.entityType,
    entityId: input.id,
    machine: machine.name,
    event: input.event,
    from: current,
    to,
    payload: prepared.payload,
  });
  return { id: input.id, from: current, to, replayed: false, at: prepared.at, effects };
}

/**
 * Move one row. Success → the move (or the replay of a move that already
 * committed). Stale or illegal → CONFLICT with `{ currentStatus, actorName, at }`
 * and nothing written. Unknown row (or another tenant's) → NOT_FOUND.
 */
export async function transition<S extends string, E extends string>(
  tx: Database,
  machine: Machine<S, E>,
  input: TransitionInput<S, E>,
): Promise<TransitionResult<S>> {
  const prepared = prepare(machine, input);
  const row = await lockRow(tx, machine as never, input.id, input.restaurantId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `${machine.entityType} not found` });
  const current = row.status as S;
  if (prepared.from.includes(current)) {
    const moved = await move(tx, machine, input, prepared, current);
    if (moved) return moved;
  }
  // Zero rows: the status left `from`, or an extra `where` guard missed.
  const now = (await lockRow(tx, machine as never, input.id, input.restaurantId))?.status ?? current;
  if (await isReplay(tx, machine as never, input, prepared as never, now)) {
    return { id: input.id, from: now as S, to: now as S, replayed: true, at: prepared.at, effects: null };
  }
  throw await conflictError(tx, machine as never, input, now);
}

// ── batch ─────────────────────────────────────────────────────────────────

export interface BatchItem<S extends string> {
  id: string;
  /** The status this item showed on the caller's screen (per item, never per batch). */
  expectedStatus: S;
  payload?: Record<string, unknown>;
  to?: S;
}

export interface BatchFailure {
  id: string;
  code: 'CONFLICT' | 'REFUSED';
  /** The row's status now ('' when the row does not exist in this tenant). */
  currentStatus: string;
  /** REFUSED: why (`not_found`, `not_allowed_from_state`, or the guard's reason). */
  reason?: string;
}

export type BatchResult<S extends string> =
  | { ok: true; results: TransitionResult<S>[] }
  | { ok: false; failures: BatchFailure[] };

export interface BatchInput<S extends string, E extends string> {
  restaurantId: string;
  event: E;
  actorId: string | null;
  items: ReadonlyArray<BatchItem<S>>;
  /**
   * Server-side policy per item (e.g. W2-04: bulk approve ≤ ₪200 per invoice,
   * never a blocking item). Return a reason to refuse, or null to allow. The
   * kernel hard-codes no cap.
   */
  guard?: (item: BatchItem<S>, row: { id: string; status: S }) => Promise<string | null> | string | null;
  at?: Date;
}

/**
 * All-or-nothing batch. Every row is locked (in id order) and checked first;
 * if ANY item is stale (CONFLICT) or refused (REFUSED), nothing is written and
 * the per-item detail comes back as `{ ok: false, failures }`. Items whose move
 * already committed with an equal payload count as replayed successes.
 */
export async function transitionMany<S extends string, E extends string>(
  tx: Database,
  machine: Machine<S, E>,
  input: BatchInput<S, E>,
): Promise<BatchResult<S>> {
  const at = input.at ?? new Date();
  const ids = [...new Set(input.items.map((i) => i.id))].sort();
  if (ids.length !== input.items.length) throw badRequest('a batch lists each row once');
  const rows =
    ids.length === 0
      ? []
      : ((await tx
          .select({ id: machine.idColumn, status: machine.statusColumn })
          .from(machine.table)
          .where(and(inArray(machine.idColumn, ids), eq(machine.restaurantColumn, input.restaurantId)))
          .orderBy(machine.idColumn)
          .for('update')) as Array<{ id: string; status: S }>);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const failures: BatchFailure[] = [];
  const todo: Array<{ item: BatchItem<S>; prepared: Prepared<S>; current: S }> = [];
  const replays: TransitionResult<S>[] = [];
  for (const item of input.items) {
    const single: TransitionInput<S, E> = {
      id: item.id,
      restaurantId: input.restaurantId,
      event: input.event,
      expectedFrom: item.expectedStatus,
      to: item.to,
      actorId: input.actorId,
      payload: item.payload,
      at,
    };
    const edge = machine.edges[input.event] as EdgeSpec<S> | undefined;
    if (edge?.reserved) {
      failures.push({ id: item.id, code: 'REFUSED', currentStatus: byId.get(item.id)?.status ?? '', reason: 'reserved' });
      continue;
    }
    const prepared = prepare(machine, single);
    const row = byId.get(item.id);
    if (!row) {
      failures.push({ id: item.id, code: 'REFUSED', currentStatus: '', reason: 'not_found' });
      continue;
    }
    if (row.status !== item.expectedStatus) {
      if (await isReplay(tx, machine as never, single, prepared as never, row.status)) {
        replays.push({ id: item.id, from: row.status, to: row.status, replayed: true, at, effects: null });
      } else failures.push({ id: item.id, code: 'CONFLICT', currentStatus: row.status });
      continue;
    }
    if (prepared.from.length === 0) {
      failures.push({ id: item.id, code: 'REFUSED', currentStatus: row.status, reason: 'not_allowed_from_state' });
      continue;
    }
    const pre = prepared.edge.precondition
      ? await prepared.edge.precondition(tx, {
          id: item.id,
          restaurantId: input.restaurantId,
          event: input.event,
          from: row.status,
          to: (prepared.to ?? row.status) as S,
          actorId: input.actorId,
          payload: prepared.payload,
          at,
        })
      : null;
    if (pre) {
      failures.push({ id: item.id, code: 'REFUSED', currentStatus: row.status, reason: pre });
      continue;
    }
    const refusal = input.guard ? await input.guard(item, row) : null;
    if (refusal) {
      failures.push({ id: item.id, code: 'REFUSED', currentStatus: row.status, reason: refusal });
      continue;
    }
    todo.push({ item, prepared, current: row.status });
  }
  if (failures.length > 0) return { ok: false, failures };

  const results: TransitionResult<S>[] = [...replays];
  for (const { item, prepared, current } of todo) {
    const moved = await move(
      tx,
      machine,
      {
        id: item.id,
        restaurantId: input.restaurantId,
        event: input.event,
        expectedFrom: item.expectedStatus,
        to: item.to,
        actorId: input.actorId,
        payload: item.payload,
        at,
      },
      prepared,
      current,
    );
    // The row is locked and was checked above, so the guarded UPDATE cannot
    // miss; if it ever does, abort the whole batch rather than half-apply it.
    if (!moved) throw await conflictError(tx, machine as never, { id: item.id, restaurantId: input.restaurantId, event: input.event }, current);
    results.push(moved);
  }
  return { ok: true, results };
}
