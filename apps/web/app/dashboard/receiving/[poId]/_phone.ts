/**
 * The phone flow's own control shape (SPEC §4–§5): every control of the
 * delivery check takes the 12 px "card" radius, and its primary buttons are
 * 60 px high. Added to the shared Button (`size="xl"`), whose radius and
 * minimum height these replace (cnMerge knows both roles).
 */
export const PHONE_CTA = 'min-h-[60px] rounded-card';
