/**
 * Ask's role table (AU-06) — the SECOND lock behind the router's role gate.
 *
 * The router decides who may open Ask at all (`ask.status` / `ask.ask`); this
 * table decides, per tool, which roles may run it and whether its ₪ figures
 * reach them. It exists so that any later widening of Ask (W3-04 "Ask
 * everywhere", the WhatsApp agent) cannot serve ₪ to a role that may not see
 * it: `runTool` refuses a tool outside `TOOL_ROLES`, and `redactForRole`
 * strips every `…Ils` field plus `figures.ils` for a role without money view.
 *
 * Until G-07's `can('money.view')` lands, money view is hard-coded:
 * owner / manager / bookkeeper = ₪ allowed; receiver / chef = no tool at all
 * (chef sees ₪ only on orders and recipes, neither of which is an Ask tool).
 */
import type { UserRole } from '@restomatch/db';
import type { ToolName, ToolOutput } from './tools';

const FINANCE: readonly UserRole[] = ['owner', 'manager', 'bookkeeper'];

/** Which roles may run each tool. Receiver and chef appear nowhere. */
export const TOOL_ROLES: Readonly<Record<ToolName, readonly UserRole[]>> = {
  leak_hero: FINANCE,
  leak_report: FINANCE,
  leak_breakdown: FINANCE,
  claimable_lines: FINANCE,
  waiting_for_me: FINANCE,
  intake_stuck: FINANCE,
  who_owes_me: FINANCE,
  to_pay_this_week: FINANCE,
  vat_at_risk: FINANCE,
};

/** Roles whose answers may carry ₪ (interim for G-07 `money.view`). */
export const MONEY_VIEW_ROLES: readonly UserRole[] = FINANCE;

export function canViewMoney(role: UserRole | undefined): boolean {
  return role !== undefined && MONEY_VIEW_ROLES.includes(role);
}

/**
 * May `role` run `tool`? Fails closed: an unknown tool or a missing role is
 * never allowed (a caller that forgets the role — e.g. a future WhatsApp entry
 * point — gets nothing, not everything).
 */
export function canUseTool(tool: string, role: UserRole | undefined): boolean {
  const allowed = (TOOL_ROLES as Record<string, readonly UserRole[] | undefined>)[tool];
  if (!allowed || role === undefined) return false;
  return allowed.includes(role);
}

/** The error a refused tool returns to the loop (an is_error tool_result, not a throw to the user). */
export class AskToolForbidden extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(tool: string, role: UserRole | undefined) {
    super(`FORBIDDEN: tool ${tool} is not available to role ${role ?? 'unknown'}`);
    this.name = 'AskToolForbidden';
  }
}

/** Remove every `…Ils` / `…Price` field (the ₪ fields by the figures naming rule), deeply. */
export function stripIls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripIls(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(Ils|Price)$/.test(k)) continue;
      out[k] = stripIls(v);
    }
    return out as T;
  }
  return value;
}

/** A tool's output as `role` may see it: unchanged for money roles, ₪-free otherwise (incl. a missing role). */
export function redactForRole(output: ToolOutput, role: UserRole | undefined): ToolOutput {
  if (canViewMoney(role)) return output;
  return { data: stripIls(output.data), links: output.links, figures: { ...output.figures, ils: [] } };
}
