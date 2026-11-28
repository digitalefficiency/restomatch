import { describe, expect, it } from 'vitest';
import { formatIlsAgorot } from '@restomatch/api';
import { formatIls } from '../money';
import { parseIlsInput } from '../../app/dashboard/recovery/parseIls';

/**
 * The server renderers (monthly-report email / WhatsApp / PDF, recovery
 * reminders) format ₪ with formatIlsAgorot in @restomatch/api because they
 * cannot import the web util. This pins the two to identical output.
 */
describe('₪ formatting parity: web formatIls ↔ server formatIlsAgorot', () => {
  const samples = [0, 1, 99, 100, 49_000, 123_456, 3_083_700, 99_999_999];
  for (const locale of ['he', 'en'] as const) {
    for (const digits of [0, 2]) {
      it(`${locale}, ${digits} decimals`, () => {
        for (const agorot of samples) {
          expect(formatIlsAgorot(agorot, { locale, maximumFractionDigits: digits })).toBe(
            formatIls(agorot / 100, { locale, maximumFractionDigits: digits }),
          );
        }
      });
    }
  }
});

describe('credit-note amount input → integer agorot', () => {
  it('parses shekel input at the boundary', () => {
    expect(parseIlsInput('159')).toBe(15900);
    expect(parseIlsInput('159.5')).toBe(15950);
    expect(parseIlsInput('1,234.56')).toBe(123456);
    expect(parseIlsInput('12,50')).toBe(1250);
    expect(parseIlsInput('₪ 10.01')).toBe(1001);
  });
  it('rejects junk, zero and sub-agora precision', () => {
    for (const bad of ['', 'abc', '0', '1.234', '-5', '1e3']) expect(parseIlsInput(bad)).toBeNull();
  });
});

describe('₪ formatting parity: signDisplay (H-01)', () => {
  // The server twin formatIlsAgorot has no signDisplay yet: G-13 mirrors the
  // option in packages/api/src/reports/money.ts. Until then this row is skipped
  // with a reason, not silently omitted.
  it.skip('server twin formatIlsAgorot mirrors signDisplay (pending G-13)', () => {});
});
