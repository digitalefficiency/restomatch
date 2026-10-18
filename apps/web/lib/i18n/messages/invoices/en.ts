import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  correction: {
    title: 'Correct invoice',
    subtitle:
      'Fix values the OCR read wrong (quantity / price / total) and re-run the match — the leak figure is calculated from these lines.',
    details: 'Invoice details',
    supplier: 'Supplier',
    viewScan: 'View scan',
    rerun: 'Re-run match',
    leak: 'Leak:',
    discrepancies: '{count} discrepancies',
    noMatchingPo: 'No matching order',
    number: 'Invoice number',
    date: 'Date',
    exclVat: 'Total before VAT (₪)',
    vat: 'VAT (₪)',
    inclVat: 'Total incl. VAT (₪)',
    saveDetails: 'Save details',
    colDescription: 'Description',
    colQty: 'Qty',
    colUnit: 'Unit',
    colUnitPrice: 'Unit price',
    colLineTotal: 'Line total',
    save: 'Save',
    edit: 'Edit',
    cancel: 'Cancel',
    noLines: 'This invoice has no lines.',
    rerunHint: 'After fixing lines or totals, use "Re-run match" to recalculate the discrepancies and the leak figure.',
    savedHeader: 'Invoice details saved.',
    savedLine: 'Line saved.',
    failed: 'The action failed.',
    showHebrew: 'Show Hebrew original',
  },
  status: {
    clean: 'Clean — no discrepancies',
    minor: 'Minor discrepancies',
    major: 'Major discrepancies',
    blocked: 'Blocked',
  },
};
