import type { CompleteOverlays } from '../../translate';
import type { feedHe } from './feed';

/** Receiver-language overlays (ar/ru/th/ti) of `components.feed.*` (machine-translated, pending native review). */
export const feedReceiver: CompleteOverlays<typeof feedHe> = {
  ar: {
    openInvoice: 'إلى الفاتورة {number}',
    byActor: 'بواسطة {actor}',
    discrepancies: '{count, plural, zero {لا فروقات} one {فرق واحد} two {فرقان} few {# فروقات} many {# فرقًا} other {# فرق}}',
    toReview:
      '{count, plural, zero {لا فروقات للمراجعة} one {فرق واحد للمراجعة} two {فرقان للمراجعة} few {# فروقات للمراجعة} many {# فرقًا للمراجعة} other {# فرق للمراجعة}}',
  },
  ru: {
    openInvoice: 'Открыть счёт {number}',
    byActor: 'Автор: {actor}',
    discrepancies: '{count, plural, one {# расхождение} few {# расхождения} many {# расхождений} other {# расхождения}}',
    toReview:
      '{count, plural, one {# расхождение на проверку} few {# расхождения на проверку} many {# расхождений на проверку} other {# расхождения на проверку}}',
  },
  th: {
    openInvoice: 'เปิดใบแจ้งหนี้ {number}',
    byActor: 'โดย {actor}',
    discrepancies: '{count, plural, other {ไม่ตรงกัน # รายการ}}',
    toReview: '{count, plural, other {ต้องตรวจ # รายการ}}',
  },
  ti: {
    openInvoice: 'ፋክቱራ {number} ክፈት',
    byActor: 'ብ {actor}',
    discrepancies: '{count, plural, one {# ፍልልይ} other {# ፍልልያት}}',
    toReview: '{count, plural, one {# ፍልልይ ንምርመራ} other {# ፍልልያት ንምርመራ}}',
  },
};
