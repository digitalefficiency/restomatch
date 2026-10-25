import { describe, expect, it } from 'vitest';
import { outsideTolerance, parseQty, qtyInputText, qtyKind } from '../qtyEntry';
import { assessScanQuality } from '../scanQuality';

// The engine's defaults (packages/matching/src/tolerances.ts) — the UI reads them, never redefines them.
const TOL = { qtyPercent: 0.03, qtyAbsolute: 1 };

describe('quantity entry at the back door (RCV-10)', () => {
  it('weighed and measured units get the decimal keypad; counted units the stepper', () => {
    for (const u of ['ק״ג', 'ק"ג', 'קג', 'kg', 'גרם', 'ליטר', "ל'", 'מ״ל']) expect(qtyKind(u), u).toBe('measured');
    for (const u of ['יח׳', 'ארגז', 'קרטון', 'בקבוק', null, '']) expect(qtyKind(u), String(u)).toBe('counted');
  });

  it('accepts a decimal comma and keeps 3 decimals', () => {
    expect(parseQty('11,640')).toBe(11.64);
    expect(parseQty('11.6404')).toBe(11.64);
    expect(parseQty('0,125')).toBe(0.125);
    expect(parseQty(' 8 ')).toBe(8);
    expect(parseQty('8.')).toBe(8);
    expect(parseQty('')).toBeNull();
    expect(parseQty('-2')).toBeNull();
    expect(parseQty('1,2,3')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(qtyInputText(11.6404)).toBe('11.64');
  });

  it('asks to confirm only outside the engine quantity tolerance', () => {
    expect(outsideTolerance(12, 11.64, TOL)).toBeNull(); // 3% on 12 kg: clean for the engine
    expect(outsideTolerance(12, 12.3, TOL)).toBeNull();
    expect(outsideTolerance(12, 12.5, TOL)).toBeCloseTo(0.0417, 3); // over 3%: the engine records it
    expect(outsideTolerance(12, 116.4, TOL)).toBeCloseTo(8.7, 5); // a typo
    expect(outsideTolerance(10, 8, TOL)).toBeCloseTo(0.2, 5); // billed 10, arrived 8
    expect(outsideTolerance(null, 3, TOL)).toBeNull();
  });
});

describe('scan quality gate (RCV-03)', () => {
  const W = 40;
  const H = 40;
  const fill = (f: (x: number, y: number) => number) => {
    const a = new Uint8ClampedArray(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) a[y * W + x] = f(x, y);
    return a;
  };

  it('names a dark photo', () => {
    expect(assessScanQuality(fill(() => 20), W, H)).toBe('dark');
  });

  it('names a blurred photo (no edges)', () => {
    expect(assessScanQuality(fill((x) => 120 + x), W, H)).toBe('blurry');
  });

  it('passes a sharp, lit page (text-like edges)', () => {
    expect(assessScanQuality(fill((x, y) => (y % 4 === 0 && x % 3 !== 0 ? 30 : 230)), W, H)).toBeNull();
  });
});
