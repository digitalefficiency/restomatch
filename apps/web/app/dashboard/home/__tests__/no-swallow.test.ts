import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * G-16 (money-swallow): a home read that fails must reach the section boundary
 * ("unavailable", neutral) — never `.catch(() => undefined)` into a silent default
 * that renders as ₪0 or "all handled". The old Toolbar's
 * `owner.viewOptions().catch(() => undefined)` is gone with I1; this pins that no
 * home file reintroduces the pattern.
 */
const HOME = join(__dirname, '..');
const files = [
  ...readdirSync(HOME).filter((f) => /\.tsx?$/.test(f)).map((f) => join(HOME, f)),
  join(HOME, '..', 'page.tsx'),
];
/**
 * Named exceptions — each routed to its owner, never silently allowed:
 * - home/questions.tsx (G-08 lane, from train B): `mapping.questionCount().catch(() => 0)`
 *   hides the "זה אותו מוצר?" line when the count can't be read (a count, no ₪).
 *   Routed to the orchestrator 11.11; remove this entry when G-08 fixes it.
 */
const KNOWN: Record<string, string> = { 'home/questions.tsx': 'G-08: questionCount().catch(() => 0)' };
const SWALLOW = /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(undefined|null|0|\[\]|\{\}|''|"")\s*\)/;

describe('home reads never swallow an error into a silent default (G-16)', () => {
  it.each(files.map((f) => [f.slice(HOME.length - 'home'.length)]))('%s', (rel) => {
    const src = readFileSync(join(HOME, '..', rel), 'utf8');
    if (KNOWN[rel]) {
      // Still there (keep the exception honest): when it is fixed, this fails and the entry goes.
      expect(src, `${rel} no longer swallows — delete its KNOWN entry`).toMatch(SWALLOW);
      return;
    }
    expect(src).not.toMatch(SWALLOW);
  });
  it('the pattern catches the old Toolbar line', () =>
    expect('ctx.caller.owner.viewOptions().catch(() => undefined)').toMatch(SWALLOW));
});
