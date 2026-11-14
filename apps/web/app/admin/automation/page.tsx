import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { admin } from '@/lib/i18n/messages/admin';
import { getLocale, getT } from '@/lib/i18n/server';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import { Money } from '@/lib/components/money';
import { isAdmin2faRequired, TwoFactorRequired } from '../TwoFactorRequired';

type AdminKey = MessageKey<typeof admin.he>;
type Caller = Awaited<ReturnType<typeof createServerCaller>>;
type Kpis = Awaited<ReturnType<Caller['admin']['automationKpis']>>;
type Week = Kpis['weeks'][number];

const WEEK_CHOICES = [4, 8, 12] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNNEL = ['found', 'decided', 'claimed', 'sent', 'credited', 'recovered'] as const;
const DAY = 86_400_000;

interface PageProps {
  searchParams: Promise<{ r?: string; w?: string }>;
}

/**
 * AU-07 · /admin/automation?r=<restaurantId>&w=8 — the measured automation KPIs
 * for one restaurant per Israel week (desktop admin console). Read-only.
 * Hours-₪ (the time ledger) sit in their own card, never next to or summed with
 * the ₪ funnel. Unknown is "לא נמדד" / "אין עדיין נתונים", never 0.
 */
export default async function AdminAutomationPage({ searchParams }: PageProps) {
  const { r, w } = await searchParams;
  const caller = await createServerCaller();
  if (!(await caller.admin.twoFactorStatus()).enabled) return <TwoFactorRequired />;

  const weeksParam = Number(w);
  const weeks = (WEEK_CHOICES as readonly number[]).includes(weeksParam) ? weeksParam : 8;
  const restaurantId = r && UUID.test(r) ? r : null;

  let list: Awaited<ReturnType<Caller['admin']['listRestaurants']>>;
  let data: Kpis | null = null;
  try {
    list = await caller.admin.listRestaurants();
    if (restaurantId) data = await caller.admin.automationKpis({ restaurantId, weeks });
  } catch (err) {
    if (isAdmin2faRequired(err)) return <TwoFactorRequired />;
    if (restaurantId) notFound();
    throw err;
  }
  const [t, locale] = await Promise.all([getT(admin), getLocale()]);

  return (
    <div className="min-w-[1180px]">
      <h1 className="mb-1 text-2xl font-bold text-ink">{t('automation.title')}</h1>
      <p className="mb-5 text-sm text-muted">{t('automation.subtitle')}</p>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label={t('automation.pick')}>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          {t('automation.pick')}
          <select
            name="r"
            defaultValue={restaurantId ?? ''}
            className="min-w-[16rem] rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="" disabled>
              {t('automation.pick')}
            </option>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex items-center gap-1" aria-label={t('automation.weeks', { count: weeks })}>
          {WEEK_CHOICES.map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-primary has-[:checked]:bg-surface-2 has-[:checked]:font-semibold"
            >
              <input type="radio" name="w" value={n} defaultChecked={n === weeks} className="sr-only" />
              {t('automation.weeks', { count: formatNumber(n, locale) })}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="rounded-lg bg-primary-bold px-4 py-2 text-sm font-semibold text-on-bold hover:bg-primary-bold-hover">
          {t('automation.show')}
        </button>
      </form>

      {!data ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted shadow-card">{t('automation.pickHint')}</p>
      ) : (
        <Report data={data} t={t} locale={locale} />
      )}
    </div>
  );
}

type T = Translator<typeof admin.he>;

