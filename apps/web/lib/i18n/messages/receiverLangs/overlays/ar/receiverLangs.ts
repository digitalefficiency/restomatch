import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — ar overlay (Arabic). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'اللغة',
    title: 'اختر لغة التطبيق',
    hint: 'لغات الاستلام: العربية، الروسية، التايلاندية، التغرينية. الشاشات الأخرى تظهر بالإنجليزية.',
  },
  lines: {
    original: 'الأصل',
    machine: 'ترجمة آلية — قارنها بالفاتورة',
    untranslated: 'لا توجد ترجمة — يظهر باللغة الأصلية',
  },
};
