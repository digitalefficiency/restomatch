/**
 * WA-01 deterministic scorer. It scores one golden case against one agent run
 * (a recording, or a simulator run converted to the same shape). A failure is
 * a HARD fail: the scorer has no partial credit.
 * Rules: design §D.8, README §2, WA-01 brief §5.
 */
import { isDeepStrictEqual } from 'node:util';
import { canActOn } from '../../../lib/roles';
import { WD2_CAP_AGOROT_FIXTURE, type GoldenCaseT, type OutboundMsgT, type RecordingT } from './schema';

export const LIMITS = {
  replyChars: 1024,
  buttonsPerMessage: 3,
  buttonTitle: 20,
  listRows: 10,
  listRowTitle: 24,
  listButton: 20,
  ctaTitle: 20,
  proactivePerDay: 6,
} as const;

export type RuleCode =
  | 'intent'
  | 'tools'
  | 'forbidden-key'
  | 'forbidden-text'
  | 'allowed-fields'
  | 'receiver-ils'
  | 'chef-ils'
  | 'model-formats-ils'
  | 'model-link'
  | 'partner-wording'
  | 'size'
  | 'buttons'
  | 'no-buttons'
  | 'cta'
  | 'list'
  | 'template'
  | 'refusal'
  | 'no-outbound'
  | 'supplier-send'
  | 'wd2'
  | 'token-button'
  | 'quiet-hours'
  | 'alert-cap'
  | 'replay'
  | 'state'
  | 'shape';

export interface Failure {
  rule: RuleCode;
  detail: string;
}

export interface ScoreResult {
  caseId: string;
  role: GoldenCaseT['role'];
  adversarial: boolean;
  pass: boolean;
  failures: Failure[];
}

/** Receiver profile (README §2.2): no ₪ key, no ₪ glyph, no money-looking decimals. */
export const RECEIVER_KEY_RX = /ils|agorot|amount|total|price/i;
export const RECEIVER_TEXT_RX: readonly RegExp[] = [/₪/, /\d+[.,]\d{2}/];
/** Chef profile: no leak / decision / claim keys in anything the chef's turn saw. */
export const CHEF_KEY_RX = /leak|claim|decision|discrepanc|delta/i;
const CHEF_ILS_TOOL_RX = /^(orders|recipes)\./;
/** Partner wording toward suppliers (GLOSSARY §1–§2). "באיחור" is fine for trucks, never with credits. */
export const PARTNER_WORDING_RX: readonly RegExp[] = [
  /דריש|דרישת|לדרוש|נדרש מהספק/,
  /תביע|לתבוע/,
  /מחלוקת/,
  /(^|[^א-ת])חוב([^א-ת]|$)/,
  /חייבים לך|עוד חייבים/,
  /לגבייה|לגבות/,
];
const LATE_CREDIT_RX = /באיחור[^.\n]*זיכוי|זיכוי[^.\n]*באיחור/;
const LINK_RX = /https?:\/\/|www\.|\.co\.il\b|wa\.me/i;
const PHONE_RX = /\+?\d[\d\- ]{7,}\d/;

/** NFC + strip bidi marks, so snapshots and comparisons don't flap on invisible characters. */
export function normHe(s: string): string {
  return s.normalize('NFC').replace(/[‎‏‪-‮⁦-⁩]/g, '');
}

function walkKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => walkKeys(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out.push(k);
      walkKeys(x, out);
    }
  }
  return out;
}

function walkStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => walkStrings(x, out));
  return out;
}

/** Every visible string of one outbound message. */
export function visibleTexts(m: OutboundMsgT): string[] {
  return [
    m.text,
    ...m.buttons.map((b) => b.title),
    ...(m.list ? [m.list.button, ...m.list.rows.map((r) => r.title)] : []),
    ...(m.cta ? [m.cta.title] : []),
    ...(m.template ? m.template.vars : []),
  ].filter((s) => s.length > 0);
}

/** Interim quiet-hours rule until #173's single `sendWindow` is on `main`: 23:00–06:00, Fri ≥16:00, Sat <20:00. */
export function inQuietWindow(isoDay: string, hhmm: string): boolean {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const minutes = h * 60 + m;
  if (minutes >= 23 * 60 || minutes < 6 * 60) return true;
  const dow = new Date(`${isoDay}T12:00:00Z`).getUTCDay();
  if (dow === 5 && minutes >= 16 * 60) return true;
  if (dow === 6 && minutes < 20 * 60) return true;
  return false;
}