function Report({ data, t, locale }: { data: Kpis; t: T; locale: Locale }) {
  const newestFirst = [...data.weeks].reverse();
  const weekLabel = (wk: Week) =>
    `${formatDate(wk.weekStart, locale, { day: 'numeric', month: 'numeric' })}–${formatDate(
      new Date(new Date(wk.weekEnd).getTime() - DAY),
      locale,
      { day: 'numeric', month: 'numeric' },
    )}`;
  const hours = (v: number | null) => (v == null ? null : formatNumber(v, locale, { maximumFractionDigits: 1 }));
  const pctOf = (v: number | null) => (v == null ? null : formatPercent(v / 100, locale));

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{data.restaurantName}</h2>
        <p className="text-sm text-subtle">
          {data.dataSince
            ? t('automation.dataSince', { date: formatDate(data.dataSince, locale, { dateStyle: 'medium' }) })
            : t('automation.noDataAtAll')}
          {' · '}
          <Link href={`/admin/restaurants/${data.restaurantId}`} className="underline underline-offset-2 hover:text-ink">
            {t('automation.back')}
          </Link>
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Tile label={t('automation.tiles.openOver24h')} value={formatNumber(data.openDecisionsOver24h, locale)} />
        <Tile
          label={t('automation.tiles.flagsOn')}
          value={t('automation.tiles.flagsOf', {
            on: formatNumber(data.flagsOn, locale),
            total: formatNumber(data.flagsTotal, locale),
          })}
        />
        <Tile
          label={t('automation.tiles.basis')}
          value={data.weeks[0]?.zeroTouchBasis === 'events' ? t('automation.tiles.basisEvents') : t('automation.tiles.basisProxy')}
          small
        />
      </div>

      {/* Document flow */}
      <Section title={t('automation.ops.title')}>
        <table className="w-full text-sm" data-testid="au07-ops">
          <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
            <tr>
              <Th first>{t('automation.ops.week')}</Th>
              <Th>{t('automation.ops.docs')}</Th>
              <Th>{t('automation.ops.inbox')}</Th>
              <Th>{t('automation.ops.duplicates')}</Th>
              <Th>
                {t('automation.ops.zeroTouch')} <EstimateChip label={t('automation.estimate')} />
              </Th>
              <Th>{t('automation.ops.arrival')}</Th>
              <Th>{t('automation.ops.exceptions')}</Th>
              <Th>{t('automation.ops.decisionAge')}</Th>
              <Th>{t('automation.ops.runs')}</Th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((wk) => (
              <tr key={wk.weekStart} className="border-b border-line last:border-0">
                <Td first>{weekLabel(wk)}</Td>
                {!wk.hasData ? (
                  <td colSpan={8} className="px-3 py-2 text-muted">
                    {t('automation.noData')}
                  </td>
                ) : (
                  <>
                    <Td num>{formatNumber(wk.docsIn, locale)}</Td>
                    <Td num>{formatNumber(wk.inboxDocs, locale)}</Td>
                    <Td num>{formatNumber(wk.duplicateCopies, locale)}</Td>
                    <Td num>
                      <Unknown value={pctOf(wk.zeroTouchPct)} t={t} />
                      {wk.zeroTouchPct != null ? (
                        <span className="block text-xs text-subtle">
                          {t('automation.ops.zeroTouchOf', {
                            part: formatNumber(wk.zeroTouchDenominator - wk.zeroTouchTouched, locale),
                            whole: formatNumber(wk.zeroTouchDenominator, locale),
                          })}
                        </span>
                      ) : null}
                      {excludedCount(wk) > 0 ? (
                        <span className="block text-xs text-subtle">
                          {t('automation.ops.excluded', { count: formatNumber(excludedCount(wk), locale) })}
                        </span>
                      ) : null}
                    </Td>
                    <Td num>
                      {wk.arrivalToMatchedHoursP50 == null ? (
                        <Unknown value={null} t={t} />
                      ) : (
                        t('automation.ops.arrivalP', {
                          p50: hours(wk.arrivalToMatchedHoursP50)!,
                          p90: hours(wk.arrivalToMatchedHoursP90) ?? '—',
                        })
                      )}
                    </Td>
                    <Td num>
                      <Unknown value={pctOf(wk.exceptionPct)} t={t} />
                    </Td>
                    <Td num>
                      <Unknown value={hours(wk.decisionAgeHoursP50)} t={t} />
                    </Td>
                    <Td num>{formatNumber(Object.values(wk.automationRuns).reduce((s, n) => s + n, 0), locale)}</Td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ₪ funnel */}
      <Section title={t('automation.funnel.title')} hint={t('automation.funnel.hint')}>
        <table className="w-full text-sm" data-testid="au07-funnel">
          <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
            <tr>
              <Th first>{t('automation.funnel.week')}</Th>
              {FUNNEL.map((k) => (
                <Th key={k}>{t(`automation.funnel.${k}` as AdminKey)}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((wk) => (
              <tr key={wk.weekStart} className="border-b border-line align-top last:border-0">
                <Td first>{weekLabel(wk)}</Td>
                {!wk.hasData ? (
                  <td colSpan={FUNNEL.length} className="px-3 py-2 text-muted">
                    {t('automation.noData')}
                  </td>
                ) : (
                  FUNNEL.map((k) => (
                    <Td key={k} num>
                      <Money agorot={wk.funnelAgorot[k]} context="line" locale={locale} />
                      <Bar part={wk.funnelAgorot[k]} whole={Math.max(...FUNNEL.map((x) => wk.funnelAgorot[x]))} />
                      {k !== 'found' && k !== 'decided' && wk.cohortAgorot[k] > 0 ? (
                        <span className="mt-1 block text-xs text-subtle" title={t('automation.funnel.cohort')}>
                          <Money agorot={wk.cohortAgorot[k]} context="line" locale={locale} />
                        </span>
                      ) : null}
                    </Td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-subtle">{t('automation.funnel.cohortLegend')}</p>
      </Section>

      {/* Alerts */}
      <Section title={t('automation.alerts.title')}>
        <AlertsTable weeks={newestFirst} t={t} locale={locale} weekLabel={weekLabel} />
      </Section>

      {/* Hours-₪: visibly apart from the ₪ funnel */}
      <section
        className="mb-6 rounded-xl border border-dashed border-line bg-surface-2 p-5"
        aria-labelledby="au07-ledger"
        data-testid="au07-ledger"
      >
        <h2 id="au07-ledger" className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
          {t('automation.ledger.title')} <EstimateChip label={t('automation.estimate')} />
        </h2>
        <p className="mb-4 text-sm text-muted">{t('automation.ledger.hint')}</p>
        <p className="mb-4 font-mono text-xl font-bold tabular-nums text-ink">
          <Money value={data.timeLedger.lowIls} context="inline" locale={locale} /> –{' '}
          <Money value={data.timeLedger.highIls} context="inline" locale={locale} />
        </p>
        <dl className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {data.timeLedger.byRole.map((r) => (
            <div key={r.role} className="flex justify-between gap-4">
              <dt className="text-subtle">{t(`automation.ledger.${r.role}` as AdminKey)}</dt>
              <dd className="text-end tabular-nums text-ink">
                <Money value={r.lowIls} context="inline" locale={locale} /> –{' '}
                <Money value={r.highIls} context="inline" locale={locale} />
              </dd>
            </div>
          ))}
        </dl>
        {data.timeLedger.bookkeeperCapped ? (
          <p className="mb-1 text-sm text-muted">{t('automation.ledger.capped')}</p>
        ) : null}
        <p className="mb-4 text-sm font-medium text-ink">{t('automation.ledger.caveat')}</p>
        <details>
          <summary className="cursor-pointer text-sm text-subtle">{t('automation.ledger.assumptions')}</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {data.timeLedger.assumptions.map((a) => (
              <div key={a.key} className="flex justify-between gap-4">
                <dt className="text-subtle">{t(`automation.ledger.${a.key.replace(/\./g, '_')}` as AdminKey)}</dt>
                <dd className="text-end tabular-nums text-ink">
                  {a.unit === 'ils_per_hour' || a.unit === 'ils_per_month' ? (
                    <Money value={a.value} context="inline" locale={locale} />
                  ) : a.unit === 'minutes' ? (
                    t('automation.ledger.minutes', { value: formatNumber(a.value, locale) })
                  ) : (
                    formatNumber(a.value, locale)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
    </>
  );
}

function AlertsTable({
  weeks,
  t,
  locale,
  weekLabel,
}: {
  weeks: Week[];
  t: T;
  locale: Locale;
  weekLabel: (wk: Week) => string;
}) {
  const rows = weeks.flatMap((wk) => wk.alerts.map((a) => ({ wk, a })));
  if (rows.length === 0) return <p className="px-3 py-4 text-sm text-muted">{t('automation.alerts.none')}</p>;
  const cols = ['queued', 'sent', 'sentMock', 'failedNoProvider', 'failed'] as const;
  return (
    <table className="w-full text-sm" data-testid="au07-alerts">
      <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
        <tr>
          <Th first>{t('automation.alerts.week')}</Th>
          <Th first>{t('automation.alerts.event')}</Th>
          {cols.map((c) => (
            <Th key={c}>{t(`automation.alerts.${c}` as AdminKey)}</Th>
          ))}
          <Th>{t('automation.alerts.opened')}</Th>
          <Th>{t('automation.alerts.acted')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ wk, a }) => (
          <tr key={`${wk.weekStart}:${a.event}`} className="border-b border-line last:border-0">
            <Td first>{weekLabel(wk)}</Td>
            <Td first>
              <span className="font-mono text-xs" dir="ltr">
                {a.event}
              </span>
            </Td>
            {cols.map((c) => (
              <Td key={c} num>
                {formatNumber(a[c], locale)}
              </Td>
            ))}
            <Td num>
              <Unknown value={null} t={t} />
            </Td>
            <Td num>{formatNumber(a.actedWithin48h, locale)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const excludedCount = (wk: Week) =>
  wk.zeroTouchExcluded.consolidated + wk.zeroTouchExcluded.pendingLink + wk.zeroTouchExcluded.duplicate;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs text-subtle">{label}</p>
      <p className={small ? 'mt-1 text-sm font-medium text-ink' : 'mt-1 font-mono text-2xl font-bold tabular-nums text-ink'}>
        {value}
      </p>
    </div>
  );
}

function Th({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <th className={`px-3 py-2 font-medium ${first ? 'text-start' : 'text-end'}`}>{children}</th>;
}

function Td({ children, first, num }: { children: React.ReactNode; first?: boolean; num?: boolean }) {
  return (
    <td className={`px-3 py-2 ${first ? 'text-start text-ink' : 'text-end'} ${num ? 'tabular-nums text-ink' : ''}`}>
      {children}
    </td>
  );
}

function Unknown({ value, t }: { value: string | null; t: T }) {
  return value == null ? <span className="text-muted">{t('automation.notMeasured')}</span> : <>{value}</>;
}

function EstimateChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
      {label}
    </span>
  );
}

/** A neutral bar (T4-calm): share of the week's largest stage. Decorative; the figure carries the value. */
function Bar({ part, whole }: { part: number; whole: number }) {
  const w = whole > 0 ? Math.round((part / whole) * 100) : 0;
  return (
    <span aria-hidden="true" className="mt-1 block h-1.5 w-full rounded-full bg-surface-2">
      <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${w}%`, marginInlineStart: 'auto' }} />
    </span>
  );
}
