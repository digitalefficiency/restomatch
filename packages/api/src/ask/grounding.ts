/**
 * Post-check of a Claude answer against what the tools actually returned —
 * the last line of defence against hallucination and prompt injection:
 *  - citations keep only hrefs the tools produced (internal /dashboard paths);
 *    their label is the SCREEN name (not model text) and a cited value must be
 *    a figure of the SAME unit in the tool output (₪ vs % vs count);
 *  - URLs, ANY label.word (inverted: a link unless it is a file name, a number or
 *    one of a few prose shapes — also defanged `[.]`/`(.)`/` dot `, spaced-out
 *    "e v i l . c o m", "evil,com"), bare IPs, user@host,
 *    markdown links and phone numbers are stripped from the text — and the answer
 *    is then flagged `grounded: false` (a link in an answer is an injection signal);
 *  - every number in the prose (any unit, "40 אלף", "5k", Hebrew "שקלים"…) must
 *    match a tool figure, otherwise the answer is flagged `grounded: false`
 *    (the UI shows a "check the screens" note);
 *  - periods (G-12b): an answer that compares figures of two periods that do not
 *    compare fairly (a month to date against a full month), or states a
 *    like-for-like change without its span label, is REFUSED: `grounded: false`
 *    and the text is replaced by a neutral sentence.
 */
import type { ClaudeAnswer } from './claude';
import { fairlyComparable, type Period } from './periods';
import { ALL_TLDS } from './tlds';
import type { Figures, ScreenLink } from './tools';

/** What the tools said about periods, for the fairness check. */
export interface PeriodGuard {
  /** One entry per month tool output: its period and its ₪ figures. */
  periods: Array<{ period: Period; ils: number[] }>;
  /** One entry per like-for-like comparison (leak_change). */
  comparisons: Array<{ deltaIls: number; labels: string[] }>;
  locale?: 'he' | 'en';
}

export const PERIOD_REFUSAL = {
  he: 'לא אשווה תקופה חלקית לחודש מלא. אפשר לשאול "מה השתנה בדליפה החודש?" — ההשוואה תהיה על אותם ימים בשני החודשים.',
  en: 'I won’t compare part of a month with a full month. Ask "What changed in the leak this month?" — it compares the same days of both months.',
} as const;

const COMPARING =
  /(מול|לעומת|בהשוואה|השתנ|ירד|ירדה|עלה|עלתה|גדל|קטנ|יותר מ|פחות מ|הפרש|compared|versus|\bvs\.?\b|than|rose|fell|increas|decreas|went up|went down|difference|change)/i;
const dash = (t: string) => t.replace(/[-‐-―]/g, '–');

/** Why an answer is refused on period grounds, or null when it is fair. */
export function periodRefusal(answer: string, guard: PeriodGuard): 'unfairPeriods' | 'missingSpan' | null {
  const nums = figuresIn(answer);
  const text = dash(answer);
  for (const c of guard.comparisons) {
    const d = Math.abs(c.deltaIls);
    if (d < 1 || !nums.some((n) => near(n, [d]))) continue;
    if (!c.labels.some((l) => l && text.includes(dash(l)))) return 'missingSpan';
  }
  if (!COMPARING.test(answer)) return null;
  // Figures that belong to ONE period only (a figure two periods share proves nothing).
  const used: Period[] = [];
  guard.periods.forEach((g, i) => {
    const others = guard.periods.filter((_, j) => j !== i).flatMap((o) => o.ils);
    const own = g.ils.filter((v) => Math.abs(v) >= 1 && !near(Math.abs(v), others));
    if (nums.some((n) => near(n, own))) used.push(g.period);
  });
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = used[i]!;
      const b = used[j]!;
      if (a.from === b.from && a.through === b.through) continue;
      if (!fairlyComparable(a, b)) return 'unfairPeriods';
    }
  }
  return null;
}

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
  /** Set when the answer was refused on period grounds (its text is then neutral). */
  refused?: 'unfairPeriods' | 'missingSpan';
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
 * soft hyphen, bidi marks, variation selectors, tag characters, combining marks
 * on ASCII), look-alike dots mapped to ".", and defanged dots ("[.]", "(.)",
 * "{dot}", " dot ", " נקודה ", "_dot_", "punkt", case-insensitive) and "(at)" restored. The cleaned text
 * the user sees is derived from that normalized copy.
 */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯⠀ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|\p{Cf}/gu;
