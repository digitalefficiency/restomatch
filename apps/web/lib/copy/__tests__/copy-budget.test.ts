import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY_ALLOW, COPY_DUP_ALLOW } from '../budget.allow';
import { classify } from '../classify';
import { baseline, check, renderAllowFile, warnings, type AllowList } from '../guard';
import { leavesOf, walkHebrew, type Leaf } from '../walk';
import { catalogWords, icuLongest, sentences } from '../words';

// W2-16 · the copy guard (MECHANISM §5.3). Blocking, pure, no DB.
// `pnpm --filter @restomatch/web copy:baseline` (COPY_BASELINE=1) regenerates ../budget.allow.ts —
// run it ONCE; afterwards the allowlist only shrinks (adoption = delete your lines).

const L = (ns: string, path: string, text: string): Leaf => ({ ns, path, text });
const rulesOf = (leaves: Leaf[], allow: AllowList = {}) => check(leaves, allow, {}).failures.map((f) => f.rule);

describe('word metric', () => {
  it('counts letter-led words only; numbers, ₪, % and dates never count', () => {
    expect(catalogWords('3 חשבוניות ממתינות · 3,603 ₪ · 12% · 25.10.2026')).toBe(2);
    expect(catalogWords('ב-30 יום')).toBe(2);
  });
  it('ICU → longest branch; number vars count 0, text vars count 1', () => {
    expect(icuLongest('{count, plural, one {חשבונית אחת} other {# חשבוניות ממתינות לשיוך}}')).toBe('# חשבוניות ממתינות לשיוך');
    expect(catalogWords('{count} חשבוניות מ-{supplier} · {amount}')).toBe(3);
  });
  it('sentences split on . ! ? ; and " — "', () => {
    expect(sentences('שורה אחת. שורה שתיים — ועוד; סוף!')).toHaveLength(4);
  });
});

describe('classes', () => {
  it.each([
    ['marketing', 'hero.title', 'exempt'],
    ['settings', 'legal.terms', 'exempt'],
    ['explain', 'toggle.why', 'button'],
    ['explain', 'leakRule', 'explain'],
    ['approvals', 'why.price.explain', 'explain'],
    ['orders', 'detail.sendAria', 'a11y'],
    ['payRun', 'toast.saved', 'toast'],
    ['payRun', 'confirmPay.body', 'confirm'],
    ['orders', 'actions.send', 'button'],
    ['orders', 'new.submitCta', 'button'],
    ['orders', 'detail.title', 'visible'],
  ] as const)('%s:%s → %s', (ns, path, cls) => expect(classify({ ns, path })).toBe(cls));
});

describe('failure rules fire (one fixture each)', () => {
  it('cap: a 13-word visible string', () => {
    expect(rulesOf([L('orders', 'detail.hint', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים')])).toEqual(['cap']);
  });
  it('cap: two sentences on a visible line', () => {
    expect(rulesOf([L('orders', 'detail.hint', 'נשמר. נשלח.')])).toEqual(['cap']);
  });
  it('cap: a 9-word toast', () => {
    expect(rulesOf([L('orders', 'toast.sent', 'ההזמנה נשלחה לספק והוא יקבל אותה בתוך כמה דקות')])).toEqual(['cap']);
  });
  it('explain: ₪ in an explain body', () => {
    expect(rulesOf([L('explain', 'x', 'עד 500 ₪ לא נספר.')])).toEqual(['explain']);
  });
  it('explain: a money placeholder in an explain body', () => {
    expect(rulesOf([L('leaks', 'explain.x', 'עד {amount} לא נספר.')])).toEqual(['explain']);
  });
  it('explain: "יעד" in an explain body', () => {
    expect(rulesOf([L('explain', 'x', 'זה היעד החודשי שלכם.')])).toEqual(['explain']);
  });
  it('explain: a 13-word sentence in an explain body', () => {
    expect(rulesOf([L('explain', 'x', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים.')])).toEqual(['cap']);
  });
  it('duplicate: the same ≥6-word text in two keys', () => {
    const t = 'שום דבר לא נשלח לספק בלי לחיצה';
    expect(rulesOf([L('orders', 'a', t), L('recovery', 'b', `${t}.`)])).toEqual(['duplicate']);
  });
  it('ratchet: an allowlisted string that grew', () => {
    const allow: AllowList = { 'orders:detail.hint': { words: 13, reason: 'baseline', owner: 'W2-06' } };
    const long = 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים';
    expect(rulesOf([L('orders', 'detail.hint', long)], allow)).toEqual([]);
    expect(rulesOf([L('orders', 'detail.hint', `${long} ועוד`)], allow)).toEqual(['ratchet']);
  });
  it('exempt and a11y strings have no cap', () => {
    const long = Array.from({ length: 30 }, () => 'מילה').join(' ');
    expect(rulesOf([L('marketing', 'x', long), L('orders', 'sendAria', long)])).toEqual([]);
  });
});

const leaves = walkHebrew();

describe('the real catalogs', () => {
  it('the explain namespace passes with no allowlist entry', () => {
    const ex = leaves.filter((l) => l.ns === 'explain');
    expect(ex.length).toBeGreaterThan(17);
    expect(check(ex, {}, {}).failures).toEqual([]);
    expect(Object.keys(COPY_ALLOW).filter((k) => k.startsWith('explain:'))).toEqual([]);
  });

  it('pass the guard with the generated allowlist (it only shrinks)', () => {
    const { failures, measured } = check(leaves, COPY_ALLOW, COPY_DUP_ALLOW);
    const w = warnings(measured, COPY_ALLOW);
    // The warn table (never fails): delete stale entries; near-duplicates are concept-merge candidates.
    console.info(
      `[copy-guard] leaves ${measured.length} · allowlisted ${Object.keys(COPY_ALLOW).length} · dup-allowlisted ${Object.keys(COPY_DUP_ALLOW).length}` +
        ` · stale ${w.stale.length} · near-duplicates ${w.near.length} · number-before-words ${w.numberFirst.length}` +
        (w.stale.length ? `\n  stale (delete): ${w.stale.slice(0, 20).join(', ')}` : '') +
        (w.near.length ? `\n  near (top 10): ${w.near.slice(0, 10).map((n) => `${n.a} ~ ${n.b} (${n.jaccard})`).join(' | ')}` : ''),
    );
    expect(failures, failures.map((f) => `${f.rule} · ${f.id} · ${f.detail}`).join('\n')).toEqual([]);
  });

  it.skipIf(!process.env.COPY_BASELINE)('copy:baseline — regenerate budget.allow.ts', () => {
    const file = fileURLToPath(new URL('../budget.allow.ts', import.meta.url));
    writeFileSync(file, renderAllowFile(baseline(leaves)));
  });
});

// Keep leavesOf in the public surface for W2-13's copy-gate.
void leavesOf;
