import { describe, expect, it } from 'vitest';
import { accountCodeProblem, base64ToBytes, bytesToBase64, mappingPayload, mappingProblems, posErrorOf } from '../logic';

describe('account codes', () => {
  it('mirrors the server rule (letters, digits, . _ - up to 15)', () => {
    expect(accountCodeProblem('6000', true)).toBeNull();
    expect(accountCodeProblem('ספק-12', true)).toBeNull();
    expect(accountCodeProblem('', true)).toBe('required');
    expect(accountCodeProblem('', false)).toBeNull();
    expect(accountCodeProblem('60\t00', true)).toBe('invalid');
    expect(accountCodeProblem('1234567890123456', true)).toBe('invalid');
  });

  it('collects problems per field and drops blank supplier overrides from the payload', () => {
    const form = { expenseAccount: ' 6000 ', vatInputAccount: '', movementType: 'חסר?', supplierAccounts: { a: ' 4001 ', b: '', c: 'x y' } };
    expect(mappingProblems(form)).toEqual({ vatInputAccount: 'required', movementType: 'invalid', 'supplier:c': 'invalid' });
    expect(mappingPayload({ ...form, vatInputAccount: '3700', movementType: 'חס', supplierAccounts: { a: ' 4001 ', b: '' } })).toEqual({
      expenseAccount: '6000',
      vatInputAccount: '3700',
      movementType: 'חס',
      supplierAccounts: { a: '4001' },
    });
  });
});

describe('POS errors', () => {
  it('parses the stable POS_FILE_<code>[:missing] message', () => {
    expect(posErrorOf({ message: 'POS_FILE_NO_COLUMNS:qty,net' })).toEqual({ key: 'NO_COLUMNS', missing: ['qty', 'net'] });
    expect(posErrorOf({ message: 'POS_FILE_NO_ROWS' })).toEqual({ key: 'NO_ROWS', missing: [] });
    expect(posErrorOf({ message: 'something else' })).toBeNull();
    expect(posErrorOf(null)).toBeNull();
  });
});

describe('file bytes', () => {
  it('base64 round-trips binary (Windows-1255 / UTF-16 bytes survive untouched)', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xe0, 0x05, 0x00, 0x0d, 0x0a]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big)).length).toBe(100_000);
  });
});
