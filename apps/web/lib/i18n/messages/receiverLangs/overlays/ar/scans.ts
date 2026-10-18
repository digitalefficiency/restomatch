import type { Shape } from '../../../../translate';
import type { he } from '../../../scans/he';

/** scans — ar overlay (Arabic). */
export const scans: Shape<typeof he> = {
  scannedInvoice: 'فاتورة ممسوحة',
  secureLink: 'رابط آمن',
  pages: '{count} صفحات',
  localCopy: 'نسخة محلية (للتطوير)',
  notLoading: 'لا يفتح؟ قد يكون السبب مانع النوافذ المنبثقة أو متصفح لا يعرض ملفات PDF.',
  openInTab: 'افتح في علامة تبويب جديدة',
};
