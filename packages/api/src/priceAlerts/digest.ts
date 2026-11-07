import { status, surfaces, text as ink } from '@restomatch/ui-tokens';
import { mailMoney, toAgorot, type MailLocale } from './money';

/**
 * AU-13 — the 07:00 "מחירים שעלו" morning mail. PURE: no DB, no clock.
 *
 * One mail per person per slot, built per ROLE (never one payload with hidden
 * sections — the chef must never receive supplier price-creep lines):
 *   - owner / manager → `buildOwnerDigest`: price creep ranked by ≈₪/month,
 *     contracts ending within 14 days, a new supplier price list, and the dish
 *     section as one more section;
 *   - chef → `buildChefDigest`: the dish section only (₪ on recipes is allowed);
 *   - receiver / bookkeeper → nothing (no purchasing decision).
 *
 * None of this is leak ₪: the creep figure is an ESTIMATE of what a rise costs
 * per month ("≈₪212 בחודש (הערכה)"), shown apart from the hero, never in a claim
 * or a letter, and the words "דליפה" / "פער" / "1.5%" never appear.
 *
 * Returns null when there is nothing to say — no "אין התראות היום" mail, ever.
 */

export type Tone = 't2' | 't4';

/** One open, un-notified price alert with its W2-12 impact estimate. */
export interface CreepLine {
  alertId: string;
  productName: string;
  supplierName: string;
  /** 0.12 = +12 %. */
  pctChange: number;
  windowDays: number;
  /** Shekels per unit (NUMERIC-derived). */
  startPrice: number;
  endPrice: number;
  cheaperSupplierName: string | null;
  cheaperPrice: number | null;
  /** ≈₪/month in integer agorot (W2-12 `impact.ts`); null = not enough data. */
  monthlyAgorot: number | null;
  /** W2-12 `alertTone`: t2 only at ≥3 % AND ≥₪50/month; otherwise neutral t4. */
  tone: Tone;
}

/** Contract prices with one supplier ending on one date (AC 2). */
export interface ContractEndingGroup {
  supplierId: string;
  supplierName: string;
  /** Inclusive restaurant-local date, YYYY-MM-DD. */
  validTo: string;
  productCount: number;
}

/** A dish whose food cost crossed the target this month (AC 3). */
export interface DishLine {
  recipeId: string;
  name: string;
  afterFoodCostBp: number;
  targetBp: number;
  /** Extra cost per plate, integer agorot. */
  costDeltaAgorot: number;
  productName: string;
  /** Unit-price change of the product that drove it, basis points. */
  productChangeBp: number;
  supplierName: string | null;
}

/** A committed supplier price list's rises (AC 5) — no ₪/month: list prices carry no quantity. */
export interface ListDiffSection {
  importId: string;
  supplierName: string;
  /** YYYY-MM-DD (restaurant-local) the import was committed. */
  importedOn: string;
  risesCount: number;
  /** Mean rise, basis points (half-up). */
  avgRiseBp: number;
  /** Top rises by %, at most 5. Shekels. */
  top: Array<{ name: string; oldListPrice: number; newListPrice: number; changeBp: number }>;
}

export interface DigestLinks {
  /** `/dashboard/go?...` deep link to the "לטיפול" queue (absolute when a base URL is known). */
  queue?: string;
  contracts?: string;
  recipe?: (recipeId: string) => string | undefined;
  catalog?: string;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
  /** Alerts the mail names (top N + "ועוד"), all of them — the caller marks these notified. */
  alertIds: string[];
  /** Sum of the known ≈₪/month estimates, integer agorot (KPI hook, AU-07). */
  creepMonthlyAgorot: number;
}

/** Lines shown in full; the rest collapse into "ועוד N". */
export const DIGEST_TOP_N = 5;

/**
 * Highest ≈₪/month first; an unknown estimate ranks LAST (never as ₪0); ties by
 * % then product name so the order is stable.
 */
export function rankCreep(lines: readonly CreepLine[]): CreepLine[] {
  return [...lines].sort((a, b) => {
    if (a.monthlyAgorot == null && b.monthlyAgorot != null) return 1;
    if (b.monthlyAgorot == null && a.monthlyAgorot != null) return -1;
    if (a.monthlyAgorot != null && b.monthlyAgorot != null && a.monthlyAgorot !== b.monthlyAgorot) {
      return b.monthlyAgorot - a.monthlyAgorot;
    }
    if (a.pctChange !== b.pctChange) return b.pctChange - a.pctChange;
    return a.productName.localeCompare(b.productName, 'he');
  });
}

