/** One locale's copy for the AU-04 briefs. Plain strings and functions; no ₪ formatting here. */
export interface BriefCopy {
  receiverMorning: {
    subject: (count: number) => string;
    heading: string;
    /** "תנובה ~08:00 (12 שורות)" — `time` null = no expected time. */
    delivery: (supplier: string, time: string | null, lines: number) => string;
    lead: (count: number) => string;
    cta: string;
  };
  evening: {
    subject: (lines: number) => string;
    heading: string;
    awaiting: (count: number, ils: string, oldestDays: number) => string;
    dueSoonHeld: (count: number) => string;
    openReceiptsToday: (count: number) => string;
    noReplyClaims: (count: number, ils: string) => string;
    intake: (count: number, oldestHours: number) => string;
    open: string;
  };
  lateTruck: {
    /** The supplier draft (dd.MM). Partner wording: a question, never a demand. Hebrew always. */
    supplierText: (supplier: string, poRef: string, plannedDate: string, restaurant: string) => string;
    supplierSubject: (poRef: string) => string;
  };
  matchAlert: {
    subject: (count: number, supplier: string) => string;
    line: (count: number, invoiceRef: string, supplier: string) => string;
    ils: (ils: string) => string;
    cta: string;
  };
}
