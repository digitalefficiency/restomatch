import Link from 'next/link';
import { TRPCError } from '@trpc/server';
import { Network, X } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { originalProps } from '@/lib/i18n/original';
import type { Locale } from '@/lib/i18n/config';
import { chain } from '@/lib/i18n/messages/chain';
import { Badge, Card, EmptyState, EntitlementUpsell, SectionHeader, cn, entitlementCauseOf, type BadgeTone } from '@/lib/components';
import { ViewToolbar, parseView, rangeLabel } from '@/lib/components/views';
import { SwitchBranchButton } from '../switch-button';
import { wholeShekelRows } from '../display';
import { DrillLink } from './drill';

/**
 * W3-01 · "כל הסניפים": the roll-up matrix. One row per branch in the URL
 * scope `b=all|<id>|g:<group>`, a pinned total row (= the chain KPIs), every
 * cell opening the 520 px branch peek (`peek=<id>`) by soft navigation — no
 * reload. Numbers come from `chain.matrix` / `chain.branchPeek` (each branch
 * under its own RLS); this page only formats.
 */

type Caller = Awaited<ReturnType<typeof createServerCaller>>;
type Matrix = Awaited<ReturnType<Caller['chain']['matrix']>>;
type Peek = Awaited<ReturnType<Caller['chain']['branchPeek']>>;
type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The current URL with `changes` applied (null drops a key). */
function hrefWith(sp: SP, changes: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s !== undefined && !(k in changes)) q.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null) q.set(k, v);
  const qs = q.toString();
  return `/dashboard/chain/matrix${qs ? `?${qs}` : ''}`;
}

function monthLabel(month: string, locale: Locale): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return formatDate(new Date(Date.UTC(y, m - 1, 15, 12)), locale, { month: 'short', year: '2-digit' });
}

/** Leak share of spend → a calm-to-warm tint (text ≥4.5:1 on every tint; same bands as the chain heatmap). */
function heatClass(pct: number | null, leak: number): string {
  if (pct === null) return leak > 0 ? 'bg-warn/30 text-ink' : 'bg-surface-2 text-subtle';
  if (pct <= 0) return 'bg-primary/10 text-primary';
  if (pct < 0.015) return 'bg-gold/20 text-gold';
  if (pct < 0.03) return 'bg-warn/30 text-ink';
  return 'bg-danger/30 text-ink';
}

const STATE_TONE: Record<'no_data' | 'pending' | 'clean' | 'leak', BadgeTone> = {
  no_data: 'neutral', // T4
  pending: 'neutral', // T4: waiting, never a false alarm
  clean: 'accent', // T3 calm
  leak: 'warning',
};

