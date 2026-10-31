import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  invoices,
  invoiceStatus,
  matchRuns,
  RECOVERY_STATUSES,
  resolutionStatus,
  sql,
  testDbUrl,
} from '@restomatch/db';
import {
  discrepancyMachine,
  DISCREPANCY_DECIDABLE,
  edgeTargets,
  invoiceCheckedSql,
  invoiceMachine,
  invoiceRematchLockedSql,
  INVOICE_REMATCH_LOCKED,
  isInvoiceRematchLocked,
  recoveryMachine,
  type Machine,
} from '../lifecycle';
import { RECOVERY_TRANSITIONS } from '../recovery/lifecycle';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05: named predicates, the recovery graph pinned to today's table, enum
 * coverage of every machine, and the status-literal ratchet (no invoice or
 * discrepancy status literal array outside the lifecycle files and the
 * allow-list below).
 */

describe('machines', () => {
  it('recovery: equal to recovery/lifecycle.ts RECOVERY_TRANSITIONS (credited only via a credit note)', () => {
    for (const from of RECOVERY_STATUSES) {
      const bare = recoveryMachine.events
        .map((e) => recoveryMachine.edges[e])
        .filter((edge) => !edge.via && edge.from.includes(from))
        .flatMap((edge) => edgeTargets(edge));
      expect(new Set(bare), from).toEqual(new Set(RECOVERY_TRANSITIONS[from]));
    }
    const credit = recoveryMachine.edges.credit;
    expect(credit).toMatchObject({ to: 'credited', via: 'credit_note' });
    const terminal = recoveryMachine.events.filter((e) => recoveryMachine.edges[e].kind === 'terminal').map((e) => recoveryMachine.edges[e].to);
    expect(terminal).toEqual(['recovered']);
    expect(recoveryMachine.edges.reopen).toMatchObject({ from: ['written_off'], to: 'claimed', kind: 'reopen' });
    expect(recoveryMachine.edges.write_off).toMatchObject({ requiresReason: true, undoable: true });
  });

  it('discrepancy: every deciding event leaves only open|escalated', () => {
    for (const e of ['accept', 'reject', 'escalate', 'resolve'] as const) {
      expect([...discrepancyMachine.edges[e].from].sort()).toEqual([...DISCREPANCY_DECIDABLE].sort());
    }
  });

  it('enum coverage: every status value is in initial ∪ targets, for every machine', () => {
    const cover = (m: Machine<string, string>, values: readonly string[]) => {
      const reachable = new Set([...m.initial, ...m.targets]);
      for (const v of values) expect(reachable.has(v), `${m.name}: ${v}`).toBe(true);
      expect([...m.states].sort()).toEqual([...values].sort());
    };
    cover(invoiceMachine as never, invoiceStatus.enumValues);
    cover(discrepancyMachine as never, resolutionStatus.enumValues);
    cover(recoveryMachine as never, RECOVERY_STATUSES);
    expect(invoiceMachine.initial).toEqual(['ocr_pending']);
  });
});

// ── predicates (DB) ───────────────────────────────────────────────────────

const ownerDb = createDb(testDbUrl());
let A: Tenant;
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'PA');
});
afterAll(async () => {
  await resetDb(ownerDb);
});

async function flags(invoiceId: string) {
  const rows = (await ownerDb.execute(sql`
    SELECT ${invoiceRematchLockedSql(sql`i.status`)} AS locked, ${invoiceCheckedSql(sql`i.id`, sql`i.restaurant_id`)} AS checked
    FROM invoices i WHERE i.id = ${invoiceId}::uuid
  `)) as unknown as Array<{ locked: boolean; checked: boolean }>;
  return rows[0]!;
}

