import { describe, expect, it } from 'vitest';
import { initialQueueState, reduceQueueKey, type QueueState } from '../queue-keys';

const press = (s: QueueState, key: string, extra: object = {}) => reduceQueueKey(s, { key, ...extra });

describe('W3-10 "לקשר" keys', () => {
  it('J/K move within bounds, on English and Hebrew layouts', () => {
    let s = initialQueueState(3, 2);
    s = press(s, 'j').state;
    s = press(s, 'ח').state;
    s = press(s, 'J').state;
    expect(s.index).toBe(2);
    s = press(s, 'k').state;
    s = press(s, 'ל').state;
    s = press(s, 'ArrowUp').state;
    expect(s.index).toBe(0);
  });

  it('1–3 link to an offered candidate only; 4 creates; the row leaves the queue', () => {
    let s = initialQueueState(3, 2);
    const miss = press(s, '3');
    expect(miss).toMatchObject({ handled: true, effect: { kind: 'none' } });
    let r = press(s, '2');
    expect(r.effect).toEqual({ kind: 'link', rowIndex: 0, candidate: 1 });
    s = r.state;
    expect(s.rowCount).toBe(2);
    s = press(s, 'j').state;
    r = press(s, '4');
    expect(r.effect).toEqual({ kind: 'create', rowIndex: 1 });
    expect(r.state).toMatchObject({ rowCount: 1, index: 0 });
  });

  it('Z undoes the last action and refocuses its row; undo on empty history is a no-op', () => {
    let s = initialQueueState(2, 1);
    s = press(s, '1').state;
    s = press(s, '1').state;
    expect(s.index).toBe(-1);
    const u = press(s, 'z');
    expect(u.effect).toEqual({ kind: 'undo', action: { kind: 'link', rowIndex: 0 } });
    expect(u.state).toMatchObject({ rowCount: 1, index: 0 });
    expect(press(initialQueueState(1), 'Z')).toMatchObject({ handled: true, effect: { kind: 'none' } });
  });

  it('never acts inside a text field or on a modifier chord', () => {
    const s = initialQueueState(2, 2);
    expect(press(s, '1', { inEditable: true }).handled).toBe(false);
    expect(press(s, 'z', { ctrlKey: true }).handled).toBe(false);
    expect(press(s, 'k', { metaKey: true }).handled).toBe(false);
    expect(press(s, 'x').handled).toBe(false);
  });
});
