// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { CommonReceiverSlice } from '../common';

/** common (receiver slice: actions, states, shell resilience + screen names) — th overlay (Thai). */
export const common: Shape<CommonReceiverSlice> = {
  actions: {
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    cancel: 'ยกเลิก',
    confirm: 'ยืนยัน',
    close: 'ปิด',
    back: 'กลับ',
    next: 'ถัดไป',
    previous: 'ก่อนหน้า',
    edit: 'แก้ไข',
    delete: 'ลบ',
    remove: 'นำออก',
    add: 'เพิ่ม',
    create: 'สร้าง',
    search: 'ค้นหา',
    filter: 'กรอง',
    clear: 'ล้าง',
    retry: 'ลองอีกครั้ง',
    refresh: 'รีเฟรช',
    upload: 'อัปโหลด',
    download: 'ดาวน์โหลด',
    export: 'ส่งออก',
    import: 'นำเข้า',
    approve: 'อนุมัติ',
    reject: 'ปฏิเสธ',
    loadMore: 'โหลดเพิ่ม',
    viewAll: 'ดูทั้งหมด',
    details: 'รายละเอียด',
    continue: 'ต่อไป',
    submit: 'ส่ง',
    signOut: 'ออกจากระบบ',
    backToOverview: 'กลับไปที่ภาพรวม',
    backHome: 'กลับหน้าแรก',
  },
  states: {
    loading: 'กำลังโหลด…',
    empty: 'ไม่มีข้อมูลที่จะแสดง',
    error: 'เกิดข้อผิดพลาด',
    noResults: 'ไม่พบผลลัพธ์',
    saved: 'บันทึกแล้ว',
    yes: 'ใช่',
    no: 'ไม่',
    all: 'ทั้งหมด',
    none: 'ไม่มี',
    unknown: 'ไม่ทราบ',
    optional: 'ไม่บังคับ',
    required: 'จำเป็น',
  },
  shell: {
    offline: {
      chip: 'ไม่มีการเชื่อมต่อ · จะอัปเดตเมื่อเครือข่ายกลับมา',
      back: 'เชื่อมต่อได้อีกครั้ง',
      action: 'ไม่มีการเชื่อมต่อ — ยังไม่ได้ส่งคำสั่ง ลองอีกครั้งเมื่อเครือข่ายกลับมา',
    },
    session: {
      title: 'การเข้าสู่ระบบหมดอายุ',
      body: 'เข้าสู่ระบบอีกครั้ง — งานของคุณบันทึกไว้แล้ว คำสั่งที่ยังไม่ได้ส่งรอให้คุณกดอีกครั้ง',
      notSent: 'ยังไม่ได้ส่ง · การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบแล้วลองอีกครั้ง',
      email: 'อีเมล',
      password: 'รหัสผ่าน',
      submit: 'เข้าสู่ระบบ',
      submitting: 'กำลังเข้าสู่ระบบ…',
      wrong: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือพยายามหลายครั้งเกินไป ลองอีกครั้งในอีกสักครู่',
      rate: 'พยายามหลายครั้งเกินไป ลองอีกครั้งภายหลัง',
      magicLink: 'ไม่มีรหัสผ่าน? ส่งลิงก์เข้าสู่ระบบทางอีเมลให้ฉัน',
      magicSent: 'เราส่งลิงก์เข้าสู่ระบบไปที่ {email} แล้ว เปิดลิงก์แล้วกลับมาที่แท็บนี้ — เราจะทำต่อจากตรงนี้',
      magicFailed: 'ส่งลิงก์ไม่สำเร็จ ลองอีกครั้งในอีกสักครู่',
      twoFactor: 'บัญชีนี้ใช้การยืนยันสองขั้นตอน เข้าสู่ระบบให้เสร็จในแท็บใหม่แล้วกลับมาที่นี่',
      openTwoFactor: 'ยืนยันให้เสร็จในแท็บใหม่',
      checkAgain: 'เสร็จแล้ว — ทำต่อ',
      stillOut: 'ยังไม่ได้เข้าสู่ระบบ เข้าสู่ระบบให้เสร็จแล้วลองอีกครั้ง',
      otherUserLink: 'ไม่ใช่คุณ? เข้าสู่ระบบด้วยผู้ใช้อื่น',
      otherUser: 'คุณเข้าสู่ระบบด้วยผู้ใช้อื่น — กำลังโหลดหน้าใหม่',
      done: 'เข้าสู่ระบบอีกครั้งแล้ว ทำต่อจากที่ค้างไว้',
      dismiss: 'ปิด',
    },
    forbidden: {
      eyebrow: '403 · ไม่มีสิทธิ์เข้าถึง',
      title: 'หน้าจอ ‘{screen}’ ไม่เปิดให้ตำแหน่งของคุณ',
      allowed: 'หน้าจอนี้เปิดให้: {roles}',
      youAre: 'คุณเข้าสู่ระบบเป็น {role} ที่ {branch}',
      requestTitle: 'ขอสิทธิ์จากเจ้าของ',
      requestBody: 'เราจะเตรียมข้อความพร้อมลิงก์ให้ เจ้าของเปลี่ยนตำแหน่งได้ที่หน้าจอทีมงาน',
      whatsapp: 'ขอทาง WhatsApp',
      email: 'ขอทางอีเมล',
      requestText: 'สวัสดี ขอสิทธิ์เข้าหน้าจอ ‘{screen}’ ใน RestoMatch ({branch}) ได้ไหม? ลิงก์: {url}',
      requestSubject: 'ขอสิทธิ์เข้าหน้าจอ ‘{screen}’',
      openIn: 'เปิดใน {branch} ({role})',
      openInHint: 'คุณมีสิทธิ์เข้าหน้าจอนี้ในสาขาอื่น:',
      refreshTitle: 'ตำแหน่งของคุณอัปเดตแล้ว',
      refreshBody: 'เจ้าของเปลี่ยนสิทธิ์ของคุณ รีเฟรชสิทธิ์เพื่อเปิดหน้าจอ ‘{screen}’',
      refreshCta: 'รีเฟรชสิทธิ์',
      home: 'กลับหน้าแรก',
      notMember: 'ลิงก์นี้เป็นของสาขาที่คุณไม่มีสิทธิ์เข้าถึง ขอให้เจ้าของเพิ่มคุณ หรือกลับหน้าแรก',
      notMemberTitle: 'คุณไม่มีสิทธิ์เข้าถึงสาขานี้',
    },
    notFound: {
      eyebrow: '404',
      title: 'ไม่พบหน้านี้',
      body: 'หน้านี้อาจถูกลบ ลิงก์อาจผิด หรือเป็นของสาขาอื่น',
      otherBranch: 'ถ้าลิงก์มาจากสาขาอื่น ให้เปลี่ยนสาขาจากตัวเลือกด้านบนของหน้า',
      up: 'กลับไปที่ {screen}',
      home: 'กลับหน้าแรก',
    },
    error: {
      title: 'โหลดหน้านี้ไม่สำเร็จ',
      body: 'ลองอีกครั้ง ถ้ายังเกิดซ้ำ ให้เก็บรหัสที่แสดงที่นี่ไว้ — ช่วยหาสาเหตุของปัญหาได้',
      bodyNoCode: 'ลองอีกครั้งในอีกสักครู่',
      code: 'รหัส: {digest}',
      retry: 'ลองอีกครั้ง',
      retrying: 'กำลังโหลดอีกครั้ง…',
      home: 'กลับหน้าแรก',
      offline: 'ไม่มีการเชื่อมต่อเครือข่าย หน้านี้จึงโหลดไม่ได้ เราจะโหลดอีกครั้งเมื่อเชื่อมต่อได้',
    },
    screens: {
      home: 'หน้าแรก',
      receiving: 'รับสินค้า',
      approvals: 'การอนุมัติ',
      payRun: 'รอบการจ่ายเงิน',
      inbox: 'ใบแจ้งหนี้ขาเข้า',
      invoices: 'ใบแจ้งหนี้',
      leaks: 'การรั่วไหล',
      claims: 'คำขอใบลดหนี้ที่ต้องส่ง',
      leakProof: 'หลักฐานการรั่วไหล',
      leakReport: 'รายงานการรั่วไหล',
      recovery: 'ติดตามเงินคืน ₪',
      reports: 'รายงาน',
      monthlyReport: 'รายงานประจำเดือน',
      ask: 'ถาม RestoMatch',
      suppliers: 'ซัพพลายเออร์',
      ledger: 'บัญชีซัพพลายเออร์',
      catalog: 'แคตตาล็อก',
      orders: 'ใบสั่งซื้อ',
      contracts: 'สัญญาและราคา',
      recipes: 'ต้นทุนต่อจาน',
      inventory: 'นับสต็อก',
      exports: 'ปิดเดือนและส่งออก',
      integrations: 'การเชื่อมต่อ',
      team: 'ทีมงาน',
      settings: 'การตั้งค่า',
      chain: 'ภาพรวมเครือ',
      branches: 'สาขา',
    },
    listSep: ', ',
    listLast: ' และ',
  },
  // W3-03a field components — machine translation, pending native review.
  field: {
    scan: {
      button: 'สแกนบาร์โค้ด', // review
      scanning: 'หันกล้องไปที่บาร์โค้ด', // review
      cancel: 'ยกเลิก', // review
      typeInstead: 'พิมพ์เอง', // review
      manualLabel: 'หมายเลขบาร์โค้ด', // review
      manualHint: 'ตัวเลขใต้แถบเส้น', // review
      submit: 'ยืนยัน', // review
      empty: 'กรุณาพิมพ์หมายเลขก่อน', // review
      found: 'สแกนแล้ว: {code}', // review
      unsupported: 'โทรศัพท์นี้สแกนบาร์โค้ดไม่ได้ พิมพ์หมายเลขแทนได้', // review
      denied: 'ไม่ได้รับอนุญาตให้ใช้กล้อง พิมพ์หมายเลขแทนได้', // review
      failed: 'สแกนไม่สำเร็จ พิมพ์หมายเลขแทนได้', // review
    },
    mic: {
      button: 'ป้อนด้วยเสียง', // review
      listening: 'กำลังฟัง… พูดได้เลย', // review
      stop: 'หยุดบันทึก', // review
      cancel: 'ยกเลิก', // review
      confirmLabel: 'นี่คือสิ่งที่เราได้ยิน แก้ไขได้ก่อนยืนยัน', // review
      typedLabel: 'พิมพ์ข้อความ', // review
      confirm: 'ยืนยัน', // review
      retry: 'บันทึกใหม่', // review
      empty: 'กรุณาใส่ข้อความก่อนยืนยัน', // review
      unsupported: 'โทรศัพท์นี้ไม่รองรับการป้อนด้วยเสียง พิมพ์แทนได้', // review
      denied: 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน พิมพ์แทนได้', // review
      offline: 'ไม่มีการเชื่อมต่อ ป้อนด้วยเสียงไม่ได้ตอนนี้ พิมพ์แทนได้', // review
      noSpeech: 'เราไม่ได้ยินอะไรเลย ลองอีกครั้งหรือพิมพ์แทน', // review
      failed: 'ป้อนด้วยเสียงไม่สำเร็จ พิมพ์แทนได้', // review
    },
  },
  // W3-03b PWA (share, install, notifications) — machine translation, pending native review.
  pwa: {
    notify: {
      title: 'การแจ้งเตือน', // review
      subtitle: 'อะไรส่งถึงคุณ และส่งไปที่ไหน: โทรศัพท์ อีเมล หรือ WhatsApp', // review
      unavailable: 'การแจ้งเตือนบนโทรศัพท์จะเปิดเร็ว ๆ นี้ ระหว่างนี้ข้อความจะส่งทางอีเมล', // review
      deviceTitle: 'โทรศัพท์เครื่องนี้', // review
      deviceOn: 'เปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้แล้ว', // review
      deviceOff: 'ปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้อยู่', // review
      enable: 'เปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้', // review
      disable: 'ปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้', // review
      noKey: 'ยังไม่ได้เชื่อมต่อผู้ให้บริการแจ้งเตือน ปุ่มจะใช้ได้เมื่อเชื่อมต่อเสร็จ', // review
      denied: 'เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ อนุญาตได้ในการตั้งค่าเบราว์เซอร์', // review
      unsupported: 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนโทรศัพท์', // review
      needsInstall: 'บน iPhone การแจ้งเตือนใช้ได้เฉพาะในแอปที่ติดตั้งแล้ว ติดตั้งจากเมนูแชร์', // review
      failed: 'ไม่สำเร็จ ลองอีกครั้ง', // review
      enabled: 'เปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้แล้ว', // review
      disabled: 'ปิดการแจ้งเตือนบนโทรศัพท์เครื่องนี้แล้ว', // review
      eventsTitle: 'แจ้งเตือนเรื่องอะไร', // review
      channelPush: 'โทรศัพท์', // review
      channelEmail: 'อีเมล', // review
      channelWhatsapp: 'WhatsApp', // review
      saved: 'บันทึกแล้ว', // review
      test: 'ส่งการแจ้งเตือนทดสอบ', // review
      testSkipped: 'ไม่ได้ส่งการแจ้งเตือนทดสอบ: ยังไม่ได้เชื่อมต่อผู้ให้บริการแจ้งเตือน', // review
      quiet: 'ไม่มีการแจ้งเตือนระหว่าง 23:00–06:00 และวันชะบัต สูงสุดวันละ 6 ครั้ง', // review
      events: {
        receiver_morning_brief: 'ของเข้าวันนี้ (06:00)', // review
        delivery_late: 'ของมาส่งช้า', // review
        approval_waiting: 'ใบแจ้งหนี้รออนุมัติ', // review
        order_reminder: 'เตือนสั่งของ', // review
        claim_overdue: 'คำขอเครดิตที่ยังไม่มีคำตอบ', // review
        invoice_ocr_failed: 'ใบแจ้งหนี้ที่อ่านไม่ได้', // review
      },
    },
    install: {
      title: 'ติดตั้ง RestoMatch บนโทรศัพท์เครื่องนี้ไหม', // review
      body: 'เปิดจากหน้าจอหลัก ทำงานได้แม้ไม่มีสัญญาณ และรับแจ้งเตือนเรื่องของเข้าและการอนุมัติ', // review
      install: 'ติดตั้ง', // review
      later: 'ไว้ทีหลัง', // review
      iosTitle: 'ติดตั้งบน iPhone: สามขั้นตอน', // review
      iosStep1: 'แตะปุ่มแชร์ที่ด้านล่างของหน้าจอ', // review
      iosStep2: 'เลือก "เพิ่มไปยังหน้าจอโฮม"', // review
      iosStep3: 'แตะ "เพิ่ม" ที่มุมจอ', // review
      done: 'เข้าใจแล้ว', // review
    },
    share: {
      title: 'แชร์ไปที่ RestoMatch', // review
      loading: 'กำลังเปิดสิ่งที่คุณแชร์…', // review
      toOrder: 'กำลังเปิดเป็นการรับคำสั่งซื้อ…', // review
      filesTitle: '{count, plural, other {เก็บ # ไฟล์ไว้บนโทรศัพท์เครื่องนี้}}', // review
      filesBody: 'ไฟล์จะอยู่บนโทรศัพท์เครื่องนี้ได้ถึง 24 ชั่วโมง เปิดรายการของเข้าแล้วแนบกับใบแจ้งหนี้', // review
      filesOther: 'ไฟล์จะอยู่บนโทรศัพท์เครื่องนี้ได้ถึง 24 ชั่วโมง ส่งต่อให้ผู้จัดการหรือเจ้าของเพื่อแนบ', // review
      toReceiving: 'ไปที่รับของ', // review
      discard: 'ลบการแชร์', // review
      discarded: 'ลบการแชร์ออกจากโทรศัพท์แล้ว', // review
      skipped: '{count, plural, other {ไม่ได้เก็บ # ไฟล์ (เฉพาะรูปหรือ PDF ไม่เกิน 20MB)}}', // review
      filesLost: 'ไฟล์ไม่มาถึง แชร์อีกครั้งจากแอปที่ติดตั้ง', // review
      textTitle: 'ข้อความที่คุณแชร์', // review
      textBody: 'การรับคำสั่งซื้อไม่ได้เปิดที่นี่ คัดลอกข้อความแล้วส่งต่อได้', // review
      copy: 'คัดลอก', // review
      copied: 'คัดลอกข้อความแล้ว', // review
      emptyTitle: 'ไม่มีเนื้อหามาถึง', // review
      emptyBody: 'การแชร์หมดอายุหรือเปิดไปแล้ว แชร์อีกครั้ง', // review
      home: 'ไปหน้าหลัก', // review
    },
  },
};
