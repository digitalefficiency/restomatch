import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRouter } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { ALL_ROLES } from '../../roles';
import { routeByKey } from '../registry';
import { canOpen } from '../visibility';
import { VIEW_ONLY, isViewOnly } from '../viewOnly';

const WEB = resolve(__dirname, '..', '..', '..');
const DASH = join(WEB, 'app', 'dashboard');
const REPO = resolve(WEB, '..', '..');

/** Every screen the sidebar spec (§4.1) marks 👁 for the bookkeeper. */
const SPEC_EYE_BOOKKEEPER = ['orders', 'receiving', 'suppliers', 'catalog', 'contracts', 'recipes', 'inventory', 'team'];

/**
 * Where each VIEW_ONLY screen's code lives (its registry folder). `skip` drops
 * a sub-folder that is another nav row: /dashboard/suppliers/ledger is the
 * `ledger` row, where the bookkeeper edits.
 */
const SCREENS: Record<string, { root: string; skip: readonly string[] }> = {
  suppliers: { root: 'suppliers', skip: ['ledger'] },
  contracts: { root: 'contracts', skip: [] },
  inventory: { root: 'inventory', skip: [] },
};

/* ───────────── tRPC tier metadata (G-07: every procedure carries meta.tier) ───────────── */

interface ProcDef {
  _def: { type: 'query' | 'mutation' | 'subscription'; meta?: { tier?: string; cap?: string } };
}
function procedures(): Record<string, ProcDef> {
  const def = (appRouter as unknown as { _def: { procedures?: Record<string, ProcDef> } })._def;
  if (!def.procedures) throw new Error('appRouter._def.procedures missing — tRPC internals changed');
  return def.procedures;
}

/** Tier → roles, read from the `requireRoles([...], 'tier')` exports in packages/api/src/trpc.ts. */
function tierRoles(): Record<string, UserRole[]> {
  const src = readFileSync(join(REPO, 'packages', 'api', 'src', 'trpc.ts'), 'utf8');
  const out: Record<string, UserRole[]> = {};
  for (const m of src.matchAll(/requireRoles\(\[([^\]]*)\],\s*'(\w+)'\)/g)) {
    out[m[2]!] = [...m[1]!.matchAll(/'(\w+)'/g)].map((r) => r[1] as UserRole);
  }
  return out;
}

/* ───────────── screen sources: the folder + the dashboard files it imports ───────────── */

function filesUnder(dir: string, skip: ReadonlySet<string>, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || skip.has(p.slice(root.length + 1))) continue;
      out.push(...filesUnder(p, skip, root));
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(WEB, spec.slice(2)) : resolve(dirname(from), spec);
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(cand) && existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** The screen's own files plus every app/dashboard file they import (transitively; relative or `@/app/…` imports). */
function screenSources(key: string): string[] {
  const { root, skip } = SCREENS[key]!;
  const queue = filesUnder(join(DASH, root), new Set(skip));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'((?:\.{1,2}|@\/app)\/[^']+)'/g)) {
      const dep = resolveImport(file, m[1]!);
      if (dep && dep.startsWith(DASH + sep)) queue.push(dep);
    }
  }
  return [...seen].sort();
}

/**
 * Dotted paths (`a.b`, or `a.b.c` on a nested router) of every tRPC mutation the files call:
 * client hooks, the vanilla client, the server caller.
 */
function mutationsIn(files: readonly string[]): string[] {
  const procs = procedures();
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b(?:trpc|client)\.((?:\w+\.)+?)(?:useMutation|mutate|mutateAsync)\b/g)) found.add(m[1]!.slice(0, -1));
    for (const m of src.matchAll(/\bcaller\.((?:\w+\.)+\w+)\(/g)) {
      if (procs[m[1]!]?._def.type === 'mutation') found.add(m[1]!);
    }
  }
  return [...found].sort();
}

