/**
 * AU-14 Hebrew copy (server side). Partner wording toward suppliers (GLOSSARY §1–§2,
 * owner 7.11): בקשת זיכוי. Never דרישה / תביעה / מחלוקת / חוב / באיחור.
 * `{x}` placeholders are filled by `renderReason` / `remittanceText`.
 */
export const he = {
  'preflight.title': 'בדיקה לפני תשלום',
  'preflight.reason.possible_duplicate': 'ייתכן כפל: דומה ל-{otherNumber} מ-{otherDate} ({otherTotal}, {otherSource})',
  'preflight.reason.confirmed_copy': 'עותק של חשבונית ששולמה/תשולם · לא לשלם',
  'preflight.reason.first_payment': 'תשלום ראשון לספק · ודאו פרטי בנק',
  'preflight.reason.bank_changed':
    'פרטי הבנק של {supplierName} השתנו ב-{changedOn} (חשבון ‎…{accountLast4}) · אמתו בטלפון מול הספק לפני תשלום',
  'preflight.reason.unusual_amount': 'סכום חריג: פי {ratio} מהרגיל לספק (חציון {median})',
  'preflight.ack.possible_duplicate': 'בדקתי: ייתכן כפל עם {otherNumber}',
  'preflight.ack.unusual_amount': 'בדקתי: הסכום החריג נכון',
  'preflight.ack.first_payment': 'בדקתי: פרטי הבנק של ספק חדש',
  'preflight.release.confirm': 'אישרתי מול הספק בטלפון שמספרו בכרטיס הספק (לא מהחשבונית או מהמייל)',
  'preflight.source.photo': 'צולמה',
  'preflight.source.email': 'נשלחה במייל',
  'preflight.source.platform': 'הגיעה מהמערכת',
  'preflight.source.manual': 'הוזנה ידנית',
  'preflight.source.whatsapp': 'נשלחה בוואטסאפ',
  'remit.greeting': 'שלום {supplierName},',
  'remit.paidIntro': 'ביום {paidOn} שילמנו את החשבוניות האלה:',
  'remit.paidLine': '• חשבונית {invoiceNumber} · {amount}',
  'remit.offset': 'קוזז: {amount} · בקשת זיכוי {claimNo} · {reason}',
  'remit.inReview': 'חשבונית {invoiceNumber} בבדיקה · נעדכן',
  'remit.net': 'סה״כ הועבר: {amount}',
  'remit.thanks': 'תודה,',
  'remit.noNumber': 'ללא מספר',
} as const;

export type CopyKey = keyof typeof he;
