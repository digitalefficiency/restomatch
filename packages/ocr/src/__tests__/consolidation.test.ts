import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TruthInvoice } from '../bench/score';
import { scoreExtraction } from '../bench/score';
import { checkInvoice, isValidIsraeliBusinessId } from '../checks';
import { billingPeriodOf, classifyConsolidation, consolidatedRawOf } from '../consolidation';
import { runOcrPipeline } from '../pipeline';
import { SYSTEM_PROMPT } from '../providers/claudeVision';
import { cleanDeliveryNotes, InvoiceExtractionV2 } from '../providers/invoiceSchema';
import { normalizeExtraction } from '../providers/normalizeExtraction';
import { StubOcrProvider } from '../providers/stub';

const truth = (n: number) =>
  JSON.parse(readFileSync(new URL(`../../bench/invoice-${n}.truth.json`, import.meta.url), 'utf8')) as TruthInvoice;

/** A truth file read back through the same parse path as a model answer. */
const asExtraction = (n: number) => {
  const r = InvoiceExtractionV2.safeParse(normalizeExtraction(truth(n)));
  if (!r.success) throw new Error(r.error.message);
  return r.data;
};

describe('classifyConsolidation — conservative', () => {
  it('two or more distinct delivery notes → consolidated (delivery_note_list)', () => {
    expect(classifyConsolidation({ deliveryNotes: [{ number: '101' }, { number: '102' }] })).toEqual({
      consolidation: 'consolidated',
      basis: 'delivery_note_list',
    });
  });

  it('one delivery note → regular, even when the model said consolidated without a period', () => {
    expect(classifyConsolidation({ documentKind: 'tax_invoice', deliveryNotes: [{ number: '61844' }] }).consolidation).toBe('regular');
    expect(classifyConsolidation({ documentKind: 'consolidated', deliveryNotes: [{ number: '61844' }] })).toEqual({
      consolidation: 'regular',
      basis: 'none',
    });
  });

  it('duplicate or empty numbers do not make a list', () => {
    expect(
      classifyConsolidation({ deliveryNotes: [{ number: '7' }, { number: '7' }, { number: '' }] }).consolidation,
    ).toBe('regular');
  });

  it('declared מרכזת with a printed period → consolidated (declared_with_period)', () => {
    expect(
      classifyConsolidation({ documentKind: 'consolidated', periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
    ).toEqual({
      consolidation: 'consolidated',
      basis: 'declared_with_period',
      billingPeriod: { from: '2026-10-01', to: '2026-10-31' },
    });
  });

  it('a period alone (no מרכזת, no list) stays regular; a reversed period is no period', () => {
    expect(classifyConsolidation({ periodStart: '2026-10-01', periodEnd: '2026-10-31' }).consolidation).toBe('regular');
    expect(billingPeriodOf({ periodStart: '2026-10-31', periodEnd: '2026-10-01' })).toBeUndefined();
    expect(billingPeriodOf({ periodStart: '2026-10-01' })).toBeUndefined();
  });
});

describe('delivery-note parsing', () => {
  it('keeps digits only, accepts numeric numbers, de-duplicates, drops bad items one by one', () => {
    expect(
      cleanDeliveryNotes([
        { number: 'ת.מ. 30512', date: '2026-10-03', totalExclVat: 412.5 },
        { number: 30587, date: '08/10/2026', totalExclVat: '388' },
        { number: '30512' },
        { number: 'אין' },
        null,
        'garbage',
      ]),
    ).toEqual([
      { number: '30512', date: '2026-10-03', totalExclVat: 412.5 },
      { number: '30587', date: undefined, totalExclVat: undefined },
    ]);
    expect(cleanDeliveryNotes('not a list')).toBeUndefined();
  });

  it('a garbled note list never fails the whole invoice parse', () => {
    const raw = { ...truth(4), deliveryNotes: [{ number: { x: 1 } }, { number: '61844' }] };
    const r = InvoiceExtractionV2.safeParse(normalizeExtraction(raw));
    expect(r.success).toBe(true);
    expect(r.success && r.data.deliveryNotes).toEqual([{ number: '61844', date: undefined, totalExclVat: undefined }]);
  });

  it('the prompt asks for the מרכזת cues, per-note totals and the one-ת.מ. rule', () => {
    expect(SYSTEM_PROMPT).toContain('"totalExclVat": number?');
    for (const cue of ['חשבונית מרכזת', 'ריכוז תעודות משלוח', 'לפי ת.מ. 1234', 'tax_invoice']) {
      expect(SYSTEM_PROMPT).toContain(cue);
    }
  });
});

describe('gate — consolidated', () => {
  const base = asExtraction(2);

  it('Σ delivery-note totals = subtotal passes, and a notes-only מרכזת needs no product lines', () => {
    expect(base.lines).toEqual([]);
    expect(checkInvoice(base)).toMatchObject({ passed: true, reasons: [] });
  });

  it('a misread note total → delivery_notes_total_mismatch with the delta', () => {
    const inv = structuredClone(base);
    inv.deliveryNotes![2]!.totalExclVat = 485.2; // 455.20 read as 485.20
    const r = checkInvoice(inv);
    expect(r.reasons).toEqual(['delivery_notes_total_mismatch']);
    expect(r.issues[0]).toMatchObject({ deltaAgorot: 3000 });
  });

  it('within 100 agorot (rounding per note) passes', () => {
    const inv = structuredClone(base);
    inv.deliveryNotes![0]!.totalExclVat = 412.9;
    expect(checkInvoice(inv).passed).toBe(true);
  });

  it('a note without a printed total skips the Σ check — and then lines are required again', () => {
    const inv = structuredClone(base);
    delete inv.deliveryNotes![1]!.totalExclVat;
    expect(checkInvoice(inv).reasons).toEqual(['no_lines']);
  });

  it('a regular invoice citing one ת.מ. with no lines is still no_lines', () => {
    const inv = { ...asExtraction(4), lines: [], deliveryNotes: [{ number: '61844', totalExclVat: 1304.5 }] };
    expect(checkInvoice(inv).reasons).toContain('no_lines');
  });
});

describe('bench fixtures 2–4 (מרכזת ×2, regular citing one ת.מ.)', () => {
  it.each([2, 3, 4])('invoice-%i: valid ח״פ, adds up, passes the gate, lines × price exact', (n) => {
    const t = truth(n);
    expect(isValidIsraeliBusinessId(t.supplier.businessId)).toBe(true);
    for (const l of t.lines) expect(Math.round(l.qty * l.unitPrice * 100)).toBe(Math.round(l.lineTotal * 100));
    expect(Math.round(t.totals.subtotal * 18)).toBe(Math.round(t.totals.vat * 100));
    expect(Math.round((t.totals.subtotal + t.totals.vat) * 100)).toBe(Math.round(t.totals.total * 100));
    expect(checkInvoice(asExtraction(n))).toMatchObject({ passed: true, reasons: [] });
  });

  it.each([
    [2, 'consolidated', 'delivery_note_list'],
    [3, 'consolidated', 'delivery_note_list'],
    [4, 'regular', 'none'],
  ] as const)('invoice-%i through the pipeline → %s (%s)', async (n, consolidation, basis) => {
    const stub = new StubOcrProvider('claude_vision', asExtraction(n));
    const r = await runOcrPipeline(Buffer.from('x'), { documentAi: stub, claude: stub });
    expect(r.reconciled.consolidation).toBe(consolidation);
    expect(r.reconciled.consolidationBasis).toBe(basis);
    expect(r.reconciled.consolidation).toBe(truth(n).consolidation);
    expect(r.checks.passed).toBe(true);
  });

  it('the period is carried for a מרכזת that prints one', async () => {
    const stub = new StubOcrProvider('claude_vision', asExtraction(3));
    const r = await runOcrPipeline(Buffer.from('x'), { documentAi: stub, claude: stub });
    expect(r.reconciled.billingPeriod).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('consolidatedRawOf gives the matcher contract (kind, YYYY-MM-DD period, digit-only numbers); null when regular', () => {
    const raw = consolidatedRawOf(asExtraction(2))!;
    expect(raw).toMatchObject({ kind: 'consolidated', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(raw.deliveryNotes.map((d) => d.number)).toEqual(['30512', '30587', '30644', '30702', '30771']);
    for (const d of raw.deliveryNotes) expect(d.number).toMatch(/^\d+$/);
    expect(consolidatedRawOf(asExtraction(4))).toBeNull();
    expect(consolidatedRawOf({ ...asExtraction(4), consolidation: 'regular' })).toBeNull();
  });

  it('the scorer checks the classification, the note numbers/totals and the period', () => {
    const t = truth(2);
    const perfect = { ...asExtraction(2), consolidation: 'consolidated' };
    expect(scoreExtraction(t, perfect).failures).toEqual([]);
    const wrong = {
      ...perfect,
      consolidation: 'regular',
      deliveryNotes: perfect.deliveryNotes!.slice(1),
      periodEnd: '2026-10-30',
    };
    expect(scoreExtraction(t, wrong).failures).toEqual([
      'consolidation',
      'deliveryNote 30512',
      'deliveryNote 30512.totalExclVat',
      'deliveryNotes.count',
      'periodEnd',
    ]);
    expect(scoreExtraction(t, wrong).moneyExact).toBe(false);
  });
});