describe('viewOnly · the list', () => {
  it('is exactly suppliers, contracts and inventory, for the bookkeeper', () => {
    expect(Object.keys(VIEW_ONLY).sort()).toEqual(['contracts', 'inventory', 'suppliers']);
    for (const roles of Object.values(VIEW_ONLY)) expect(roles).toEqual(['bookkeeper']);
  });

  it('isViewOnly: the bookkeeper on a listed key only', () => {
    for (const key of Object.keys(VIEW_ONLY)) {
      expect(isViewOnly('bookkeeper', key), key).toBe(true);
      for (const role of ALL_ROLES.filter((r) => r !== 'bookkeeper')) expect(isViewOnly(role, key), `${role} ${key}`).toBe(false);
    }
  });

  it('unknown keys and Object.prototype names are never view-only (and never throw)', () => {
    for (const key of ['nope', 'queue', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      for (const role of ALL_ROLES) expect(isViewOnly(role, key), `${role} ${key}`).toBe(false);
    }
  });

  it("the bookkeeper's own finance work stays actionable (no eye), and דוחות carries none", () => {
    const actionable = ['approvals', 'payRun', 'inbox', 'invoices', 'claims', 'recovery', 'ledger', 'exports', 'close', 'leaks', 'monthlyReport', 'integrations', 'settings'];
    for (const key of actionable) expect(isViewOnly('bookkeeper', key), key).toBe(false);
  });
});

describe('viewOnly · half 1: the role can open the screen (route gate)', () => {
  it('every listed key is a nav item every listed role passes the route gate for', () => {
    for (const [key, roles] of Object.entries(VIEW_ONLY)) {
      const def = routeByKey(key);
      expect(def?.nav, key).toBe('item');
      for (const role of roles ?? []) expect(canOpen(role, def!), `${role} → ${def!.path}`).toBe(true);
    }
  });

  it('a spec 👁 screen is listed exactly when the route admits the bookkeeper (re-verify the writes before listing a new one)', () => {
    const opens = SPEC_EYE_BOOKKEEPER.filter((key) => canOpen('bookkeeper', routeByKey(key)!));
    expect(opens.sort()).toEqual(Object.keys(VIEW_ONLY).sort());
    // Left out today because the route gate refuses her: there is no row to carry the eye.
    expect(SPEC_EYE_BOOKKEEPER.filter((key) => !opens.includes(key)).sort()).toEqual(['catalog', 'orders', 'receiving', 'recipes', 'team']);
  });
});

describe('viewOnly · half 2: the server refuses every write on the screen', () => {
  const tiers = tierRoles();

  it('reads the tier roles from trpc.ts (sanity)', () => {
    expect(tiers.manager).toEqual(['owner', 'manager']);
    expect(tiers.chef).toEqual(['owner', 'manager', 'chef']);
    expect(tiers.finance).toEqual(['owner', 'manager', 'bookkeeper']);
  });

  it('every listed key has its screen sources mapped', () => {
    expect(Object.keys(SCREENS).sort()).toEqual(Object.keys(VIEW_ONLY).sort());
    for (const [key, { root }] of Object.entries(SCREENS)) expect(routeByKey(key)?.path, key).toBe(`/dashboard/${root}`);
  });

  for (const key of Object.keys(SCREENS)) {
    it(`${key}: no server action, and every mutation sits on a tier that excludes the listed roles`, () => {
      const files = screenSources(key);
      const actions = files.filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));
      expect(actions, 'server actions bypass the tRPC tiers: verify by hand').toEqual([]);

      const procs = procedures();
      const writes = mutationsIn(files);
      expect(writes.length, `${key}: the scan found no mutation at all`).toBeGreaterThan(0);
      for (const path of writes) {
        const tier = procs[path]?._def.meta?.tier;
        expect(procs[path], `${path} is not on appRouter`).toBeDefined();
        const allowed = tier ? tiers[tier] : undefined;
        expect(allowed, `${path}: tier '${tier}' admits every member (or is unknown): verify by hand`).toBeDefined();
        for (const role of VIEW_ONLY[key] ?? []) expect(allowed, `${path} (${tier}) admits ${role}`).not.toContain(role);
      }
    });
  }

  it('the scan sees the writes the evidence cites', () => {
    const suppliers = mutationsIn(screenSources('suppliers'));
    expect(suppliers).toEqual(expect.arrayContaining(['suppliers.create', 'suppliers.update', 'suppliers.setActive', 'contracts.update', 'catalog.updateItem', 'products.update']));
    // The statement reconcile lives on the ledger row (not this screen).
    expect(suppliers).not.toContain('suppliers.reconcileStatement');
    expect(mutationsIn(screenSources('contracts'))).toEqual(
      expect.arrayContaining(['contracts.create', 'contracts.adoptPrice', 'contracts.importCommit', 'priceAlerts.dismiss', 'priceAlerts.setThreshold']),
    );
    expect(mutationsIn(screenSources('inventory'))).toEqual(expect.arrayContaining(['inventory.start', 'inventory.saveLines', 'inventory.setSales', 'inventory.amendLine']));
  });
});
