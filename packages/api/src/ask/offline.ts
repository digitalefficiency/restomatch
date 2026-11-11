/**
 * Deterministic offline answers (no Claude, no network, no spend) for the five
 * canned questions — used when ANTHROPIC_API_KEY is missing, the per-restaurant
 * budget is spent, or the Claude leg fails. The API returns FACTS (numbers,
 * names, links); the web turns them into a sentence in he/en with formatIls()
 * (the ₪ display boundary), so no money string is ever built here.
 */
import { computeLeakHero, computeLeakReport } from '@restomatch/charts';
import type { Database } from '@restomatch/db';
import { leakComparison } from './compare';
import { monthKey, restaurantTimezone } from './periods';
import { claimableFor, clip, reportData, type ScreenLink } from './tools';

export const CANNED_INTENTS = ['leakChange', 'leakTotal', 'priceRaise', 'claimWeek', 'topSupplier'] as const;
export type CannedIntent = (typeof CANNED_INTENTS)[number];

/** Keyword rules (he + en). First match wins; order = most specific first. */
const RULES: Array<[CannedIntent, RegExp]> = [
  ['claimWeek', /(claim|credit|תבוע|לתבוע|תביע|זיכוי|לדרוש|החזר)/i],
  // "why…", "the leak … went up / down / changed" or "what changed in the leak" — before
  // priceRaise ("increase"). Neutral: it never presupposes a rise.
  [
    'leakChange',
    /(why|למה|מדוע)|((leak|דליפ|דלף).*(went up|go up|went down|increas|decreas|chang|rise|rose|fell|drop|עלת|עלה|ירד|השתנ|גדל|קטנ))|((chang|השתנ).*(leak|דליפ|דלף))/i,
  ],
  ['priceRaise', /(rais|price|increas|expensive|העלה|העלו|התייקר|מחיר|יקר)/i],
  ['topSupplier', /(which supplier|worst|most|biggest|top|איזה ספק|הכי|הגדול)/i],
  // Only a question about the LEAK (or a loss) is the leak total: "כמה" / "how much" alone
  // ("כמה הזמנות?", "how much is the salmon?") is not — it falls through to null.
  ['leakTotal', /(leak|\blos(?:e|s|t|ing)\b|דליפ|דלף|דולף|הפסד)/i],
];

export function classifyQuestion(question: string): CannedIntent | null {
  for (const [intent, re] of RULES) if (re.test(question)) return intent;
  return null;
}

export interface OfflineFacts {
  intent: CannedIntent | null;
  facts: Record<string, string | number | null | Array<Record<string, string | number | null>>>;
  links: ScreenLink[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function offlineAnswer(
  db: Database,
  restaurantId: string,
  question: string,
  now: Date = new Date(),
  locale: 'he' | 'en' = 'en',
): Promise<OfflineFacts> {
  const intent = classifyQuestion(question);
  const tz = await restaurantTimezone(db, restaurantId);
  const month = monthKey(0, now, tz);

  switch (intent) {
    case 'leakTotal': {
      const h = await computeLeakHero(db, restaurantId, { monthOffset: 0, now });
      return {
        intent,
        facts: {
          month,
          leakIls: r2(h.leakIls),
          leakPct: h.leakPct == null ? null : Math.round(h.leakPct * 1000) / 10,
          caughtIls: r2(h.caughtBeforePaymentIls),
          invoicesWithLeak: h.invoicesWithLeak,
        },
        links: [
          { screen: 'overview', href: '/dashboard' },
          { screen: 'breakdown', href: '/dashboard/leaks/breakdown?m=0' },
        ],
      };
    }
    case 'leakChange': {
      // Like for like (the same function as the leak_change tool): this month to date
      // vs the SAME days of last month — never a partial month against a full one.
      const c = await leakComparison(db, restaurantId, now, locale);
      const links: ScreenLink[] = [
        { screen: 'report', href: `/dashboard/leaks/report?month=${c.cur.from.slice(0, 7)}` },
        { screen: 'report', href: `/dashboard/leaks/report?month=${c.prev.from.slice(0, 7)}` },
      ];
      if (c.topSupplier?.id) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${c.topSupplier.id}` });
      return {
        intent,
        facts: {
          month: c.cur.from.slice(0, 7),
          prevMonth: c.prev.from.slice(0, 7),
          // The two spans compared, as local days (inclusive) — the sentence names them.
          from: c.cur.from,
          to: c.cur.through,
          prevFrom: c.prev.from,
          prevTo: c.prev.through,
          complete: c.cur.complete ? 1 : 0,
          prevComplete: c.prev.complete ? 1 : 0,
          spanLabel: c.spanLabel,
          curSpanLabel: c.curSpanLabel,
          prevSpanLabel: c.prevSpanLabel,
          leakIls: c.cur.leakIls,
          prevLeakIls: c.prev.leakIls,
          deltaIls: c.deltaIls,
          topSupplier: c.topSupplier?.name ?? null,
          topSupplierDeltaIls: c.topSupplier?.deltaIls ?? null,
          topType: c.topType?.type ?? null,
          topTypeDeltaIls: c.topType?.deltaIls ?? null,
        },
        links,
      };
    }
    case 'priceRaise': {
      const rep = reportData(await computeLeakReport(db, restaurantId, month), locale);
      const items = rep.priceIncreases.filter((p) => (p.deltaPct ?? 0) > 0).slice(0, 5);
      return {
        intent,
        facts: {
          month,
          count: items.length,
          items: items.map((p) => ({
            supplier: p.supplier,
            product: p.product,
            beforePrice: p.beforePrice,
            afterPrice: p.afterPrice,
            deltaPct: p.deltaPct,
            excessIls: p.excessIls,
          })),
        },
        links: [{ screen: 'report', href: `/dashboard/leaks/report?month=${month}` }],
      };
    }
    case 'claimWeek': {
      // The open claimable lines of awaitingDecision: every month, no limit.
      const c = await claimableFor(db, restaurantId, locale);
      return {
        intent,
        facts: {
          totalIls: c.totalIls,
          count: c.count,
          duplicateInclVatIls: c.duplicateInclVatIls,
          vatIls: c.vatIls,
          items: c.lines.slice(0, 5).map((l) => ({
            supplier: l.supplier,
            item: l.item,
            type: l.type,
            amountIls: l.amountIls,
            invoiceNumber: l.invoiceNumber,
          })),
        },
        links: [
          { screen: 'claims', href: '/dashboard/leaks/claims' },
          ...c.lines.slice(0, 5).map((l) => ({ screen: 'invoice' as const, href: `/dashboard/invoices/${l.invoiceId}` })),
        ],
      };
    }
    case 'topSupplier': {
      const rep = reportData(await computeLeakReport(db, restaurantId, month), locale);
      const top = [...rep.bySupplier].sort((a, b) => b.leakIls - a.leakIls)[0];
      return {
        intent,
        facts: {
          month,
          supplier: top && top.leakIls > 0 ? clip(top.supplier) : null,
          leakIls: top ? top.leakIls : 0,
          leakPct: top?.leakPctOfSpend ?? null,
          spendIls: top ? top.spendIls : 0,
        },
        links: [
          { screen: 'report', href: `/dashboard/leaks/report?month=${month}` },
          ...(top?.supplierId ? [{ screen: 'supplier' as const, href: `/dashboard/suppliers/${top.supplierId}` }] : []),
        ],
      };
    }
    default:
      return { intent: null, facts: {}, links: [{ screen: 'leaks', href: '/dashboard/leaks' }] };
  }
}
