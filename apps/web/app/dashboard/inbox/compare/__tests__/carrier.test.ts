import { describe, expect, it } from 'vitest';
import { carrierChoice, type CarrierOption } from '../carrier';

const page: CarrierOption = { id: 'page', role: 'page', supplier: 'תנובה', number: null, total: 600 };
const headA: CarrierOption = { id: 'headA', role: 'head', supplier: 'תנובה', number: 'A-1', total: 400 };
const headB: CarrierOption = { id: 'headB', role: 'head', supplier: 'תנובה', number: 'A-2', total: 5_000 };

describe('G-09 · the "checked together" dialog\'s carrier (round 12 #10)', () => {
  it('defaults only to an OFFERED invoice — never a head the person did not pick, even with the biggest total', () => {
    const c = carrierChoice([page, headA, headB], 'headA', null);
    expect(c.offered.map((o) => o.id)).toEqual(['page', 'headA']);
    expect(c.payable).toBe('page'); // ₪600 > ₪400; headB (₪5,000) is not offered
  });

  it('switching heads moves the offer; a pick no longer offered falls back to the default', () => {
    expect(carrierChoice([page, headA, headB], 'headB', null).payable).toBe('headB');
    expect(carrierChoice([page, headA, headB], 'headB', 'headA').payable).toBe('headB');
    expect(carrierChoice([page, headA, headB], 'headA', 'headA').payable).toBe('headA');
  });

  it('the carrier a head is already included in is offered too', () => {
    const carrier: CarrierOption = { id: 'carrier', role: 'carrier', supplier: 'תנובה', number: 'A-1', total: 1_000 };
    expect(carrierChoice([page, headA, carrier], 'headA', null).payable).toBe('carrier');
  });
});
