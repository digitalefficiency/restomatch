/**
 * Deterministic offline answers (no Claude, no network, no spend) for the five
 * canned questions — used when ANTHROPIC_API_KEY is missing, the per-restaurant
 * budget is spent, or the Claude leg fails. The API returns FACTS (numbers,
 * names, links); the web turns them into a sentence in he/en with formatIls()
 * (the ₪ display boundary), so no money string is ever built here.
 */
import {
  computeLeakBreakdown,
  computeLeakGrouped,
  computeLeakHero,
  computeLeakReport,
  computeLeakSummary,
} from '@restomatch/charts';
import type { Database } from '@restomatch/db';
import { claimableData, clip, monthKey, reportData, type ScreenLink } from './tools';

export const CANNED_INTENTS = ['leakChange', 'leakTotal', 'priceRaise', 'claimWeek', 'topSupplier'] as const;
export type CannedIntent = (typeof CANNED_INTENTS)[number];

/** Keyword rules (he + en). First match wins; order = most specific first. */
const RULES: Array<[CannedIntent, RegExp]> = [
  ['claimWeek', /(claim|credit|תבוע|לתבוע|תביע|זיכוי|לדרוש|החזר)/i],
  // "why…" or "the leak … went up / changed" — before priceRaise ("increase").
  ['leakChange', /(why|למה|מדוע)|((leak|דליפ|דלף).*(went up|go up|increas|chang|rise|rose|עלת|עלה|השתנ|גדל))/i],
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
  const month = monthKey(0, now);
  const prevMonth = monthKey(-1, now);

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
      // Like for like: this month to date vs the SAME day-span of last month (the
      // explorer's aligned compare) — never a partial month against a full one.
      const spec = { period: 'this_month' as const, now };
      const [curH, prevH, curSup, prevSup, curType, prevType] = await Promise.all([
        computeLeakSummary(db, restaurantId, spec, 'off'),
        computeLeakSummary(db, restaurantId, spec, 'prev'),
        computeLeakGrouped(db, restaurantId, spec, 'supplier', 'off', 200),
        computeLeakGrouped(db, restaurantId, spec, 'supplier', 'prev', 200),
        computeLeakGrouped(db, restaurantId, spec, 'type', 'off', 200),
        computeLeakGrouped(db, restaurantId, spec, 'type', 'prev', 200),
      ]);
      const span = alignedSpan(curH.monthStart, prevH.monthStart, prevH.monthEnd, now);
      // Biggest supplier and discrepancy-type movers between the two spans —
      // over the FULL lists (a supplier outside last month's top 8 is not "new").
      const supDelta = new Map<string, { name: string | null; id: string | null; delta: number }>();
      const supName = (r: { label: string | null; labelEn: string | null }) =>
        clip(locale === 'en' ? (r.labelEn ?? r.label) : (r.label ?? r.labelEn));
      for (const r of curSup) supDelta.set(r.key || '?', { name: supName(r), id: r.key || null, delta: r.leakIls });
      for (const r of prevSup) {
        const e = supDelta.get(r.key || '?') ?? { name: supName(r), id: r.key || null, delta: 0 };
        e.delta -= r.leakIls;
        supDelta.set(r.key || '?', e);
      }
      const typeDelta = new Map<string, number>();
      for (const r of curType) typeDelta.set(r.key, (typeDelta.get(r.key) ?? 0) + r.leakIls);
      for (const r of prevType) typeDelta.set(r.key, (typeDelta.get(r.key) ?? 0) - r.leakIls);
      const topSup = [...supDelta.values()].sort((a, b) => b.delta - a.delta)[0] ?? null;
      const topType = [...typeDelta.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
      const links: ScreenLink[] = [
        { screen: 'report', href: `/dashboard/leaks/report?month=${month}` },
        { screen: 'report', href: `/dashboard/leaks/report?month=${prevMonth}` },
      ];
      if (topSup?.id) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${topSup.id}` });
      const leakIls = r2(curH.leakIls);
      const prevLeakIls = r2(prevH.leakIls);
      return {
        intent,
        facts: {
          month,
          prevMonth,
          // The two spans compared, as local days (inclusive) — the sentence names them.
          from: span.from,
          to: span.to,
          prevFrom: span.prevFrom,
          prevTo: span.prevTo,
          leakIls,
          prevLeakIls,
          deltaIls: r2(leakIls - prevLeakIls),
          topSupplier: topSup && topSup.delta > 0 ? topSup.name : null,
          topSupplierDeltaIls: topSup && topSup.delta > 0 ? r2(topSup.delta) : null,
          topType: topType && topType[1] > 0 ? topType[0] : null,
          topTypeDeltaIls: topType && topType[1] > 0 ? r2(topType[1]) : null,
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
      const [cur, prev] = await Promise.all([
        computeLeakBreakdown(db, restaurantId, { monthOffset: 0, limit: 100, now }),
        computeLeakBreakdown(db, restaurantId, { monthOffset: -1, limit: 100, now }),
      ]);
      const c = claimableData([...cur, ...prev], locale);
      return {
        intent,
        facts: {
          totalIls: c.totalIls,
          count: c.count,
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

/** 'YYYY-MM-DD' of an instant in Israel time. */
function israelDay(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d));
}

/**
 * The inclusive local days an aligned compare covers: this month from its 1st to
 * today, and the comparison period from its start to its (exclusive) end − 1 ms.
 */
export function alignedSpan(
  curStartIso: string,
  prevStartIso: string,
  prevEndIso: string,
  now: Date,
): { from: string; to: string; prevFrom: string; prevTo: string } {
  return {
    from: israelDay(curStartIso),
    to: israelDay(now),
    prevFrom: israelDay(prevStartIso),
    prevTo: israelDay(new Date(new Date(prevEndIso).getTime() - 1)),
  };
}
