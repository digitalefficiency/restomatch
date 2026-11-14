import { describe, expect, it } from 'vitest';
import {
  THREAD_KEY,
  THREAD_MAX,
  appendTurn,
  autoSubmitQuestion,
  loadThread,
  saveThread,
  settleTurn,
  withoutQ,
  type AskTurn,
} from '../thread';
import { formatPeriod, intentChip } from '../intent';

const turn = (id: string): AskTurn => ({ id, question: `q${id}`, answer: null, at: 1 });

describe('Ask thread (sessionStorage)', () => {
  it('round-trips, caps at THREAD_MAX and survives garbage or a throwing store', () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    let t: AskTurn[] = [];
    for (let i = 0; i < THREAD_MAX + 3; i++) t = appendTurn(t, turn(String(i)));
    expect(t).toHaveLength(THREAD_MAX);
    saveThread(store, t);
    expect(loadThread(store)).toEqual(t);
    mem.set(THREAD_KEY, '{bad');
    expect(loadThread(store)).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(loadThread(throwing)).toEqual([]);
    expect(() => saveThread(throwing, t)).not.toThrow();
  });
  it('settles one turn (stream end / stop / ungrounded)', () => {
    const t = settleTurn([turn('a'), turn('b')], 'b', { answer: 'תשובה', ungrounded: true });
    expect(t[0]!.answer).toBeNull();
    expect(t[1]).toMatchObject({ answer: 'תשובה', ungrounded: true });
  });
});

describe('?q= auto-submit', () => {
  it('submits a trimmed question once, ignores out-of-range lengths', () => {
    expect(autoSubmitQuestion('?q=%20%D7%9B%D7%9E%D7%94%20%20%D7%93%D7%9C%D7%A3%3F')).toBe(
      'כמה דלף?',
    );
    expect(autoSubmitQuestion('?q=a')).toBeNull();
    expect(autoSubmitQuestion(`?q=${'א'.repeat(501)}`)).toBeNull();
    expect(autoSubmitQuestion('')).toBeNull();
  });
  it('drops q from the URL and keeps the rest', () => {
    expect(withoutQ('/dashboard/ask', '?q=x&from=palette')).toBe('/dashboard/ask?from=palette');
    expect(withoutQ('/dashboard/ask', '?q=x')).toBe('/dashboard/ask');
  });
});

describe('intent chip', () => {
  it('names topic, subject and period', () => {
    expect(intentChip({ topic: 'leak', period: '2026-10' }, 'he')).toBe('הבנתי: דליפה · 10.2026');
    expect(intentChip({ topic: 'supplier', subject: ' ירקות השרון ' }, 'he')).toBe(
      'הבנתי: ספק · ירקות השרון',
    );
    expect(intentChip({ topic: 'claims' }, 'en')).toBe('Understood as: Credit requests');
  });
  it('ignores a malformed period', () => {
    expect(formatPeriod('2026-13')).toBeNull();
    expect(formatPeriod(null)).toBeNull();
  });
});

describe('wiring helpers (W3-04b part 2)', () => {
  it('maps the offline canned intents to a chip, and nothing for Claude/unknown', async () => {
    const { intentFromCanned } = await import('../intent');
    expect(intentFromCanned('leakChange')).toEqual({ topic: 'leak' });
    expect(intentFromCanned('claimWeek')).toEqual({ topic: 'claims' });
    expect(intentChip(intentFromCanned('claimWeek')!, 'he')).toBe('הבנתי: בקשות זיכוי');
    expect(intentFromCanned(null)).toBeNull();
    expect(intentFromCanned('somethingNew')).toBeNull();
  });
  it('a stopped turn and a result survive the session round-trip', () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const t = settleTurn(
      settleTurn([turn('a'), turn('b')], 'a', { error: 'stopped' }),
      'b',
      { result: { mode: 'offline', grounded: true }, ungrounded: false },
    );
    saveThread(store, t);
    const back = loadThread(store);
    expect(back[0]).toMatchObject({ id: 'a', error: 'stopped' });
    expect(back[1]).toMatchObject({ id: 'b', result: { mode: 'offline' } });
  });
});