/** Combining marks on an ASCII char ("evil.c̲om"); a combining dot above ("evil̇com", "˙") is a dot. */
const COMBINING_DOT = /(?<=[\x21-\x7E])\s?\u0307/g;
const ASCII_MARKS = /(?<=[\x21-\x7E])\p{M}+/gu;
/** A dash of any kind between digits is a hyphen ("054–1234567"). */
const DIGIT_DASH = /(?<=\d)\p{Pd}(?=\d)/gu;
const LOOKALIKE_DOTS = /[。｡․﹒۔։·‧∙⋅・⸱⸳܁܂᛫⦁ㆍᆞᐧ་]/g;
const DOT_WORD = '(?:\\.|,|dot|נקודה|punkt)';
const DEFANG = new RegExp(
  `\\s*(?:\\[\\s*${DOT_WORD}\\s*\\]|\\(\\s*${DOT_WORD}\\s*\\)|\\{\\s*${DOT_WORD}\\s*\\}|<\\s*${DOT_WORD}\\s*>|\\s+(?:dot|נקודה|punkt)\\s+|[_-]dot[_-])\\s*`,
  'gi',
);
const DEFANG_AT = /\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*/gi;

/**
 * Known TLDs (lower-case ASCII): the spaced ("evil . com") and comma ("evil,com")
 * forms are only links when they end in one of these — prose has ". Next" and
 * "milk,eggs" all the time. The tight label.word form does NOT use this list:
 * any ASCII word after a dot is a link (inverted logic, S4 L1) unless it is
 * a file extension or one of the prose shapes in `isProseToken`.
 */
const TLDS = new Set(
  (
    'com net org info biz io co il me ru ai app dev shop ly to tv cc xyz online site link store tech top club pro ' +
    'live click page us uk de fr eu cn in br jp au ca es it nl pl ua by kz su tk ml ga cf gq ws fm gg im vip win ' +
    'bid men loan work today life world news email cloud host website space fun icu cyou buzz monster rest bar ' +
    'mobi name asia tel travel gov edu mil int ch at be se no dk fi pt gr tr ro hu cz sk bg hr si rs lt lv ee ie ' +
    'is lu mt cy ae sa eg ma tn jo lb ps iq ir pk bd lk th vn ph my sg id kr tw hk mx ar cl pe ve za ng ke nz ' +
    'one blog wiki help support service services money pay bank finance cash gift sale shopping deals best ' +
    'app games tips network systems solutions digital media agency global center company group zone ' +
    'ink lol wtf rip gay sex porn adult casino bet poker loans cards credit ' +
    // phishing-heavy new gTLDs (S4 re-verify)
    'zip mov bond sbs cfd lat quest cam skin hair beauty mom dad boo foo nexus phd esq prof meme day ' +
    'country stream download review racing date faith party science trade webcam accountant cricket ' +
    'gdn kim men work fit surf uno cyou autos boats homes motorcycles yachts quest ' +
    // food / hospitality / generic gTLDs a restaurant-themed lure would use (refuter round 3)
    'menu pizza wine beer kitchen restaurant cafe coffee bar vodka recipes catering delivery rocks ninja guru ' +
    'plus run fish farm organic market supplies tax direct exchange express ' +
    'example test invalid localhost local onion internal lan home corp'
  ).split(' '),
);

/** File extensions a grounded answer may name ("report.xlsx"). NOT zip/mov — those are phishing gTLDs. */
const FILE_EXTS = new Set(
  'xlsx xls csv pdf png jpg jpeg gif webp svg heic tif tiff doc docx txt rtf json xml ppt pptx odt ods'.split(' '),
);
/** Words that start an English sentence: "spend.Next month", "rose.It came" (a missing space, not a host). */
const SENTENCE_STARTERS = new Set(
  (
    'it its the this that these those there then next last total also and but so we you your our they he she ' +
    'in on at for from to of most some all each every one two three please note overall however meanwhile ' +
    'since because if when while what which why how here now finally first second third this other'
  ).split(' '),
);
/** Abbreviations a "abbr.word" prose token starts with ("avg.price", "kg.unit", "excl.VAT"). */
const ABBREVIATIONS = new Set(
  (
    'avg approx est max min vs incl excl qty tot ref no kg gr ml ltr pcs pc unit ea per mo yr wk hr ' +
    'dr mr mrs ms st jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun'
  ).split(' '),
);
/** Comma / semicolon forms ("evil,com") only count for TLDs that are not everyday list words ("cash,credit"). */
const COMMA_TLDS = new Set([...TLDS].filter((t) => t.length === 2 || ['com', 'net', 'org', 'info', 'biz', 'xyz', 'app', 'dev', 'online', 'site', 'shop', 'zip', 'mov'].includes(t)));

