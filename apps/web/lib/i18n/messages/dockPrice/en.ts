import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  usual: 'Your usual price:',
  window: '({days} days)',
  title: 'Median of what you paid this supplier for the item over the last {days} days ({count} invoices)',
};
