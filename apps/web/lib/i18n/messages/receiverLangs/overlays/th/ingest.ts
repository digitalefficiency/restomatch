import type { Shape } from '../../../../translate';
import type { he } from '../../../ingest/he';

/** ingest — th overlay (Thai): the receiver-PWA strings only (pwa.*). Machine-drafted; needs the native-speaker pass. */
export const ingest: Shape<Pick<typeof he, 'pwa'>> = {
  pwa: {
    offlineTitle: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
    offlineBody: 'ถ่ายรูปต่อได้เลย รูปจะถูกบันทึกไว้ในโทรศัพท์และอัปโหลดเองเมื่อกลับมาออนไลน์',
    queued: 'รูปที่รออัปโหลด: {count}',
    queuedOne: 'มีรูป 1 รูปรออัปโหลด',
    syncing: 'กำลังอัปโหลดรูปที่บันทึกไว้…',
    synced: 'อัปโหลดรูปครบแล้ว',
    syncFailed: 'อัปโหลดไม่สำเร็จ จะลองใหม่ในอีกสักครู่',
    savedOffline: 'บันทึกรูปไว้ในโทรศัพท์แล้ว จะอัปโหลดเมื่อกลับมาออนไลน์',
    install: 'ติดตั้งแอปรับสินค้า',
    installHint: 'ทางลัดบนหน้าจอหลัก เปิดเข้าหน้ารับสินค้าทันที',
    installed: 'โหมดแอป',
  },
};
