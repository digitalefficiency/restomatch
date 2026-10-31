/**
 * Minimal bidi reordering for the PDF renderer (pdf-lib draws glyphs strictly
 * left-to-right and has no Unicode Bidirectional Algorithm).
 *
 * Covers what a report line contains — Hebrew words, Latin words, numbers with
 * separators, ₪ and % — with the UBA's essentials: strong types (R = Hebrew,
 * L = Latin letters and digits), number runs kept together, neutrals resolved
 * from their neighbours (same direction on both sides → that direction, else
 * the paragraph direction), implicit levels (R → odd, L → even) and rule L2
 * reversal, plus bracket mirroring on RTL runs. Hebrew needs no shaping, so a
 * visual-order string is all the PDF needs. RLM/LRM marks are dropped.
 */
export type Dir = 'rtl' | 'ltr';

const isHebrew = (ch: string) => /[֐-׿]/.test(ch);
const isLatinOrDigit = (ch: string) => /[A-Za-z0-9À-ÿ]/.test(ch);
/** Inside a number/word: "1,234.56", "12%", "INV-12", "a/b". */
const isJoiner = (ch: string) => /[.,:/%\-+'_@]/.test(ch);
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };

type T = 'R' | 'L' | 'EN' | 'N';
const isDigit = (ch: string) => /[0-9]/.test(ch);

export function visualOrder(text: string, dir: Dir): string {
  const chars = [...text.replace(/[‎‏‪-‮⁦-⁩]/g, '')];
  if (!chars.some(isHebrew)) return chars.join('');
  const types: T[] = chars.map((ch) => (isHebrew(ch) ? 'R' : isLatinOrDigit(ch) ? 'L' : 'N'));
  // A joiner between two L chars (or a trailing % after a digit) belongs to the L run.
  for (let i = 0; i < chars.length; i++) {
    if (types[i] !== 'N' || !isJoiner(chars[i]!)) continue;
    const prevL = types[i - 1] === 'L';
    const nextL = types[i + 1] === 'L';
    if ((prevL && nextL) || (prevL && chars[i] === '%')) types[i] = 'L';
  }
  // RTL paragraphs: a number run (digits + joiners, no Latin letter) is a weak
  // European number. UBA W7: it becomes L only after a Latin letter; N1: for
  // neutral resolution it counts as R — so in "ספק 1,234 ₪ · 1.6%" the amount
  // and the percent keep their reading order.
  if (dir === 'rtl') {
    let i = 0;
    while (i < chars.length) {
      if (types[i] !== 'L') { i++; continue; }
      let j = i;
      while (j < chars.length && types[j] === 'L') j++;
      const run = chars.slice(i, j);
      if (run.some(isDigit) && !run.some((ch) => /[A-Za-z\u00C0-\u00FF]/.test(ch))) {
        let k = i - 1;
        while (k >= 0 && types[k] !== 'R' && types[k] !== 'L') k--;
        if (k < 0 || types[k] === 'R') for (let m = i; m < j; m++) types[m] = 'EN';
      }
      i = j;
    }
  }
  // Resolve neutrals (EN counts as R).
  const strong = (t: T): T => (t === 'EN' ? 'R' : t);
  const base: T = dir === 'rtl' ? 'R' : 'L';
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'N') continue;
    let j = i;
    while (j < types.length && types[j] === 'N') j++;
    const before = i === 0 ? base : strong(types[i - 1]!);
    const after = j === types.length ? base : strong(types[j]!);
    const t: T = before === after ? before : base;
    for (let k = i; k < j; k++) types[k] = t;
    i = j - 1;
  }
  // Levels: RTL paragraph → R=1, L/EN=2; LTR paragraph → L=0, R=1.
  const levels = types.map((t) => (dir === 'rtl' ? (t === 'R' ? 1 : 2) : t === 'R' ? 1 : 0));
  const out = chars.map((ch, i) => (levels[i]! % 2 === 1 && MIRROR[ch] ? MIRROR[ch]! : ch));
  const max = Math.max(...levels);
  const minOdd = 1;
  for (let lvl = max; lvl >= minOdd; lvl--) {
    for (let i = 0; i < out.length; i++) {
      if (levels[i]! < lvl) continue;
      let j = i;
      while (j < out.length && levels[j]! >= lvl) j++;
      const seg = out.slice(i, j).reverse();
      const segLv = levels.slice(i, j).reverse();
      out.splice(i, j - i, ...seg);
      levels.splice(i, j - i, ...segLv);
      i = j - 1;
    }
  }
  return out.join('');
}
