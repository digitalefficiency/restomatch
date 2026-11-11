import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MoneyState } from '@restomatch/ui-tokens';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, Money, SectionHeader, StatusChip, cn, type StatusTone } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { accounting } from '@/lib/i18n/messages/accounting';
import { followUps } from '../recovery/logic';
import { loadDecide, loadRecoveryClaims, loadVatAtRisk } from '../home/data';
import { buildSteps, currentMonth, progress, resolveMonth, shiftMonth, type StepKey, type StepState } from './steps';

/** Owner and bookkeeper close the month; the manager reads it. Receiver and chef see no purchase ₪ (§7). */
const CLOSE_ROLES = new Set(['owner', 'manager', 'bookkeeper']);

const TONE: Record<StepState, { tone: StatusTone; emphasis: 'bold' | 'subtle' }> = {
  todo: { tone: 'warn', emphasis: 'bold' }, // T2
  done: { tone: 'success', emphasis: 'subtle' }, // T3
  pending: { tone: 'neutral', emphasis: 'subtle' }, // T4
  off: { tone: 'neutral', emphasis: 'subtle' }, // T4
};

const MONEY_STATE: Record<StepKey, MoneyState> = {
  unchecked: 'spend',
  gaps: 'atRisk',
  claims: 'outstanding',
  consolidated: 'pending',
  deliveryNotes: 'spend',
  vat: 'atRisk',
  exports: 'pending',
};

/** A source that fails or is switched off reads as "not active" (T4), never as an alarm or a page error. */
async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: rawMonth } = await searchParams;
  const caller = await createServerCaller();
  const [session, memberships, locale, t] = await Promise.all([
    auth(),
    caller.onboarding.myMemberships(),
    getLocale(),
    getT(accounting),
  ]);
  if (memberships.length === 0) redirect('/onboarding');
  const active = memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0]!;
  if (!CLOSE_ROLES.has(active.role)) notFound();

  const now = new Date();
  const month = resolveMonth(rawMonth, now);
  const [checklist, decide, claims, vat] = await Promise.all([
    caller.close.checklist({ month }),
    settle(loadDecide()),
    settle(loadRecoveryClaims()),
    settle(loadVatAtRisk(active.restaurantId, active.role)),
  ]);
  const unsent = claims ? followUps(claims, now.toISOString()).unsent : null;
  const steps = buildSteps({
    monthOffset: checklist.monthOffset,
    unchecked: checklist.unchecked,
    consolidated: checklist.consolidated,
    deliveryNotes: checklist.deliveryNotes,
    gaps: decide ? { count: decide.count, amountIls: decide.amountIls } : null,
    claims: unsent ? { count: unsent.count, amountIls: unsent.agorot / 100 } : null,
    vat: vat ? { count: vat.count, amountIls: vat.totalVatAtRisk } : null,
  });
  const { done, total, open } = progress(steps);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const monthName = formatDate(new Date(Date.UTC(y, m - 1, 15)), locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const hasNext = next <= currentMonth(now);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <div data-testid="close-page">
      <SectionHeader level={1} title={t('close.title')} subtitle={t('close.subtitle')} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('close.monthLabel')} className="flex items-center gap-1">
          <Link
            href={`/dashboard/close?month=${prev}`}
            aria-label={t('close.prevMonth')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface-2"
          >
            {/* RTL: "previous" points right. */}
            <ChevronRight className="h-5 w-5 rtl:block ltr:hidden" aria-hidden />
            <ChevronLeft className="h-5 w-5 rtl:hidden ltr:block" aria-hidden />
          </Link>
          <h2 className="min-w-40 text-center text-lg font-bold text-ink" data-testid="close-month">
            {monthName}
          </h2>
          {hasNext ? (
            <Link
              href={`/dashboard/close?month=${next}`}
              aria-label={t('close.nextMonth')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface-2"
            >
              <ChevronLeft className="h-5 w-5 rtl:block ltr:hidden" aria-hidden />
              <ChevronRight className="h-5 w-5 rtl:hidden ltr:block" aria-hidden />
            </Link>
          ) : (
            <span className="h-10 w-10" aria-hidden />
          )}
        </nav>
        <p className="text-sm font-semibold text-muted tabular-nums" data-testid="close-progress">
          {open === 0 ? t('close.allDone') : t('close.progress', { done: n(done), total: n(total) })}
        </p>
      </div>

      <ol className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface shadow-card" data-testid="close-steps">
        {steps.map((st, i) => {
          const tone = TONE[st.state];
          const copyKey = `close.steps.${st.key}` as const;
          return (
            <li
              key={st.key}
              data-step={st.key}
              data-state={st.state}
              data-primary={st.primary ? 'true' : undefined}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:flex-nowrap"
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold tabular-nums',
                  st.state === 'todo' ? 'border-ink text-ink' : 'border-line text-muted',
                )}
              >
                {n(i + 1)}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
                  {t(`${copyKey}.title`)}
                  <StatusChip tone={tone.tone} emphasis={tone.emphasis} label={t(`close.state.${st.state}`)} />
                </p>
                <p className="mt-1 text-sm text-muted">{t(`${copyKey}.body`)}</p>
                {st.openNow && st.state !== 'off' ? <p className="mt-1 text-xs text-muted">{t('close.openNow')}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end text-end" data-testid={`close-figure-${st.key}`}>
                {st.key === 'exports' ? (
                  <span className="text-sm text-muted">{t('close.notTracked')}</span>
                ) : st.state === 'off' || st.amountIls == null ? (
                  <span className="text-sm text-muted">—</span>
                ) : (
                  <>
                    <Money value={st.amountIls} context="tile" state={st.state === 'todo' ? MONEY_STATE[st.key] : 'pending'} />
                    <span className="text-xs text-muted tabular-nums">{t('close.count', { count: n(st.count ?? 0) })}</span>
                  </>
                )}
              </div>
              {st.href ? (
                <div className="w-full shrink-0 sm:w-auto">
                  <LinkButton
                    href={st.href}
                    variant={st.primary ? 'primary' : 'secondary'}
                    size="sm"
                    className="min-h-11 w-full sm:w-auto"
                    data-testid={`close-link-${st.key}`}
                  >
                    {t(`${copyKey}.verb`)}
                  </LinkButton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
