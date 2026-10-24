/**
 * Minimal bidi for a Hebrew (RTL-base) line drawn by a PDF library that only
 * places glyphs left to right: returns the string in VISUAL order.
 *
 * Classes: R = Hebrew letters/marks; L = Latin letters, digits and "₪"
 * (numbers and amounts read left to right); N = everything else. Neutrals
 * between two L characters join the L run ("12.95 ₪", "SH-1001"); every other
 * neutral takes the RTL base direction. Visual order = runs reversed, R runs
 * reversed character by character (with brackets mirrored), L runs kept.
 * Enough for supplier names, item descriptions, SKUs, quantities and ₪.
 */
type Cls = 'R' | 'L' | 'N';

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };

function cls(ch: string): Cls {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x0590 && c <= 0x05ff) || (c >= 0xfb1d && c <= 0xfb4f)) return 'R';
  if (/[A-Za-z0-9À-ɏ₪]/.test(ch)) return 'L';
  return 'N';
}

export function visualRtl(text: string): string {
  const chars = Array.from(text);
  const classes = chars.map(cls);
  // Resolve neutrals: L only when both nearest strong neighbours are L.
  const resolved: Array<'R' | 'L'> = classes.map((c, i) => {
    if (c !== 'N') return c;
    let prev: Cls = 'R';
    for (let j = i - 1; j >= 0; j--) if (classes[j] !== 'N') { prev = classes[j]!; break; }
    let next: Cls = 'R';
    for (let j = i + 1; j < classes.length; j++) if (classes[j] !== 'N') { next = classes[j]!; break; }
    return prev === 'L' && next === 'L' ? 'L' : 'R';
  });
  const runs: Array<{ dir: 'R' | 'L'; text: string[] }> = [];
  chars.forEach((ch, i) => {
    const dir = resolved[i]!;
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.text.push(ch);
    else runs.push({ dir, text: [ch] });
  });
  return runs
    .reverse()
    .map((r) => (r.dir === 'R' ? r.text.reverse().map((ch) => MIRROR[ch] ?? ch).join('') : r.text.join('')))
    .join('');
}
