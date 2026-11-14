/**
 * The public site's ONE sample month (apps/web/app/(marketing)/_components/sampleMonth.ts on
 * claude/ux-w3-06-marketing): every landing asset shows these, never the demo seed above.
 * Shekels, ex-VAT. An illustration, labelled "דוגמה" — not a promise or a target.
 */
export const SAMPLE = {
  purchasing: 150_000,
  leakPct: 1.5,
  leak: 2_250, // 150,000 × 1.5%
  unpaid: 1_530, // "נתפסו לפני תשלום"
  paid: 720,
  checked: 35,
  withGap: 13,
  decide: { amount: 910, count: 2, example: { he: 'בירה מהחבית', en: 'Draft beer keg', amount: 104.8 } }, // T2 "ממתין להחלטה שלך" (inside the unpaid part)
  credit: { amount: 720, count: 3 }, // T2 credit requests to send (the paid part)
  goodNews: 620, // unpaid − undecided
};
