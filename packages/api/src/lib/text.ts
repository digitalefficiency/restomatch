/** C0 control characters + DEL (CR, LF, tab included). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Refinement for a display name that also lands in email headers (the supplier
 * order subject carries the restaurant name): no control characters, so a name
 * can never inject a header line.
 */
export function hasNoControlChars(s: string): boolean {
  return !CONTROL_CHARS.test(s);
}
export const NO_CONTROL_CHARS_MESSAGE = 'השם לא יכול לכלול תווי בקרה (שורה חדשה, טאב)';