export default async function ChainMatrixPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [caller, t, locale, sp] = await Promise.all([createServerCaller(), getT(chain), getLocale(), searchParams]);
  const view = parseView(sp);
  const viewInput = { period: view.period, ...(view.period === 'custom' ? { from: view.from, to: view.to } : {}) };
  const scopeRaw = one(sp.b);
  const peekId = one(sp.peek);

  let data: Matrix | null = null;
  let blocked: 'entitlement' | 'role' | 'notFound' | null = null;
  try {
    data = await caller.chain.matrix({ view: viewInput, compare: view.compare, scope: scopeRaw });
  } catch (err) {
    if (entitlementCauseOf(err)) blocked = 'entitlement';
    else if (err instanceof TRPCError && err.code === 'FORBIDDEN') blocked = 'role';
    else if (err instanceof TRPCError && err.code === 'NOT_FOUND') blocked = 'notFound';
    else throw err;
  }

  if (!data) {
    return (
      <div>
        <SectionHeader level={1} title={t('matrix.title')} subtitle={t('matrix.subtitle')} />
        {blocked === 'entitlement' ? (
          <EntitlementUpsell feature="chain" title={t('dashboard.upsell')} />
        ) : blocked === 'notFound' ? (
          <EmptyState
            icon={<Network className="h-6 w-6" />}
            title={t('errors.notFound')}
            action={
              <Link href={hrefWith(sp, { b: null, peek: null })} className="font-semibold text-primary hover:text-ink">
                {t('matrix.scopeAll')}
              </Link>
            }
          />
        ) : (
          <EmptyState icon={<Network className="h-6 w-6" />} title={t('dashboard.ownerOnly')} description={t('dashboard.ownerOnlyBody')} />
        )}
      </div>
    );
  }

  let peek: Peek | null = null;
  if (peekId) {
    peek = await caller.chain.branchPeek({ restaurantId: peekId, view: viewInput }).catch(() => null);
  }

  const ils = (v: number) => formatIls(v, { locale });
  const pct = (v: number | null) => (v === null ? '—' : formatPercent(v, locale, 1));
  const compared = data.compare !== 'off';
  const ok = data.branches.filter((b) => b.status === 'ok');
  // Display only: each row rounded like its own dashboard; the printed total is their sum (= the chain KPIs).
  const leakShown = wholeShekelRows(ok.map((b) => b.leakIls));
  const leakRow = new Map(ok.map((b, i) => [b.restaurantId, leakShown.rows[i]!]));
  const newestFirst = [...data.months].reverse(); // RTL: the newest month sits next to the names
  const { totals } = data;
  const activeId = data.pool.find((b) => b.isActive)?.restaurantId ?? null;
  const periodLabel = data.periodStart && data.periodEnd ? rangeLabel(view.period, data.periodStart, data.periodEnd, locale) : '';
  const peekHref = (id: string) => hrefWith(sp, { peek: id });
  const money = (v: number | null) => (v === null ? <span className="text-subtle">{t('matrix.recoveryOff')}</span> : ils(v));
  const cellCls = 'px-3 py-2 text-end font-mono tabular-nums';

  return (
    <div className={cn(peek && 'lg:pe-[540px]')}>
      <SectionHeader
        level={1}
        title={t('matrix.title')}
        subtitle={
          <>
            {t('matrix.subtitle')}{' '}
            <Link href="/dashboard/chain" className="font-semibold text-primary hover:text-ink" data-testid="matrix-back">
              {t('matrix.back')}
            </Link>
          </>
        }
      />
      <ViewToolbar page="chain" view={view} period compare saved={false} />

      {/* Scope chips: the URL is the source of truth, a click is a soft navigation (no reload). */}
      <nav aria-label={t('matrix.scopeLabel')} className="mb-4 flex flex-wrap gap-2" data-testid="matrix-scope">
        {[{ key: 'all', label: t('matrix.scopeAll'), href: hrefWith(sp, { b: null, peek: null }), on: data.scope.kind === 'all' }, ...data.pool.map((b) => ({
          key: b.restaurantId,
          label: b.name,
          href: hrefWith(sp, { b: b.restaurantId, peek: null }),
          on: data.scope.kind === 'branch' && data.scope.restaurantId === b.restaurantId,
        }))].map((c) => (
          <DrillLink
            key={c.key}
            href={c.href}
            aria-current={c.on ? 'true' : undefined}
            className={cn(
              'rounded-full px-3 py-1 text-sm ring-1',
              c.on ? 'bg-info/12 text-ink ring-info/40 font-semibold' : 'bg-surface text-muted ring-line hover:text-ink',
            )}
          >
            {c.label}
          </DrillLink>
        ))}
      </nav>

      <p className="mb-3 text-xs text-subtle" data-testid="matrix-period">
        {periodLabel}
      </p>
      {data.truncated ? <p className="mb-3 text-xs text-warn">{t('dashboard.truncated', { count: formatNumber(data.branches.length, locale) })}</p> : null}
      {totals.partial ? (
        <p role="status" className="mb-3 rounded-lg bg-warn/12 px-3 py-2 text-sm text-ink ring-1 ring-warn/25" data-testid="matrix-partial">
          {t('matrix.partial')}
        </p>
      ) : null}

      <Card padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm" data-testid="matrix-table">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs text-subtle">
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t('matrix.cols.branch')}</th>
              {newestFirst.map((m) => (
                <th key={m} scope="col" className="px-1 py-2 text-center font-semibold">{monthLabel(m, locale)}</th>
              ))}
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t('matrix.cols.state')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.leak')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.leakPct')}</th>
              {compared ? <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.delta')}</th> : null}
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.awaiting')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.openCredit')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.recovered')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('matrix.cols.completeness')}</th>
            </tr>
            {/* Pinned total row = the chain KPIs. */}
            <tr className="border-b-2 border-line bg-surface-2 font-semibold text-ink" data-testid="matrix-total">
              <th scope="row" className="px-3 py-2 text-start">{t('matrix.total')}</th>
              {newestFirst.map((m) => (
                <td key={m} />
              ))}
              <td />
              <td className={cellCls} data-testid="matrix-total-leak">{ils(leakShown.total)}</td>
              <td className={cellCls}>{pct(totals.leakPct)}</td>
              {compared ? <td className={cellCls}>{totals.prevLeakIls === null ? '—' : ils(totals.leakIls - totals.prevLeakIls)}</td> : null}
              <td className={cellCls} data-testid="matrix-total-awaiting">{ils(totals.awaitingIls)}</td>
              <td className={cellCls}>{money(totals.openCreditIls)}</td>
              <td className={cellCls}>{money(totals.recoveredIls)}</td>
              <td className={cellCls}>{pct(totals.completeness)}</td>
            </tr>
          </thead>
          <tbody>
            {data.branches.map((b) =>
              b.status === 'error' ? (
                <tr key={b.restaurantId} className="border-b border-line" data-testid="matrix-row-error">
                  <th scope="row" className="px-3 py-2 text-start font-semibold text-ink" {...originalProps(b.name)}>
                    {b.name}
                  </th>
                  <td colSpan={newestFirst.length + (compared ? 8 : 7)} className="px-3 py-2">
                    <span role="status" className="block rounded-lg bg-warn/12 px-3 py-2 text-ink ring-1 ring-warn/25">
                      {t('matrix.branchError', { name: b.name })}
                    </span>
                  </td>
                </tr>
              ) : (
                <tr
                  key={b.restaurantId}
                  className={cn('border-b border-line', peek?.restaurantId === b.restaurantId && 'bg-info/12')}
                  data-testid="matrix-row"
                  data-branch={b.restaurantId}
                >
                  <th scope="row" className="max-w-[16rem] whitespace-normal break-words px-3 py-2 text-start font-semibold text-ink">
                    <DrillLink href={peekHref(b.restaurantId)} className="hover:text-primary" {...originalProps(b.name)}>
                      {b.name}
                    </DrillLink>
                  </th>
                  {newestFirst.map((m) => {
                    const c = b.trend.find((p) => p.month === m);
                    return (
                      <td key={m} className="px-0.5 py-1">
                        <DrillLink
                          href={peekHref(b.restaurantId)}
                          title={c ? `${monthLabel(m, locale)} · ${ils(c.leakIls)}` : monthLabel(m, locale)}
                          className={cn('block rounded px-1 py-1 text-center text-xs tabular-nums', heatClass(c?.leakPct ?? null, c?.leakIls ?? 0))}
                        >
                          {c && c.leakPct !== null ? formatPercent(c.leakPct, locale, 1) : '—'}
                        </DrillLink>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <Badge tone={STATE_TONE[b.state]}>{t(`matrix.state.${b.state}`)}</Badge>
                  </td>
                  <td className={cellCls}>
                    <DrillLink href={peekHref(b.restaurantId)} className="hover:text-primary" data-testid="matrix-leak">
                      {(() => {
                        const v = leakRow.get(b.restaurantId);
                        return v === undefined ? <span className="text-subtle">—</span> : ils(v);
                      })()}
                    </DrillLink>
                  </td>
                  <td className={cellCls}>{pct(b.leakPct)}</td>
                  {compared ? (
                    <td className={cellCls}>{b.leakDeltaIls === null ? '—' : ils(b.leakDeltaIls)}</td>
                  ) : null}
                  <td className={cellCls}>
                    <DrillLink href={peekHref(b.restaurantId)} className="hover:text-primary">
                      {ils(b.awaitingIls)}
                    </DrillLink>
                  </td>
                  <td className={cellCls}>{money(b.openCreditIls)}</td>
                  <td className={cellCls}>{money(b.recoveredIls)}</td>
                  <td className={cellCls}>{pct(b.completeness)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </Card>

      {peek ? (
        <aside
          aria-label={t('matrix.peek.title', { name: peek.name })}
          className="mt-6 w-full rounded-2xl bg-surface p-4 shadow-lg ring-1 ring-line lg:fixed lg:end-4 lg:top-20 lg:mt-0 lg:max-h-[calc(100vh-6rem)] lg:w-[520px] lg:overflow-y-auto"
          data-testid="matrix-peek"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-base font-bold text-ink" {...originalProps(peek.name)}>
              {t('matrix.peek.title', { name: peek.name })}
            </h2>
            <DrillLink href={hrefWith(sp, { peek: null })} aria-label={t('matrix.peek.close')} className="rounded p-1 text-muted hover:text-ink">
              <X className="h-4 w-4" aria-hidden="true" />
            </DrillLink>
          </div>
          <p className="mb-4 text-sm text-muted">
            <span className="font-mono font-semibold tabular-nums text-ink">{ils(peek.leakIls)}</span> · {pct(peek.leakPct)}
          </p>
          <h3 className="mb-2 text-xs font-semibold text-subtle">{t('matrix.peek.biggest')}</h3>
          {peek.biggestInvoices.length === 0 ? (
            <p className="mb-4 text-sm text-muted">{t('matrix.peek.none')}</p>
          ) : (
            <ul className="mb-4 space-y-2" data-testid="matrix-peek-invoices">
              {peek.biggestInvoices.map((inv) => (
                <li key={inv.invoiceId} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="min-w-0 break-words text-ink">
                    {(locale === 'en' ? inv.supplierNameEn : null) ?? inv.supplierName ?? '—'}
                    {inv.invoiceNumber ? <span className="text-subtle"> · {inv.invoiceNumber}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-mono tabular-nums text-ink">{ils(inv.leakIls)}</span>
                    {peek.restaurantId === activeId ? (
                      <DrillLink href={`/dashboard/invoices/${inv.invoiceId}`} className="font-semibold text-primary hover:text-ink" data-testid="matrix-peek-open">
                        {t('matrix.peek.openInvoice')}
                      </DrillLink>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {peek.restaurantId !== activeId && peek.biggestInvoices[0] ? (
            <SwitchBranchButton
              restaurantId={peek.restaurantId}
              branchName={peek.name}
              then={`/dashboard/invoices/${peek.biggestInvoices[0].invoiceId}`}
              label={t('matrix.peek.switchFirst')}
              testId="matrix-peek-switch"
            />
          ) : null}
          {peek.topSuppliers.length > 0 ? (
            <>
              <h3 className="mb-2 mt-4 text-xs font-semibold text-subtle">{t('matrix.peek.topSuppliers')}</h3>
              <ul className="space-y-1 text-sm">
                {peek.topSuppliers.map((s) => (
                  <li key={s.supplierId ?? s.name ?? ''} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words text-ink">{(locale === 'en' ? s.nameEn : null) ?? s.name ?? '—'}</span>
                    <span className="font-mono tabular-nums text-ink">{ils(s.leakIls)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
