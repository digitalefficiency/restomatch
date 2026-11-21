/**
 * The phone flow's own control shape (SPEC §4–§5): every control of the
 * delivery check takes the 12 px "card" radius, and its primary buttons are
 * 60 px high. Added to the shared Button (`size="xl"`), whose radius and
 * minimum height these replace (cnMerge knows both roles).
 *
 * Its digits are tabular (DS3-07): a label that changes in place, as the
 * quantity sheet's "save 12.5 kg" while the pad types or "mark the rest (8)"
 * as lines are ticked, keeps its width in any face.
 */
export const PHONE_CTA = 'min-h-[60px] rounded-card tabular-nums';
