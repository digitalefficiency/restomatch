import { CAPS, adopterOf, classify, type CopyClass } from './classify';
import { leafId, type Leaf } from './walk';
import { MONEY_VAR_RE, catalogWords, countWords, normalise, placeholderNames, sentences } from './words';

/**
 * The copy guard (MECHANISM §5.3): caps by class, the ratchet allowlist, the `explain` body rules
 * and exact duplicates. Pure — the unit test and the `copy:baseline` generator both call it.
 */
export type AllowReason = 'baseline' | 'legal' | 'confirmation' | 'a11y' | 'detail';
export type AllowEntry = { words: number; reason: AllowReason; owner: string };
export type AllowList = Record<`${string}:${string}`, AllowEntry>;
export type DupAllowList = Record<`${string}:${string}`, string>;

export type Rule = 'cap' | 'ratchet' | 'explain' | 'duplicate';
export interface Failure {
  rule: Rule;
  id: string;
  detail: string;
}
export interface Measured extends Leaf {
  id: `${string}:${string}`;
  cls: CopyClass;
  words: number;
  /** Why it breaks its class rules, if it does (empty = within caps). */
  breaks: string[];
}

const DUP_MIN_WORDS = 6;

/** Rules a single leaf breaks on its own (cap / explain rules), ignoring the allowlist. */
export function breaksOf(leaf: Leaf, cls: CopyClass, words: number): string[] {
  const cap = CAPS[cls];
  if (!cap) return [];
  const out: string[] = [];
  if (words > cap.words) out.push(`${words} words > ${cap.words} (${cls})`);
  const ss = cap.sentences || cap.sentenceWords ? sentences(leaf.text) : [];
  if (cap.sentences && ss.length > cap.sentences) out.push(`${ss.length} sentences > ${cap.sentences}`);
  if (cap.sentenceWords) {
    const long = ss.find((s) => countWords(s) > cap.sentenceWords!);
    if (long) out.push(`a sentence has ${countWords(long)} words > ${cap.sentenceWords}`);
  }
  if (cls === 'explain') {
    if (leaf.text.includes('₪')) out.push('₪ in an explain body');
    const money = placeholderNames(leaf.text).filter((v) => MONEY_VAR_RE.test(v));
    if (money.length) out.push(`money placeholder {${money.join('}, {')}} in an explain body`);
    if (/(^|[^א-ת])[והבלמש]?יעד/.test(leaf.text)) out.push('"יעד" in an explain body');
  }
  return out;
}

export function measure(leaves: Leaf[]): Measured[] {
  return leaves.map((l) => {
    const cls = classify(l);
    const words = catalogWords(l.text);
    return { ...l, id: leafId(l), cls, words, breaks: breaksOf(l, cls, words) };
  });
}

