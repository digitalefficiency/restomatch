import { describe, expect, it } from 'vitest';
import { ordersAutopilotEn, ordersAutopilotHe } from '../orders/messages';

/**
 * W3-09 / AU-11 · every autopilot notice is ₪-free and uses partner wording
 * (GLOSSARY §1–2). Renders every entry with sample arguments and scans it.
 */
function render(bundle: Record<string, unknown>): string[] {
  return Object.entries(bundle).map(([, v]) =>
    typeof v === 'function' ? (v as (...a: unknown[]) => string)('תנובה', 9, '14:00') : String(v),
  );
}

const he = render(ordersAutopilotHe);
const en = render(ordersAutopilotEn);

describe('order autopilot notices', () => {
  it('carry no ₪ and no 2-decimal amount', () => {
    for (const s of [...he, ...en]) {
      expect(s).not.toMatch(/₪|ILS|NIS/);
      expect(s).not.toMatch(/\d+\.\d{2}(?!\d)/);
    }
  });

  it('Hebrew uses partner wording only', () => {
    const banned = [/דריש|דרוש|נדרש/, /תביע|לתבוע|נתבע/, /מחלוק/, /(^|[^א-ת])חוב(?![א-ת])/, /איחור/, /דליפ|דלף/, /חריג/, /עליכם|לאלתר|יש להעביר/, /מכתבי? זיכוי/];
    for (const s of he) for (const re of banned) expect(s, s).not.toMatch(re);
    expect(ordersAutopilotHe.backorderBilledInFull('עגבניות')).toContain('בקשת זיכוי');
  });

  it('English uses partner wording only', () => {
    const banned = [/\bclaim/i, /\bdisput/i, /\bowe[sd]?\b/i, /\boverdue/i, /\bleak/i, /\bdemand/i];
    for (const s of en) for (const re of banned) expect(s, s).not.toMatch(re);
  });

  it('he and en have the same keys', () => {
    expect(Object.keys(ordersAutopilotEn).sort()).toEqual(Object.keys(ordersAutopilotHe).sort());
  });

  it('the prepared title names supplier, count and cut-off', () => {
    expect(ordersAutopilotHe.preparedTitle('תנובה', 9, '14:00')).toBe('טיוטה מוכנה לתנובה · 9 פריטים · השליחה עד 14:00');
    expect(ordersAutopilotHe.preparedTitle('תנובה', 9, null)).toBe('טיוטה מוכנה לתנובה · 9 פריטים');
  });
});
