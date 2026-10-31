// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { OverviewReceiverSlice } from '../overview';

/** overview (receiver slice) — th overlay (Thai). */
export const overview: Shape<OverviewReceiverSlice> = {
  homeTitle: { receiver: 'ของส่งวันนี้' },
  homeSubtitle: { receiver: 'รถคันถัดไปอยู่ด้านบน ตามด้วยที่เหลือทั้งหมด' },
  board: {
    summary: 'วันนี้: ของส่ง {total} รอบ · รับแล้ว {received} · ล่าช้า {late}',
    next: 'รถคันถัดไป',
    groups: {
      late: 'ล่าช้า',
      now: 'ตอนนี้ / ถัดไป',
      later: 'ภายหลังวันนี้',
      undated: 'ไม่มีวันที่',
      received: 'รับแล้ว',
    },
    cta: {
      start: 'เริ่มรับของ',
      continue: 'รับของต่อ',
      received: 'รับแล้ว ✓',
      partial: 'รับบางส่วน ✓',
    },
    state: {
      inProgress: 'กำลังรับของ',
      late: 'ล่าช้า',
      lateSince: 'กำหนดส่ง {date}',
    },
    items: '{count} รายการ',
    noDate: 'ไม่มีวันที่ส่ง',
    closedAt: 'ปิดเมื่อ {time}',
    noPo: {
      title: 'ใบแจ้งหนี้ที่ไม่มีใบสั่งซื้อ',
      hint: 'ซัพพลายเออร์มาโดยไม่มีใบสั่งซื้อ? ขอให้ผู้จัดการกะเปิดใบสั่งซื้อ แล้วรถจะแสดงที่นี่เพื่อรับของ',
    },
    empty: {
      title: 'วันนี้ไม่มีของส่งที่คาดไว้',
      hint: 'เมื่อส่งใบสั่งซื้อพร้อมวันที่ส่งให้ซัพพลายเออร์ รถจะแสดงที่นี่',
    },
    receipt: {
      title: 'การรับของจาก {supplier}',
      readOnly: 'การรับของปิดแล้ว — อ่านอย่างเดียว',
      back: 'กลับไปที่กระดานของส่ง',
      product: 'สินค้า',
      ordered: 'สั่ง',
      received: 'ได้รับ',
      rejected: 'ปฏิเสธ',
      notFound: 'ไม่พบการรับของ',
      followUp: {
        cta: 'ของส่งตามมาถึงแล้ว — รับของให้ครบ',
        hint: 'การรับของจะเปิดอีกครั้งเพื่อนับสิ่งที่มาตอนนี้ การเปิดใหม่จะถูกบันทึกไว้',
        failed: 'เปิดการรับของไม่สำเร็จ ลองอีกครั้ง',
      },
    },
  },
};
