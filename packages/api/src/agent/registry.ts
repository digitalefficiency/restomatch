/**
 * The role tool registry of the WhatsApp agent (WA-02, design §C.2).
 *
 * Every tool is READ-ONLY and is either an existing tRPC procedure called
 * through the server caller (session from the binding), or one of Ask's leak
 * tools run in the binding's tenant transaction. The model sees only the tools
 * of its role; a tool name it invents, or one of another role, is refused
 * (`tool_not_allowed`). No tool takes a tenant, user or role id, and none
 * writes: proposals are WA-07's (`agent/actions/**`), one registry row each.
 *
 * Out of the design table until their procedures exist: "close status"
 * (`close` router is empty until W3-05a) and the chef's "order guide".
 */
import type { Database, UserRole } from '@restomatch/db';
import type { z } from 'zod';
import type { AgentBinding, AgentCaller } from './caller';
import { profileFor, type RedactionProfile } from './redact';
import { BOOKKEEPER_TOOLS } from './tools/bookkeeper';
import { CHEF_TOOLS } from './tools/chef';
import { MANAGER_TOOLS } from './tools/manager';
import { OWNER_TOOLS } from './tools/owner';
import { RECEIVER_TOOLS } from './tools/receiver';

export interface ToolRunContext {
  db: Database;
  binding: AgentBinding;
  now: Date;
  /** The tRPC server caller for the binding (session from the binding, never the model). */
  caller: () => AgentCaller;
  /** Run inside the binding's tenant transaction (RLS GUCs set) on the agent's connection. */
  tx: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;
}

export interface ToolRunOutput {
  data: unknown;
  /** Internal `/dashboard…` paths that show this data (validated again before use). */
  links?: string[];
}

export interface AgentTool<I = any> {
  /** The name the model calls. */
  name: string;
  /** Roles whose model may call it (design §C.2 read column). */
  roles: readonly UserRole[];
  /** The procedure path (`approvals.myQueue`) or Ask tool (`ask.leak_hero`): decides the chef's ₪ exemption. */
  source: string;
  kind: 'read';
  description: string;
  input: z.ZodType<I>;
  /** Strict JSON schema the model sees. */
  inputJson: Record<string, unknown>;
  run(ctx: ToolRunContext, input: I): Promise<ToolRunOutput>;
  /** Links for REDACTED data (when `run` gives none). */
  links?(input: I, data: any): string[];
  /** Hebrew fact lines from REDACTED data (₪ via render.ts only). */
  facts(data: any, input: I): string[];
  /** A decisive server sentence that replaces model prose (e.g. "supplier not found"). */
  verdict?(data: any, input: I): string | null;
}

const ALL: AgentTool[] = [...OWNER_TOOLS, ...MANAGER_TOOLS, ...BOOKKEEPER_TOOLS, ...CHEF_TOOLS, ...RECEIVER_TOOLS];

/** name → tool (one definition per name; a duplicate is a build error caught by the registry test). */
export const REGISTRY: ReadonlyMap<string, AgentTool> = new Map(ALL.map((t) => [t.name, t]));
export const REGISTRY_SIZE = ALL.length;

export function toolsFor(role: UserRole): AgentTool[] {
  return ALL.filter((t) => t.roles.includes(role));
}

export function toolFor(role: UserRole, name: string): AgentTool | null {
  const t = REGISTRY.get(name);
  return t && t.roles.includes(role) ? t : null;
}

/** The tool definitions sent to the model for a role (strict, read-only). */
export function toolDefinitionsFor(role: UserRole) {
  return toolsFor(role).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputJson,
    strict: true,
  }));
}

/** The registry as rows `{ name, role, procedure, redaction, kind }` (design §C.2 review table). */
export function registryRows(): Array<{
  name: string;
  role: UserRole;
  procedure: string;
  redaction: RedactionProfile;
  kind: 'read';
}> {
  return ALL.flatMap((t) =>
    t.roles.map((role) => ({ name: t.name, role, procedure: t.source, redaction: profileFor(role), kind: t.kind })),
  );
}
