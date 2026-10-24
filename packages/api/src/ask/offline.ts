/**
 * Deterministic offline answers (no Claude, no network, no spend) for the five
 * canned questions — used when ANTHROPIC_API_KEY is missing, the per-restaurant
 * budget is spent, or the Claude leg fails. The API returns FACTS (numbers,
 * names, links); the web turns them into a sentence in he/en with formatIls()
 * (the ₪ display boundary), so no money string is ever built here.
 */
import { computeLeakBreakdown, computeLeakHero, computeLeakReport } from '@restomatch/charts';
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
  ['leakTotal', /(how much|leak|total|כמה|דליפ|דלף|הפסד)/i],
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
      const [curRaw, prevRaw] = await Promise.all([
        computeLeakReport(db, restaurantId, month),
        computeLeakReport(db, restaurantId, prevMonth),
      ]);
      const cur = { hero: { leakIls: r2(curRaw.hero.leakIls) }, byType: curRaw.byType, bySupplier: curRaw.bySupplier };
      const prev = { hero: { leakIls: r2(prevRaw.hero.leakIls) }, byType: prevRaw.byType, bySupplier: prevRaw.bySupplier };
      // Biggest supplier and discrepancy-type movers between the two months —
      // over the FULL lists (a supplier outside last month's top 8 is not "new").
      const supName = (s: { supplierName: string | null; supplierNameEn: string | null }) => clip(locale === 'en' ? (s.supplierNameEn ?? s.supplierName) : (s.supplierName ?? s.supplierNameEn));
      const supDelta = new Map<string, { name: string | null; id: string | null; delta: number }>();
      for (const s of cur.bySupplier) supDelta.set(s.supplierId ?? supName(s) ?? '?', { name: supName(s), id: s.supplierId, delta: s.leakIls });
      for (const s of prev.bySupplier) {
        const k = s.supplierId ?? supName(s) ?? '?';
        const e = supDelta.get(k) ?? { name: supName(s), id: s.supplierId, delta: 0 };
        e.delta -= s.leakIls;
        supDelta.set(k, e);
      }
      const typeDelta = new Map<string, number>();
      for (const t of cur.byType) typeDelta.set(t.type, (typeDelta.get(t.type) ?? 0) + t.amountIls);
      for (const t of prev.byType) typeDelta.set(t.type, (typeDelta.get(t.type) ?? 0) - t.amountIls);
      const topSup = [...supDelta.values()].sort((a, b) => b.delta - a.delta)[0] ?? null;
      const topType = [...typeDelta.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
      const links: ScreenLink[] = [
        { screen: 'report', href: `/dashboard/leaks/report?month=${month}` },
        { screen: 'report', href: `/dashboard/leaks/report?month=${prevMonth}` },
      ];
      if (topSup?.id) links.push({ screen: 'supplier', href: `/dashboard/suppliers/${topSup.id}` });
      return {
        intent,
        facts: {
          month,
          prevMonth,
          leakIls: cur.hero.leakIls,
          prevLeakIls: prev.hero.leakIls,
          deltaIls: r2(cur.hero.leakIls - prev.hero.leakIls),
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
