/**
 * Post-check of a Claude answer against what the tools actually returned —
 * the last line of defence against hallucination and prompt injection:
 *  - citations keep only hrefs the tools produced (internal /dashboard paths);
 *    their label is the SCREEN name (not model text) and a cited value must be
 *    a figure of the SAME unit in the tool output (₪ vs % vs count);
 *  - URLs, any label.tld (also defanged `[.]`/`(.)`/` dot `), bare IPs, user@host,
 *    markdown links and phone numbers are stripped from the text — and the answer
 *    is then flagged `grounded: false` (a link in an answer is an injection signal);
 *  - every number in the prose (any unit, "40 אלף", "5k", Hebrew "שקלים"…) must
 *    match a tool figure, otherwise the answer is flagged `grounded: false`
 *    (the UI shows a "check the screens" note).
 */
import type { ClaudeAnswer } from './claude';
import type { Figures, ScreenLink } from './tools';

export interface Citation {
  /** Which screen (label rendered by the web in the user's language). */
  screen: ScreenLink['screen'];
  value: number | null;
  unit: 'ils' | 'pct' | 'count' | null;
  href: string;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
  grounded: boolean;
  /** Figures in the text no tool returned (for the report / logs). */
  ungrounded: number[];
}

const INTERNAL = /^\/dashboard(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_=&\-]*)?$/;

function near(n: number, pool: readonly number[]): boolean {
  // Prose rounds ₪ to whole shekels and % to one decimal.
  return pool.some((p) => {
    const a = Math.abs(p);
    return Math.abs(a - n) < 0.01 || Math.abs(Math.round(a) - n) < 0.01 || Math.abs(Math.round(a * 10) / 10 - n) < 0.01;
  });
}

/** Every number in prose, with k / אלף / M / מיליון multipliers; years and YYYY-MM dates skipped. */
export function figuresIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{4}-\d{2}(?:-\d{2})?)|(-?\d[\d,]*(?:\.\d+)?)\s*(k|K|אלף|M|מיליון)?/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) continue; // a date
    const raw = m[2]!;
    let n = Math.abs(Number(raw.replace(/,/g, '')));
    if (!Number.isFinite(n)) continue;
    if (/^(19|20)\d{2}$/.test(raw)) continue; // a year
    const mult = m[3];
    if (mult === 'k' || mult === 'K' || mult === 'אלף') n *= 1000;
    if (mult === 'M' || mult === 'מיליון') n *= 1_000_000;
    out.push(n);
  }
  return out;
}

/**
 * Link detection works on a NORMALIZED copy of the prose: NFKC (full-width
 * letters/dots/brackets → ASCII), invisible characters removed (zero-width,
 * soft hyphen, bidi marks), look-alike dots mapped to ".", and defanged dots
 * ("[.]", "(.)", "{dot}", " dot ", case-insensitive) restored. The cleaned text
 * the user sees is derived from that normalized copy.
 */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g;
const LOOKALIKE_DOTS = /[。｡․﹒۔։·‧∙⋅・]/g;
const DEFANG = /\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}|<\s*(?:\.|dot)\s*>|\s+dot\s+)\s*/gi;

/**
 * Real TLDs a link in an answer could use (lower-case ASCII). An unknown ASCII
 * "tld" ("spend.Next", "avg.price", "report.xlsx") is ordinary text, not a link.
 */
const TLDS = new Set(
  (
    'com net org info biz io co il me ru ai app dev shop ly to tv cc xyz online site link store tech top club pro ' +
    'live click page us uk de fr eu cn in br jp au ca es it nl pl ua by kz su tk ml ga cf gq ws fm gg im vip win ' +
    'bid men loan work today life world news email cloud host website space fun icu cyou buzz monster rest bar ' +
    'mobi name asia tel travel gov edu mil int ch at be se no dk fi pt gr tr ro hu cz sk bg hr si rs lt lv ee ie ' +
    'is lu mt cy ae sa eg ma tn jo lb ps iq ir pk bd lk th vn ph my sg id kr tw hk mx ar cl pe ve za ng ke nz ' +
    'one blog wiki help support service services money pay bank finance cash gift sale shopping deals best ' +
    'help app games tips network systems solutions digital media agency global center company group zone ' +
    'ink lol wtf rip gay sex porn adult casino bet poker loans cards credit ' +
    'example test invalid localhost local onion internal lan home corp'
  ).split(' '),
);

