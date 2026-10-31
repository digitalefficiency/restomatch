import { describe, expect, it } from 'vitest';
import { formatIls } from '../../money';
import { messageTemplates } from '../../messageTemplates';
import { stripIsolates } from '../translate';
import { lint } from './copyGate';

const FSI = '⁨';
const PDI = '⁩';

const all = () => [
  messageTemplates.lateDelivery({ supplierName: 'Coca-Cola Ltd.', agentName: 'Dana', orderedOn: '20.10', expectedLabel: 'אתמול' }),
  messageTemplates.priceDispute({ supplierName: 'Coca-Cola Ltd.', productName: 'Cola 1.5L', sku: 'CC-15', orderedPrice: 12.5, invoicePrice: 14.9 }),
  messageTemplates.missingItem({ supplierName: 'Coca-Cola Ltd.', productName: 'Cola 1.5L', qty: 24, unit: 'יח׳' }),
  messageTemplates.agentVerification({ supplierName: 'Coca-Cola Ltd.', name: 'Dana', role: 'סוכנת', newPhone: '050-1234567' }),
  messageTemplates.orderConfirmation({ supplierName: 'Coca-Cola Ltd.', lines: [{ rawDescription: 'Cola 1.5L', qty: 6, unit: 'ארגז' }] }),
];

describe('supplier WhatsApp texts (W2-13)', () => {
  it('isolate the supplier name (FSI…PDI), never ASCII quotes around it (Lab I)', () => {
    for (const msg of all()) {
      expect(msg).toContain(`${FSI}Coca-Cola Ltd.${PDI}`);
      expect(msg).not.toMatch(/"Coca|Ltd\."/);
    }
  });

  it('₪ comes from the formatter (agora precision), never typed next to a number', () => {
    const msg = stripIsolates(all()[1]!);
    for (const n of [14.9, 12.5, 2.4]) expect(msg).toContain(formatIls(n, { maximumFractionDigits: 2 }));
    expect(msg).not.toMatch(/₪\d/);
  });

  it('no slash forms, glossary terms, and every text passes the copy gate', () => {
    for (const msg of all()) {
      expect(msg).not.toMatch(/[א-ת] ?\/ ?[א-ת]/);
      expect(lint(stripIsolates(msg), 'he')).toEqual([]);
    }
    expect(all()[1]).toContain('חשבונית זיכוי');
    expect(all()[1]).not.toContain('תעודת זיכוי');
  });
});
