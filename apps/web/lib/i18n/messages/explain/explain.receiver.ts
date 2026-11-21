// Machine translation — pending native review (W2-16; reviewer: W2-05, owner of receiverLangs/**).
import type { CompleteOverlays } from '../../translate';
import type { he } from './he';

/**
 * Receiver-language overlays (ar/ru/th/ti) of the `explain` namespace: the fold toggle labels plus
 * every concept a receiver screen renders. A concept missing here falls back to Hebrew, never English
 * (translate.ts). Adding a receiver-rendered concept to he.ts means adding it here in the same commit.
 */
// W2-05 review (31.10): amountAfterClose and possibleDuplicate are owner/bookkeeper ideas (money,
// payment) and are not rendered on receiver screens, so they stay out of the receiver overlay.
export const RECEIVER_CONCEPTS = ['noSendWithoutTap', 'reviewNotGap', 'viewOnly'] as const;

type ReceiverPart = Pick<typeof he, 'toggle' | (typeof RECEIVER_CONCEPTS)[number]>;

export const explainReceiver: CompleteOverlays<ReceiverPart> = {
  ar: {
    toggle: { why: 'لماذا؟', details: 'التفاصيل', how: 'كيف حسبنا؟' },
    noSendWithoutTap: 'لا يُرسَل شيء إلى المورد دون ضغطة منكم.',
    reviewNotGap: 'سطر للفحص ليس فرقًا. حدّدوه حسب ما وصل.',
    viewOnly: 'للعرض فقط',
  },
  ru: {
    toggle: { why: 'Почему?', details: 'Подробнее', how: 'Как мы посчитали?' },
    noSendWithoutTap: 'Поставщику ничего не отправляется без вашего нажатия.',
    reviewNotGap: 'Строка на проверку — это не расхождение. Отметьте её по тому, что пришло.',
    viewOnly: 'Только просмотр',
  },
  th: {
    toggle: { why: 'ทำไม?', details: 'รายละเอียด', how: 'เราคำนวณอย่างไร?' },
    noSendWithoutTap: 'ไม่มีอะไรถูกส่งถึงผู้จำหน่ายจนกว่าคุณจะกด',
    reviewNotGap: 'บรรทัดที่ต้องตรวจไม่ใช่ส่วนต่าง ทำเครื่องหมายตามของที่มาถึง',
    viewOnly: 'ดูอย่างเดียว',
  },
  ti: {
    toggle: { why: 'ስለምንታይ?', details: 'ዝርዝር', how: 'ብኸመይ ተሓሲቡ?' },
    noSendWithoutTap: 'ብዘይ ናትኩም ጠውቒ ናብ ኣቕራቢ ዋላ ሓንቲ ኣይለኣኽን።',
    reviewNotGap: 'ንምርመራ ዘሎ መስመር ፍልልይ ኣይኮነን። ብዝመጸ መሰረት ምልክት ግበሩሉ።',
    viewOnly: 'ንምርኣይ ጥራይ',
  },
};