/** A label.word token: punycode, or 2+ letters of any script after the last dot. */
const HOST = /(?<![\p{L}\p{N}@-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(xn--[a-z0-9-]{1,59}|\p{L}{2,24})(?![\p{L}\p{N}-])(?::\d{1,5})?(?:\/\S*)?/giu;
/** "evil . com", "evil .com": a spaced dot before a KNOWN tld (a normal ". Next" sentence is not touched). */
const SPACED_HOST = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\s+\.\s*([a-z]{2,24})\b/giu;
/** "evil. com": only a LOWER-case known tld that ends the token ("Prices rose. Today: ₪1,200" is prose). */
const SPACED_HOST_AFTER = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\.\s+([a-z]{2,24})(?=$|[\s/])(?!\s+[\p{L}\p{N}])/gu;
/** "evil, com" / "evil ,com": a spaced comma before a short list of unmistakable TLDs. */
const SPACED_COMMA_HOST = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]{0,62}\s*[,;]\s*(com|net|org|io|il|ru|xyz|ly|app|dev|zip|mov)(?![\p{L}\p{N}])/gu;
/** "evil,com" / "evil,co,il": a comma between labels before a KNOWN tld (detection only — "milk,eggs" is prose). */
const COMMA_HOST = /(?<![\p{L}\p{N}@-])(?:[\p{L}\p{N}][\p{L}\p{N}-]{0,62}[,;])+([a-z]{2,24}|xn--[a-z0-9-]{1,59})(?![\p{L}\p{N}-])(?:\/\S*)?/giu;
/** Spaced-out single characters ("e v i l . c o m", "e v i l , c o m"): collapsed for detection only. */
const SPACED_LETTERS = /(?<![\p{L}\p{N}])[\p{L}\p{N}](?:\s*[.,;]\s*[\p{L}\p{N}]|[\s-]+[\p{L}\p{N}])+(?![\p{L}\p{N}])/gu;
/** "evil . c o m", "evil.c o m": a word, a dot, then spaced-out letters. */
const WORD_THEN_SPACED = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]*\s*[.,]\s*(?:[\p{L}\p{N}]\s+)+[\p{L}\p{N}](?![\p{L}\p{N}])/gu;

const LINK_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/gi, // any scheme://… (hxxp:// too)
  /\b(?:javascript|data|vbscript|mailto|tel|sms|whatsapp|ftp|file|intent|telegram|tg|viber|skype):\S+/gi, // "Data: 3 invoices" is prose
  /\bwww\.\S+/gi,
  /[^\s@]+@[^\s@]+\.\p{L}[^\s@]*/gu, // user@host / emails ("10@3.50" is a price)
  /(?:^|(?<=\s))@\s*\p{L}[\w.]{1,}/gu, // @handles (Telegram/Instagram), "@ evilbot"
  /\[[0-9a-f:.]*::[0-9a-f:.]*(?:%\w+)?\](?::\d+)?/gi, // [IPv6] with "::"
  /(?<![\w:])(?=[0-9a-f:]*\d)(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])|(?<![\w:])::[0-9a-f]{1,4}\b/gi, // IPv6 "::" ("Note::" is prose)
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, // full IPv6 (a "10:30:45" time is not touched)
  /(?<![\w.-])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])(?::\d+)?(?:\/\S*)?/g, // IPv4 (+port/path); "INV-26.10.18.001" is not
  /\b0x[0-9a-f]{6,8}\b/gi, // hex IPv4
];

/** Phone forms (also checked on a collapsed "0 5 4 - 1 2 3…" copy). */
const PHONE_PATTERNS: RegExp[] = [
  /(?:\+|\b00(?=[1-9]))\d[\d\s-]{7,16}\d\b/g, // international phone numbers ("00012345678" is an invoice no.)
  /\b972\d{8,9}\b/g,
  // Israeli numbers: a real prefix (05X / 07X / 02-04, 08-09), any separators ("(054) 123.4567");
  // an invoice number like "01234567" has no valid prefix + length.
  /(?<![\d.,])(?:\b0|\+?\s*972[\s().-]*)\(?(?:[57][\s().-]*\d|[23489])\)?(?:[\s().-]*\d){7}(?![\d.,])/g,
  /\b1-?[78]00-\d{2,3}-?\d{2,4}\b/g, // toll-free 1-800 / 1700-… (with a hyphen; "Order 1700 250" is a count)
  /(?:^|(?<=\s))\*\d{3,5}\b(?![^*\n]*\*)/g, // *1234 short numbers (not markdown "*1250 ₪*")
];

/** Hebrew IDN TLDs (any other Hebrew word after a dot is just a sentence without a space). */
const HEBREW_TLDS = new Set(['ישראל', 'קום']);

/** The non-ASCII suffix rule: Hebrew only for real Hebrew TLDs; any other script is an IDN or a homoglyph spoof. */
function isNonAsciiTld(t: string): boolean {
  if (/^[\u0590-\u05FF]+$/.test(t)) return HEBREW_TLDS.has(t);
  return /[^\x00-\x7F]/.test(t);
}

