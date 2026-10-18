import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, FileCheck2, HandCoins } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { Card, EmptyState, SectionHeader, StatCard } from '@/lib/components';
import { displayName } from '../approvals/vocab';
import { TrackerClient } from './tracker-client';

/**
 * ₪-back tracker (flag `recovery`): claimed → letter sent → acknowledged →
 * credit note → money back, with totals, ageing and per-supplier recovery rate.
 * Money arrives as integer agorot; shown via formatIls(agorot / 100).
 */
export default async function RecoveryPage() {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.recovery) notFound();

  const [t, locale] = await Promise.all([getT(recoveryNs), getLocale()]);
  const [{ summary, returnedThisMonth }, claims, suggestions] = await Promise.all([
    caller.recovery.summary(),
    caller.recovery.list(),
    caller.recovery.creditLineSuggestions(),
  ]);
  const ils = (agorot: number) => formatIls(agorot / 100, { locale });
  const pct = (r: number | null) => (r == null ? '—' : formatPercent(r, locale, 0));
  const ageingTotal = Object.values(summary.ageing).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        level={1}
        title={t('tracker.title')}
        subtitle={t('tracker.subtitle')}
        action={
          <Link
            href="/dashboard/leaks/claims"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-muted hover:border-primary/40 hover:text-primary"
          >
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            {t('tracker.lettersLink')}
          </Link>
        }
      />

      {summary.claimCount === 0 ? (
        <EmptyState icon={<HandCoins className="h-6 w-6" />} title={t('tracker.empty')} description={t('tracker.emptyHint')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="recovery-totals">
            <StatCard label={t('tracker.claimed')} value={ils(summary.claimedAgorot)} />
            <StatCard label={t('tracker.credited')} value={ils(summary.creditedAgorot)} tone="primary" />
            <StatCard
              label={t('tracker.returned')}
              value={ils(summary.recoveredAgorot)}
              tone="gold"
              hint={t('tracker.returnedThisMonth', { amount: ils(returnedThisMonth.returnedAgorot) })}
            />
            <StatCard
              label={t('tracker.outstanding')}
              value={ils(summary.outstandingAgorot)}
              tone="danger"
              hint={`${t('tracker.rate')}: ${pct(summary.recoveryRate)} (${t('tracker.rateHint')})`}
            />
          </div>

          {summary.overdueCount > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span>
                <strong>{t('tracker.overdue', { count: summary.overdueCount, amount: ils(summary.overdueAgorot) })}</strong>
                <span className="ms-2 text-muted">{t('tracker.overdueHint')}</span>
              </span>
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <Card padding="lg">
              <h2 className="text-sm font-bold text-ink">{t('tracker.ageingTitle')}</h2>
              <ul className="mt-3 space-y-2">
                {(Object.keys(summary.ageing) as Array<keyof typeof summary.ageing>).map((b) => {
                  const v = summary.ageing[b];
                  const w = ageingTotal > 0 ? Math.round((v / ageingTotal) * 100) : 0;
                  return (
                    <li key={b} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">{t(`tracker.ageing.${b}`)}</span>
                        <span className="font-mono tabular-nums text-ink">{ils(v)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                        <div
                          className={`h-1.5 rounded-full ${b === 'd90p' || b === 'd61_90' ? 'bg-danger' : 'bg-gold'}`}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card padding="lg">
              <h2 className="text-sm font-bold text-ink">{t('tracker.suppliersTitle')}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colSupplier')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('tracker.colClaimed')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('tracker.colCredited')}</th>
                      <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('tracker.colOutstanding')}</th>
                      <th scope="col" className="py-2 text-end font-semibold">{t('tracker.colRate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.bySupplier.map((s) => (
                      <tr key={s.supplierId ?? '—'} className="border-b border-line/60">
                        <td className="py-2 pe-3 text-ink">{displayName(locale, s.supplierName, s.supplierNameEn) || '—'}</td>
                        <td className="py-2 pe-3 text-end font-mono tabular-nums">{ils(s.claimedAgorot)}</td>
                        <td className="py-2 pe-3 text-end font-mono tabular-nums text-primary">{ils(s.creditedAgorot)}</td>
                        <td className="py-2 pe-3 text-end font-mono tabular-nums text-danger">{ils(s.outstandingAgorot)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{pct(s.recoveryRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <TrackerClient claims={claims} suggestions={suggestions} />
        </>
      )}
    </div>
  );
}
