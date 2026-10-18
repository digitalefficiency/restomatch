/**
 * Post-check of a Claude answer against what the tools actually returned —
 * the last line of defence against hallucination and prompt injection:
 *  - citations keep only hrefs the tools produced (internal /dashboard paths);
 *  - a cited value must appear in the tool output (else it is dropped);
 *  - URLs / markdown links are stripped from the answer text;
 *  - every ₪ / % figure in the text must match a tool number, otherwise the
 *    answer is flagged `grounded: false` (the UI shows a "check the screens" note).
 */
import type { ClaudeAnswer } from './claude';
import type { ScreenLink } from './tools';

export interface Citation {
  label: string;
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

function matches(n: number, pool: readonly number[]): boolean {
  // ₪ figures may be rounded to whole shekels in prose; % to one decimal.
  return pool.some((p) => Math.abs(p - n) < 0.01 || Math.abs(Math.round(p) - n) < 0.01 || Math.abs(Math.abs(p) - n) < 0.51);
}

/** Numbers written next to ₪ or % in prose ("₪1,234", "1,234 ₪", "12.5%"). */
export function figuresIn(text: string): number[] {
  const out: number[] = [];
  const re = /(₪\s?-?[\d,]+(?:\.\d+)?|-?[\d,]+(?:\.\d+)?\s?(?:₪|%|ש"ח|ש״ח|shekel|NIS|ILS))/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[0].replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  return out;
}

export function groundAnswer(raw: ClaudeAnswer, links: readonly ScreenLink[], numbers: readonly number[]): GroundedAnswer {
  const allowed = new Set(links.map((l) => l.href).filter((h) => INTERNAL.test(h)));
  const citations: Citation[] = [];
  for (const c of raw.citations) {
    if (!allowed.has(c.href)) continue;
    if (c.value != null && !matches(Math.abs(c.value), numbers.map(Math.abs))) continue;
    if (citations.some((x) => x.href === c.href && x.value === c.value)) continue;
    citations.push({ label: c.label.replace(/[<>]/g, '').slice(0, 120), value: c.value, unit: c.unit, href: c.href });
  }
  const answer = raw.answer
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/[<>]/g, '')
    .trim();
  const ungrounded = figuresIn(answer).filter((n) => !matches(n, numbers.map(Math.abs)));
  return { answer, citations, grounded: ungrounded.length === 0, ungrounded };
}