function isKnownTld(tld: string): boolean {
  const t = tld.toLowerCase();
  return t.startsWith('xn--') || TLDS.has(t) || isNonAsciiTld(t);
}

/**
 * Inverted rule for a tight label.word token: it IS a link, unless
 *  - the suffix is a file extension ("report.xlsx"), or a Hebrew word (a sentence without a space);
 *  - it is a 2-label ASCII token with no port/path that reads as prose:
 *    "spend.Next" / "rose.It" (Title-case English sentence starter);
 *    "excl.VAT" / "Coke.Zero"… a Title- or UPPER-case word that is no real TLD (full list);
 *    "1.Tnuva" / "2.Review" (a numbered list item, Title-case);
 *    "avg.price" / "kg.unit" (an abbreviation + a word that is no real TLD).
 */
function isProseToken(m: string, tld: string): boolean {
  const t = tld.toLowerCase();
  if (t.startsWith('xn--')) return false;
  if (/[^\x00-\x7F]/.test(t)) return !isNonAsciiTld(t);
  if (FILE_EXTS.has(t)) return true;
  const labels = m.split('.');
  if (labels.length !== 2 || /[:/]/.test(m)) return false;
  const titleOrUpper = /^[A-Z][a-z]+$/.test(tld) || /^[A-Z]{2,}$/.test(tld);
  if (/^[A-Z][a-z]+$/.test(tld) && SENTENCE_STARTERS.has(t)) return true;
  if (/^\d{1,2}$/.test(labels[0]!) && /^[A-Z][a-z]+$/.test(tld)) return true;
  if (titleOrUpper && !ALL_TLDS.has(t) && /^\p{L}[\p{L}\p{N}-]*$/u.test(labels[0]!)) return true;
  return ABBREVIATIONS.has(labels[0]!.toLowerCase()) && /^[A-Za-z]+$/.test(tld) && !ALL_TLDS.has(t);
}

/** Does a (collapsed) token contain a link by the same rules as the prose? */
function hasLink(token: string): boolean {
  const dotted = token.replace(/[,;]/g, '.');
  if (PHONE_PATTERNS.some((re) => new RegExp(re.source, re.flags).test(dotted))) return true;
  for (const m of dotted.matchAll(new RegExp(HOST.source, HOST.flags))) {
    if (!isProseToken(m[0], m[1]!)) return true;
  }
  return false;
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
    .replace(COMBINING_DOT, '.')
    .replace(INVISIBLE, '')
    .replace(ASCII_MARKS, '')
    .replace(DIGIT_DASH, '-')
    .replace(LOOKALIKE_DOTS, '.')
    .replace(DEFANG, '.')
    .replace(DEFANG_AT, '@');
  for (const re of [...LINK_PATTERNS, ...PHONE_PATTERNS]) {
    out = out.replace(re, () => {
      stripped = true;
      return '';
    });
  }
  // Spaced-out letters: collapse a COPY; strip the run only if the copy is a link.
  for (const re of [WORD_THEN_SPACED, SPACED_LETTERS]) {
    out = out.replace(re, (m) => {
      const collapsed = m.replace(/[\s-]+/g, '');
      if (!hasLink(collapsed)) return m;
      stripped = true;
      return '';
    });
  }
  out = out.replace(SPACED_HOST, (m, tld: string) => {
    if (!isKnownTld(tld)) return m;
    stripped = true;
    return '';
  });
  out = out.replace(SPACED_HOST_AFTER, (m, tld: string) => {
    if (!TLDS.has(tld)) return m;
    stripped = true;
    return '';
  });
  out = out.replace(COMMA_HOST, (m, tld: string) => {
    if (!(COMMA_TLDS.has(tld.toLowerCase()) || tld.toLowerCase().startsWith('xn--'))) return m;
    stripped = true;
    return '';
  });
  out = out.replace(SPACED_COMMA_HOST, () => {
    stripped = true;
    return '';
  });
  out = out.replace(HOST, (m, tld: string) => {
    if (isProseToken(m, tld)) return m;
    stripped = true;
    return '';
  });
  // Tidy the gaps left by removals (does not by itself flag the answer).
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').trim(), stripped };
}

export function groundAnswer(
  raw: ClaudeAnswer,
  links: readonly ScreenLink[],
  figures: Figures,
  guard?: PeriodGuard,
): GroundedAnswer {
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
  const refused = guard ? periodRefusal(answer, guard) : null;
  if (refused) {
    return { answer: PERIOD_REFUSAL[guard?.locale ?? 'he'], citations: [], grounded: false, ungrounded, refused };
  }
  return { answer, citations, grounded: ungrounded.length === 0 && !stripped, ungrounded };
}
