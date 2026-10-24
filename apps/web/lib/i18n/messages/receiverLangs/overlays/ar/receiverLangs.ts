import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — ar overlay (Arabic). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'اللغة',
    title: 'اختر لغة التطبيق',
    hint: 'اللغات المتاحة لموظفي الاستلام: العربية، الروسية، التايلاندية، التغرينية. تظهر الشاشات الأخرى بالإنجليزية.',
  },
  lines: {
    original: 'الأصل',
    machine: 'ترجمة آلية — قارنها بالفاتورة',
    untranslated: 'لا توجد ترجمة — يظهر باللغة الأصلية',
  },
};
