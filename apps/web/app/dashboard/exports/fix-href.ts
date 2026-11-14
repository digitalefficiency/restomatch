/** W3-05b · where to fix each group the export leaves out (exports.preview). Pure. */

export type Reason = 'notChecked' | 'duplicate' | 'undated' | 'notInUniform';

/** Where to fix each left-out group: the one invoice when there is one, else its queue. */
export function fixHref(reason: Reason, invoiceIds: readonly string[], count: number): string {
  const one = count === 1 && invoiceIds[0] ? `/dashboard/invoices/${invoiceIds[0]}` : null;
  switch (reason) {
    case 'notChecked':
      return one ?? '/dashboard/invoices?view=awaiting';
    case 'duplicate':
      return '/dashboard/approvals';
    case 'undated':
    case 'notInUniform':
      return one ?? (invoiceIds[0] ? `/dashboard/invoices/${invoiceIds[0]}` : '/dashboard/invoices');
  }
}
