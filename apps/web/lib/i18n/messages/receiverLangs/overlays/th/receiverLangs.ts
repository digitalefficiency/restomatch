import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — th overlay (Thai). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'ภาษา',
    title: 'เลือกภาษาของแอป',
    hint: 'ภาษาสำหรับผู้รับสินค้า: อาหรับ รัสเซีย ไทย ติกรินยา หน้าอื่นจะแสดงเป็นภาษาอังกฤษ',
  },
  lines: {
    original: 'ต้นฉบับ',
    machine: 'แปลอัตโนมัติ — ตรวจกับบิล',
    untranslated: 'ไม่มีคำแปล — แสดงเป็นภาษาต้นฉบับ',
  },
};
