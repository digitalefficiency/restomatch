/**
 * The copy gate's rules (W2-13; spec: lens-copy-rtl.md §1 glossary + §2 house style).
 *
 * Pure functions over strings so the gate test can run them on (a) every i18n
 * namespace leaf and (b) string literals scanned out of server files. The gate
 * WARNS on everything (one table), and hard-fails only on W2-13's own
 * namespaces and server files; W4-01 turns it into an error everywhere.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GLOSSARY } from '../glossary';
import type { MessageTree } from '../translate';

export type Lang = 'he' | 'en';

export interface Finding {
  readonly rule: RuleId;
  readonly match: string;
}

export type RuleId =
  | 'retired-term'
  | 'masculine-imperative'
  | 'slash-form'
  | 'count-without-plural'
  | 'sign-next-to-placeholder'
  | 'ellipsis'
  | 'emoji'
  | 'ascii-quote-abbreviation'
  | 'english-token'
  | 'leak-target';

const HE = '\\u05D0-\\u05EA';
const HE_PREFIX = `(?:^|[^${HE}])[והבלמשכ]{0,3}`;
const HEBREW = new RegExp(`[${HE}]`);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A Hebrew term, allowing the one-letter prefixes (ו/ה/ב/ל/מ/ש/כ) and any suffix. */
function heTerm(term: string): RegExp {
  return new RegExp(`${HE_PREFIX}${escapeRe(term)}`);
}
/** A Latin term on word boundaries. */
function enTerm(term: string, flags = 'i'): RegExp {
  return new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?![A-Za-z])`, flags);
}

const RETIRED: Record<Lang, Array<{ term: string; re: RegExp; allow: readonly string[] }>> = {
  he: GLOSSARY.flatMap((g) =>
    g.retireHe.map((term) => ({
      term,
      re: /^[A-Za-z]/.test(term) ? enTerm(term, '') : heTerm(term),
      allow: g.allow as readonly string[],
    })),
  ),
  en: GLOSSARY.flatMap((g) => g.retireEn.map((term) => ({ term, re: enTerm(term), allow: g.allow as readonly string[] }))),
};

/** Masculine-singular imperatives that open a Hebrew string (house style: plural or noun form). */
const MASC_IMPERATIVES = new Set([
  'בחר', 'לחץ', 'הזן', 'הקלד', 'שלח', 'פתח', 'סגור', 'שמור', 'אשר', 'דחה', 'העבר', 'שלם', 'דרוש',
  'הוסף', 'מחק', 'ערוך', 'צלם', 'סרוק', 'בדוק', 'נסה', 'התחבר', 'הירשם', 'עבור', 'חזור', 'הכנס',
  'צור', 'הורד', 'העלה', 'ודא', 'בטל', 'ספור', 'הזמן', 'גש', 'קרא', 'השתמש', 'הגדר', 'עדכן',
]);

const RULES: Array<{ id: RuleId; langs: readonly Lang[]; test: (s: string) => string | null }> = [
  {
    id: 'masculine-imperative',
    langs: ['he'],
    test: (s) => {
      const first = /^[\s"'«(]*([א-ת]+)/.exec(s)?.[1];
      return first && MASC_IMPERATIVES.has(first) ? first : null;
    },
  },
  {
    id: 'slash-form',
    langs: ['he'],
    test: (s) => /[א-ת]+ ?\/ ?[א-ת]+/.exec(s)?.[0] ?? null,
  },
  {
    id: 'count-without-plural',
    langs: ['he', 'en'],
    test: (s) => {
      const flat = stripPluralBlocks(s);
      return (
        /\{count\}/.exec(flat)?.[0] ??
        /\{\w+\}\s+(?:ימים|שעות|פריטים|שורות|חשבוניות|פערים|ספקים|הזמנות|days|items|lines|invoices)(?![א-תa-z])/.exec(flat)?.[0] ??
        null
      );
    },
  },
  {
    id: 'sign-next-to-placeholder',
    langs: ['he', 'en'],
    test: (s) =>
      /["'״׳“”„+₪$]\s?\{\w+\}|\{\w+\}\s?(?:["'״“”%₪]|\+(?![\p{L}\d]))/u.exec(s)?.[0] ?? null,
  },
  { id: 'ellipsis', langs: ['he', 'en'], test: (s) => (s.includes('...') ? '...' : null) },
  { id: 'emoji', langs: ['he', 'en'], test: (s) => /\p{Extended_Pictographic}/u.exec(s)?.[0] ?? null },
  {
    id: 'ascii-quote-abbreviation',
    langs: ['he'],
    test: (s) => /[א-ת]"[א-ת]|[א-ת]'(?=[א-ת\s.,)]|$)/.exec(s)?.[0] ?? null,
  },
  {
    id: 'english-token',
    langs: ['he'],
    test: (s) => /(?<![A-Za-z])(?:POs?|OCR|[Ss]tub|[Ww]ebhook)(?![A-Za-z])/.exec(s)?.[0] ?? null,
  },
  {
    id: 'leak-target',
    langs: ['he', 'en'],
    // Owner: never show a 1.5% target. "1.5%" anywhere; "יעד"/"target" only next to the leak
    // (a food-cost target in recipes is a different thing).
    test: (s) =>
      /1[.,]5\s?%/.exec(s)?.[0] ??
      (/דליפ|דלף|דולף|leak/i.test(s)
        ? (new RegExp(`${HE_PREFIX}יעד(?![${HE}])`).exec(s)?.[0]?.trim() ??
          /(?<![A-Za-z])target(?![A-Za-z])/i.exec(s)?.[0] ??
          null)
        : null),
  },
];

/** Drop `{x, plural, …}` blocks (their `#` is locale-formatted, so they are the fix, not the bug). */
function stripPluralBlocks(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const m = /^\{\s*\w+\s*,\s*plural\s*,/.exec(s.slice(i));
    if (!m) {
      out += s[i];
      i += 1;
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < s.length; j += 1) {
      if (s[j] === '{') depth += 1;
      else if (s[j] === '}' && --depth === 0) break;
    }
    out += '#';
    i = j + 1;
  }
  return out;
}

