import { describe, expect, it } from 'vitest';
import { createDb, sql, testDbUrl } from '@restomatch/db';
import { LEAK_FILTER } from '../leak-views';
import {
  DECISIONS,
  DECISION_KEYS,
  DECISION_RULES,
  DECISION_TO_STATUS,
  DISCREPANCY_TYPES,
  EFFECTS,
  MONEY_STATES,
  RESOLUTION_STATUS_VALUES,
  SYSTEM_DECISIONS,
  allocationTier,
  effectOf,
  effectSql,
  moneyStateOf,
  type ClaimStatus,
  type Effect,
} from '../decisions';

const db = createDb(testDbUrl()); // read-only: VALUES rows only, no table writes

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

/** Every (type, key) as a SQL row aliased `d`: tolerated = accepted with no resolved_at. */
function combos() {
  return DISCREPANCY_TYPES.flatMap((type) =>
    DECISION_KEYS.map((key) => ({
      type,
      key,
      status: key === 'tolerated' ? 'accepted' : key,
      resolvedAt: key === 'tolerated' || key === 'open' || key === 'escalated' ? null : '2026-10-11T08:00:00Z',
    })),
  );
}
const valuesSql = () =>
  sql.join(
    combos().map(
      (c) => sql`(${c.type}::text, ${c.key}::text, ${c.status}::text, ${c.resolvedAt}::timestamptz, 'warn'::text)`,
    ),
    sql`, `,
  );

describe('DECISION_RULES / effectOf: the only status → ₪ map [G-14]', () => {
  it('covers all 12 types and every status/decision with exactly one effect', () => {
    expect(DISCREPANCY_TYPES).toHaveLength(12);
    for (const t of DISCREPANCY_TYPES) {
      const rule = DECISION_RULES[t];
      for (const k of DECISION_KEYS) expect(EFFECTS).toContain(rule.effect[k]);
      expect(rule.allowed).toContain(rule.primary);
      for (const d of DECISIONS) {
        expect(RESOLUTION_STATUS_VALUES).toContain(rule.toStatus[d]);
        // A decision's effect is the effect of the status it is read back as.
        expect(effectOf(t, d)).toBe(rule.effect[DECISION_TO_STATUS[d].key]);
      }
    }
  });

  it('the meanings the owner signs', () => {
    expect(effectOf('PRICE_HIGHER', 'open')).toBe('undecided');
    expect(effectOf('PRICE_HIGHER', 'escalated')).toBe('undecided');
    expect(effectOf('PRICE_HIGHER', 'accepted')).toBe('claim');
    expect(effectOf('PRICE_HIGHER', 'resolved')).toBe('claim'); // resolved = accepted and settled
    expect(effectOf('PRICE_HIGHER', 'tolerate')).toBe('waive'); // system auto-approve: paid, not asked back
    expect(effectOf('PRICE_HIGHER', 'rejected')).toBe('waive'); // the money leaked; not claimed
    expect(effectOf('DUPLICATE_INVOICE', 'reject')).toBe('excluded'); // "not a duplicate"
    expect(effectOf('MISSING_ON_INVOICE', 'accept')).toBe('waive'); // never claimable (owner 31.10)
    for (const k of DECISION_KEYS) {
      expect(effectOf('PRICE_LOWER', k)).toBe('excluded');
      expect(effectOf('UNORDERED_ARRIVAL', k)).toBe('excluded');
    }
    expect(SYSTEM_DECISIONS.has('tolerate')).toBe(true);
    expect(DECISION_TO_STATUS.tolerate.status).toBe('accepted');
    expect(() => effectOf('NOPE', 'open')).toThrow();
    expect(() => effectOf('PRICE_HIGHER', 'maybe')).toThrow();
  });

  it('SQL effectSql() == effectOf for every type × status (the ledger reads the same table)', async () => {
    const res = await db.execute(sql`
      SELECT d.type, x.key, ${effectSql()} AS effect
      FROM (VALUES ${valuesSql()}) AS x(type, key, resolution_status, resolved_at, severity)
      CROSS JOIN LATERAL (SELECT x.type, x.resolution_status, x.resolved_at, x.severity) AS d
    `);
    const rows = rowsOf(res);
    expect(rows).toHaveLength(12 * DECISION_KEYS.length);
    for (const r of rows) expect(r.effect, `${r.type}/${r.key}`).toBe(effectOf(String(r.type), String(r.key)));
  });

  it('LEAK_FILTER counts a warn/block row exactly when its effect is not excluded', async () => {
    const res = await db.execute(sql`
      SELECT d.type, x.key, (${LEAK_FILTER}) AS counts
      FROM (VALUES ${valuesSql()}) AS x(type, key, resolution_status, resolved_at, severity)
      CROSS JOIN LATERAL (SELECT x.type, x.resolution_status, x.resolved_at, x.severity) AS d
    `);
    for (const r of rowsOf(res)) {
      expect(r.counts, `${r.type}/${r.key}`).toBe(effectOf(String(r.type), String(r.key)) !== 'excluded');
    }
  });
});

describe('money states [G-14]', () => {
  const claimStates: Array<[ClaimStatus, number, boolean, string]> = [
    ['claimed', 0, false, 'to_offset'],
    ['claimed', 0, true, 'to_send'],
    ['letter_sent', 0, true, 'requested'],
    ['acknowledged', 0, false, 'requested'],
    ['disputed', 0, true, 'disputed'],
    ['credited', 500, true, 'credited'],
    ['recovered', 500, true, 'recovered'],
    ['written_off', 300, true, 'credited'],
  ];
  it.each(claimStates)('a live %s claim (credited %d, paid %s) → %s, whatever the decision', (status, credited, paid, want) => {
    for (const effect of ['undecided', 'claim', 'waive'] as Effect[]) {
      expect(moneyStateOf({ effect, claimStatus: status, creditedAgorot: credited, invoicePaid: paid })).toBe(want);
      expect(allocationTier(effect, true)).toBe(1);
    }
  });

  it('no live claim: the effect decides (offset before payment, a letter after: decision 19)', () => {
    const s = (effect: Effect, paid: boolean, claimStatus: ClaimStatus | null = null) =>
      moneyStateOf({ effect, claimStatus, creditedAgorot: 0, invoicePaid: paid });
    expect(s('undecided', false)).toBe('undecided');
    expect(s('claim', false)).toBe('to_offset');
    expect(s('claim', true)).toBe('to_send');
    expect(s('waive', true)).toBe('waived');
    expect(s('waive', false, 'written_off')).toBe('waived');
    expect(() => s('excluded', false)).toThrow();
    expect(allocationTier('claim', false)).toBe(2);
    expect(allocationTier('waive', false)).toBe(2);
    expect(allocationTier('undecided', false)).toBe(3);
  });

  it('eight states, as the acceptance names them', () => {
    expect([...MONEY_STATES]).toEqual(['undecided', 'to_offset', 'to_send', 'requested', 'disputed', 'credited', 'recovered', 'waived']);
  });
});
