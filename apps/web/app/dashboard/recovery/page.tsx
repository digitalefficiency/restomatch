import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileCheck2, HandCoins, Mail, Send } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { Card, EmptyState, SectionHeader } from '@/lib/components';
import { displayName } from '../approvals/vocab';
import { TrackerClient } from './tracker-client';
import { ALL_CLAIMS, ANSWER_DAYS, followUps, funnelOf, type FunnelPart } from './logic';

const PART_ORDER: FunnelPart[] = ['returned', 'credited', 'open', 'disputed', 'writtenOff'];
const PART_BAR: Record<FunnelPart, string> = {
  returned: 'bg-gold',
  credited: 'bg-primary',
  open: 'bg-ink/70',
  disputed: 'bg-warn',
  writtenOff: 'bg-line-strong',
};

/**
 * ₪-back tracker (flag `recovery`): claimed → letter sent → acknowledged →
 * credit note → money back. T1 = what suppliers still owe; one funnel
 * (נדרש → זוכה → הוחזר, plus open / disputed / written off) whose printed
 * whole shekels add up (Hamilton rounding); the supplier table is at 2 dp.
 * Money arrives as integer agorot; shown via formatIls(agorot / 100).
 */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.recovery) notFound();
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const initialTab = tabParam === 'all' || tabParam === 'closed' ? tabParam : 'todo';

  const [t, locale] = await Promise.all([getT(recoveryNs), getLocale()]);
  const [{ summary, returnedThisMonth }, claims, suggestions] = await Promise.all([
    caller.recovery.summary(),
    // Every claim: the banner, tab counts and cards sum them (never a 200-row first page).
    caller.recovery.list({ limit: ALL_CLAIMS }),
    caller.recovery.creditLineSuggestions(),
  ]);
  const nowIso = new Date().toISOString();
  const exact = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const whole = (shekels: number) => formatIls(shekels, { locale, maximumFractionDigits: 0 });
  const pct = (r: number | null) => (r == null ? '—' : formatPercent(r, locale, 0));
  const ageingTotal = Object.values(summary.ageing).reduce((s, v) => s + v, 0);
  const funnel = funnelOf(summary);
  const queues = followUps(claims, nowIso);

  return (
    <div className="space-y-6">
      <SectionHeader
        level={1}
        title={t('tracker.title')}
        subtitle={t('tracker.subtitle')}
        action={
          <Link
            href="/dashboard/leaks/claims"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-muted hover:border-primary/40 hover:text-primary"
          >
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            {t('tracker.lettersLink')}
          </Link>
        }
      />

      {summary.claimCount === 0 ? (
        <EmptyState
          icon={<HandCoins className="h-6 w-6" />}
          title={t('tracker.empty')}
          description={t('tracker.emptyHint')}
          action={
            <Link href="/dashboard/approvals" className="text-sm font-semibold text-primary hover:underline">
              {t('tracker.emptyCta')}
            </Link>
          }
        />
      ) : (
        <>
          {/* T1 — what suppliers still owe, then the one funnel every other ₪ on the page belongs to. */}
          <Card padding="lg" elevated data-testid="recovery-hero">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-muted">{t('tracker.outstanding')}</p>
                <p
                  className="mt-1 text-4xl font-extrabold tabular-nums text-ink lg:text-5xl"
                  title={exact(summary.outstandingAgorot)}
                  data-testid="recovery-outstanding"
                >
                  <bdi>{whole(Math.round(summary.outstandingAgorot / 100))}</bdi>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {t('tracker.outstandingHint', { claimed: whole(funnel.stages.claimed), count: formatNumber(summary.claimCount, locale) })}
                </p>
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-subtle">{t('tracker.rate')}</dt>
                  <dd className="font-semibold tabular-nums text-ink" title={t('tracker.rateHint')}>
                    {pct(summary.recoveryRate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">{t('tracker.returnedThisMonthLabel')}</dt>
                  <dd className="font-semibold tabular-nums text-gold">{exact(returnedThisMonth.returnedAgorot)}</dd>
                </div>
              </dl>
            </div>

            <section className="mt-5 border-t border-line pt-4" aria-labelledby="funnel-title" data-testid="recovery-funnel">
              <h2 id="funnel-title" className="text-sm font-bold text-ink">
                {t('funnel.title')}
              </h2>
              <ol className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" aria-label={t('funnel.stagesLabel')}>
                {(['claimed', 'credited', 'returned'] as const).map((s, i) => (
                  <li key={s} className="flex items-baseline gap-2">
                    {i > 0 ? (
                      <span aria-hidden="true" className="text-subtle" data-testid="funnel-arrow">
                        {locale === 'he' ? '←' : '→'}
                      </span>
                    ) : null}
                    <span className="text-muted">{t(`funnel.stage.${s}`)}</span>
                    <span className="font-bold tabular-nums text-ink" data-testid={`stage-${s}`}>
                      {whole(funnel.stages[s])}
                    </span>
                  </li>
                ))}
              </ol>
              <div
                className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
                role="img"
                aria-label={t('funnel.sentence', {
                  claimed: whole(funnel.totalShekels),
                  returned: whole(funnel.shekels.returned),
                  credited: whole(funnel.shekels.credited),
                  open: whole(funnel.shekels.open),
                  disputed: whole(funnel.shekels.disputed),
                  writtenOff: whole(funnel.shekels.writtenOff),
                })}
              >
                {PART_ORDER.map((p) =>
                  funnel.agorot[p] > 0 && funnel.totalAgorot > 0 ? (
                    <span key={p} className={PART_BAR[p]} style={{ width: `${(funnel.agorot[p] / funnel.totalAgorot) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
                {PART_ORDER.map((p) => (
                  <div key={p} className="flex items-baseline gap-2" data-testid="funnel-part" data-part={p}>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${PART_BAR[p]}`} aria-hidden="true" />
                    <dt className="text-muted">{t(`funnel.part.${p}`)}</dt>
                    <dd className="ms-auto font-semibold tabular-nums text-ink sm:ms-0" title={exact(funnel.agorot[p])} data-shekels={funnel.shekels[p]}>
                      {whole(funnel.shekels[p])}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-subtle">{t('funnel.note')}</p>
            </section>
          </Card>

          {/* T2 — the two follow-up queues, each with its one action. */}
          {queues.unsent.count > 0 || queues.waiting.count > 0 ? (
            <div className="grid gap-3 md:grid-cols-2" data-testid="recovery-followups">
              {queues.unsent.count > 0 ? (
                <Card padding="md" className="flex flex-wrap items-center justify-between gap-3 border-warn/40">
                  <p
                    className="flex min-w-0 items-start gap-2 text-sm text-ink"
                    data-testid="recovery-followup-unsent"
                    data-agorot={queues.unsent.agorot}
                    data-count={queues.unsent.count}
                  >
                    <Send className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                    <span>
                      <strong>{t('followUp.unsent', { count: formatNumber(queues.unsent.count, locale), amount: exact(queues.unsent.agorot) })}</strong>
                    </span>
                  </p>
                  <Link
                    href="/dashboard/leaks/claims"
                    className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-90"
                  >
                    {t('followUp.unsentCta')}
                  </Link>
                </Card>
              ) : null}
              {queues.waiting.count > 0 ? (
                <Card padding="md" className="flex flex-wrap items-center justify-between gap-3 border-warn/40">
                  <div className="min-w-0 text-sm text-ink">
                    <p
                      className="flex items-start gap-2"
                      data-testid="recovery-followup-waiting"
                      data-agorot={queues.waiting.agorot}
                      data-count={queues.waiting.count}
                    >
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                      <strong>
                        {t('followUp.waiting', { count: formatNumber(queues.waiting.count, locale), amount: exact(queues.waiting.agorot), days: formatNumber(ANSWER_DAYS, locale) })}
                      </strong>
                    </p>
                    <p className="ms-6 mt-0.5 text-xs text-muted">{t('followUp.reminderNote')}</p>
                  </div>
                  <Link
                    href="/dashboard/leaks/claims#sent-letters-title"
                    className="inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40"
                  >
                    {t('followUp.waitingCta')}
                  </Link>
                </Card>
              ) : null}
            </div>
          ) : null}

          <TrackerClient claims={claims} suggestions={suggestions} nowIso={nowIso} initialTab={initialTab} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
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
                        <span className="tabular-nums text-ink">{exact(v)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                        {/* Neutral ink: money still owed is not good news; warn only past 60 days. */}
                        <div
                          className={`h-1.5 rounded-full ${b === 'd90p' || b === 'd61_90' ? 'bg-warn' : 'bg-ink/60'}`}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card padding="lg">
              <h2 id="recovery-suppliers-title" className="text-sm font-bold text-ink">
                {t('tracker.suppliersTitle')}
              </h2>
              {/* Desktop: the table at 2 dp, so each row reconciles to its claims. */}
              <table className="mt-3 hidden w-full text-sm md:table" aria-labelledby="recovery-suppliers-title" data-testid="recovery-suppliers">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colSupplier')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('tracker.colOutstanding')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('tracker.colClaimed')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('tracker.colCredited')}</th>
                    <th scope="col" className="py-2 text-right font-semibold">{t('tracker.colRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bySupplier.map((s) => (
                    <tr key={s.supplierId ?? '—'} className="border-b border-line/60">
                      <td className="py-2 pe-3 text-ink">{displayName(locale, s.supplierName, s.supplierNameEn) || '—'}</td>
                      <td className="py-2 pe-3 text-right font-semibold tabular-nums text-ink">{exact(s.outstandingAgorot)}</td>
                      <td className="py-2 pe-3 text-right tabular-nums text-muted">{exact(s.claimedAgorot)}</td>
                      <td className="py-2 pe-3 text-right tabular-nums text-primary">{exact(s.creditedAgorot)}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{pct(s.recoveryRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Phone: one card per supplier, the outstanding ₪ first. */}
              <ul className="mt-3 divide-y divide-line/60 md:hidden">
                {summary.bySupplier.map((s) => (
                  <li key={s.supplierId ?? '—'} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-semibold text-ink">{displayName(locale, s.supplierName, s.supplierNameEn) || '—'}</span>
                      <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{exact(s.outstandingAgorot)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {t('tracker.supplierLine', {
                        claimed: exact(s.claimedAgorot),
                        credited: exact(s.creditedAgorot),
                        rate: pct(s.recoveryRate),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
