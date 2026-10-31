// Machine translation — pending native review (W2-16; reviewer: W2-05, owner of receiverLangs/**).
import type { CompleteOverlays } from '../../translate';
import type { he } from './he';

/**
 * Receiver-language overlays (ar/ru/th/ti) of the `explain` namespace: the fold toggle labels plus
 * every concept a receiver screen renders. A concept missing here falls back to Hebrew, never English
 * (translate.ts). Adding a receiver-rendered concept to he.ts means adding it here in the same commit.
 */
export const RECEIVER_CONCEPTS = ['noSendWithoutTap', 'amountAfterClose', 'reviewNotGap', 'possibleDuplicate', 'viewOnly'] as const;

type ReceiverPart = Pick<typeof he, 'toggle' | (typeof RECEIVER_CONCEPTS)[number]>;

export const explainReceiver: CompleteOverlays<ReceiverPart> = {
  ar: {
    toggle: { why: 'لماذا؟', details: 'التفاصيل', how: 'كيف حسبنا؟' },
    noSendWithoutTap: 'لا يُرسَل شيء إلى المورّد دون ضغطة منكم.',
    amountAfterClose: 'يُحدَّد المبلغ بعد إغلاق استلام البضاعة.',
    reviewNotGap: 'سطر للفحص ليس فرقًا. حدّدوه حسب ما وصل.',
    possibleDuplicate: 'رقم الفاتورة موجود مسبقًا لدى المورّد. ستُفحص قبل الدفع.',
    viewOnly: 'للعرض فقط',
  },
  ru: {
    toggle: { why: 'Почему?', details: 'Подробнее', how: 'Как мы посчитали?' },
    noSendWithoutTap: 'Поставщику ничего не отправляется без вашего нажатия.',
    amountAfterClose: 'Сумма будет определена после закрытия приёмки товара.',
    reviewNotGap: 'Строка на проверку — это не расхождение. Отметьте её по тому, что пришло.',
    possibleDuplicate: 'Такой номер счёта у поставщика уже есть. Его проверят перед оплатой.',
    viewOnly: 'Только просмотр',
  },
  th: {
    toggle: { why: 'ทำไม?', details: 'รายละเอียด', how: 'เราคำนวณอย่างไร?' },
    noSendWithoutTap: 'ไม่มีอะไรถูกส่งถึงซัพพลายเออร์จนกว่าคุณจะกด',
    amountAfterClose: 'ยอดจะกำหนดหลังปิดการรับสินค้า',
    reviewNotGap: 'บรรทัดที่ต้องตรวจไม่ใช่ส่วนต่าง ทำเครื่องหมายตามของที่มาถึง',
    possibleDuplicate: 'เลขใบแจ้งหนี้นี้มีอยู่แล้วสำหรับซัพพลายเออร์นี้ จะถูกตรวจก่อนชำระเงิน',
    viewOnly: 'ดูอย่างเดียว',
  },
  ti: {
    toggle: { why: 'ስለምንታይ?', details: 'ዝርዝር', how: 'ብኸመይ ተሓሲቡ?' },
    noSendWithoutTap: 'ብዘይ ናትኩም ጠውቒ ናብ ኣቕራቢ ዋላ ሓንቲ ኣይለኣኽን።',
    amountAfterClose: 'እቲ መጠን ድሕሪ ምዕጻው ምቕባል ኣቑሑ ይውሰን።',
    reviewNotGap: 'ንምርመራ ዘሎ መስመር ፍልልይ ኣይኮነን። ብዝመጸ መሰረት ምልክት ግበሩሉ።',
    possibleDuplicate: 'እዚ ቁጽሪ ፋክቱራ ኣብቲ ኣቕራቢ ድሮ ኣሎ። ቅድሚ ክፍሊት ክምርመር እዩ።',
    viewOnly: 'ንምርኣይ ጥራይ',
  },
};
