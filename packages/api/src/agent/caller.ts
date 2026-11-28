/**
 * The WhatsApp agent's server caller (WA-02, design §C.2 / README §2.3, §2.11).
 *
 *  - Identity comes from the BINDING only: `{ userId, restaurantId, role }` of a
 *    verified binding (WA-03ʰ `wa_bindings`; interim: the typed AgentBinding the
 *    caller passes). Nothing the model writes reaches the session.
 *  - Agent turns run on the APP-ROLE connection (`DATABASE_URL_APP`, no
 *    BYPASSRLS). `assertAgentConnection` refuses a superuser / BYPASSRLS
 *    connection (fails closed), so RLS scopes every statement underneath the
 *    procedures' own restaurant filters.
 *  - Every tool result passes `redactFor` (redact.ts) before anything else.
 */
import { sql, withRestaurant, type Database, type UserRole } from '@restomatch/db';
import { figuresOf, type Figures } from '../ask/tools';
import type { AppContext } from '../context';
import { appRouter } from '../index';
import { isInternalPath } from './links';
import { redactFor } from './redact';
import { toolFor, type AgentTool, type ToolRunContext } from './registry';

export interface AgentBinding {
  userId: string;
  restaurantId: string;
  role: UserRole;
  /** The restaurant's display name (system prompt + copy). */
  restaurantName: string;
}

export type AgentCaller = ReturnType<typeof appRouter.createCaller>;

export function agentCaller(db: Database, b: AgentBinding): AgentCaller {
  const ctx: AppContext = { db, session: { userId: b.userId, restaurantId: b.restaurantId, role: b.role } };
  return appRouter.createCaller(ctx);
}

/** Run `fn` in the binding's tenant transaction (both RLS GUCs set), as memberProcedure does. */
export function runInAgentTx<T>(db: Database, b: AgentBinding, fn: (tx: Database) => Promise<T>): Promise<T> {
  return withRestaurant(db, b.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${b.userId}, true)`);
    return fn(tx);
  });
}

export class AgentDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentDbError';
  }
}

const checked = new WeakMap<Database, Promise<void>>();

/** Refuse (once per connection object) a connection that is superuser or bypasses RLS. */
export function assertAgentConnection(db: Database): Promise<void> {
  let p = checked.get(db);
  if (!p) {
    p = (async () => {
      const rows = (await db.execute(
        sql`select r.rolsuper as super, r.rolbypassrls as bypass,
                   exists (select 1 from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as owns
            from pg_roles r where r.rolname = current_user`,
      )) as unknown as Array<{ super: boolean; bypass: boolean; owns: boolean }>;
      const r = rows[0];
      // A table owner skips RLS too (the policies are not FORCEd): refuse it like a superuser.
      if (!r || r.super || r.bypass || r.owns) {
        throw new AgentDbError('WhatsApp agent turns run on the app-role connection only (RLS enforced)');
      }
    })();
    checked.set(db, p);
    p.catch(() => checked.delete(db));
  }
  return p;
}

export class ToolNotAllowedError extends Error {
  readonly refusal = 'tool_not_allowed' as const;
  constructor(readonly tool: string, readonly role: UserRole) {
    super(`tool not allowed: ${tool.slice(0, 60)}`);
    this.name = 'ToolNotAllowedError';
  }
}

export interface ToolCallResult {
  name: string;
  source: string;
  /** Redacted, JSON-safe data: the ONLY form the model, renderer and links see. */
  data: unknown;
  links: string[];
  figures: Figures;
  facts: string[];
  verdict: string | null;
}

/**
 * Execute one tool for a binding: allow-list → input parse → run → redact →
 * links / figures / facts from the REDACTED data.
 */
export async function callTool(
  db: Database,
  binding: AgentBinding,
  name: string,
  rawInput: unknown,
  opts: { now?: Date } = {},
): Promise<ToolCallResult> {
  const tool: AgentTool | null = toolFor(binding.role, name);
  if (!tool) throw new ToolNotAllowedError(name, binding.role);
  const input = tool.input.parse(rawInput ?? {});
  let caller: AgentCaller | null = null;
  const ctx: ToolRunContext = {
    db,
    binding,
    now: opts.now ?? new Date(),
    caller: () => (caller ??= agentCaller(db, binding)),
    tx: (fn) => runInAgentTx(db, binding, fn),
  };
  const out = await tool.run(ctx, input);
  const data = redactFor(binding.role, tool.source, out.data);
  const links = (out.links ?? tool.links?.(input, data) ?? []).filter(isInternalPath);
  return {
    name: tool.name,
    source: tool.source,
    data,
    links,
    figures: figuresOf(data),
    facts: tool.facts(data, input),
    verdict: tool.verdict?.(data, input) ?? null,
  };
}
