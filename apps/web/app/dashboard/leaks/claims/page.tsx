import Link from 'next/link';
import { WithOriginal, originalProps } from '@/lib/i18n/original';
import { ArrowRight, FileCheck2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Badge, Card, EmptyState, SectionHeader } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from './print-button';
import { claimableLines, sumClaims, vatBasisOf, type VatBasis } from '@restomatch/api';

type LetterLine = { invoice: string; item: string; issue: string; amount: number; basis: VatBasis };
type Letter = { name: string; lines: LetterLine[]; total: number; mixed: boolean };

/** One letter per supplier, largest first; the total is the sum of its printed lines. */
function toLetters(bySupplier: Map<string, { name: string; lines: LetterLine[] }>): Letter[] {
  return [...bySupplier.values()]
    .filter((g) => g.lines.length > 0)
    .map((g) => ({ ...g, total: sumClaims(g.lines), mixed: new Set(g.lines.map((l) => l.basis)).size > 1 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Supplier credit-request letters (מכתבי דרישת זיכוי): turns the month's leak
 * into one printable letter per supplier listing every claimable line. Built
 * from owner.leakBreakdown — the same numbers as the hero, no new money math.
 * `?m=-1` = previous month.
 *
 * With the ₪-back tracker (flag `recovery`) on, the claims it holds in status
 * "claimed" (no letter sent yet — on paid invoices too, which the before-payment
 * letters skip) get their own letters, after this month's: the tracker's "letters" link and the
 * monthly report's "send claim letters for N discrepancies (₪X)" point here, and
 * these letters add up to exactly that ₪X (Σ outstanding of the claimed claims).
 */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const parsed = Number.parseInt(sp.m ?? '0', 10);
  const monthOffset = Number.isFinite(parsed) ? Math.min(0, Math.max(-24, parsed)) : 0;

  const caller = await createServerCaller();
  const [t, ta, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getLocale()]);
  const [hero, rows, memberships, flags] = await Promise.all([
    caller.owner.leakHero({ monthOffset }),
    caller.owner.leakBreakdown({ monthOffset, limit: 200 }),
    caller.onboarding.myMemberships(),
    caller.recovery.flags(),
  ]);
  // Tracker claims still awaiting a letter (all months, like the report's sendClaims).
  const tracked = flags.recovery ? await caller.recovery.list({ status: 'claimed' }).catch(() => []) : [];

  const month = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const today = formatDate(new Date(), locale, { dateStyle: 'long' });
  const restaurant = memberships[0]?.restaurantName ?? '';
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });

  const trackerGroups = new Map<string, { name: string; lines: LetterLine[] }>();
  for (const c of tracked) {
    if (c.status !== 'claimed' || c.outstandingAgorot <= 0) continue;
    const name = displayName(locale, c.supplierName, c.supplierNameEn) || '—';
    const key = c.supplierId ?? c.supplierName ?? name;
    const group = trackerGroups.get(key) ?? { name, lines: [] };
    group.lines.push({
      invoice: c.invoiceNumber ?? '—',
      item:
        displayName(locale, c.productName, c.productNameEn) ||
        displayName(locale, c.lineDescription, c.lineDescriptionEn),
      issue: discrepancyLabel(ta, c.discrepancyType),
      amount: c.outstandingAgorot / 100,
      basis: vatBasisOf(c.discrepancyType),
    });
    trackerGroups.set(key, group);
  }
  const trackerLetters = toLetters(trackerGroups);
  const trackerCount = trackerLetters.reduce((n, l) => n + l.lines.length, 0);
  const trackerTotal = Math.round(trackerLetters.reduce((s, l) => s + l.total * 100, 0)) / 100;

  // Group claimable lines by supplier. The claimable rule (₪, capped per invoice) is shared
  // with the pay run: @restomatch/api claimableLines.
  const bySupplier = new Map<string, { name: string; lines: LetterLine[] }>();
  for (const inv of rows) {
    const claimable = claimableLines(inv);
    if (claimable.length === 0) continue;
    const name = displayName(locale, inv.supplierName, inv.supplierNameEn) || '—';
    const key = inv.supplierName ?? name;
    const group = bySupplier.get(key) ?? { name, lines: [] };
    for (const { line: l, amount, basis } of claimable) {
      group.lines.push({
        invoice: inv.invoiceNumber ?? '—',
        item:
          displayName(locale, l.productName, l.productNameEn) ||
          displayName(locale, l.lineDescription, l.lineDescriptionEn),
        issue: discrepancyLabel(ta, l.type),
        amount,
        basis,
      });
    }
    bySupplier.set(key, group);
  }
  const letters = toLetters(bySupplier);
  const anyLetters = letters.length > 0 || trackerLetters.length > 0;

  const renderLetter = (letter: Letter, kind: 'tracker' | 'month') => (
    <Card
      key={`${kind}:${letter.name}`}
      as="article"
      elevated
      padding="lg"
      data-testid={kind === 'tracker' ? 'tracker-letter' : 'month-letter'}
      className="break-inside-avoid print:break-after-page print:border-0 print:bg-white print:text-black print:shadow-none"
    >
      <div className="flex flex-col gap-1 text-sm text-muted sm:flex-row sm:justify-between print:text-black">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink print:text-black">
            {t('claims.to', { supplier: letter.name })}
            {/* T2 "act now": every letter is still to be sent. */}
            <Badge tone="warning-solid" className="print:hidden">
              {t('claims.toSend')}
            </Badge>
          </p>
          <p>
            <WithOriginal text={t('claims.from', { restaurant })} value={restaurant} />
          </p>
        </div>
        <p>{t('claims.date', { date: today })}</p>
      </div>
      <h2 className="mt-4 text-base font-bold text-ink print:text-black">
        {kind === 'tracker' ? t('claims.trackerSubject') : t('claims.subject', { month })}
      </h2>
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
                <td className="py-2 text-end font-mono tabular-nums text-ink print:text-black">
                  {ils(l.amount)}
                  <span className="block font-sans text-[11px] text-subtle print:text-black">{t(`claims.basis.${l.basis}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-end font-semibold text-ink print:text-black">
                {kind === 'tracker' ? t('claims.trackerTotal') : t('claims.total')}
              </td>
              <td className="pt-3 text-end font-mono text-lg font-extrabold tabular-nums text-danger print:text-black">
                {ils(letter.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {letter.mixed ? <p className="mt-2 text-xs text-subtle print:text-black">{t('claims.mixedBasis')}</p> : null}
      <p className="mt-4 text-sm text-muted print:text-black">{t('claims.closing')}</p>
      <p className="mt-3 text-sm text-muted print:text-black">
        {t('claims.signature')}
        <br />
        <span className="font-semibold text-ink print:text-black" {...originalProps(restaurant)}>
          {restaurant}
        </span>
      </p>
    </Card>
  );

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
          action={anyLetters ? <PrintButton label={t('claims.print')} primary /> : undefined}
        />
      </div>

      {!anyLetters ? (
        <EmptyState icon={<FileCheck2 className="h-6 w-6" />} title={t('claims.empty')} description={t('claims.note')} />
      ) : (
        <div className="space-y-6">
          {letters.length > 0 ? (
            <>
              {trackerLetters.length > 0 ? (
                <h2 className="text-lg font-bold text-ink print:hidden">{t('claims.monthTitle', { month })}</h2>
              ) : null}
              <p className="text-xs text-subtle print:hidden">{t('claims.note')}</p>
              {letters.map((letter) => renderLetter(letter, 'month'))}
            </>
          ) : null}
          {trackerLetters.length > 0 ? (
            <section aria-labelledby="tracker-letters-title" className="space-y-6" data-testid="tracker-letters">
              <div className="print:hidden">
                <h2 id="tracker-letters-title" className="text-lg font-bold text-ink">
                  {t('claims.trackerTitle')}
                </h2>
                <p className="mt-1 text-xs text-subtle">
                  {t('claims.trackerNote', { count: formatNumber(trackerCount, locale), amount: ils(trackerTotal) })}
                </p>
              </div>
              {trackerLetters.map((letter) => renderLetter(letter, 'tracker'))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
