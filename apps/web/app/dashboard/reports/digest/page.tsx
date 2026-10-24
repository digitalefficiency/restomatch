import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { Card, SectionHeader, cn } from '@/lib/components';
import { displayName } from '../../approvals/vocab';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' of `d` shifted by `offset` months, in Israel time. */
function monthKey(offset: number, d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value) - 1 + offset;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/**
 * In-app preview of the monthly email (flag `monthlyDigestPreview`): the one
 * number, the top 3 leaking suppliers and what was recovered — exactly the
 * figures of the monthly report and the dashboard hero for the same month.
 * Read-only: nothing is queued or sent from this page. Owner/manager only.
 */
export default async function MonthlyDigestPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.monthlyDigestPreview) notFound();
  const sp = await searchParams;
  const thisMonth = monthKey(0);
  const lastMonth = monthKey(-1);
  const month = sp.month && MONTH.test(sp.month) ? sp.month : thisMonth;

  const [t, locale] = await Promise.all([getT(recoveryNs), getLocale()]);
  const { data, frozen, subject, to, sendOn, fullReport } = await caller.monthlyReport.digest({ month, locale });
  const ils = (agorot: number) => formatIls(agorot / 100, { locale });
  const pct = (r: number | null) => (r == null ? '—' : formatPercent(r, locale));
  const monthName = formatDate(`${month}-15T12:00:00Z`, locale, { month: 'long', year: 'numeric' });
  const sendDate = formatDate(`${sendOn}T09:00:00Z`, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const cta = fullReport
    ? { href: `/dashboard/reports/monthly?month=${month}`, label: t('digest.cta') }
    : flags.recovery
      ? { href: '/dashboard/recovery', label: t('digest.ctaTracker') }
      : null;
  const pill = (active: boolean) =>
    cn('rounded-lg px-3 py-1.5 text-xs font-semibold', active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink');
  const top = data.topSuppliers.slice(0, 3);

  return (
    <div className="space-y-6">
      <SectionHeader level={1} title={t('digest.title')} subtitle={t('digest.subtitle')} />

      <nav aria-label={t('report.month')} className="flex w-fit gap-1 rounded-xl bg-surface-2 p-1">
        <Link href={`?month=${thisMonth}`} className={pill(month === thisMonth)} aria-current={month === thisMonth ? 'page' : undefined}>
          {t('digest.thisMonth')}
        </Link>
        <Link href={`?month=${lastMonth}`} className={pill(month === lastMonth)} aria-current={month === lastMonth ? 'page' : undefined}>
          {t('digest.lastMonth')}
        </Link>
      </nav>

      <Card padding="none" elevated className="mx-auto max-w-2xl overflow-hidden" data-testid="digest-email">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-b border-line bg-surface-2 px-5 py-4 text-sm">
          <dt className="text-muted">{t('digest.from')}</dt>
          <dd className="min-w-0 truncate font-semibold text-ink">RestoMatch</dd>
          <dt className="text-muted">{t('digest.to')}</dt>
          <dd className="min-w-0 truncate text-xs leading-5 text-ink">
            {to.length > 0 ? (
              <span className="font-mono" dir="ltr">
                {to.join(', ')}
              </span>
            ) : (
              <span className="text-muted">{t('digest.noRecipient')}</span>
            )}
          </dd>
          <dt className="text-muted">{t('digest.subject')}</dt>
          <dd className="min-w-0 font-semibold text-ink" dir="auto" data-testid="digest-subject">
            {subject}
          </dd>
        </dl>
        <p className="flex items-center gap-1.5 border-b border-line px-5 py-2 text-xs text-muted">
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {frozen ? t('digest.frozen') : t('digest.sendOn', { date: sendDate })}
        </p>

        <div dir={dir} className="space-y-6 px-5 py-6 sm:px-8">
          <p className="text-sm text-ink">{t('digest.greeting', { month: monthName })}</p>

          <section data-testid="digest-one-number" className="rounded-2xl bg-danger/10 px-5 py-5 ring-1 ring-danger/25">
            <p className="font-mono text-4xl font-extrabold tabular-nums text-danger sm:text-5xl">{ils(data.leakAgorot)}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{t('digest.oneNumberLabel')}</p>
            <p className="mt-1 text-sm text-muted">
              {data.spendAgorot > 0 ? t('digest.pctOfSpend', { pct: pct(data.leakPct), spend: ils(data.spendAgorot) }) : t('digest.noSpend')}
            </p>
          </section>

          <section data-testid="digest-suppliers">
            <h2 className="text-sm font-bold text-ink">{t('digest.topSuppliers')}</h2>
            {top.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t('digest.noSuppliers')}</p>
            ) : (
              <ol className="mt-2 divide-y divide-line rounded-xl border border-line">
                {top.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted">
                        {i + 1}
                      </span>
                      <span className="truncate text-ink">{displayName(locale, s.name, s.nameEn)}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-danger">
                      {ils(s.leakAgorot)} <span className="text-xs text-muted">{pct(s.leakPct)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section data-testid="digest-recovered">
            <h2 className="text-sm font-bold text-ink">{t('digest.recovered')}</h2>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  ['claimed', data.claimedAgorot, 'text-primary'],
                  ['returned', data.returnedAgorot, 'text-gold'],
                  ['outstanding', data.outstandingAgorot, 'text-danger'],
                ] as const
              ).map(([key, agorot, tone]) => (
                <div key={key} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                  <dt className="text-xs text-muted">{t(`digest.${key}`)}</dt>
                  <dd className={cn('mt-1 font-mono text-lg font-bold tabular-nums', tone)}>{ils(agorot)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {cta ? (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {cta.label}
              <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </Card>

      <p className="mx-auto flex max-w-2xl items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t('digest.note')}
      </p>
    </div>
  );
}