/* ───────────────────────────── copy ───────────────────────────── */

const pct = (ratio: number): string => `+${Math.round(ratio * 100)}%`;
const pctBp = (bp: number, sign = false): string => `${sign && bp > 0 ? '+' : ''}${Math.round(bp / 100)}%`;
const weeks = (days: number): number => Math.max(1, Math.round(days / 7));
/** "2026-11-30" → "30.11" (string slicing: never a UTC Date). */
const dayMonth = (ymd: string): string => `${Number(ymd.slice(8, 10))}.${Number(ymd.slice(5, 7))}`;
const unitPrice = (ils: number, l: MailLocale) => mailMoney(toAgorot(ils), l, 2);
const perMonth = (agorot: number, l: MailLocale) => mailMoney(agorot, l, 0);

interface Copy {
  dir: 'rtl' | 'ltr';
  heading: string;
  creepHeading: string;
  products: (n: number) => string;
  estimate: (money: string) => string;
  unknown: string;
  creepLine: (l: CreepLine, loc: MailLocale) => string;
  cheaper: (supplier: string, price: string) => string;
  more: (n: number) => string;
  actNow: string;
  toQueue: string;
  contractsHeading: string;
  contractLine: (g: ContractEndingGroup) => string;
  renew: string;
  dishHeading: string;
  dishLine: (d: DishLine, loc: MailLocale) => string;
  toRecipe: string;
  listHeading: string;
  listLine: (s: ListDiffSection, loc: MailLocale) => string;
  toCatalog: string;
  footer: string;
  subjectCreep: (n: number, first: CreepLine, total: string | null) => string;
  subjectContracts: (n: number) => string;
  subjectDishes: (n: number) => string;
  subjectList: (supplier: string) => string;
}

const HE: Copy = {
  dir: 'rtl',
  heading: 'מחירים שעלו',
  creepHeading: 'מחירים שעלו אצל הספקים',
  products: (n) => (n === 1 ? 'מוצר אחד' : `${n} מוצרים`),
  estimate: (m) => `≈${m} בחודש (הערכה)`,
  unknown: 'אין מספיק נתונים',
  creepLine: (l, loc) =>
    `${l.productName} · ${l.supplierName} · ${pct(l.pctChange)} ב-${weeks(l.windowDays)} שבועות · ` +
    `מ-${unitPrice(l.startPrice, loc)} ל-${unitPrice(l.endPrice, loc)} ליחידה · ` +
    (l.monthlyAgorot == null ? 'אין מספיק נתונים' : `≈${perMonth(l.monthlyAgorot, loc)} בחודש (הערכה)`),
  cheaper: (s, p) => `אותו מוצר אצל ${s}: ${p} ליחידה`,
  more: (n) => `ועוד ${n}`,
  actNow: 'לטיפול עכשיו',
  toQueue: 'לרשימת המחירים לטיפול',
  contractsHeading: 'חוזי מחירים שמסתיימים בשבועיים הקרובים',
  contractLine: (g) =>
    `חוזה מחירים עם ${g.supplierName} מסתיים ב-${dayMonth(g.validTo)} · ${g.productCount === 1 ? 'מוצר אחד' : `${g.productCount} מוצרים`}`,
  renew: 'לחידוש',
  dishHeading: 'מנות שעברו את יעד עלות המזון',
  dishLine: (d, loc) =>
    `${d.name} ${pctBp(d.afterFoodCostBp)} (יעד ${pctBp(d.targetBp)}) · ${mailMoney(d.costDeltaAgorot, loc, 2)} יותר למנה · ` +
    `${d.productName} ${pctBp(d.productChangeBp, true)}${d.supplierName ? ` אצל ${d.supplierName}` : ''}`,
  toRecipe: 'למתכון',
  listHeading: 'מחירון חדש',
  listLine: (s, loc) =>
    `מחירון חדש מ${s.supplierName} (${dayMonth(s.importedOn)}): ${s.risesCount === 1 ? 'מחיר אחד עלה' : `${s.risesCount} מחירים עלו`} · ` +
    `ממוצע ${pctBp(s.avgRiseBp, true)} · הגבוהים: ` +
    s.top
      .map((t) => `${t.name} ${pctBp(t.changeBp)} ${unitPrice(t.oldListPrice, loc)} → ${unitPrice(t.newListPrice, loc)}`)
      .join(' · '),
  toCatalog: 'למחירון',
  footer: 'ההערכה החודשית מחושבת לפי הכמויות שהזמנתם ב-90 הימים האחרונים. היא אינה חלק מסכום הכסף שאיתרנו בחשבוניות.',
  subjectCreep: (n, first, total) =>
    `מחירים שעלו: ${n === 1 ? `${first.productName} ${pct(first.pctChange)}` : `${n} מוצרים`}` +
    (total ? ` · ≈${total} בחודש (הערכה)` : ''),
  subjectContracts: (n) => (n === 1 ? 'חוזה מחירים מסתיים בקרוב' : `${n} חוזי מחירים מסתיימים בקרוב`),
  subjectDishes: (n) => (n === 1 ? 'מנה אחת עברה את יעד עלות המזון' : `${n} מנות עברו את יעד עלות המזון`),
  subjectList: (s) => `מחירון חדש מ${s}`,
};