describe('predicates', () => {
  it('INVOICE_REMATCH_LOCKED = {approved, paid}; disputed is NOT locked', () => {
    expect([...INVOICE_REMATCH_LOCKED]).toEqual(['approved', 'paid']);
    expect(invoiceStatus.enumValues.filter(isInvoiceRematchLocked)).toEqual(['approved', 'paid']);
    expect(isInvoiceRematchLocked('disputed')).toBe(false);
  });

  it('INVOICE_CHECKED is EXISTS(match_runs), never status = matched — two separate predicates', async () => {
    // The seeded invoice is `matched` WITH a match run.
    expect(await flags(A.invoiceId)).toEqual({ locked: false, checked: true });
    // `matched` without any match run (OCR/import set it) is NOT checked.
    await ownerDb.update(matchRuns).set({ invoiceId: null }).where(eq(matchRuns.id, A.matchRunId));
    expect(await flags(A.invoiceId)).toEqual({ locked: false, checked: false });
    // `disputed` with a run: checked, not locked. `paid` with a run: both.
    await ownerDb.update(matchRuns).set({ invoiceId: A.invoiceId }).where(eq(matchRuns.id, A.matchRunId));
    await ownerDb.update(invoices).set({ status: 'disputed' }).where(eq(invoices.id, A.invoiceId));
    expect(await flags(A.invoiceId)).toEqual({ locked: false, checked: true });
    await ownerDb.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, A.invoiceId));
    expect(await flags(A.invoiceId)).toEqual({ locked: true, checked: true });
  });
});

// ── the status-literal ratchet ────────────────────────────────────────────

/**
 * Files still holding invoice/discrepancy status literal arrays, with the
 * package that owns the cleanup (G-05 brief §1.9). The ratchet only shrinks: a
 * NEW offender fails, and a fixed file must be removed from this list (its
 * count must match exactly). `packages/charts/**` is allow-listed wholesale
 * until G-14 and is outside this scan.
 */
const ALLOW: ReadonlyArray<{ file: string; count: number; owner: string }> = [
  { file: 'exports/period.ts', count: 1, owner: 'W2-14' },
  { file: 'ledger/coverage.ts', count: 1, owner: 'W2-11' },
  { file: 'lib/claims.ts', count: 1, owner: 'W2-03' },
  { file: 'match/consolidated.ts', count: 1, owner: 'G-04' },
  { file: 'receiving/matchTriggers.ts', count: 1, owner: 'W2-05' },
  { file: 'recovery/service.ts', count: 1, owner: 'W2-10' },
  { file: 'routers/approvals.ts', count: 2, owner: 'W2-04' },
  { file: 'routers/payRun.ts', count: 6, owner: 'W2-03' },
  { file: 'routers/receiving.ts', count: 1, owner: 'W2-05' },
];

const STATUS_VALUES = [...new Set([...invoiceStatus.enumValues, ...resolutionStatus.enumValues])];
const LITERAL = new RegExp(`['"\`](?:${STATUS_VALUES.join('|')})['"\`]`, 'g');

/** Array literals `[...]` and SQL `IN (...)` lists made only of status literals. */
function offenders(src: string): number[] {
  const lines: number[] = [];
  const re = /\[([^[\]]{0,400})\]|\bIN\s*\(([^()]{0,400})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[1] ?? m[2] ?? '';
    const hits = body.match(LITERAL) ?? [];
    const rest = body.replace(LITERAL, '').replace(/as const|[\s,]/g, '');
    if (hits.length > 0 && rest === '') lines.push(src.slice(0, m.index).split('\n').length);
  }
  return lines;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(p, out);
    } else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('status-literal guard', () => {
  it('no invoice/discrepancy status literal arrays outside */lifecycle.ts, lifecycle/** and the allow-list', () => {
    const root = join(__dirname, '..');
    const found = new Map<string, number[]>();
    for (const abs of walk(root)) {
      const file = relative(root, abs).split('\\').join('/');
      if (file.startsWith('lifecycle/') || file.endsWith('/lifecycle.ts') || file === 'lifecycle.ts') continue;
      const lines = offenders(readFileSync(abs, 'utf8'));
      if (lines.length > 0) found.set(file, lines);
    }
    const unexpected = [...found].filter(([f]) => !ALLOW.some((a) => a.file === f)).map(([f, l]) => `${f}:${l.join(',')}`);
    expect(unexpected, 'new status literal arrays — use lifecycle/predicates.ts or a machine').toEqual([]);
    for (const a of ALLOW) {
      expect(found.get(a.file)?.length ?? 0, `${a.file} (${a.owner}): update the ratchet when you fix it`).toBe(a.count);
    }
  });

  it('the scanner catches the shapes it guards', () => {
    expect(offenders(`inArray(invoices.status, ['approved', 'paid'])`)).toEqual([1]);
    expect(offenders(`const X = ['open', 'escalated'] as const;`)).toEqual([1]);
    expect(offenders(`sql\`status IN ('matched', 'paid')\``)).toEqual([1]);
    expect(offenders(`const roles = ['owner', 'manager'];`)).toEqual([]);
  });
});