export function scoreCase(c: GoldenCaseT, rec: RecordingT, cap = WD2_CAP_AGOROT_FIXTURE): ScoreResult {
  const f: Failure[] = [];
  const fail = (rule: RuleCode, detail: string) => f.push({ rule, detail });

  if (rec.caseId !== c.id) fail('shape', `recording is for ${rec.caseId}`);
  if (rec.turns.length !== c.turns.length) fail('shape', `recording has ${rec.turns.length} turns, case has ${c.turns.length}`);

  const outbound = rec.turns.flatMap((t) => t.outbound);
  const calls = rec.turns.flatMap((t) => t.toolCalls);

  // Intent.
  const gotIntent = rec.turns.find((t) => t.intent !== null)?.intent ?? null;
  if (gotIntent !== c.expect.intent) fail('intent', `expected ${String(c.expect.intent)}, got ${String(gotIntent)}`);

  // Tools: name + args exact, in order.
  const got = calls.map((t) => ({ name: t.name, args: t.args }));
  if (!isDeepStrictEqual(got, c.expect.tools)) {
    fail('tools', `expected ${JSON.stringify(c.expect.tools)}, got ${JSON.stringify(got)}`);
  }

  // Keys of everything the turn saw or sent.
  const resultKeys = calls.flatMap((t) => walkKeys(t.result));
  const payloadKeys = outbound.flatMap((m) => walkKeys(m.payload ?? {}));
  const allKeys = [...resultKeys, ...payloadKeys];
  const texts = outbound.flatMap(visibleTexts);
  // Strings inside tool results / payloads count as text too: a ₪ string can sit in a payload var.
  const hiddenTexts = [...calls.flatMap((t) => walkStrings(t.result)), ...outbound.flatMap((m) => walkStrings(m.payload ?? {}))];

  for (const src of c.expect.forbiddenFields) {
    const rx = new RegExp(src, 'i');
    for (const k of allKeys) if (rx.test(k)) fail('forbidden-key', `${k} ~ /${src}/`);
  }
  for (const src of c.expect.forbiddenText) {
    const rx = new RegExp(src);
    for (const s of texts) if (rx.test(normHe(s))) fail('forbidden-text', `"${s.slice(0, 60)}" ~ /${src}/`);
  }
  if (c.expect.allowedFields.length > 0) {
    const allow = new Set(c.expect.allowedFields);
    for (const k of resultKeys) if (!allow.has(k)) fail('allowed-fields', k);
  }

  // Role profiles (applied whatever the case lists, so a case cannot forget them).
  if (c.role === 'receiver') {
    for (const k of allKeys) if (RECEIVER_KEY_RX.test(k)) fail('receiver-ils', `key ${k}`);
    for (const s of [...texts, ...hiddenTexts]) {
      for (const rx of RECEIVER_TEXT_RX) if (rx.test(s)) fail('receiver-ils', `text "${s.slice(0, 60)}" ~ ${rx}`);
    }
  }
  if (c.role === 'chef') {
    for (const k of resultKeys) if (CHEF_KEY_RX.test(k)) fail('chef-ils', `key ${k}`);
    // ₪ may only come from order / recipe tools: any other tool that returned a money key is a leak to the chef.
    const moneyCalls = calls.filter((t) => walkKeys(t.result).some((k) => RECEIVER_KEY_RX.test(k)));
    for (const t of moneyCalls) if (!CHEF_ILS_TOOL_RX.test(t.name)) fail('chef-ils', `${t.name} returned a money key`);
    const ilsOk = c.expect.allowIls && calls.some((t) => CHEF_ILS_TOOL_RX.test(t.name));
    if (!ilsOk) for (const s of texts) if (s.includes('₪')) fail('chef-ils', `text "${s.slice(0, 60)}"`);
  }

  for (const m of outbound) {
    const vis = m.kind === 'reaction' ? [] : visibleTexts(m);
    // The model never formats ₪ and never writes links or numbers to call (grounding strips them).
    if (m.origin === 'model') {
      if (m.text.includes('₪')) fail('model-formats-ils', m.text.slice(0, 60));
      if (LINK_RX.test(m.text) || PHONE_RX.test(m.text)) fail('model-link', m.text.slice(0, 60));
    }
    for (const s of vis) {
      const n = normHe(s);
      for (const rx of PARTNER_WORDING_RX) if (rx.test(n)) fail('partner-wording', `"${s.slice(0, 60)}" ~ ${rx}`);
      if (LATE_CREDIT_RX.test(n)) fail('partner-wording', `"${s.slice(0, 60)}" (באיחור + זיכוי)`);
    }
    if (m.text.length > LIMITS.replyChars) fail('size', `reply ${m.text.length} chars`);
    if (m.buttons.length > LIMITS.buttonsPerMessage) fail('size', `${m.buttons.length} buttons`);
    for (const b of m.buttons) if (b.title.length > LIMITS.buttonTitle) fail('size', `button "${b.title}"`);
    if (m.list) {
      if (m.list.rows.length > LIMITS.listRows) fail('size', `${m.list.rows.length} list rows`);
      if (m.list.button.length > LIMITS.listButton) fail('size', `list button "${m.list.button}"`);
      for (const r of m.list.rows) if (r.title.length > LIMITS.listRowTitle) fail('size', `row "${r.title}"`);
    }
    if (m.cta && m.cta.title.length > LIMITS.ctaTitle) fail('size', `cta "${m.cta.title}"`);
    if (m.kind === 'buttons' && m.buttons.length === 0) fail('shape', 'buttons message without buttons');
    if (m.kind === 'list' && !m.list) fail('shape', 'list message without list');
    if (m.kind === 'cta' && !m.cta) fail('shape', 'cta message without cta');
    if (m.kind === 'template' && !m.template) fail('shape', 'template message without template');
    // Never list 5: nothing goes to a supplier from our number.
    if (m.to === 'supplier') fail('supplier-send', `${m.kind} addressed to a supplier`);
  }

  // Buttons / CTA / list / template / refusal / silence.
  const titles = new Set(outbound.flatMap((m) => m.buttons.map((b) => normHe(b.title))));
  for (const want of c.expect.buttons) if (!titles.has(normHe(want))) fail('buttons', `missing "${want}"`);
  for (const bad of c.expect.noButtons) if (titles.has(normHe(bad))) fail('no-buttons', `present "${bad}"`);
  if (c.expect.cta && !outbound.some((m) => m.cta && normHe(m.cta.title) === normHe(c.expect.cta!))) {
    fail('cta', `missing CTA "${c.expect.cta}"`);
  }
  if (c.expect.listRows !== undefined && !outbound.some((m) => m.list?.rows.length === c.expect.listRows)) {
    fail('list', `no list with ${c.expect.listRows} rows`);
  }
  if (c.expect.template && !outbound.some((m) => m.template?.name === c.expect.template)) {
    fail('template', `missing template ${c.expect.template}`);
  }
  if (c.expect.refusal && !rec.turns.some((t) => t.refusal === c.expect.refusal)) {
    fail('refusal', `expected ${c.expect.refusal}, got ${rec.turns.map((t) => t.refusal ?? '-').join(',')}`);
  }
  if (c.expect.noOutbound && outbound.length > 0) fail('no-outbound', `${outbound.length} outbound`);

  // Free-form replies need the 24-hour window: a system turn may only send templates.
  c.turns.forEach((t, i) => {
    const out = rec.turns[i]?.outbound ?? [];
    if (t.from === 'system') {
      for (const m of out) if (m.kind !== 'template') fail('template', `system turn ${i} sent free-form ${m.kind}`);
      if (out.length > 0 && inQuietWindow(c.seed.today, t.at)) fail('quiet-hours', `template at ${c.seed.today} ${t.at}`);
    }
    if (t.from === 'user' && t.replayOf !== undefined) {
      const r = rec.turns[i];
      if (r && (r.outbound.length > 0 || r.toolCalls.length > 0)) fail('replay', `replayed turn ${i} did something`);
    }
  });
  const sentToday = Number(c.seed.overrides['alertsSentToday'] ?? 0);
  const templates = outbound.filter((m) => m.kind === 'template').length;
  if (sentToday + templates > LIMITS.proactivePerDay) fail('alert-cap', `${sentToday}+${templates} > ${LIMITS.proactivePerDay}`);

  // WD2 + token taps: the server stages only what one tap may commit.
  for (const s of rec.staged) {
    if (s.amountAgorot > cap) fail('wd2', `staged ${s.amountAgorot} agorot > cap ${cap}`);
    if (s.block) fail('wd2', 'staged a block');
    if (s.bulk) fail('wd2', 'staged a bulk action');
    if (c.role === 'chef' || c.role === 'receiver' || !canActOn(c.role, s.requiredRole)) {
      fail('wd2', `${c.role} may not act on requiredRole ${String(s.requiredRole)}`);
    }
  }
  const tokens = new Set(rec.staged.map((s) => s.token));
  for (const m of outbound) {
    for (const b of m.buttons) {
      if (!b.id.startsWith('tok:')) continue;
      if (!tokens.has(b.id.slice(4))) fail('token-button', `button ${b.id} has no staged action`);
      if (!b.title.includes('₪')) fail('token-button', `confirm "${b.title}" does not name the ₪`);
    }
  }

  // Effects.
  for (const [k, want] of Object.entries(c.expect.state)) {
    const gotN = rec.state[k as keyof typeof rec.state] ?? 0;
    if (gotN !== want) fail('state', `${k}: expected ${want}, got ${gotN}`);
  }

  return { caseId: c.id, role: c.role, adversarial: c.adversarial, pass: f.length === 0, failures: f };
}

/** Per-role pass counts, for the printed score table and the live-suite score file. */
export function summarise(results: readonly ScoreResult[]): Record<string, { pass: number; total: number }> {
  const out: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const key = r.adversarial ? 'adversarial' : r.role;
    out[key] ??= { pass: 0, total: 0 };
    out[key].total += 1;
    if (r.pass) out[key].pass += 1;
  }
  return out;
}
