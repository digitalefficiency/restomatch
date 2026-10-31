/**
 * The copy gate (W2-13): glossary + house style, enforced by a test instead of review.
 *
 * WARN everywhere: one table per run (namespace → rule counts) printed to stdout; the
 * owners' work list. HARD-FAIL only on W2-13's own namespaces (`emails`, `common`,
 * `components`) and its own server files, except the reasoned ALLOW entries below.
 * W4-01 turns the warning into an error everywhere.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_NAMESPACES } from '../messages';
import type { MessageTree } from '../translate';
import { leaves, lint, lintServerFiles, type Finding, type Lang, type Row, type RuleId } from './copyGate';

const REPO = resolve(__dirname, '../../../../..');

/** Server files whose string literals are scanned (as Hebrew text). G-11's registry when present. */
const SERVER_SCAN = [
  'packages/api/src/notifications',
  'packages/api/src/reports',
  'packages/api/src/match',
  'packages/api/src/recovery',
  'packages/api/src/priceAlerts',
  'apps/web/lib/messageTemplates.ts',
  'apps/web/lib/legal/registry.ts',
];

/** W2-13's own surface: must be clean (hard assertion). */
const OWN_NAMESPACES = new Set(['emails', 'common', 'components']);
const OWN_FILES = [
  'packages/api/src/notifications/templates.ts',
  'packages/api/src/notifications/copy/',
  'packages/api/src/match/persist.ts',
  'apps/web/lib/messageTemplates.ts',
];

/**
 * Reasoned exceptions on the hard-failing surface. Each one names its owner.
 * `where` is `ns:key` for namespace leaves or `file:<path>` for server literals.
 */
const ALLOW: Array<{ where: string; rule: RuleId; reason: string; text?: string }> = [
  // DECISION_COPY.he.{approve,reject,escalate}: masculine singular, pinned by W2-04's
  // approvals-router.test.ts. W2-04's work item; the values are not changed here.
  { where: 'emails:decision.approve', rule: 'masculine-imperative', reason: 'W2-04 (pinned by approvals-router.test.ts)' },
  { where: 'emails:decision.reject', rule: 'masculine-imperative', reason: 'W2-04 (pinned by approvals-router.test.ts)' },
  { where: 'emails:decision.escalate', rule: 'masculine-imperative', reason: 'W2-04 (pinned by approvals-router.test.ts)' },
  // Unused since W2-13 (the feed renders feed.discrepancies / feed.toReview, ICU plurals). Kept with a
  // plain {count} because W2-05's receiver overlays (CompleteOverlays<typeof he>) carry `{count}` and
  // receiver-langs.test pins placeholder parity. W2-05 can drop both keys from the overlays, then here.
  { where: 'components:activity.discrepancies', rule: 'count-without-plural', reason: 'W2-05 receiver overlays' },
  { where: 'components:activity.toReview', rule: 'count-without-plural', reason: 'W2-05 receiver overlays' },
  // matchActivitySummary().detail (persist.ts): pinned byte-identical by match-money.test.ts and no
  // longer persisted since W2-13 (the feed row is v2 metadata). Its text dies with the function.
  ...(
    [
      ['retired-term', 'חריגה אחת'],
      ['retired-term', '{x} חריגות'],
      ['retired-term', 'חריגה אחת לבדיקה'],
      ['retired-term', '{x} חריגות לבדיקה'],
      ['retired-term', 'הפסד פוטנציאלי ₪{x}'],
      ['sign-next-to-placeholder', 'הפסד פוטנציאלי ₪{x}'],
    ] as const
  ).map(([rule, text]) => ({
    where: 'file:packages/api/src/match/persist.ts',
    rule,
    text,
    reason: 'matchActivitySummary().detail is pinned by match-money.test.ts and not persisted',
  })),
  // Quotes around a placeholder: pinned verbatim by e2e/W1-04.spec.ts:172 (W1-04's spec).
  { where: 'common:shell.forbidden.title', rule: 'sign-next-to-placeholder', reason: 'pinned by e2e/W1-04.spec.ts:172' },
  { where: 'file:packages/api/src/notifications/copy/he.ts', rule: 'masculine-imperative', reason: 'the same three DECISION_COPY values (W2-04)' },
];

const covers = (a: (typeof ALLOW)[number], where: string, text: string) =>
  (where === a.where || where.startsWith(`${a.where}:`)) && (a.text === undefined || a.text === text);
const allowed = (where: string, text: string, f: Finding) => ALLOW.some((a) => a.rule === f.rule && covers(a, where, text));

