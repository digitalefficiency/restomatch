/** "12.50" / "12,50" → 1250 agorot (parse at the boundary; null when invalid). */
export function parseIlsInput(raw: string): number | null {
  const s = raw.trim().replace(/[₪\s]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const agorot = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return agorot > 0 && Number.isSafeInteger(agorot) ? agorot : null;
}