const EN: Copy = {
  dir: 'ltr',
  heading: 'Prices that went up',
  creepHeading: 'Supplier prices that went up',
  products: (n) => (n === 1 ? '1 product' : `${n} products`),
  estimate: (m) => `≈${m}/month (estimate)`,
  unknown: 'Not enough data',
  creepLine: (l, loc) =>
    `${l.productName} · ${l.supplierName} · ${pct(l.pctChange)} in ${weeks(l.windowDays)} weeks · ` +
    `from ${unitPrice(l.startPrice, loc)} to ${unitPrice(l.endPrice, loc)} per unit · ` +
    (l.monthlyAgorot == null ? 'Not enough data' : `≈${perMonth(l.monthlyAgorot, loc)}/month (estimate)`),
  cheaper: (s, p) => `Same product at ${s}: ${p} per unit`,
  more: (n) => `and ${n} more`,
  actNow: 'Act now',
  toQueue: 'Open the price queue',
  contractsHeading: 'Contract prices ending in the next two weeks',
  contractLine: (g) =>
    `Contract prices with ${g.supplierName} end on ${dayMonth(g.validTo)} · ${g.productCount === 1 ? '1 product' : `${g.productCount} products`}`,
  renew: 'Renew',
  dishHeading: 'Dishes over their food-cost target',
  dishLine: (d, loc) =>
    `${d.name} ${pctBp(d.afterFoodCostBp)} (target ${pctBp(d.targetBp)}) · ${mailMoney(d.costDeltaAgorot, loc, 2)} more per plate · ` +
    `${d.productName} ${pctBp(d.productChangeBp, true)}${d.supplierName ? ` at ${d.supplierName}` : ''}`,
  toRecipe: 'Open recipe',
  listHeading: 'New price list',
  listLine: (s, loc) =>
    `New price list from ${s.supplierName} (${dayMonth(s.importedOn)}): ${s.risesCount === 1 ? '1 price went up' : `${s.risesCount} prices went up`} · ` +
    `average ${pctBp(s.avgRiseBp, true)} · largest: ` +
    s.top
      .map((t) => `${t.name} ${pctBp(t.changeBp)} ${unitPrice(t.oldListPrice, loc)} → ${unitPrice(t.newListPrice, loc)}`)
      .join(' · '),
  toCatalog: 'Open price list',
  footer: 'The monthly estimate uses the quantities you ordered in the last 90 days. It is not part of the money we found on your invoices.',
  subjectCreep: (n, first, total) =>
    `Prices that went up: ${n === 1 ? `${first.productName} ${pct(first.pctChange)}` : `${n} products`}` +
    (total ? ` · ≈${total}/month (estimate)` : ''),
  subjectContracts: (n) => (n === 1 ? 'A price contract ends soon' : `${n} price contracts end soon`),
  subjectDishes: (n) => (n === 1 ? '1 dish is over its food-cost target' : `${n} dishes are over their food-cost target`),
  subjectList: (s) => `New price list from ${s}`,
};

const copyFor = (l: MailLocale): Copy => (l === 'en' ? EN : HE);

/* ───────────────────────────── LIGHT template ───────────────────────────── */

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Every pair below is a ui-tokens role pair (AA by construction; ui-tokens contrast tests). */
const C = {
  canvas: surfaces.canvas,
  card: surfaces.surface,
  line: surfaces.line,
  ink: ink.ink,
  muted: ink.muted,
  link: status.primary.text,
  t2Bg: status.danger.bgBold,
  t2Fg: status.danger.onBold,
  t2Rail: status.danger.text,
  neutralBg: status.neutral.bgSubtle,
};