/** A label.tld host: TLD from the list, punycode, or 2+ non-ASCII letters (e.g. ".ישראל", ".рф"). */
const HOST = /(?<![\p{L}\p{N}@-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(xn--[a-z0-9-]{1,59}|\p{L}{2,24})(?![\p{L}\p{N}-])(?::\d{1,5})?(?:\/\S*)?/giu;
/** "evil . com", "evil .com": a spaced dot before a KNOWN tld (a normal ". Next" sentence is not touched). */
const SPACED_HOST = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\s+\.\s*([a-z]{2,24})\b|(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\.\s+([a-z]{2,24})\b(?!\s+[a-z])/giu;

const LINK_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/gi, // any scheme://… (hxxp:// too)
  /\b(?:javascript|data|vbscript|mailto|tel|sms|whatsapp|ftp|file|intent|telegram|tg|viber|skype):\S*/gi,
  /\bwww\.\S+/gi,
  /[^\s@]+@[^\s@]+\.[^\s@]+/g, // user@host / emails
  /(?:^|(?<=\s))@[\w.]{3,}/g, // @handles (Telegram/Instagram)
  /\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4})*::[0-9a-f:]*(?:%\w+)?\]?(?::\d+)?/gi, // IPv6 with "::"
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, // full IPv6 (a "10:30:45" time is not touched)
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/\S*)?/g, // IPv4 (+port/path)
  /\b0x[0-9a-f]{6,8}\b/gi, // hex IPv4
  /(?:\+|\b00)\d[\d\s-]{7,16}\d\b/g, // international phone numbers
  /\b972\d{8,9}\b/g,
  /(?:\b0\d{1,2}|\b1-?[78]00|\b1700)[\s-]?\d{3}[\s-]?\d{3,4}\b/g, // Israeli numbers / toll-free
  /(?:^|(?<=\s))\*\d{3,5}\b/g, // *1234 short numbers
];

/** Hebrew IDN TLDs (any other Hebrew word after a dot is just a sentence without a space). */
const HEBREW_TLDS = new Set(['ישראל', 'קום']);

function isHostMatch(tld: string): boolean {
  const t = tld.toLowerCase();
  if (t.startsWith('xn--') || TLDS.has(t)) return true;
  if (/^[\u0590-\u05FF]+$/.test(t)) return HEBREW_TLDS.has(t);
  // Any other non-ASCII TLD: an IDN (".рф") or a homoglyph spoof (".cоm" with a Cyrillic о).
  return /[^\x00-\x7F]/.test(t);
}

/** Strip every link-like token from model prose; `stripped` says whether a LINK was removed. */
export function sanitizeAnswer(text: string): { text: string; stripped: boolean } {
  let stripped = false;
  // Markdown links keep their visible text but count as a link.
  let out = text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_m, label: string) => {
    stripped = true;
    return label;
  });
  out = out
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(LOOKALIKE_DOTS, '.')
    .replace(DEFANG, '.');
  for (const re of LINK_PATTERNS) {
    out = out.replace(re, () => {
      stripped = true;
      return '';
    });
  }
  out = out.replace(SPACED_HOST, (m, a?: string, b?: string) => {
    if (!isHostMatch(a ?? b ?? '')) return m;
    stripped = true;
    return '';
  });
  out = out.replace(HOST, (m, tld: string) => {
    if (!isHostMatch(tld)) return m;
    // "rose.It came…" (sentence without a space): a Title-case 2-label ASCII
    // token reads as prose; real hosts in text are lower- or upper-case.
    if (/^[A-Z][a-z]+$/.test(tld) && m.split('.').length === 2 && !/[:/]/.test(m)) return m;
    stripped = true;
    return '';
  });
  // Tidy the gaps left by removals (does not by itself flag the answer).
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').trim(), stripped };
}

export function groundAnswer(raw: ClaudeAnswer, links: readonly ScreenLink[], figures: Figures): GroundedAnswer {
  const byHref = new Map(links.filter((l) => INTERNAL.test(l.href)).map((l) => [l.href, l.screen] as const));
  const all = [...figures.ils, ...figures.pct, ...figures.count];
  const citations: Citation[] = [];
  for (const c of raw.citations) {
    const screen = byHref.get(c.href);
    if (!screen) continue;
    if (c.value != null) {
      const pool = c.unit === 'ils' ? figures.ils : c.unit === 'pct' ? figures.pct : c.unit === 'count' ? figures.count : [];
      if (!near(Math.abs(c.value), pool)) continue;
    }
    if (citations.some((x) => x.href === c.href && x.value === c.value)) continue;
    citations.push({ screen, value: c.value, unit: c.value == null ? null : c.unit, href: c.href });
  }
  // Anything link-like in the prose is an injection signal: strip it AND flag the answer.
  const { text: answer, stripped } = sanitizeAnswer(raw.answer);
  const ungrounded = figuresIn(answer).filter((n) => !near(n, all));
  return { answer, citations, grounded: ungrounded.length === 0 && !stripped, ungrounded };
}
