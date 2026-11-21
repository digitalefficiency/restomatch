/**
 * G-16 API invariants over the source (GAP-PACKAGES G-16 §2):
 *  • "late" is defined once — `api/lib/deliveryState.ts`; everyone else calls it;
 *  • one definition per ₪ metric — interim signature scan until G-14's metrics
 *    registry (`charts/src/metrics.ts`) gives every metric an id.
 * Warn mode: per-area counts are printed; G16_MODE=error fails on them.
 */
import { describe, expect, it } from 'vitest';
import { readSources, report, scanSignatures, type Signature } from './g16';

const ROOTS = ['packages/db/src', 'packages/api/src', 'packages/charts/src', 'packages/matching/src', 'apps/worker/src', 'apps/web/app', 'apps/web/lib'];

// ─── late-defined-once ───────────────────────────────────────────────────────

export const LATE_SIGNATURES: Signature[] = [
  // SQL: a comparison against the PO's expected delivery time.
  { id: 'late.sql', pattern: /expected_delivery_at"?\s*(\+\s*interval\s*'[^']*'\s*)?(<|>|<=|>=)\s*(now\(\)|\$\{|current_|'?\d)|(now\(\)|\$\{now\})\s*(<|>|<=|>=)\s*("?\w+"?\.)?"?expected_delivery_at/i },
  // TS: comparing a clock to an expected delivery / deadline.
  { id: 'late.ts', pattern: /expectedDelivery\w*[\w.?()]*\s*(<|>|<=|>=)\s*(now|Date\.now|new Date)|(now|Date\.now\(\))[\w.()]*\s*(<|>|<=|>=)\s*[\w.]*expectedDelivery|(now|Date\.now\(\))[\w.()]*\s*(<|>|<=|>=)\s*[\w.()]*deadline[^\n]*['"]late['"]/ },
  // Producing the 'late' state by hand.
  { id: 'late.value', pattern: /\?\s*['"]late['"]|return\s+['"]late['"]|THEN\s+'late'/ },
];
const LATE_HOME = 'packages/api/src/lib/deliveryState.ts';

// ─── one-metric-definition (interim) ─────────────────────────────────────────

export const METRIC_SIGNATURES: Signature[] = [
  // leak.total = Σ|Δ| (AGENTS.md "Leak figure").
  { id: 'leak.total', pattern: /sum\(\s*abs\(/i },
  { id: 'leak.total', pattern: /reduce\([^\n]*Math\.abs\([^)]*[dD]elta/ },
  // vat.rate — a VAT fraction literal (17% before 2025, 18% since).
  { id: 'vat.rate', pattern: /vat[^\n]*(^|[^\w.'"-])(0\.1[78]|1\.1[78])(?![\d\w])|(^|[^\w.'"-])(0\.1[78]|1\.1[78])(?![\d\w])[^\n]*vat/i },
];
/**
 * Where each metric is defined today: leak.total in the engine (matching) and the
 * leak SQL (charts); vat.rate as the restaurants.vat_rate column default (packages/db, with its doctor/fixtures).
 */
const METRIC_HOMES: Record<string, RegExp> = {
  'leak.total': /^packages\/(matching|charts)\/src\//,
  'vat.rate': /^packages\/db\/src\//,
};
const isHome = (path: string, sig: Signature) => METRIC_HOMES[sig.id]!.test(path);

describe('late-defined-once', () => {
  it('self-test: catches a hand-rolled late rule, ignores a call to deliveryState()', () => {
    const planted = [
      { path: 'apps/worker/src/jobs/x.ts', text: "const late = now.getTime() > deadline.getTime() ? 'late' : 'ok';" },
      { path: 'packages/api/src/routers/y.ts', text: "sql`where expected_delivery_at < now()`" },
      { path: 'packages/api/src/routers/z.ts', text: "if (deliveryState({ po, latestReceipt, now, tz }) === 'late') n++;" },
    ];
    const v = scanSignatures(planted, LATE_SIGNATURES, (p) => p === LATE_HOME);
    expect(v.map((x) => x.area).sort()).toEqual(['api:y', 'worker:x', 'worker:x']);
    expect(scanSignatures([{ path: LATE_HOME, text: "return 'late';" }], LATE_SIGNATURES, (p) => p === LATE_HOME)).toEqual([]);
  });

  it('the tree (warn): "late" is computed only in api/lib/deliveryState.ts', () => {
    const sources = readSources(ROOTS);
    expect(sources.some((s) => s.path === LATE_HOME)).toBe(true);
    // The home itself must hold the definition the scan protects.
    expect(scanSignatures(sources.filter((s) => s.path === LATE_HOME), LATE_SIGNATURES, () => false).length).toBeGreaterThan(0);
    report('late-defined-once', scanSignatures(sources, LATE_SIGNATURES, (p) => p === LATE_HOME));
  });
});

describe('one-metric-definition (interim, until the G-14 registry ids)', () => {
  it('self-test: catches a re-implemented leak sum and a VAT literal outside the engine / charts', () => {
    const planted = [
      { path: 'apps/web/app/dashboard/x/page.tsx', text: 'const t = rows.reduce((s, r) => s + Math.abs(r.deltaAmount), 0);' },
      { path: 'apps/worker/src/jobs/y.ts', text: 'select sum(abs(d.delta_amount)) from discrepancies d' },
      { path: 'packages/api/src/routers/z.ts', text: 'const vat = sub * 0.17;' },
      { path: 'packages/api/src/routers/c.ts', text: '// the VAT default is 0.18\nshadow: rgba(0,0,0,0.18)' },
      { path: 'packages/charts/src/leak-hero.ts', text: 'sum(abs(d.delta_amount))' },
      { path: 'packages/api/src/routers/w.ts', text: 'const p = 10.17; const q = x.17;' },
    ];
    const v = scanSignatures(planted, METRIC_SIGNATURES, isHome);
    expect(v.map((x) => x.detail.split(' ')[0])).toEqual(['leak.total', 'leak.total', 'vat.rate']);
  });

  it('the tree (warn): each ₪ metric has one home', () => {
    const sources = readSources(ROOTS);
    // Each home still holds its definition (a moved definition must move the home too).
    const homes = sources.flatMap((s) => scanSignatures([s], METRIC_SIGNATURES, (p, sig) => !isHome(p, sig)));
    expect(new Set(homes.map((h) => h.detail.split(' ')[0]))).toEqual(new Set(['leak.total', 'vat.rate']));
    report('one-metric-definition', scanSignatures(sources, METRIC_SIGNATURES, isHome));
  });
});
