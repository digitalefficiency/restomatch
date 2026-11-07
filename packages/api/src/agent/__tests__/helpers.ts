/** Shared setup of the agent's DB tests: the RLS-enforced app role, recorded model clients. */
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  restaurants,
  testDbUrl,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { vi } from 'vitest';
import type { AskClientLike } from '../../ask/claude';
import type { AgentBinding } from '../caller';
import type { Tenant } from '../../__tests__/fixtures';

export const TEST_DB_URL = testDbUrl();
export const ownerDb = createDb(TEST_DB_URL);

export async function appRoleDb(): Promise<Database> {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  return createDb(await ensureRlsAppRole(TEST_DB_URL));
}

export async function setFeatures(t: Tenant, features: Record<string, boolean>) {
  await ownerDb.update(restaurants).set({ settings: { features } as never }).where(eq(restaurants.id, t.restaurantId));
}

/** Test-only binding (interim for WA-03ʰ `wa_bindings`). */
export function fakeBinding(t: Tenant, role: UserRole = 'owner', userId = t.ownerUserId): AgentBinding {
  return { userId, restaurantId: t.restaurantId, role, restaurantName: `מסעדה ${t.supplierName.slice(-1)}` };
}

type Body = Record<string, any>;
export function recordedModel(script: (body: Body, call: number) => Record<string, unknown>) {
  const bodies: Body[] = [];
  const create = vi.fn(async (body: Body) => {
    bodies.push(JSON.parse(JSON.stringify(body)));
    return script(body, bodies.length - 1) as never;
  });
  const client: AskClientLike = { create };
  return { client, create, bodies };
}
export const toolUse = (name: string, input: unknown = {}, id = 'tu_1') => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 1000, output_tokens: 100 },
});
export const final = (answer: string, citations: unknown[] = []) => ({
  content: [{ type: 'text', text: JSON.stringify({ answer, citations }) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1500, output_tokens: 200 },
});
/** Every tool_result the model was sent, parsed. */
export function toolResults(bodies: Body[]): unknown[] {
  return bodies.flatMap((b) =>
    (b.messages as Array<{ content: unknown }>).flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Array<{ type: string; content?: string }>)
            .filter((c) => c.type === 'tool_result')
            .map((c) => {
              try {
                return JSON.parse(c.content ?? 'null');
              } catch {
                return c.content;
              }
            })
        : [],
    ),
  );
}
