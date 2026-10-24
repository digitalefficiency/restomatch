import { describe, expect, it } from 'vitest';
import { parseJsonFromText } from '../providers/_anthropic';

describe('parseJsonFromText', () => {
  it('parses a fenced JSON object', () => {
    expect(parseJsonFromText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores trailing text after the object, even with braces', () => {
    const text = '{"lines":[{"name":"עגבניות {שרי}","qty":2}]}\n\nNote: total {approx} matches.';
    expect(parseJsonFromText(text)).toEqual({ lines: [{ name: 'עגבניות {שרי}', qty: 2 }] });
  });

  it('handles escaped quotes inside strings', () => {
    expect(parseJsonFromText('Here: {"s":"a \\"}\\" b"} done')).toEqual({ s: 'a "}" b' });
  });

  it('throws when no object is present', () => {
    expect(() => parseJsonFromText('no json here')).toThrow(/no JSON object/);
  });
});
