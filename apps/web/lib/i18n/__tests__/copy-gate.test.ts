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
import { GLOSSARY } from '../glossary';
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

/* ── C2 guard (Train C): the retired claims term never comes back ─────────────────────────────
 * Owner decision 7.11: suppliers are daily partners, so the claim is "בקשת זיכוי", never "דרישה".
 * Unlike the warn table above, this FAILS on the creditClaim concept's retired words in EVERY Hebrew
 * namespace and in the server copy the gate scans, whoever owns the string.
 *
 *   CLAIMS_ALLOW   — a deliberate use: exact `where` + exact text + a reason. Stale entries fail.
 *   CLAIMS_PENDING — known offenders already routed to their owner in the Train-C fix round. They are
 *                    tolerated (not failed) so another lane's fix never turns this red; when a pending
 *                    string is gone it is reported for removal. Never add a new offender here: fix it.
 */
const CLAIMS_TERMS = GLOSSARY.find((g) => g.concept === 'creditClaim')!.retireHe as readonly string[];

const CLAIMS_ALLOW: Array<{ where: string; text: string; reason: string }> = [];

const CLAIMS_PENDING: Array<{ where: string; owner: string }> = [
  // W2-02 (invoices/he.ts) — fixing in the Train-C round
  { where: 'invoices:', owner: 'W2-02' },
  // W2-09 (leaks/he.ts, leakProof/he.ts) — fixing in the Train-C round
  { where: 'leaks:', owner: 'W2-09' },
  { where: 'leakProof:', owner: 'W2-09' },
  // W2-11 (suppliers/he.ts) — fixing in the Train-C round
  { where: 'suppliers:', owner: 'W2-11' },
  // Reported to the orchestrator for routing (found by this guard)
  { where: 'approvals:', owner: 'W2-04' },
  { where: 'receivingDelivery:', owner: 'W2-05' },
  { where: 'file:packages/api/src/reports/monthly.ts', owner: 'W2-16b' },
];

describe('C2 guard: "בקשת זיכוי", never the retired claims term (owner 7.11)', () => {
  const termRe = (term: string) => new RegExp(`(?:^|[^\u05D0-\u05EA])[והבלמשכ]{0,3}${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const RES = CLAIMS_TERMS.map((t) => ({ term: t, re: termRe(t) }));
  const hits = (text: string) => RES.filter((r) => r.re.test(text)).map((r) => r.term);

  const rows: Array<{ where: string; text: string; terms: string[] }> = [
    ...ALL_NAMESPACES.flatMap((ns) =>
      leaves(ns.he as MessageTree).map(([key, text]) => ({ where: `${ns.name}:${key}`, text, terms: hits(text) })),
    ),
    ...lintServerFiles(REPO, SERVER_SCAN).map((r) => ({ where: r.where, text: r.text, terms: hits(r.text) })),
  ].filter((r) => r.terms.length > 0);

  const allowed = (r: { where: string; text: string }) => CLAIMS_ALLOW.some((a) => (r.where === a.where || r.where.startsWith(`${a.where}:`)) && r.text === a.text);
  const pending = (r: { where: string }) => CLAIMS_PENDING.find((p) => r.where === p.where || r.where.startsWith(p.where.endsWith(':') ? p.where : `${p.where}:`));

  it('fires on every retired form (fixtures)', () => {
    for (const t of ['יש עליה דרישת זיכוי', 'שתי דרישות זיכוי', 'אפשר לדרוש זיכוי', 'הוסיפו לדרישת זיכוי', 'אושר לדרישה', 'מכתב זיכוי לספק']) {
      expect(hits(t), t).not.toEqual([]);
    }
    for (const t of ['בקשת זיכוי', 'הוסיפו לבקשת זיכוי', 'מכתב בקשת זיכוי', 'חשבונית זיכוי', 'תעודת זיכוי']) {
      expect(hits(t), t).toEqual([]);
    }
  });

  it('no Hebrew copy or server copy carries the retired claims term (outside the precise allow / routed pending lists)', () => {
    const offenders = rows.filter((r) => !allowed(r) && !pending(r)).map((r) => `${r.where} [${r.terms.join(', ')}] ← ${r.text}`);
    expect(offenders).toEqual([]);
  });

  it('reports the routed offenders still open, and pending entries already fixed (warn)', () => {
    const open = rows.filter((r) => !allowed(r) && pending(r)).map((r) => `${pending(r)!.owner}: ${r.where} ← ${r.text}`);
    const fixed = CLAIMS_PENDING.filter((p) => !rows.some((r) => pending(r) === p)).map((p) => `${p.owner}: ${p.where}`);
    console.log(`\nC2 GUARD (claims term)\nopen (${open.length}):\n  ${open.join('\n  ')}\nfixed, remove from CLAIMS_PENDING (${fixed.length}):\n  ${fixed.join('\n  ')}\n`);
    expect(true).toBe(true);
  });

  it('every CLAIMS_ALLOW entry is still needed', () => {
    for (const a of CLAIMS_ALLOW) expect(rows.some((r) => allowed(r) && r.where.startsWith(a.where)), a.where).toBe(true);
  });
});
