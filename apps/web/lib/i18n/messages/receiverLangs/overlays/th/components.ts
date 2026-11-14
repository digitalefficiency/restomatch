import type { Shape } from '../../../../translate';
import type { he } from '../../../components/he';

/** components — th overlay (Thai). */
export const components: Shape<typeof he> = {
  spinner: { loading: 'กำลังโหลด' },
  loadMore: { label: 'โหลดเพิ่ม' },
  breadcrumbs: { label: 'เส้นทางหน้า' },
  toast: {
    region: 'การแจ้งเตือน',
    dismiss: 'ปิดการแจ้งเตือน',
  },
  errors: {
    generic: 'เกิดข้อผิดพลาด กรุณาลองใหม่',
    network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่',
    forbidden: 'คุณไม่มีสิทธิ์ทำสิ่งนี้',
    notFound: 'ไม่พบรายการนี้ — อาจถูกลบไปแล้ว',
    validation: 'ข้อมูลบางช่องไม่ถูกต้อง กรุณาตรวจแล้วลองใหม่',
    tooMany: 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่',
  },
  entitlement: {
    features: {
      advanced_analytics: 'การวิเคราะห์ขั้นสูง',
      accounting_export: 'ส่งออกข้อมูลบัญชี',
      whatsapp_alerts: 'แจ้งเตือนทาง WhatsApp',
      integrations: 'การเชื่อมต่อระบบ',
    },
    compactTitle: 'อัปเกรดเพื่อใช้ {feature}',
    compactBody: 'ฟีเจอร์นี้มีในแพ็กเกจแบบเสียเงิน',
    compactCta: 'ดูแพ็กเกจ',
    title: 'อัปเกรดแพ็กเกจเพื่อใช้ {feature}',
    body: '{feature} มีในแพ็กเกจแบบเสียเงิน อัปเกรดบัญชีเพื่อใช้ได้ทั้งหมด',
    cta: 'ดูแพ็กเกจและอัปเกรด',
  },
  errorNotice: { title: 'เกิดข้อผิดพลาด' },
  activity: {
    types: {
      invoice_received: 'ได้รับบิล',
      invoice_matched: 'ตรวจเทียบบิลแล้ว',
      discrepancy_approved: 'เรียกคืนจากผู้จำหน่ายแล้ว',
      discrepancy_rejected: 'ชำระตามที่เรียกเก็บ',
      alias_learned: 'เรียนรู้ชื่อสินค้าใหม่',
      sync_completed: 'ซิงค์ข้อมูลเสร็จแล้ว',
      other: 'อัปเดต',
    },
    invoiceReceivedNumbered: 'ได้รับบิล {number}',
    consolidatedReceivedNumbered: 'ได้รับบิลรวม {number}',
    inclVat: '{amount} รวม VAT',
    matchesOrder: 'ตรงกับใบสั่งซื้อและการรับสินค้า',
    awaitingDeliveryNotes: 'รอเทียบกับใบส่งของสัปดาห์นี้',
    invoiceMatchedNumbered: 'ตรวจเทียบบิล {number} แล้ว',
    discrepancyOne: 'ไม่ตรงกัน 1 รายการ',
    discrepancies: 'ไม่ตรงกัน {count} รายการ',
    potentialLoss: '{amount} ในรายการที่ไม่ตรงกัน',
    savings: 'เรียกคืน {amount}',
    matchesOrderAndReceipt: 'ตรงกับใบสั่งซื้อและการรับสินค้า',
    awaitingMonthlyMatch: 'รอเทียบกับใบส่งของเดือนนี้',
    awaitingPoLink: 'รอเชื่อมกับใบสั่งซื้อ',
    noPoLinked: 'ยังไม่ได้เชื่อมใบสั่งซื้อ',
    toReviewOne: 'มี 1 รายการที่ต้องตรวจสอบ',
    toReview: 'มี {count} รายการที่ต้องตรวจสอบ',
    empty: 'ยังไม่มีความเคลื่อนไหว',
  },
};
