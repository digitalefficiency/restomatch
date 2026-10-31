import { describe, expect, it } from 'vitest';
import { diffCoverage, loadFragments, mergeCoverage, type CoverageFragment } from './coverage/index';

/**
 * Pure tests for the COVERAGE fragment mechanism (W2-01). No DB, and it never
 * imports cross-tenant.attack.test.ts (that would register the DB suites).
 * Synthetic base maps stand in for BASE_COVERAGE.
 */

const BASE: CoverageFragment = {
  'activity.feed': 'isolation',
  'receiving.getPo': 'attack',
};

const VALID_ATTACK = "attack — inventory-router.test.ts: B reading A's thing → NOT_FOUND";
const VALID_ISOLATION = "isolation — inventory-rls.attack.test.ts: B's list excludes A's rows";

describe('diffCoverage', () => {
  it('reports an undeclared procedure as missing and an unregistered entry as stale', () => {
    const registered = ['activity.feed', 'ghost.proc'];
    const declared = ['activity.feed', 'receiving.getPo'];
    expect(diffCoverage(registered, declared)).toEqual({
      missing: ['ghost.proc'],
      stale: ['receiving.getPo'],
    });
  });

  it('is empty when both sides agree', () => {
    expect(diffCoverage(['a.b', 'c.d'], ['c.d', 'a.b'])).toEqual({ missing: [], stale: [] });
  });
});

describe('mergeCoverage', () => {
  it('returns the base unchanged when there are no fragments (empty glob)', () => {
    expect(mergeCoverage(BASE, {})).toEqual(BASE);
  });

  it('merges a valid fragment', () => {
    const merged = mergeCoverage(BASE, {
      './W2-02.ts': { 'tasks.list': VALID_ISOLATION, 'tasks.done': VALID_ATTACK },
      './G-07.ts': { 'caps.check': 'justification — read-only constant table, no tenant data at all' },
    });
    expect(merged).toEqual({
      ...BASE,
      'tasks.list': VALID_ISOLATION,
      'tasks.done': VALID_ATTACK,
      'caps.check': 'justification — read-only constant table, no tenant data at all',
    });
  });

  it('rejects a fragment that re-declares a base key, naming both sources', () => {
    expect(() =>
      mergeCoverage(BASE, { './W2-03.ts': { 'activity.feed': VALID_ISOLATION } }),
    ).toThrow(/activity\.feed.*BASE_COVERAGE.*W2-03\.ts/s);
  });

  it('rejects the same key in two fragments, naming both files', () => {
    expect(() =>
      mergeCoverage(BASE, {
        './W2-04.ts': { 'tasks.list': VALID_ISOLATION },
        './W2-05.ts': { 'tasks.list': VALID_ISOLATION },
      }),
    ).toThrow(/tasks\.list.*W2-04\.ts.*W2-05\.ts/s);
  });

  it('rejects a fragment file name outside the package-id pattern', () => {
    expect(() => mergeCoverage(BASE, { './misc.ts': { 'tasks.list': VALID_ISOLATION } })).toThrow(
      /misc\.ts/,
    );
    expect(() => mergeCoverage(BASE, { './W2-2.ts': { 'tasks.list': VALID_ISOLATION } })).toThrow(
      /W2-2\.ts/,
    );
  });

  it('accepts every documented file-name shape', () => {
    for (const f of ['./W2-09a.ts', './W3-01.ts', './G-14.ts', './H-03.ts']) {
      expect(() => mergeCoverage(BASE, { [f]: { [`p${f.length}.x`]: VALID_ATTACK } })).not.toThrow();
    }
  });

  it("rejects a bare 'attack' / 'isolation' in a fragment", () => {
    expect(() => mergeCoverage(BASE, { './W2-06.ts': { 'orders.x': 'attack' } })).toThrow(
      /orders\.x.*W2-06\.ts/s,
    );
    expect(() => mergeCoverage(BASE, { './W2-06.ts': { 'orders.y': 'isolation' } })).toThrow(
      /orders\.y/,
    );
  });

  it('rejects a malformed attack/isolation value and a weak justification', () => {
    // attack without a named test file
    expect(() =>
      mergeCoverage(BASE, { './W2-06.ts': { 'orders.x': 'attack — covered somewhere, trust me' } }),
    ).toThrow(/orders\.x/);
    // too short
    expect(() => mergeCoverage(BASE, { './W2-06.ts': { 'orders.x': 'public, no data' } })).toThrow(
      /orders\.x/,
    );
    // TODO placeholder
    expect(() =>
      mergeCoverage(BASE, { './W2-06.ts': { 'orders.x': 'TODO write the attack test for this one later' } }),
    ).toThrow(/orders\.x/);
  });

  it('rejects a value naming a test file that does not exist under src/__tests__/', () => {
    expect(() =>
      mergeCoverage(BASE, {
        './W2-07.ts': { 'orders.z': "attack — no-such-file.attack.test.ts: B → NOT_FOUND on A's row" },
      }),
    ).toThrow(/no-such-file\.attack\.test\.ts/);
  });

  it('never mutates the base it was given', () => {
    const base = { ...BASE };
    mergeCoverage(base, { './W2-02.ts': { 'tasks.list': VALID_ISOLATION } });
    expect(base).toEqual(BASE);
  });
});

describe('loadFragments', () => {
  it('loads only package fragment files (never index.ts) as plain maps', () => {
    const fragments = loadFragments();
    for (const [file, frag] of Object.entries(fragments)) {
      expect(file).not.toMatch(/index\.ts$/);
      expect(typeof frag).toBe('object');
    }
  });
});
