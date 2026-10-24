import Link from 'next/link';
import { WithOriginal, originalProps } from '@/lib/i18n/original';
import { ArrowRight, FileCheck2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Card, EmptyState, SectionHeader } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from './print-button';

/** A line is claimable when it counts as leak, is still open/claimed, and the invoice is unpaid. */
const CLAIMABLE = new Set(['open', 'escalated', 'accepted']);

/**
 * Supplier credit-request letters (מכתבי דרישת זיכוי): turns the month's leak
 * into one printable letter per supplier listing every claimable line. Built
 * from owner.leakBreakdown — the same numbers as the hero, no new money math.
 * `?m=-1` = previous month.
 */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const parsed = Number.parseInt(sp.m ?? '0', 10);
  const monthOffset = Number.isFinite(parsed) ? Math.min(0, Math.max(-24, parsed)) : 0;

  const caller = await createServerCaller();
  const [t, ta, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getLocale()]);
  const [hero, rows, memberships] = await Promise.all([
    caller.owner.leakHero({ monthOffset }),
    caller.owner.leakBreakdown({ monthOffset, limit: 200 }),
    caller.onboarding.myMemberships(),
  ]);

  const month = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const today = formatDate(new Date(), locale, { dateStyle: 'long' });
  const restaurant = memberships[0]?.restaurantName ?? '';
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });

  // Group claimable lines by supplier.
  const bySupplier = new Map<
    string,
    { name: string; lines: Array<{ invoice: string; item: string; issue: string; amount: number }> }
  >();
  for (const inv of rows) {
    if (inv.pendingLink || inv.status === 'paid') continue;
    const name = displayName(locale, inv.supplierName, inv.supplierNameEn) || '—';
    const key = inv.supplierName ?? name;
    const group = bySupplier.get(key) ?? { name, lines: [] };
    let invClaimed = 0;
    for (const l of inv.lines) {
      if (!l.countsAsLeak || !CLAIMABLE.has(l.resolutionStatus)) continue;
      // Never claim more on an invoice than its capped leak.
      const amount = Math.min(Math.abs(l.deltaAmount), Math.max(0, inv.leakIls - invClaimed));
      if (amount <= 0) continue;
      invClaimed += amount;
      group.lines.push({
        invoice: inv.invoiceNumber ?? '—',
        item:
          displayName(locale, l.productName, l.productNameEn) ||
          displayName(locale, l.lineDescription, l.lineDescriptionEn),
        issue: discrepancyLabel(ta, l.type),
        amount,
      });
    }
    if (group.lines.length > 0) bySupplier.set(key, group);
  }
  const letters = [...bySupplier.values()]
    .map((g) => ({ ...g, total: Math.round(g.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <Link
        href={`/dashboard/leaks/breakdown${monthOffset ? `?m=${monthOffset}` : ''}`}
        className="mb-3 -ms-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:text-ink print:hidden"
      >
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('breakdown.title')}
      </Link>
      <div className="print:hidden">
        <SectionHeader
          level={1}
          title={t('claims.title')}
          subtitle={t('claims.subtitle', { month })}
          action={letters.length > 0 ? <PrintButton label={t('claims.print')} /> : undefined}
        />
      </div>

      {letters.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="h-6 w-6" />} title={t('claims.empty')} description={t('claims.note')} />
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-subtle print:hidden">{t('claims.note')}</p>
          {letters.map((letter) => (
            <Card
              key={letter.name}
              as="article"
              elevated
              padding="lg"
              className="break-inside-avoid print:break-after-page print:border-0 print:bg-white print:text-black print:shadow-none"
            >
              <div className="flex flex-col gap-1 text-sm text-muted sm:flex-row sm:justify-between print:text-black">
                <div>
                  <p className="font-semibold text-ink print:text-black">{t('claims.to', { supplier: letter.name })}</p>
                  <p>
                    <WithOriginal text={t('claims.from', { restaurant })} value={restaurant} />
                  </p>
                </div>
                <p>{t('claims.date', { date: today })}</p>
              </div>
              <h2 className="mt-4 text-base font-bold text-ink print:text-black">{t('claims.subject', { month })}</h2>
              <p className="mt-2 text-sm text-muted print:text-black">{t('claims.intro', { amount: ils(letter.total) })}</p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle print:text-black">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('claims.colInvoice')}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('claims.colItem')}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('claims.colIssue')}</th>
                      <th scope="col" className="py-2 text-end font-semibold">{t('claims.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {letter.lines.map((l, i) => (
                      <tr key={i} className="border-b border-line/60">
                        <td className="py-2 pe-3 font-mono tabular-nums text-muted print:text-black">{l.invoice}</td>
                        <td className="py-2 pe-3 text-ink print:text-black">{l.item || '—'}</td>
                        <td className="py-2 pe-3 text-muted print:text-black">{l.issue}</td>
                        <td className="py-2 text-end font-mono tabular-nums text-ink print:text-black">{ils(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="pt-3 text-end font-semibold text-ink print:text-black">
                        {t('claims.total')}
                      </td>
                      <td className="pt-3 text-end font-mono text-lg font-extrabold tabular-nums text-danger print:text-black">
                        {ils(letter.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="mt-4 text-sm text-muted print:text-black">{t('claims.closing')}</p>
              <p className="mt-3 text-sm text-muted print:text-black">
                {t('claims.signature')}
                <br />
                <span className="font-semibold text-ink print:text-black" {...originalProps(restaurant)}>
                  {restaurant}
                </span>
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
