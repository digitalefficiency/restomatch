import Link from 'next/link';
import { ArrowLeft, ClipboardList, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/components';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import type { HomeCaller } from './caller';
import { HomeSection } from './section';
import { BoardSkeleton, CardSkeleton } from './skeletons';
import { ReceivingBoard } from './receiving-board';
import { NeedsYou } from './needs-you';
import { NeedsSkeleton } from './skeletons';
import { taskRow } from '@/lib/components/notifications/rows';
import type { Task } from '@/lib/components/notifications/model';

/**
 * Staff "מחכה לך" (W2-08): the same task spine, counts only — the server sends
 * no ₪ for receiver/chef (tasks.mine nulls it), and this strip renders none.
 * One home per number: a task whose figure already has its own block on this
 * home (`homed`: the chef's count tile) is not repeated; with nothing left the
 * strip renders nothing (the blocks below say the rest).
 */
export function StaffNeeds({ load, homed = [], t, locale, fail }: { load: () => Promise<{ tasks: Task[]; failed: string[] }>; homed?: readonly Task['type'][]; t: T; locale: Locale; fail: Set<string> }) {
  return (
    <HomeSection name="needs" fallback={<NeedsSkeleton rows={2} />} forceFail={fail.has('needs')}>
      <StaffNeedsBody load={load} homed={homed} t={t} locale={locale} />
    </HomeSection>
  );
}

async function StaffNeedsBody({ load, homed, t, locale }: { load: () => Promise<{ tasks: Task[]; failed: string[] }>; homed: readonly Task['type'][]; t: T; locale: Locale }) {
  const { tasks, failed } = await load();
  const rows = tasks
    .filter((x) => x.scope === 'mine' && !homed.includes(x.type))
    .map((x) => taskRow({ ...x, ilsAgorot: null }, t, locale, () => ''))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ ...r, agorot: null, notes: undefined }));
  if (failed.length > 0 && rows.length === 0) throw new Error(`[home] task sources failed: ${failed.join(',')}`);
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 [&_#needs-you-title]:lg:sr-only">
      <NeedsYou title={t('needs.title')} rows={rows} zero={t('needs.staffZero')} moreLabel={(c) => t('needs.more', { count: formatNumber(c, locale) })} />
    </div>
  );
}

type T = Translator<typeof overviewHe>;
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2';

/** Receiver "Today": the receiving board. No ₪, no view toolbar, no owner calls. */
export function ReceiverHome({ caller, t, locale, fail }: { caller: HomeCaller<'receiver'>; t: T; locale: Locale; fail: Set<string> }) {
  return (
    <HomeSection name="board" fallback={<BoardSkeleton />} forceFail={fail.has('board')}>
      <ReceiverBoard caller={caller} t={t} locale={locale} />
    </HomeSection>
  );
}

async function ReceiverBoard({ caller, t, locale }: { caller: HomeCaller<'receiver'>; t: T; locale: Locale }) {
  const rows = await caller.receiving.todayExpectations({ includeLate: true });
  return <ReceivingBoard rows={rows} t={t} locale={locale} />;
}

/**
 * Chef "Today": the count tile, then dishes over their food-cost target with the cause ingredient.
 * Food-cost % only — no purchase or leak ₪ on staff homes (owner decision §8.6).
 */
export function ChefHome({ caller, t, locale, fail }: { caller: HomeCaller<'chef'>; t: T; locale: Locale; fail: Set<string> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
      <div className="lg:col-span-5">
        <HomeSection name="count" fallback={<CardSkeleton className="h-36" />} forceFail={fail.has('count')}>
          <CountTile caller={caller} t={t} locale={locale} />
        </HomeSection>
      </div>
      <div className="lg:col-span-7">
        <HomeSection name="dishes" fallback={<CardSkeleton className="h-64" />} forceFail={fail.has('dishes')}>
          <DishesOverTarget caller={caller} t={t} locale={locale} />
        </HomeSection>
      </div>
    </div>
  );
}

async function CountTile({ caller, t, locale }: { caller: HomeCaller<'chef'>; t: T; locale: Locale }) {
  const { enabled } = await caller.inventory.enabled();
  if (!enabled) return <Calm testId="chef-count" text={t('chef.countOff')} />;
  const draft = await caller.inventory.current();
  const n = (v: number) => formatNumber(v, locale);
  const open = draft && draft.status === 'draft';
  return (
    <Link
      href="/dashboard/inventory/count"
      data-testid="chef-count"
      data-state={open ? 'open' : 'none'}
      className={cn('block rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-primary/40 sm:p-5', focus)}
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-subtle">
        <ClipboardList className="h-4 w-4" aria-hidden="true" />
        {t('chef.countTitle')}
      </span>
      {open ? (
        <>
          <span className="mt-2 block text-2xl font-bold tabular-nums text-ink">
            {t('chef.countOpen', { counted: n(draft.progress.counted), lines: n(draft.progress.lines) })}
          </span>
          <span className="mt-1 block text-sm text-muted">{t('chef.countOpenHint', { left: n(draft.progress.notCounted) })}</span>
        </>
      ) : (
        <>
          <span className="mt-2 block text-2xl font-bold text-ink">{t('chef.countNone')}</span>
          <span className="mt-1 block text-sm text-muted">{t('chef.countNoneHint')}</span>
        </>
      )}
      <span className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-on-primary">
        {open ? t('chef.countContinue') : t('chef.countStart')}
        <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" />
      </span>
    </Link>
  );
}

async function DishesOverTarget({ caller, t, locale }: { caller: HomeCaller<'chef'>; t: T; locale: Locale }) {
  const { enabled } = await caller.recipes.enabled();
  if (!enabled) return <Calm testId="chef-dishes" text={t('chef.dishesOff')} />;
  const res = await caller.recipes.priceAlerts();
  const pct = (bp: number) => formatPercent(bp / 10_000, locale, 1);
  const name = (he: string, en: string | null) => (locale === 'en' && en ? en : he);
  return (
    <section aria-labelledby="chef-dishes-title" data-testid="chef-dishes" className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="chef-dishes-title" className="flex items-center gap-2 text-base font-bold text-ink">
            <UtensilsCrossed className="h-4 w-4 text-muted" aria-hidden="true" />
            {t('chef.dishesTitle')}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t('chef.dishesSubtitle', { target: pct(res.targetBp) })}</p>
        </div>
        <Link href="/dashboard/recipes" className={cn('inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary hover:underline', focus)}>
          {t('chef.dishesAll')}
        </Link>
      </div>
      {!res.enabled || res.alerts.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-primary">{t('chef.dishesNone')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line" data-record="">
          {res.alerts.slice(0, 5).map((a) => (
            <li key={a.recipeId}>
              <Link
                href={`/dashboard/recipes/${a.recipeId}`}
                data-testid="chef-dish"
                className={cn('flex min-h-14 items-center justify-between gap-3 py-2', focus)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">
                    <bdi>{name(a.name, a.nameEn)}</bdi>
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {t('chef.dishCause', {
                      ingredient: name(a.product.name, a.product.nameEn),
                      supplier: a.supplier ? name(a.supplier.name, a.supplier.nameEn) : '—',
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="block text-sm font-bold tabular-nums text-danger">
                    {t('chef.dishCost', { before: pct(a.beforeFoodCostBp), after: pct(a.afterFoodCostBp) })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Calm({ text, testId }: { text: string; testId: string }) {
  return (
    <p data-testid={testId} className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      {text}
    </p>
  );
}
