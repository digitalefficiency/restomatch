import type { Shape } from '../../../../translate';
import type { he } from '../../../scans/he';

/** scans — th overlay (Thai). */
export const scans: Shape<typeof he> = {
  scannedInvoice: 'ใบแจ้งหนี้ที่สแกน',
  secureLink: 'ลิงก์ปลอดภัย',
  pages: '{count} หน้า',
  localCopy: 'สำเนาในเครื่อง (สำหรับพัฒนา)',
  notLoading: 'เปิดไม่ขึ้น? อาจเป็นเพราะเบราว์เซอร์บล็อกป๊อปอัป หรือเปิดไฟล์ PDF ไม่ได้',
  openInTab: 'เปิดในแท็บใหม่',
};
