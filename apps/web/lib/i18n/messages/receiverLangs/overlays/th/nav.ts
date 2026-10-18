import type { Shape } from '../../../../translate';
import type { he } from '../../../nav/he';

/** nav — th overlay (Thai). */
export const nav: Shape<typeof he> = {
  mainLabel: 'เมนูหลัก',
  mobileLabel: 'เมนูด่วน',
  skipToContent: 'ข้ามไปที่เนื้อหา',
  links: {
    overview: 'ภาพรวม',
    receiving: 'รับสินค้า',
    approvals: 'อนุมัติ',
    leaks: 'ตามหาเงินรั่ว',
    ask: 'ถาม RestoMatch',
    suppliers: 'ผู้จำหน่าย',
    catalog: 'แคตตาล็อก',
    orders: 'ใบสั่งซื้อ',
    exports: 'ส่งออกข้อมูล',
    team: 'ทีม',
    chain: 'เครือร้าน',
    branches: 'สาขา',
    settings: 'ตั้งค่า',
  },
  groups: {
    operations: 'งานประจำวัน',
    purchasing: 'จัดซื้อ',
    admin: 'การจัดการ',
  },
  menu: {
    open: 'เปิดเมนู',
    close: 'ปิดเมนู',
    more: 'เพิ่มเติม',
    account: 'บัญชี',
  },
  signOut: 'ออกจากระบบ',
  search: {
    placeholder: 'ค้นหาผู้จำหน่าย สินค้า บิล…',
    shortPlaceholder: 'ค้นหา…',
    label: 'ค้นหาทั้งหมด',
    searching: 'กำลังค้นหา…',
    noResults: 'ไม่พบผลลัพธ์',
    minChars: 'พิมพ์อย่างน้อย 2 ตัวอักษร',
    error: 'ค้นหาไม่สำเร็จ กรุณาลองใหม่',
    hint: 'ใช้ลูกศรเลื่อน · Enter เปิด · Esc ปิด',
    groups: {
      suppliers: 'ผู้จำหน่าย',
      products: 'สินค้า',
      invoices: 'บิล',
    },
    noInvoiceNumber: 'ไม่มีเลขที่',
  },
  worker: {
    title: 'ตอนนี้ระบบตรวจบิลใช้งานไม่ได้',
    body: 'บิลที่อัปโหลดจะถูกบันทึกไว้ และระบบจะอ่านและตรวจทันทีที่กลับมาใช้งานได้',
    lastBeat: 'ติดต่อได้ครั้งล่าสุด {minutes} นาทีที่แล้ว',
    ownerNotified: 'แจ้งเจ้าของร้านแล้ว',
  },
  loading: 'กำลังโหลด',
};
