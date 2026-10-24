import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Mail, MessageCircle } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { Card, SectionHeader, StatCard, cn } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';

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
 * Monthly "one number" report preview (flag `monthlyReport`): the same data,
 * email, WhatsApp text and PDF the worker sends on the 1st — for this month to
 * date, or any past month. Owner/manager only.
 */
export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.monthlyReport) notFound();
  const sp = await searchParams;
  const thisMonth = monthKey(0);
  const lastMonth = monthKey(-1);
  const month = sp.month && MONTH.test(sp.month) ? sp.month : thisMonth;
  const view = sp.view === 'whatsapp' ? 'whatsapp' : 'email';

  const [t, ta, locale] = await Promise.all([getT(recoveryNs), getT(approvalsNs), getLocale()]);
  const { data, email, whatsapp } = await caller.monthlyReport.preview({ month, locale });
  const ils = (agorot: number) => formatIls(agorot / 100, { locale });
  const pct = (r: number | null) => (r == null ? '—' : formatPercent(r, locale));
  const title = formatDate(`${month}-15T12:00:00Z`, locale, { month: 'long', year: 'numeric' });
  const next = data.nextActions.map((a) => {
    const p = a.params as Record<string, string | number>;
    switch (a.code) {
      case 'chaseOverdue':
      case 'decideOpen':
      case 'sendClaims':
        return t(`next.${a.code}`, { count: formatNumber(Number(p.count), locale), amount: ils(Number(p.agorot)) });
      case 'linkPending':
        return t('next.linkPending', { count: formatNumber(Number(p.count), locale) });
      case 'talkToSupplier':
        return t('next.talkToSupplier', {
          supplier: String(locale === 'en' ? p.supplierEn : p.supplier),
          pct: pct(Number(p.pct)),
        });
      default:
        return t('next.allClear');
    }
  });
  const pill = (active: boolean) =>
    cn(
      'rounded-lg px-3 py-1.5 text-xs font-semibold',
      active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
    );
  const qs = (m: string, v = view) => `?month=${m}${v === 'whatsapp' ? '&view=whatsapp' : ''}`;

  return (
    <div className="space-y-6">
      <SectionHeader level={1} title={`${t('report.title')} · ${title}`} subtitle={t('report.subtitle')} />

      <nav aria-label={t('report.month')} className="flex w-fit gap-1 rounded-xl bg-surface-2 p-1">
        <Link href={qs(thisMonth)} className={pill(month === thisMonth)} aria-current={month === thisMonth ? 'page' : undefined}>
          {t('report.thisMonth')}
        </Link>
        <Link href={qs(lastMonth)} className={pill(month === lastMonth)} aria-current={month === lastMonth ? 'page' : undefined}>
          {t('report.lastMonth')}
        </Link>
      </nav>

      <Card padding="lg" elevated data-testid="report-hero">
        <p className="font-mono text-4xl font-extrabold tabular-nums text-danger sm:text-5xl">{ils(data.leakAgorot)}</p>
        <p className="mt-2 text-base font-semibold text-ink">
          {data.spendAgorot > 0
            ? t('report.headline', { amount: ils(data.leakAgorot), pct: pct(data.leakPct) })
            : t('report.noSpend')}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label={t('report.spend')} value={ils(data.spendAgorot)} />
          <StatCard label={t('report.caught')} value={ils(data.caughtAgorot)} tone="gold" />
          <StatCard label={t('report.claimed')} value={ils(data.claimedAgorot)} tone="primary" />
          {/* Without the recovery feature no claims are tracked: unknown, not "₪0 owed". */}
          {data.recoveryTracked === false ? null : (
            <>
              <StatCard label={t('report.returned')} value={ils(data.returnedAgorot)} tone="gold" />
              <StatCard label={t('report.outstanding')} value={ils(data.outstandingAgorot)} tone="danger" />
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card padding="lg">
          <h2 className="text-sm font-bold text-ink">{t('report.topSuppliers')}</h2>
          {data.topSuppliers.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('report.none')}</p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {data.topSuppliers.map((s, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-ink">{displayName(locale, s.name, s.nameEn)}</span>
                  <span className="font-mono tabular-nums text-danger">
                    {ils(s.leakAgorot)} <span className="text-xs text-muted">{pct(s.leakPct)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card padding="lg">
          <h2 className="text-sm font-bold text-ink">{t('report.topIssues')}</h2>
          {data.topIssues.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('report.none')}</p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {data.topIssues.map((x) => (
                <li key={x.type} className="flex justify-between gap-2">
                  <span className="text-ink">
                    {discrepancyLabel(ta, x.type)}
                    <span className="ms-1 text-xs text-muted">{t('report.issueCount', { count: formatNumber(x.count, locale) })}</span>
                  </span>
                  <span className="font-mono tabular-nums">{ils(x.amountAgorot)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card padding="lg">
          <h2 className="text-sm font-bold text-ink">{t('report.nextActions')}</h2>
          <ul className="mt-2 list-disc space-y-2 ps-5 text-sm text-ink">
            {next.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">{t('report.channels')}</h2>
          <div className="flex flex-wrap gap-2">
            {flags.monthlyDigestPreview ? (
              <Link
                href={`/dashboard/reports/digest?month=${month}`}
                data-testid="report-digest-link"
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink hover:border-primary/40"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                {t('digest.title')}
              </Link>
            ) : null}
            <a
              href={`/dashboard/reports/monthly/pdf?month=${month}&locale=he`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:brightness-110"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('report.downloadHe')}
            </a>
            <a
              href={`/dashboard/reports/monthly/pdf?month=${month}&locale=en`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink hover:border-primary/40"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('report.downloadEn')}
            </a>
          </div>
        </div>
        <div className="mt-4 flex w-fit gap-1 rounded-xl bg-surface-2 p-1">
          <Link href={qs(month, 'email')} className={cn(pill(view === 'email'), 'inline-flex items-center gap-1')}>
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {t('report.email')}
          </Link>
          <Link href={qs(month, 'whatsapp')} className={cn(pill(view === 'whatsapp'), 'inline-flex items-center gap-1')}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {t('report.whatsapp')}
          </Link>
        </div>
        {view === 'email' ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted" dir="auto">
              {email.subject}
            </p>
            <iframe
              title={t('report.emailFrame')}
              srcDoc={email.html}
              sandbox=""
              className="h-[640px] w-full rounded-xl border border-line bg-white"
            />
          </div>
        ) : (
          <div className="mt-4 max-w-md">
            <pre
              dir={locale === 'he' ? 'rtl' : 'ltr'}
              className="whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-[#005c4b] p-4 font-sans text-sm leading-relaxed text-white"
              data-testid="whatsapp-preview"
            >
              {whatsapp}
            </pre>
            <p className="mt-2 text-xs text-muted">{t('report.whatsappNote')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
