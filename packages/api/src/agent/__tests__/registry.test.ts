import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import { REGISTRY, REGISTRY_SIZE, registryRows, toolDefinitionsFor, toolFor, toolsFor } from '../registry';

/**
 * Design §C.2 read column, as tool names (close status and the chef's order
 * guide wait for their procedures). A tool reachable from a role not listed
 * here fails this test.
 */
const DESIGN: Record<UserRole, string[]> = {
  owner: ['leak_hero', 'leak_report', 'leak_breakdown', 'claimable_lines', 'supplier_leak', 'approvals_queue', 'approvals_summary', 'recovery_claims', 'vat_at_risk'],
  manager: ['leak_hero', 'leak_report', 'leak_breakdown', 'claimable_lines', 'supplier_leak', 'approvals_queue', 'order_send_status', 'supplier_confirm_responses', 'today_deliveries'],
  bookkeeper: ['approvals_queue', 'recovery_claims', 'vat_at_risk', 'pay_run_month'],
  chef: ['orders_list', 'order_detail'],
  receiver: ['today_deliveries', 'delivery_detail'],
};
const ROLES = Object.keys(DESIGN) as UserRole[];

describe('role tool registry (WA-02 §5.3)', () => {
  it.each(ROLES)('%s sees exactly the design table', (role) => {
    expect(toolsFor(role).map((t) => t.name).sort()).toEqual([...DESIGN[role]].sort());
    expect(toolDefinitionsFor(role).map((d) => d.name).sort()).toEqual([...DESIGN[role]].sort());
  });

  it('one definition per name; every tool is read-only and takes no tenant/user/role id', () => {
    expect(REGISTRY.size).toBe(REGISTRY_SIZE);
    for (const t of REGISTRY.values()) {
      expect(t.kind).toBe('read');
      const props = Object.keys((t.inputJson as { properties?: object }).properties ?? {});
      expect(props.filter((p) => /restaurant|tenant|user|role|branch/i.test(p))).toEqual([]);
      expect((t.inputJson as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it('unknown and cross-role tools are refused', () => {
    expect(toolFor('owner', 'send_to_supplier')).toBeNull();
    expect(toolFor('chef', 'leak_hero')).toBeNull();
    expect(toolFor('chef', 'approvals_queue')).toBeNull();
    expect(toolFor('chef', 'recovery_claims')).toBeNull();
    expect(toolFor('receiver', 'order_detail')).toBeNull();
    expect(toolFor('receiver', 'leak_hero')).toBeNull();
    expect(toolFor('owner', 'leak_hero')?.name).toBe('leak_hero');
  });

  it('redaction profile per row: receiver/chef rows are stripped, the rest none', () => {
    for (const r of registryRows()) {
      expect(r.redaction).toBe(r.role === 'receiver' ? 'receiver' : r.role === 'chef' ? 'chef' : 'none');
    }
  });

  it('no write, payment, send, SQL or HTTP tool exists', () => {
    for (const name of REGISTRY.keys()) {
      expect(name).not.toMatch(/approve|reject|waive|pay(?!_run)|send(?!_status)|sql|http|fetch|delete|update|create|mark/i);
    }
  });
});
