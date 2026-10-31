/**
 * Builds a pilot-setup config from the intake spreadsheets (CSV exports), so
 * nobody hand-edits JSON (docs/PILOT-SETUP.md, step 0).
 *
 *   pnpm --filter @restomatch/db pilot:config -- --from-csv ~/restomatch-pilot/tziki --out ~/restomatch-pilot/tziki.json
 *
 * Inputs (UTF-8, a BOM is fine, extra columns are ignored):
 *   restaurant.csv  one row: שם, ח״פ, כתובת
 *   staff.csv       שם מלא, תפקיד (בעלים|מנהל|מקבל סחורה|שף|הנהלת חשבונות), מייל, נייד, שפה (he|en|ar|ru|ti|th)
 *   suppliers.csv   שם הספק, ח״פ, איש קשר, נייד, מייל להזמנות, ימי הזמנה ("א,ג,ה"), שעת סגירה (HH:MM),
 *                   ימי אספקה, מע״מ (18%|0%), חשבונית מרכזת (כן|לא)
 *
 * Every unknown value is an error naming the file, row and column. The result
 * is validated exactly like a hand-written config and then goes through the
 * normal pilot:setup dry-run. Logs names and roles only, never row contents.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PilotError, validateConfig, type PilotConfig, type PilotFeatureKey, type PilotOrderSchedule, type PilotRole } from './pilot-setup';

/** The pilot flag set (brief item 11): the same for the QA tenant and the first customers. */
export const PILOT_FEATURES: PilotFeatureKey[] = [
  'contracts',
  'recovery',
  'orderCapture',
  'dockSlip',
  'receiverPwa',
  'leakProof',
  'supplierLeakCard',
  'supplierLedger',
  'monthlyReport',
  'monthlyDigestPreview',
];

