import type { Shape } from '../../../../translate';
import type { he } from '../../../ingest/he';

/** ingest — ar overlay (Arabic): the receiver-PWA strings only (pwa.*). Machine-drafted; needs the native-speaker pass. */
export const ingest: Shape<Pick<typeof he, 'pwa'>> = {
  pwa: {
    offlineTitle: 'لا يوجد اتصال بالإنترنت',
    offlineBody: 'يمكنك متابعة التصوير. تُحفظ الصور على الهاتف وتُرفع تلقائيًا عند عودة الاتصال.',
    queued: 'صور بانتظار الرفع: {count}',
    queuedOne: 'صورة واحدة بانتظار الرفع',
    syncing: 'جارٍ رفع الصور المحفوظة…',
    synced: 'تم رفع كل الصور',
    syncFailed: 'فشل الرفع، سنحاول مجددًا بعد قليل',
    savedOffline: 'حُفظت الصورة على الهاتف وسيتم رفعها عند عودة الاتصال',
    install: 'تثبيت تطبيق الاستلام',
    installHint: 'اختصار على الشاشة الرئيسية يفتح مباشرة على الاستلام.',
    installed: 'وضع التطبيق',
  },
};
