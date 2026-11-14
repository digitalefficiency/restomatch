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

/**
 * The film's own breakdown INSIDE the sample month (the site shows only the totals above). Every
 * figure here reconciles to SAMPLE, and scripts/check-sample.mjs asserts it — no free literals on
 * a product screen.
 */
export const FILM = {
  // the decide example: (572.40 − 520.00) × 2 kegs = 104.80 = SAMPLE.decide.example.amount
  keg: { usual: 520, latest: 572.4, qty: 2 },
  // the other price rises on the "מחירים שעלו" screen (usual → latest, per unit)
  rises: [
    { usual: 139, latest: 149 }, // entrecôte · HaKerem Butchery
    { usual: 89, latest: 96 }, // salmon fillet · Mediterranean Fish Co.
  ],
  // the three credit requests to send — Σ = SAMPLE.credit.amount
  credits: [300, 240, 180],
  // the receiver beat: quantities only, never ₪ (ordered → received on the door)
  delivery: { ordered: 15, received: 12 },
};

/** Price rise in % with one decimal, as the leak screen shows it ("+10.1%"). */
export const risePct = (usual: number, latest: number) => `+${(((latest - usual) / usual) * 100).toFixed(1)}%`;
/** The keg example's gap in agorot-exact shekels. */
export const kegGap = () => Math.round((FILM.keg.latest - FILM.keg.usual) * FILM.keg.qty * 100) / 100;