/** RFC 4180 CSV: quotes, doubled quotes, CRLF/LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** Header match ignoring spaces and the ״ / " / ׳ / ' marks people type differently. */
const headerKey = (h: string) => h.normalize('NFC').replace(/[\s"'״׳]/g, '').toLowerCase();

interface Table {
  file: string;
  rows: Array<{ line: number; get: (col: string) => string }>;
}

function readTable(dir: string, file: string, required: string[]): Table {
  let text: string;
  try {
    text = readFileSync(join(dir, file), 'utf8');
  } catch {
    throw new PilotError([`${file}: file not found in ${dir}`]);
  }
  const [header, ...body] = parseCsv(text);
  if (!header) throw new PilotError([`${file}: empty file`]);
  const index = new Map(header.map((h, i) => [headerKey(h), i] as const));
  const missing = required.filter((c) => !index.has(headerKey(c)));
  if (missing.length) throw new PilotError(missing.map((c) => `${file}: missing column "${c}"`));
  return {
    file,
    rows: body.map((cells, i) => ({ line: i + 2, get: (col: string) => (cells[index.get(headerKey(col))!] ?? '').trim() })),
  };
}

const ROLES: Record<string, PilotRole> = { בעלים: 'owner', מנהל: 'manager', 'מקבל סחורה': 'receiver', שף: 'chef', 'הנהלת חשבונות': 'bookkeeper' };
const DAYS: Record<string, number> = {
  א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6,
  ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6,
};

/** "א,ג,ה" / "א׳, ג׳" / "ראשון,שלישי" → sorted weekday numbers (0 = Sunday). */
export function parseWeekdays(v: string): number[] | null {
  const parts = v.split(/[,،\s/]+/).map((x) => x.replace(/[׳'"״.]/g, '').trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const p of parts) {
    const d = DAYS[p];
    if (d === undefined) return null;
    if (!out.includes(d)) out.push(d);
  }
  return out.sort((a, b) => a - b);
}

/** One window per order day: delivered on the next listed delivery day strictly after it. */
export function orderScheduleFrom(orderDays: number[], cutoff: string, deliveryDays: number[]): PilotOrderSchedule {
  return {
    windows: orderDays.map((d) => {
      const gaps = deliveryDays.map((k) => ((k - d + 7) % 7) || 7);
      const gap = Math.min(...gaps);
      const fulfillment =
        gap === 7 ? ({ kind: 'lead_days', leadDays: 7 } as const) : ({ kind: 'next_named_day', deliversOnDay: (d + gap) % 7 } as const);
      return { orderDays: [d], cutoff, fulfillment };
    }),
  };
}

/** Reads the three CSVs in `dir` and returns a validated config (throws PilotError listing every problem). */
export function configFromCsv(dir: string): PilotConfig {
  const problems: string[] = [];
  const bad = (t: Table, line: number, col: string, why: string) => problems.push(`${t.file} row ${line}, column "${col}": ${why}`);

  const rest = readTable(dir, 'restaurant.csv', ['שם', 'ח״פ']);
  if (rest.rows.length !== 1) problems.push(`restaurant.csv: expected exactly one row, found ${rest.rows.length}`);
  const r0 = rest.rows[0];

  const staff = readTable(dir, 'staff.csv', ['שם מלא', 'תפקיד', 'מייל']);
  const members = staff.rows.map((row) => {
    const role = ROLES[row.get('תפקיד')];
    if (!role) bad(staff, row.line, 'תפקיד', `unknown role "${row.get('תפקיד')}" (בעלים|מנהל|מקבל סחורה|שף|הנהלת חשבונות)`);
    const email = row.get('מייל');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(staff, row.line, 'מייל', 'not an email address');
    const locale = row.get('שפה') || undefined;
    if (locale && !['he', 'en', 'ar', 'ru', 'ti', 'th'].includes(locale)) bad(staff, row.line, 'שפה', `unknown language "${locale}" (he|en|ar|ru|ti|th)`);
    return {
      email,
      name: row.get('שם מלא') || undefined,
      role: role ?? ('owner' as PilotRole),
      phone: row.get('נייד') || undefined,
      locale: locale as PilotConfig['members'][number]['locale'],
    };
  });

  const sup = readTable(dir, 'suppliers.csv', ['שם הספק', 'ימי הזמנה', 'שעת סגירה', 'ימי אספקה', 'מע״מ']);
  const suppliers = sup.rows.map((row) => {
    const vatRaw = row.get('מע״מ').replace(/\s/g, '');
    const vatRate = vatRaw === '18%' ? 0.18 : vatRaw === '0%' ? 0 : NaN;
    if (Number.isNaN(vatRate)) bad(sup, row.line, 'מע״מ', `unknown VAT "${row.get('מע״מ')}" (18%|0%)`);
    const orderDays = parseWeekdays(row.get('ימי הזמנה'));
    if (!orderDays) bad(sup, row.line, 'ימי הזמנה', `unknown weekday in "${row.get('ימי הזמנה')}" (e.g. "א,ג,ה")`);
    const deliveryDays = parseWeekdays(row.get('ימי אספקה'));
    if (!deliveryDays) bad(sup, row.line, 'ימי אספקה', `unknown weekday in "${row.get('ימי אספקה')}" (e.g. "ב,ד,ו")`);
    const cutoff = row.get('שעת סגירה');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) bad(sup, row.line, 'שעת סגירה', `"${cutoff}" is not HH:MM`);
    const consolidatedRaw = row.get('חשבונית מרכזת');
    const consolidated = consolidatedRaw === 'כן' ? true : consolidatedRaw === 'לא' || consolidatedRaw === '' ? false : null;
    if (consolidated === null) bad(sup, row.line, 'חשבונית מרכזת', `"${consolidatedRaw}" must be כן or לא`);
    return {
      name: row.get('שם הספק'),
      businessId: row.get('ח״פ') || undefined,
      contactName: row.get('איש קשר') || undefined,
      contactWhatsapp: row.get('נייד') || undefined,
      contactEmail: row.get('מייל להזמנות') || undefined,
      vatRate,
      orderSchedule: orderDays && deliveryDays && /^\d\d:\d\d$/.test(cutoff) ? orderScheduleFrom(orderDays, cutoff, deliveryDays) : undefined,
      consolidatedInvoice: consolidated ?? false,
    };
  });
  if (problems.length) throw new PilotError(problems);

  const cfg = {
    restaurant: {
      name: r0!.get('שם'),
      businessId: r0!.get('ח״פ'),
      vatRate: 0.18,
      timezone: 'Asia/Jerusalem',
      address: r0!.get('כתובת') || undefined,
    },
    features: Object.fromEntries(PILOT_FEATURES.map((f) => [f, true])),
    members,
    suppliers,
    products: [],
  };
  return validateConfig(JSON.parse(JSON.stringify(cfg)));
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]) {
  const dir = arg(argv, 'from-csv');
  const out = arg(argv, 'out');
  if (!dir || !out) throw new PilotError(['usage: pilot:config -- --from-csv <dir> --out <file.json>']);
  const home = (p: string) => resolve(process.cwd(), p.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
  const cfg = configFromCsv(home(dir));
  writeFileSync(home(out), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  console.log(`[pilot:config] ${cfg.restaurant.name}: ${cfg.members.length} members (${cfg.members.map((m) => `${m.name ?? '—'} · ${m.role}`).join(', ')}), ${cfg.suppliers.length} suppliers (${cfg.suppliers.map((s) => s.name).join(', ')})`);
  console.log(`[pilot:config] wrote ${home(out)} — next: PILOT_CONFIG=${home(out)} pnpm --filter @restomatch/db pilot:setup -- --expect-project <ref>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
    process.exit(0);
  } catch (err) {
    if (err instanceof PilotError) {
      for (const p of err.problems) console.error(`[pilot:config] ✘ ${p}`);
      process.exit(2);
    }
    console.error('[pilot:config] failed', err);
    process.exit(1);
  }
}