function namespaceRows(): Row[] {
  return ALL_NAMESPACES.flatMap((ns) =>
    (['he', 'en'] as const).flatMap((lang: Lang) =>
      leaves((lang === 'he' ? ns.he : ns.en) as MessageTree).map(([key, text]) => {
        const where = `${ns.name}:${key}`;
        return { where, lang, text, findings: lint(text, lang, where) };
      }),
    ),
  );
}

function table(rows: readonly Row[]): string {
  const counts = new Map<string, Map<RuleId, number>>();
  for (const r of rows) {
    const scope = r.where.startsWith('file:') ? r.where.replace(/^file:/, '').replace(/:\d+$/, '') : r.where.split(':')[0]!;
    for (const f of r.findings) {
      const m = counts.get(scope) ?? new Map<RuleId, number>();
      m.set(f.rule, (m.get(f.rule) ?? 0) + 1);
      counts.set(scope, m);
    }
  }
  const lines = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scope, m]) => {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      return `| ${scope} | ${total} | ${[...m.entries()].map(([r, n]) => `${r} ${n}`).join(', ')} |`;
    });
  return ['| scope | findings | by rule |', '|---|---|---|', ...lines].join('\n');
}

describe('copy gate: every rule fires on its fixture', () => {
  it.each([
    ['בחר ספק', 'he', 'masculine-imperative'],
    ['כתובת דוא"ל', 'he', 'ascii-quote-abbreviation'],
    ['עוד {count} ימים', 'he', 'count-without-plural'],
    ['טוען...', 'he', 'ellipsis'],
    ['הכול מוכן 🎉', 'he', 'emoji'],
    ['צפוי PO אחד', 'he', 'english-token'],
    ['זה רק stub', 'he', 'english-token'],
    ['הפסד פוטנציאלי {amount}', 'he', 'retired-term'],
    ['יעד 1.5%', 'he', 'leak-target'],
    ['את/ה', 'he', 'slash-form'],
    ['נא לתקן / להוציא', 'he', 'slash-form'],
    ['מהספק "{supplier}"', 'he', 'sign-next-to-placeholder'],
    ['₪{amount}', 'he', 'sign-next-to-placeholder'],
    ['חשבונית ריכוז', 'he', 'retired-term'],
    ['פתיחת תביעה', 'he', 'retired-term'],
    ['3 חריגות', 'he', 'retired-term'],
    ['Potential loss {amount}', 'en', 'retired-term'],
    ['Leak target 1.5%', 'en', 'leak-target'],
  ] as const)('%s (%s) → %s', (text, lang, rule) => {
    expect(lint(text, lang).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    ['בחרו ספק', 'he'],
    ['חשבונית מרכזת', 'he'],
    ['{count, plural, one {יום אחד} two {יומיים} other {# ימים}}', 'he'],
    ['מ-{supplier}', 'he'],
    ['דליפה החודש', 'he'],
    ['כתובת דוא״ל', 'he'],
    ['POS', 'he'],
    ['טוען…', 'he'],
  ] as const)('clean: %s (%s)', (text, lang) => {
    expect(lint(text, lang)).toEqual([]);
  });
});

describe('copy gate: the report', () => {
  const nsRows = namespaceRows();
  const fileRows = lintServerFiles(REPO, SERVER_SCAN);

  it('prints one table (warn): per namespace / server file, per rule', () => {
    const report = table([...nsRows, ...fileRows]);
    // The owners' work list. Never fails on other packages' copy (W4-01 makes it an error).
    console.log(`\nCOPY GATE (warn)\n${report}\n`);
    expect(nsRows.length).toBeGreaterThan(1000);
    expect(fileRows.length).toBeGreaterThan(0);
  });

  it('W2-13 namespaces (emails, common, components) are clean', () => {
    const dirty = nsRows
      .filter((r) => OWN_NAMESPACES.has(r.where.split(':')[0]!))
      .flatMap((r) => r.findings.filter((f) => !allowed(r.where, r.text, f)).map((f) => `${r.where} [${r.lang}] ${f.rule}: ${f.match} ← ${r.text}`));
    expect(dirty).toEqual([]);
  });

  it('W2-13 server files are clean', () => {
    const dirty = fileRows
      .filter((r) => OWN_FILES.some((p) => r.where.startsWith(`file:${p}`)))
      .flatMap((r) => r.findings.filter((f) => !allowed(r.where, r.text, f)).map((f) => `${r.where} ${f.rule}: ${f.match} ← ${r.text}`));
    expect(dirty).toEqual([]);
  });

  it('every ALLOW entry is still needed (no stale exceptions)', () => {
    for (const a of ALLOW) {
      const rows = a.where.startsWith('file:') ? fileRows : nsRows;
      const hit = rows.some((r) => covers(a, r.where, r.text) && r.findings.some((f) => f.rule === a.rule));
      expect(hit, `${a.where} ${a.rule}`).toBe(true);
    }
  });
});
