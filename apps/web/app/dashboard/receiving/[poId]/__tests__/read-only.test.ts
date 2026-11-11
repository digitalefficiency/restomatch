import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adaptReconciliation, type InvoiceLineRow, type PoLineRow } from '../_adapters';

// The components are compiled with the classic JSX runtime in vitest (as in heatmap.test).
(globalThis as unknown as { React?: typeof React }).React = React;
// Loaded after the global exists (Reconciliation builds JSX at module level).
const { AdjustQuantities } = await import('@/app/showcase/receiver/_steps/AdjustQuantities');
const { Reconciliation } = await import('@/app/showcase/receiver/_steps/Reconciliation');

/**
 * ReceivingWizard `readOnly` (IA-03 wires readOnly={routeAccess(role, path) === 'read'}):
 * every line and its numbers stay visible; no write action (✓ / edit / bulk /
 * close / retake / photo / dock slip) is rendered. Default false: unchanged.
 */
const po = { id: 'po', supplierId: 's', supplierName: 'ספק', expectedAt: null, status: 'sent', totalEstimated: null };
const poLines: PoLineRow[] = [
  { id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '20' },
  { id: 'pl2', productId: 'p2', rawDescription: 'עגבניה שרי', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' },
];
const inv = (o: Partial<InvoiceLineRow>): InvoiceLineRow => ({
  id: 'i',
  productId: null,
  rawDescription: null,
  qtyBilled: '1',
  unit: 'ק״ג',
  unitPriceBilled: '1',
  lineTotal: '1',
  ...o,
});

const WRITE_IDS = ['count-arrived', 'count-edit', 'close-receipt', 'all-arrived', 'mark-rest', 'count-actions'];

function count(readOnly?: boolean): string {
  const { result, initialMarks } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });
  return renderToStaticMarkup(
    createElement(AdjustQuantities, {
      result,
      marks: initialMarks,
      onUpdateMark: () => undefined,
      onSubmit: () => undefined,
      ...(readOnly === undefined ? {} : { readOnly }),
    }),
  );
}

describe('ReceivingWizard readOnly — the count screen', () => {
  it('default (no prop): the write actions are there, exactly as before', () => {
    const html = count();
    for (const id of ['count-arrived', 'count-edit', 'count-actions']) expect(html).toContain(`data-testid="${id}"`);
  });

  it('readOnly: every line and its ordered quantity stay visible; no ✓ / edit / bulk / close', () => {
    const html = count(true);
    expect(html).toContain('data-testid="delivery-check"');
    expect(html.match(/data-testid="count-line"/g)).toHaveLength(2);
    expect(html).toContain('חזה עוף');
    expect(html).toContain('עגבניה שרי');
    expect(html).toContain('data-testid="count-progress"');
    for (const id of WRITE_IDS) expect(html).not.toContain(`data-testid="${id}"`);
  });
});

describe('ReceivingWizard readOnly — the invoice comparison', () => {
  const { result } = adaptReconciliation({
    po,
    poLines,
    receiptLines: [],
    invoiceLines: [inv({ id: 'a', productId: 'p1', qtyBilled: '4', unitPriceBilled: '20' })],
  });
  const recon = (readOnly: boolean) =>
    renderToStaticMarkup(
      createElement(Reconciliation, { result, onContinueAdjust: () => undefined, onRetake: () => undefined, showMoney: false, readOnly }),
    );

  it('readOnly hides the retake (a new photo is a write) and keeps the lines + the way to the count', () => {
    expect(recon(false)).toContain('data-testid="recon-retake"');
    const html = recon(true);
    expect(html).not.toContain('data-testid="recon-retake"');
    expect(html).toContain('data-testid="continue-adjust"');
    expect(html).toContain('חזה עוף');
  });
});

describe('ReceivingWizard readOnly — wiring (source guard)', () => {
  const src = readFileSync(join(__dirname, '..', 'wizard.tsx'), 'utf8');
  it('defaults to false and reaches both screens', () => {
    expect(src).toMatch(/readOnly = false,\n\}: \{/);
    expect(src).toMatch(/<Reconciliation[\s\S]*?readOnly=\{readOnly\}/);
    expect(src).toMatch(/<AdjustQuantities[\s\S]*?readOnly=\{readOnly\}/);
  });
  it('no photo, no receipt started, no mark, no close, no dock slip when read-only', () => {
    expect(src).toContain("{step === 'SCAN_INVOICE' && !readOnly ? (");
    expect(src).toContain("{step === 'SCAN_INVOICE' && registerRetry && !readOnly ? (");
    expect(src).toContain('const activeGrId = readOnly ? (knownGrId ?? grId) : await ensureReceipt(knownGrId ?? grId);');
    expect(src).toContain('if (readOnly) return; // view only: nothing is marked or saved');
    expect(src).toContain('if (readOnly || !grId || !result) return;');
    expect(src).toContain('{dockSlipOn && grId && slipNeeded && !readOnly ? (');
  });
});