/** Groups of ≥2 keys holding the same normalised text (≥6 words), exempt class left out. */
export function duplicateGroups(ms: Measured[]): Measured[][] {
  const by = new Map<string, Measured[]>();
  for (const m of ms) {
    if (m.cls === 'exempt' || m.cls === 'a11y') continue;
    const n = normalise(m.text);
    if (countWords(n) < DUP_MIN_WORDS) continue;
    by.set(n, [...(by.get(n) ?? []), m]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

export function check(leaves: Leaf[], allow: AllowList, dupAllow: DupAllowList): { failures: Failure[]; measured: Measured[] } {
  const measured = measure(leaves);
  const failures: Failure[] = [];
  for (const m of measured) {
    const a = allow[m.id];
    if (a) {
      if (m.words > a.words) failures.push({ rule: 'ratchet', id: m.id, detail: `grew to ${m.words} words (allowlisted at ${a.words}); shorten it` });
      continue;
    }
    for (const b of m.breaks) failures.push({ rule: m.cls === 'explain' && !/^\d+ words|sentence/.test(b) ? 'explain' : 'cap', id: m.id, detail: b });
  }
  for (const g of duplicateGroups(measured)) {
    if (g.every((m) => dupAllow[m.id])) continue;
    failures.push({
      rule: 'duplicate',
      id: g.map((m) => m.id).join(' = '),
      detail: `same text in ${g.length} keys: make it one explain.<concept> key (or reuse the existing one)`,
    });
  }
  return { failures, measured };
}

/** Warn table (never fails): stale allowlist, near-duplicates, numbers-before-words misses. */
export function warnings(measured: Measured[], allow: AllowList) {
  const byId = new Map(measured.map((m) => [m.id, m]));
  const stale = Object.entries(allow)
    .filter(([id]) => {
      const m = byId.get(id as `${string}:${string}`);
      return !m || m.breaks.length === 0;
    })
    .map(([id]) => id);

  // Near-duplicates: token Jaccard ≥ 0.6 on ≥8-word strings, via an inverted index of rarer tokens.
  const pool = measured.filter((m) => m.cls !== 'exempt' && m.cls !== 'a11y' && m.words >= 8);
  const toks = pool.map((m) => new Set(normalise(m.text).split(' ')));
  const index = new Map<string, number[]>();
  toks.forEach((ts, i) => ts.forEach((t) => index.set(t, [...(index.get(t) ?? []), i])));
  const seen = new Set<string>();
  const near: Array<{ a: string; b: string; jaccard: number }> = [];
  index.forEach((ids) => {
    if (ids.length > 40) return;
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x]!;
        const j = ids[y]!;
        const k = `${i}:${j}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const A = toks[i]!;
        const B = toks[j]!;
        let inter = 0;
        A.forEach((t) => B.has(t) && inter++);
        const jac = inter / (A.size + B.size - inter);
        if (jac >= 0.6 && jac < 1) near.push({ a: pool[i]!.id, b: pool[j]!.id, jaccard: Math.round(jac * 100) / 100 });
      }
  });
  near.sort((p, q) => q.jaccard - p.jaccard);

  const numberFirst = measured.filter((m) => m.cls !== 'exempt' && /^[א-ת]+ \{(count|n)\}/.test(m.text)).map((m) => m.id);
  return { stale, near, numberFirst };
}

/** The baseline the `copy:baseline` script writes: one entry per leaf over its cap, one per duplicate. */
export function baseline(leaves: Leaf[]): { allow: AllowList; dup: DupAllowList } {
  const measured = measure(leaves);
  const allow: AllowList = {};
  for (const m of measured) {
    if (!m.breaks.length) continue;
    allow[m.id] = { words: m.words, reason: m.cls === 'confirm' ? 'confirmation' : 'baseline', owner: adopterOf(m.ns) };
  }
  const dup: DupAllowList = {};
  for (const g of duplicateGroups(measured)) for (const m of g) dup[m.id] = adopterOf(m.ns);
  return { allow, dup };
}

/** Render budget.allow.ts: sorted by key, grouped by owner comment (MECHANISM §6.5.4). */
export function renderAllowFile({ allow, dup }: { allow: AllowList; dup: DupAllowList }): string {
  const group = <V,>(rec: Record<string, V>, ownerOf: (v: V) => string, line: (id: string, v: V) => string) => {
    const owners = new Map<string, string[]>();
    for (const id of Object.keys(rec).sort()) {
      const o = ownerOf(rec[id]!);
      owners.set(o, [...(owners.get(o) ?? []), line(id, rec[id]!)]);
    }
    return [...owners.keys()].sort().flatMap((o) => [`  // ── ${o} (${owners.get(o)!.length}) ──`, ...owners.get(o)!]);
  };
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return [
    '/**',
    ' * GENERATED by `pnpm --filter @restomatch/web copy:baseline` (W2-16), then ONLY SHRINKS.',
    ' * COPY_ALLOW: catalog strings over their class cap today (MECHANISM §5.3), with the word count they',
    ' * may not grow past and the package that adopts them. Adoption = shorten/fold the string and delete',
    ' * your line. COPY_DUP_ALLOW: keys that hold the same ≥6-word text today; merge them into one',
    ' * `explain.<concept>` (or one key) and delete the lines. Never add a line by hand.',
    ' */',
    "import type { AllowList, DupAllowList } from './guard';",
    '',
    'export const COPY_ALLOW: AllowList = {',
    ...group(allow, (v) => v.owner, (id, v) => `  ${q(id)}: { words: ${v.words}, reason: '${v.reason}', owner: '${v.owner}' },`),
    '};',
    '',
    'export const COPY_DUP_ALLOW: DupAllowList = {',
    ...group(dup, (v) => v, (id, v) => `  ${q(id)}: '${v}',`),
    '};',
    '',
  ].join('\n');
}