/** Every finding for one string. `where` is `namespace:key` / `file:path`, used for allow lists. */
export function lint(text: string, lang: Lang, where = ''): Finding[] {
  const out: Finding[] = [];
  for (const r of RETIRED[lang]) {
    if (r.allow.includes(where)) continue;
    const m = r.re.exec(text);
    if (m) out.push({ rule: 'retired-term', match: r.term });
  }
  for (const rule of RULES) {
    if (!rule.langs.includes(lang)) continue;
    const m = rule.test(text);
    if (m) out.push({ rule: rule.id, match: m });
  }
  return out;
}

/* ── walking namespaces and server files ──────────────────────────────────── */

export function leaves(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : leaves(v, `${prefix}${k}.`),
  );
}

export interface Row {
  readonly where: string; // `ns:key` or `path:line`
  readonly lang: Lang;
  readonly text: string;
  readonly findings: readonly Finding[];
}

/**
 * String literals in a TS source, with line numbers. Comments are skipped;
 * `${…}` inside template literals becomes `{x}` so placeholder rules apply.
 */
export function stringLiterals(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const startLine = line;
      let text = '';
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          text += src[i + 1] === 'n' ? '\n' : (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 0;
          for (; i < n; i += 1) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}' && --depth === 0) break;
            else if (src[i] === '\n') line += 1;
          }
          text += '{x}';
          i += 1;
          continue;
        }
        if (src[i] === '\n') line += 1;
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push({ line: startLine, text });
    } else {
      i += 1;
    }
  }
  return out;
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Lint the Hebrew/English literals of every TS file under `paths` (files or dirs), relative to `root`. */
export function lintServerFiles(root: string, paths: readonly string[]): Row[] {
  const files = paths.flatMap((p) => {
    const abs = join(root, p);
    try {
      return statSync(abs).isDirectory() ? walk(abs) : [abs];
    } catch {
      return []; // optional path (e.g. G-11's registry before it lands)
    }
  });
  return files.flatMap((file) => {
    const rel = relative(root, file);
    return stringLiterals(readFileSync(file, 'utf8'))
      .filter((l) => HEBREW.test(l.text))
      .map((l) => {
        const where = `file:${rel}:${l.line}`;
        return { where, lang: 'he' as const, text: l.text, findings: lint(l.text, 'he', `file:${rel}`) };
      });
  });
}
