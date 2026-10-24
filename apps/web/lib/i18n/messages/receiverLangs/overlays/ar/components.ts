import type { Shape } from '../../../../translate';
import type { he } from '../../../components/he';

/** components — ar overlay (Arabic). */
export const components: Shape<typeof he> = {
  spinner: { loading: 'جارٍ التحميل' },
  loadMore: { label: 'عرض المزيد' },
  breadcrumbs: { label: 'مسار التنقل' },
  toast: {
    region: 'الإشعارات',
    dismiss: 'إغلاق الإشعار',
  },
  errors: {
    generic: 'حدث خطأ. حاول مرة أخرى.',
    network: 'لا يوجد اتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.',
    forbidden: 'ليست لديك صلاحية لفعل ذلك.',
    notFound: 'غير موجود — ربما تم حذفه.',
    validation: 'بعض الحقول غير صحيحة. راجِعها وحاول مرة أخرى.',
    tooMany: 'محاولات كثيرة جدًا. انتظر قليلًا وحاول مرة أخرى.',
  },
  entitlement: {
    features: {
      advanced_analytics: 'تحليلات متقدمة',
      accounting_export: 'تصدير للمحاسبة',
      whatsapp_alerts: 'تنبيهات واتساب',
      integrations: 'الربط مع أنظمة أخرى',
    },
    compactTitle: 'قم بالترقية لتفعيل {feature}',
    compactBody: 'هذه الميزة متاحة في الخطط المدفوعة.',
    compactCta: 'عرض الخطط',
    title: 'قم بترقية خطتك لتفعيل {feature}',
    body: 'ميزة {feature} متاحة في الخطط المدفوعة. قم بترقية حسابك للحصول على كل الميزات.',
    cta: 'عرض الخطط والترقية',
  },
  errorNotice: { title: 'حدث خطأ' },
  activity: {
    types: {
      invoice_received: 'تم استلام فاتورة',
      invoice_matched: 'تمت مطابقة فاتورة',
      discrepancy_approved: 'تمت الموافقة على فرق',
      discrepancy_rejected: 'تم رفض فرق',
      alias_learned: 'تعلّم النظام اسم منتج',
      sync_completed: 'تمت المزامنة',
      other: 'تحديث',
    },
    invoiceReceivedNumbered: 'تم استلام الفاتورة {number}',
    consolidatedReceivedNumbered: 'تم استلام الفاتورة المجمّعة {number}',
    inclVat: '{amount} شامل الضريبة',
    matchesOrder: 'مطابقة للطلبية ولاستلام البضاعة',
    awaitingDeliveryNotes: 'بانتظار المطابقة مع إشعارات التسليم لهذا الأسبوع',
    invoiceMatchedNumbered: 'تمت مطابقة الفاتورة {number}',
    discrepancyOne: 'فرق واحد',
    discrepancies: '{count} فروق',
    potentialLoss: 'خسارة محتملة {amount}',
    savings: 'تم توفير {amount}',
    matchesOrderAndReceipt: 'مطابقة للطلبية ولاستلام البضاعة',
    awaitingMonthlyMatch: 'بانتظار المطابقة مع إشعارات التسليم لهذا الشهر',
    awaitingPoLink: 'بانتظار الربط بطلبية',
    noPoLinked: 'لا توجد طلبية مرتبطة',
    toReviewOne: 'فرق واحد للمراجعة',
    toReview: '{count} فروق للمراجعة',
    empty: 'لا يوجد نشاط بعد.',
  },
};
