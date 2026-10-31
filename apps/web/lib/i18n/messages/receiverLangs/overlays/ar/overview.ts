// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { OverviewReceiverSlice } from '../overview';

/** overview (receiver slice) — ar overlay (Arabic). */
export const overview: Shape<OverviewReceiverSlice> = {
  homeTitle: { receiver: 'شحنات اليوم' },
  homeSubtitle: { receiver: 'الشاحنة التالية في الأعلى، وبعدها كل الباقي.' },
  board: {
    summary: 'اليوم: {total} شحنات · {received} استُلمت · {late} متأخرة',
    next: 'الشاحنة التالية',
    groups: {
      late: 'متأخرة',
      now: 'الآن / التالية',
      later: 'لاحقًا اليوم',
      undated: 'بدون تاريخ',
      received: 'استُلمت',
    },
    cta: {
      start: 'ابدأ الاستلام',
      continue: 'تابع الاستلام',
      received: 'استُلمت ✓',
      partial: 'استُلمت جزئيًا ✓',
    },
    state: {
      inProgress: 'قيد الاستلام',
      late: 'متأخرة',
      lateSince: 'كانت متوقعة {date}',
    },
    items: '{count} أصناف',
    noDate: 'بدون تاريخ توصيل',
    closedAt: 'أُغلقت {time}',
    noPo: {
      title: 'فاتورة بدون طلبية',
      hint: 'وصل مورد بدون طلبية؟ اطلب من مدير الوردية فتح طلبية، وستظهر الشاحنة هنا للاستلام.',
    },
    empty: {
      title: 'لا توجد شحنات متوقعة اليوم',
      hint: 'عندما تُرسل طلبية إلى مورد مع تاريخ توصيل، ستظهر الشاحنة هنا.',
    },
    receipt: {
      title: 'استلام {supplier}',
      readOnly: 'الاستلام مُغلق — للقراءة فقط',
      back: 'العودة إلى لوحة الشحنات',
      product: 'صنف',
      ordered: 'المطلوب',
      received: 'المستلم',
      rejected: 'مرفوض',
      notFound: 'لم يتم العثور على الاستلام',
      followUp: {
        cta: 'وصلت شحنة تكميلية — أكمل الاستلام',
        hint: 'سيُفتح الاستلام مجددًا لعدّ ما وصل الآن. يُسجَّل الفتح في السجل.',
        failed: 'لم نتمكن من فتح الاستلام. حاول مرة أخرى.',
      },
    },
  },
};