interface Block {
  heading: string;
  items: Array<{ text: string; sub?: string; tone?: Tone; badge?: string; link?: { href: string; label: string } }>;
  more?: string;
  cta?: { href: string; label: string };
}

function renderHtml(locale: MailLocale, title: string, blocks: Block[], footer: string | null): string {
  const c = copyFor(locale);
  const side = c.dir === 'rtl' ? 'right' : 'left';
  const a = (href: string, label: string) =>
    `<a href="${esc(href)}" style="color:${C.link};font-weight:600">${esc(label)}</a>`;
  const body = blocks
    .map((b) => {
      const items = b.items
        .map((it) => {
          const t2 = it.tone === 't2';
          const badge =
            t2 && it.badge
              ? `<span style="display:inline-block;background:${C.t2Bg};color:${C.t2Fg};border-radius:6px;padding:1px 8px;font-size:12px;font-weight:700;margin-inline-end:6px">${esc(it.badge)}</span>`
              : '';
          return (
            `<li style="margin:0 0 10px;padding:8px 10px;border-${side}:3px solid ${t2 ? C.t2Rail : C.line};background:${t2 ? C.card : C.neutralBg};border-radius:6px">` +
            `${badge}<span style="color:${C.ink}">${esc(it.text)}</span>` +
            (it.link ? ` · ${a(it.link.href, it.link.label)}` : '') +
            (it.sub ? `<div style="color:${C.muted};font-size:13px;margin-top:4px">${esc(it.sub)}</div>` : '') +
            `</li>`
          );
        })
        .join('');
      return (
        `<h2 style="font-size:16px;margin:20px 0 8px;color:${C.ink}">${esc(b.heading)}</h2>` +
        `<ul style="list-style:none;margin:0;padding:0">${items}</ul>` +
        (b.more ? `<p style="margin:0 0 8px;color:${C.muted}">${esc(b.more)}</p>` : '') +
        (b.cta ? `<p style="margin:8px 0 0">${a(b.cta.href, b.cta.label)}</p>` : '')
      );
    })
    .join('');
  return (
    `<!doctype html><html lang="${locale}" dir="${c.dir}"><body style="margin:0;font-family:Arial,sans-serif;background:${C.canvas};color:${C.ink};padding:24px">` +
    `<div style="max-width:600px;margin:auto;background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:24px;text-align:${side}">` +
    `<h1 style="font-size:20px;margin:0 0 4px;color:${C.ink}">${esc(title)}</h1>` +
    body +
    (footer ? `<p style="margin:24px 0 0;color:${C.muted};font-size:12px">${esc(footer)}</p>` : '') +
    `</div></body></html>`
  );
}

function renderText(title: string, blocks: Block[], footer: string | null): string {
  const out: string[] = [title];
  for (const b of blocks) {
    out.push('', b.heading);
    for (const it of b.items) {
      out.push(`- ${it.tone === 't2' && it.badge ? `[${it.badge}] ` : ''}${it.text}${it.link ? ` · ${it.link.label}: ${it.link.href}` : ''}`);
      if (it.sub) out.push(`  ${it.sub}`);
    }
    if (b.more) out.push(b.more);
    if (b.cta) out.push(`${b.cta.label}: ${b.cta.href}`);
  }
  if (footer) out.push('', footer);
  return out.join('\n');
}

/* ───────────────────────────── sections ───────────────────────────── */

function creepBlock(lines: CreepLine[], loc: MailLocale, links: DigestLinks): Block | null {
  if (lines.length === 0) return null;
  const c = copyFor(loc);
  const ranked = rankCreep(lines);
  const shown = ranked.slice(0, DIGEST_TOP_N);
  return {
    heading: c.creepHeading,
    items: shown.map((l) => ({
      text: c.creepLine(l, loc),
      sub:
        l.cheaperSupplierName && l.cheaperPrice != null
          ? c.cheaper(l.cheaperSupplierName, unitPrice(l.cheaperPrice, loc))
          : undefined,
      tone: l.tone,
      badge: c.actNow,
    })),
    more: ranked.length > shown.length ? c.more(ranked.length - shown.length) : undefined,
    cta: links.queue ? { href: links.queue, label: c.toQueue } : undefined,
  };
}

