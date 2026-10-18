/**
 * Post-check of a Claude answer against what the tools actually returned —
 * the last line of defence against hallucination and prompt injection:
 *  - citations keep only hrefs the tools produced (internal /dashboard paths);
 *    their label is the SCREEN name (not model text) and a cited value must be
 *    a figure of the SAME unit in the tool output (₪ vs % vs count);
 *  - URLs, bare domains, markdown links and phone numbers are stripped from the text;
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

export function sanitizeAnswer(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|il|info|biz|xyz|app|me|ru|ai|example|link|site|online)\b\S*/gi, '')
    .replace(/(?:\+972|\b0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  const answer = sanitizeAnswer(raw.answer);
  const ungrounded = figuresIn(answer).filter((n) => !near(n, all));
  return { answer, citations, grounded: ungrounded.length === 0, ungrounded };
}
