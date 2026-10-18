import type { Shape } from '../../../../translate';
import type { he } from '../../../nav/he';

/** nav — ar overlay (Arabic). */
export const nav: Shape<typeof he> = {
  mainLabel: 'القائمة الرئيسية',
  mobileLabel: 'تنقل سريع',
  skipToContent: 'انتقل إلى المحتوى',
  links: {
    overview: 'نظرة عامة',
    receiving: 'استلام البضاعة',
    approvals: 'الموافقات',
    leaks: 'كاشف الخسائر',
    suppliers: 'الموردون',
    catalog: 'الكتالوج',
    orders: 'الطلبيات',
    exports: 'التصدير',
    team: 'الفريق',
    settings: 'الإعدادات',
  },
  groups: {
    operations: 'العمليات',
    purchasing: 'المشتريات',
    admin: 'الإدارة',
  },
  menu: {
    open: 'افتح القائمة',
    close: 'أغلق القائمة',
    more: 'المزيد',
    account: 'الحساب',
  },
  signOut: 'تسجيل الخروج',
  search: {
    placeholder: 'ابحث عن موردين، منتجات، فواتير…',
    shortPlaceholder: 'بحث…',
    label: 'بحث عام',
    searching: 'جارٍ البحث…',
    noResults: 'لا توجد نتائج',
    minChars: 'اكتب حرفين على الأقل',
    error: 'فشل البحث. حاول مرة أخرى.',
    hint: 'الأسهم للتنقل · Enter للفتح · Esc للإغلاق',
    groups: {
      suppliers: 'الموردون',
      products: 'المنتجات',
      invoices: 'الفواتير',
    },
    noInvoiceNumber: 'بدون رقم',
  },
  worker: {
    title: 'نظام المعالجة غير متاح الآن.',
    body: 'الفواتير التي ترفعها محفوظة، وستتم قراءتها ومطابقتها عند عودة النظام.',
    lastBeat: 'آخر إشارة قبل {minutes} دقيقة.',
    ownerNotified: 'تم إبلاغ صاحب المطعم.',
  },
  loading: 'جارٍ التحميل',
};
