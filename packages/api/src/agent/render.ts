/**
 * The WhatsApp agent's Hebrew renderer (WA-02). Every ₪ in an outbound
 * message is made here, never by the model:
 *  - `money()` takes shekels as the DB/engine returns them (NUMERIC strings or
 *    numbers), parses to INTEGER AGOROT at this boundary (half-up at the
 *    agora) and formats with the server ₪ twin `formatIlsAgorot`
 *    (reports/money.ts, pinned to the web's formatIls()). Interim for G-13
 *    `moneyText` (#187): same bytes, wrapped in FSI…PDI so a ₪ amount never
 *    reorders inside right-to-left text. When G-13 lands, `money()` delegates.
 *  - No number formatter of its own in agent/** (a test greps for one).
 *  - A message is ≤ 1,024 characters (cut at a line boundary).
 */
import { sanitizeAnswer } from '../ask/grounding';
import { formatIlsAgorot, formatPct } from '../reports/money';
import { HE } from './copy/he';

export const MAX_MESSAGE_CHARS = 1024;
const FSI = '⁨';
const PDI = '⁩';

/** Bidi-isolate a run (a number, a name, a money string) inside Hebrew text. */
export function isolate(s: string): string {
  return `${FSI}${s}${PDI}`;
}

/** Shekels (NUMERIC string or number) → integer agorot, half-up; null when not a number. */
export function toAgorot(ils: unknown): number | null {
  const n = typeof ils === 'number' ? ils : typeof ils === 'string' && ils.trim() !== '' ? Number(ils) : NaN;
  if (!Number.isFinite(n)) return null;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 + 1e-9);
}

/** The one ₪ string of the agent: whole shekels, he-IL, isolated. */
export function money(ils: unknown): string {
  const ag = toAgorot(ils);
  return isolate(formatIlsAgorot(ag ?? 0, { locale: 'he' }));
}

/** ₪ from integer agorot. */
export function moneyAgorot(agorot: number): string {
  return isolate(formatIlsAgorot(Math.round(agorot), { locale: 'he' }));
}

/** A ratio (0.016) as "1.6%". */
export function pct(ratio: number | null | undefined): string {
  return isolate(formatPct(ratio ?? null, 'he'));
}

/** A count: integers with thousands separators (he-IL digits are Western). */
export function count(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return isolate(v < 0 ? `-${s}` : s);
}

/** A quantity (NUMERIC string or number), up to 3 decimals, trailing zeros out. */
export function qty(n: unknown): string {
  const v = typeof n === 'number' ? n : typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN;
  if (!Number.isFinite(v)) return isolate('—');
  return isolate(String(Math.round(v * 1000) / 1000));
}

/**
 * A name from tool data (already clipped by redaction), isolated. Supplier and
 * product names are untrusted (OCR'd paper): links, phones and e-mails are
 * stripped with Ask's sanitiser before they enter an outbound message.
 */
export function name(s: unknown, fallback = '—'): string {
  const clean = typeof s === 'string' ? sanitizeAnswer(s).text.trim() : '';
  return isolate(clean || fallback);
}

/** "לפי הנתונים: …" from the tools' server-built fact lines. */
export function factsText(lines: readonly string[]): string {
  const body = lines.filter(Boolean);
  if (body.length === 0) return HE.noData;
  return [HE.factsPrefix, ...body.map((l) => `• ${l}`)].join('\n');
}

/**
 * The final message: body, then the server's links (appended after grounding).
 * Cut to MAX_MESSAGE_CHARS at a line boundary; links are kept whole.
 */
export function composeMessage(body: string, links: readonly string[] = []): string {
  const tail = links.length ? `\n\n${HE.linkLabel}\n${links.join('\n')}` : '';
  const room = MAX_MESSAGE_CHARS - tail.length;
  let text = body.trim();
  if (text.length > room) {
    const lines = text.split('\n');
    const kept: string[] = [];
    let len = 0;
    for (const l of lines) {
      if (len + l.length + 2 > room) break;
      kept.push(l);
      len += l.length + 1;
    }
    text = kept.length ? `${kept.join('\n')}\n…` : `${text.slice(0, Math.max(0, room - 1))}…`;
  }
  return `${text}${tail}`;
}