function contractsBlock(groups: ContractEndingGroup[], loc: MailLocale, links: DigestLinks): Block | null {
  if (groups.length === 0) return null;
  const c = copyFor(loc);
  const sorted = [...groups].sort((a, b) => a.validTo.localeCompare(b.validTo) || a.supplierName.localeCompare(b.supplierName, 'he'));
  return {
    heading: c.contractsHeading,
    items: sorted.map((g) => ({
      text: c.contractLine(g),
      link: links.contracts ? { href: links.contracts, label: c.renew } : undefined,
    })),
  };
}

function dishBlock(dishes: DishLine[], loc: MailLocale, links: DigestLinks): Block | null {
  if (dishes.length === 0) return null;
  const c = copyFor(loc);
  const sorted = [...dishes].sort((a, b) => b.costDeltaAgorot - a.costDeltaAgorot || a.name.localeCompare(b.name, 'he'));
  return {
    heading: c.dishHeading,
    items: sorted.map((d) => {
      const href = links.recipe?.(d.recipeId);
      return { text: c.dishLine(d, loc), link: href ? { href, label: c.toRecipe } : undefined };
    }),
  };
}

function listBlock(sections: ListDiffSection[], loc: MailLocale, links: DigestLinks): Block | null {
  const withRises = sections.filter((s) => s.risesCount > 0);
  if (withRises.length === 0) return null;
  const c = copyFor(loc);
  return {
    heading: c.listHeading,
    items: withRises.map((s) => ({ text: c.listLine(s, loc) })),
    cta: links.catalog ? { href: links.catalog, label: c.toCatalog } : undefined,
  };
}

/* ───────────────────────────── builders ───────────────────────────── */

export interface OwnerDigestInput {
  locale: MailLocale;
  creep: CreepLine[];
  contracts: ContractEndingGroup[];
  dishes: DishLine[];
  listDiffs: ListDiffSection[];
  links: DigestLinks;
}

/** The owner / manager mail: sections 1, 2, 5 and the dish section. Null when empty. */
export function buildOwnerDigest(input: OwnerDigestInput): DigestEmail | null {
  const c = copyFor(input.locale);
  const blocks = [
    creepBlock(input.creep, input.locale, input.links),
    contractsBlock(input.contracts, input.locale, input.links),
    listBlock(input.listDiffs, input.locale, input.links),
    dishBlock(input.dishes, input.locale, input.links),
  ].filter((b): b is Block => b !== null);
  if (blocks.length === 0) return null;

  const known = input.creep.filter((l) => l.monthlyAgorot != null);
  const creepMonthlyAgorot = known.reduce((s, l) => s + (l.monthlyAgorot ?? 0), 0);
  const total = creepMonthlyAgorot > 0 ? perMonth(creepMonthlyAgorot, input.locale) : null;
  const ranked = rankCreep(input.creep);
  const withRises = input.listDiffs.filter((s) => s.risesCount > 0);
  const subject =
    ranked.length > 0
      ? c.subjectCreep(ranked.length, ranked[0]!, total)
      : input.contracts.length > 0
        ? c.subjectContracts(input.contracts.length)
        : withRises.length > 0
          ? c.subjectList(withRises[0]!.supplierName)
          : c.subjectDishes(input.dishes.length);
  const title = ranked.length > 0 ? `${c.heading}: ${c.products(ranked.length)}${total ? ` · ${c.estimate(total)}` : ''}` : subject;
  const footer = ranked.length > 0 ? c.footer : null;
  return {
    subject,
    html: renderHtml(input.locale, title, blocks, footer),
    text: renderText(title, blocks, footer),
    alertIds: ranked.map((l) => l.alertId),
    creepMonthlyAgorot,
  };
}

/** The chef mail: the dish section ONLY. A separate payload, never the owner mail with sections hidden. */
export function buildChefDigest(input: { locale: MailLocale; dishes: DishLine[]; links: DigestLinks }): DigestEmail | null {
  const block = dishBlock(input.dishes, input.locale, input.links);
  if (!block) return null;
  const subject = copyFor(input.locale).subjectDishes(input.dishes.length);
  return {
    subject,
    html: renderHtml(input.locale, subject, [block], null),
    text: renderText(subject, [block], null),
    alertIds: [],
    creepMonthlyAgorot: 0,
  };
}
