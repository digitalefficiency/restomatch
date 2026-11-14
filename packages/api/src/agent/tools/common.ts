/**
 * Shared helpers of the agent's role tools (WA-02). Tool data reaching these
 * helpers is already REDACTED JSON (see caller.ts), so accessors are defensive.
 */
import { runTool, type ToolName } from '../../ask/tools';
import type { AgentCaller } from '../caller';
import type { AgentTool, ToolRunContext, ToolRunOutput } from '../registry';
import { z } from 'zod';

export const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
export const has = (o: unknown, k: string): boolean => Object.prototype.hasOwnProperty.call(obj(o), k);

/**
 * Until #211 (LEAK_FILTER) lands, MISSING_ON_INVOICE may still sit in the
 * leak lines: drop every element `{ type: 'MISSING_ON_INVOICE' }` so it is
 * never shown (or summed) as leak. It is never claimable (lib/claims.ts).
 */
export function dropMissingOnInvoice<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => !(v && typeof v === 'object' && (v as { type?: unknown }).type === 'MISSING_ON_INVOICE'))
      .map((v) => dropMissingOnInvoice(v)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = dropMissingOnInvoice(v);
    return out as T;
  }
  return value;
}

export const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const MONTH_JSON = { type: 'string', description: "Calendar month 'YYYY-MM' (Israel time). Omit for the current month." };
export const NO_INPUT = z.object({}).strict();
export const NO_INPUT_JSON = { type: 'object', properties: {}, additionalProperties: false };
export const PO_INPUT = z.object({ poId: z.string().uuid() }).strict();
export const PO_INPUT_JSON = {
  type: 'object',
  properties: { poId: { type: 'string', description: 'A purchase-order id from a deliveries or orders tool result.' } },
  required: ['poId'],
  additionalProperties: false,
};

/** Run one of Ask's read-only leak tools in the binding's tenant transaction. */
export async function runAskTool(ctx: ToolRunContext, name: ToolName, input: unknown): Promise<ToolRunOutput> {
  const out = await ctx.tx((tx) =>
    runTool(name, input, { db: tx, restaurantId: ctx.binding.restaurantId, now: ctx.now, locale: 'he' }),
  );
  return { data: dropMissingOnInvoice(out.data), links: out.links.map((l) => l.href) };
}

/** Call a procedure of the caller by its dotted path (`approvals.myQueue`). */
export async function callProcedure(caller: AgentCaller, path: string, input: unknown): Promise<unknown> {
  let node: unknown = caller;
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  if (typeof node !== 'function') throw new Error(`unknown procedure: ${path}`);
  return (node as (i: unknown) => Promise<unknown>)(input);
}

/** A tool over the tRPC procedure named by its `source`, called as the binding. */
export function procedureTool<I>(
  def: Omit<AgentTool<I>, 'run' | 'kind'> & { toInput?: (i: I) => unknown; post?: (data: unknown) => unknown },
): AgentTool<I> {
  return {
    ...def,
    kind: 'read',
    async run(ctx, input) {
      const data = await callProcedure(ctx.caller(), def.source, def.toInput ? def.toInput(input) : input);
      return { data: def.post ? def.post(data) : data };
    },
  };
}
