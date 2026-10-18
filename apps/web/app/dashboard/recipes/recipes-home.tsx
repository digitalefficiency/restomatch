'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { AlertTriangle, ChefHat, Plus, Search, TrendingUp, Upload } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Select,
  Spinner,
  StatCard,
  Textarea,
  cn,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { UnitText as UnitTextSafe } from '@/lib/components/UnitText';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { originalProps } from '@/lib/i18n/original';
import { LIGHT_TONE, ils, ilsDelta, pct, priceText, type Light } from './recipe-ui';

type ListOutput = inferRouterOutputs<AppRouter>['recipes']['list'];
type Tab = 'dishes' | 'changes' | 'impact' | 'import' | 'pos';

export function RecipesHome({ initial, canSetTarget }: { initial: ListOutput; canSetTarget: boolean }) {
  const t = useT(recipesNs);
  const [tab, setTab] = useState<Tab>('dishes');
  const list = trpc.recipes.list.useQuery(undefined, { initialData: initial });
  const data = list.data ?? initial;
  // The POS tab exists only when the `integrations` flag is on as well.
  const posProbe = trpc.recipes.posVsTheory.useQuery({ month: 'current' }, { staleTime: 60_000 });
  const showPos = !!posProbe.data && posProbe.data.reason !== 'integrationsOff';
  const tabs: Tab[] = showPos ? ['dishes', 'changes', 'impact', 'pos', 'import'] : ['dishes', 'changes', 'impact', 'import'];

  return (
    <div className="space-y-6">
      <TargetBar targetBp={data.targetBp} canSetTarget={canSetTarget} />
      <Summary data={data} />
      <div role="tablist" aria-label={t('title')} className="flex gap-1 overflow-x-auto border-b border-line text-sm">
        {tabs.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              tab === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'dishes' ? <DishesTab data={data} /> : null}
        {tab === 'changes' ? <ChangesTab /> : null}
        {tab === 'impact' ? <ImpactTab /> : null}
        {tab === 'import' ? <ImportTab onDone={() => setTab('dishes')} /> : null}
        {tab === 'pos' && showPos ? <PosTab targetBp={data.targetBp} /> : null}
      </div>
    </div>
  );
}

function TargetBar({ targetBp, canSetTarget }: { targetBp: number; canSetTarget: boolean }) {
  const t = useT(recipesNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(targetBp / 100));
  const save = trpc.recipes.setTarget.useMutation({
    onSuccess: async () => {
      toast.success(t('target.saved'));
      setEditing(false);
      await utils.recipes.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">{t('target.label')}</span>
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value);
            if (Number.isFinite(n)) save.mutate({ targetPct: n });
          }}
        >
          <Input
            aria-label={t('target.label')}
            type="number"
            min={5}
            max={80}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-muted">%</span>
          <Button size="sm" type="submit" loading={save.isPending}>
            {t('target.save')}
          </Button>
        </form>
      ) : (
        <span className="text-lg font-bold tabular-nums text-ink">{pct(targetBp, locale)}</span>
      )}
      {canSetTarget && !editing ? (
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {t('target.edit')}
        </Button>
      ) : null}
      <span className="text-xs text-subtle">{canSetTarget ? t('target.hint') : t('target.readOnly')}</span>
    </Card>
  );
}

function Summary({ data }: { data: ListOutput }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const dishes = data.recipes.filter((r) => !r.isSubRecipe && r.active);
  const priced = dishes.filter((r) => r.foodCostBp != null);
  const avg = priced.length ? Math.round(priced.reduce((a, r) => a + r.foodCostBp!, 0) / priced.length) : null;
  const above = dishes.filter((r) => r.light === 'red' || r.light === 'amber').length;
  const incomplete = data.recipes.filter((r) => !r.complete).length;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label={t('summary.dishes')} value={formatNumber(dishes.length, locale)} />
      <StatCard
        label={t('summary.avgFoodCost')}
        value={pct(avg, locale)}
        tone={avg == null ? 'neutral' : avg <= data.targetBp ? 'primary' : 'warn'}
      />
      <StatCard label={t('summary.aboveTarget')} value={formatNumber(above, locale)} tone={above ? 'danger' : 'neutral'} />
      <StatCard label={t('summary.incomplete')} value={formatNumber(incomplete, locale)} tone={incomplete ? 'warn' : 'neutral'} />
    </div>
  );
}

function LightBadge({ light, bp }: { light: Light; bp: number | null }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  return (
    <Badge tone={LIGHT_TONE[light]}>
      <span className="tabular-nums">{bp == null ? t('list.light.none') : pct(bp, locale)}</span>
      <span className="sr-only"> · {t(`list.light.${light}`)}</span>
    </Badge>
  );
}

function Name({ name, nameEn }: { name: string; nameEn: string | null }) {
  const locale = useLocale();
  const d = displayName(name, nameEn, locale);
  return (
    <span>
      <span {...originalProps(d.secondary ? null : d.primary)}>{d.primary}</span>
      {d.secondary ? (
        <span className="ms-1.5 text-xs text-subtle" {...originalProps(d.secondary)}>
          {d.secondary}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "before → after" that reads correctly in RTL too: the pair is isolated LTR
 * (time flows left→right like the numbers) and each value is its own <bdi>, so
 * the RLM marks inside Hebrew ₪ strings cannot reorder the arrow or the sign.
 */
function Arrow({ from, to }: { from: string; to: string }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      <bdi>{from}</bdi> → <bdi>{to}</bdi>
    </bdi>
  );
}

function DishesTab({ data }: { data: ListOutput }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const [q, setQ] = useState('');
  const match = (r: ListOutput['recipes'][number]) =>
    !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.nameEn ?? '').toLowerCase().includes(q.toLowerCase());
  const dishes = data.recipes.filter((r) => !r.isSubRecipe && match(r));
  const subs = data.recipes.filter((r) => r.isSubRecipe && match(r));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} className="ps-9" />
        </div>
        <LinkButton href="/dashboard/recipes/new" size="sm">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('list.newDish')}
        </LinkButton>
        <LinkButton href="/dashboard/recipes/new?sub=1" size="sm" variant="secondary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('list.newSub')}
        </LinkButton>
      </div>

      {dishes.length === 0 ? (
        <EmptyState icon={<ChefHat className="h-6 w-6" />} title={t('list.empty')} />
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-subtle">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t('list.dish')}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold">{t('list.cost')}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold">{t('list.menuPrice')}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold">{t('list.foodCost')}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold">{t('list.margin')}</th>
              </tr>
            </thead>
            <tbody>
              {dishes.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/recipes/${r.id}`} className="font-medium text-ink hover:text-primary">
                      <Name name={r.name} nameEn={r.nameEn} />
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-subtle">
                      {r.category ? <span {...originalProps(r.category)}>{r.category}</span> : null}
                      {!r.active ? <Badge>{t('list.inactive')}</Badge> : null}
                      {!r.complete ? (
                        <span className="inline-flex items-center gap-1 text-warn">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {t('list.incomplete')}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{ils(r.portionCostAgorot, locale)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{ils(r.menuPriceAgorot, locale)}</td>
                  <td className="px-4 py-3 text-end">
                    <LightBadge light={r.light} bp={r.foodCostBp} />
                  </td>
                  <td className={cn('px-4 py-3 text-end font-semibold tabular-nums', (r.grossMarginAgorot ?? 0) < 0 && 'text-danger')}>
                    {ils(r.grossMarginAgorot, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted">{t('list.subRecipes')}</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-subtle">{t('list.emptySub')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {subs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/recipes/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-primary/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      <Name name={r.name} nameEn={r.nameEn} />
                    </span>
                    <span className="text-xs text-subtle">
                      {t('list.yields', { qty: formatNumber(Number(r.yieldQty), locale), unit: '' })}
                      <UnitTextSafe unit={r.yieldUnit} />
                    </span>
                  </span>
                  <span className="text-end text-sm tabular-nums">
                    <span className="block text-xs text-subtle">{t('list.subBatch')}</span>
                    {ils(r.batchCostAgorot, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChangesTab() {
  const t = useT(recipesNs);
  const locale = useLocale();
  const q = trpc.recipes.changes.useQuery();
  if (q.isLoading) return <Spinner />;
  if (!q.data) return null;
  const { rows, since } = q.data;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('changes.title')}</h2>
        <p className="text-sm text-muted">{t('changes.subtitle', { since: formatDate(since, locale) })}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<TrendingUp className="h-6 w-6" />} title={t('changes.empty')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.recipeId}>
              <Card padding="sm" className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="min-w-[10rem] flex-1">
                  <Link href={`/dashboard/recipes/${r.recipeId}`} className="font-semibold text-ink hover:text-primary">
                    <Name name={r.name} nameEn={r.nameEn} />
                  </Link>
                  {r.driver ? (
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="text-subtle">{t('changes.why')}: </span>
                      {r.driver.kind === 'product' && r.driver.priceBefore && r.driver.priceNow ? (
                        <>
                          <span {...originalProps(locale === 'en' && r.driver.nameEn ? null : r.driver.name)}>
                            {locale === 'en' && r.driver.nameEn ? r.driver.nameEn : r.driver.name}
                          </span>
                          {': '}
                          <Arrow from={priceText(r.driver.priceBefore, locale)} to={priceText(r.driver.priceNow, locale)} />{' '}
                          (<UnitTextSafe unit={r.driver.unit} />)
                        </>
                      ) : (
                        t('changes.driverSub', { name: locale === 'en' && r.driver.nameEn ? r.driver.nameEn : r.driver.name })
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="text-end text-sm tabular-nums">
                  <span className="block text-xs text-subtle">{t('changes.delta')}</span>
                  <bdi dir="ltr" className={cn('font-bold', r.costDeltaAgorot > 0 ? 'text-danger' : 'text-primary')}>
                    {ilsDelta(r.costDeltaAgorot, locale)}
                  </bdi>
                </div>
                {r.isSubRecipe ? null : (
                  <>
                    <div className="text-end text-sm">
                      <span className="block text-xs text-subtle">{t('changes.foodCost')}</span>
                      <Arrow from={pct(r.beforeFoodCostBp, locale)} to={pct(r.afterFoodCostBp, locale)} />
                    </div>
                    <Badge tone={LIGHT_TONE[r.afterLight]}>{t(`list.light.${r.afterLight}`)}</Badge>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImpactTab() {
  const t = useT(recipesNs);
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [change, setChange] = useState('12');
  const [run, setRun] = useState<{ productId: string; changePct: number } | null>(null);
  const products = trpc.recipes.searchProducts.useQuery({ search, limit: 50 }, { placeholderData: (p) => p });
  const impact = trpc.recipes.impact.useQuery(run ?? { productId: '00000000-0000-0000-0000-000000000000', changePct: 0 }, { enabled: !!run });
  const options = products.data ?? [];
  const changeNum = Number(change);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('impact.title')}</h2>
        <p className="text-sm text-muted">{t('impact.subtitle')}</p>
      </div>
      <Card padding="sm">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (productId && Number.isFinite(changeNum)) setRun({ productId, changePct: changeNum });
          }}
        >
          <Field label={t('editor.productSearch')} htmlFor="impact-search">
            <Input id="impact-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label={t('impact.product')} htmlFor="impact-product">
            <Select id="impact-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t('impact.pick')}</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {displayName(p.name, p.nameEn, locale).primary}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('impact.change')} htmlFor="impact-change">
            <Input id="impact-change" type="number" min={-90} max={500} step={0.5} value={change} onChange={(e) => setChange(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!productId}>
            {t('impact.run')}
          </Button>
        </form>
      </Card>
      {impact.isFetching ? <Spinner /> : null}
      {run && impact.data ? (
        <Card padding="md" flow>
          <p className="text-base font-semibold text-ink">
            {t('impact.headline', {
              product: displayName(impact.data.product.name, impact.data.product.nameEn, locale).primary,
              // LRI…PDI keeps the sign in front of the number inside a Hebrew sentence.
              change: `\u2066${impact.data.changeBp >= 0 ? '+' : '−'}${pct(Math.abs(impact.data.changeBp), locale)}\u2069`,
              count: formatNumber(impact.data.rows.length, locale),
            })}
          </p>
          {impact.data.product.unitPrice ? (
            <p className="mt-1 text-xs text-subtle">
              {t('impact.currentPrice', { price: priceText(impact.data.product.unitPrice, locale), unit: '' })}
              <UnitTextSafe unit={impact.data.product.unit} />
            </p>
          ) : null}
          {impact.data.rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('impact.none')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {impact.data.rows.map((r) => (
                <li key={r.recipeId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-medium text-ink">
                    <Name name={r.name} nameEn={r.nameEn} />
                  </span>
                  <span className="text-sm text-muted">
                    {r.beforeFoodCostBp != null ? (
                      <Arrow from={pct(r.beforeFoodCostBp, locale)} to={pct(r.afterFoodCostBp, locale)} />
                    ) : (
                      <Arrow from={ils(r.beforeCostAgorot, locale)} to={ils(r.afterCostAgorot, locale)} />
                    )}
                    {r.marginDeltaAgorot != null ? (
                      <bdi dir="ltr" className={cn('ms-3 font-semibold tabular-nums', r.marginDeltaAgorot < 0 ? 'text-danger' : 'text-primary')}>
                        {ilsDelta(r.marginDeltaAgorot, locale)}
                      </bdi>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function PosTab({ targetBp }: { targetBp: number }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const [month, setMonth] = useState<'current' | 'previous'>('current');
  const q = trpc.recipes.posVsTheory.useQuery({ month }, { placeholderData: (p) => p });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t('pos.title')}</h2>
          <p className="max-w-3xl text-sm text-muted">{t('pos.subtitle')}</p>
        </div>
        <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5 text-sm" role="group" aria-label={t('pos.title')}>
          {(['current', 'previous'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={month === m}
              onClick={() => setMonth(m)}
              className={cn('rounded-lg px-3 py-1.5', month === m ? 'bg-surface font-semibold text-ink' : 'text-muted hover:text-ink')}
            >
              {t(`pos.month.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {!d ? <Spinner /> : null}
      {d ? (
        <p className="text-xs text-subtle" dir="ltr">
          <bdi>{formatDate(d.from, locale)}</bdi> – <bdi>{formatDate(d.to, locale)}</bdi>
        </p>
      ) : null}
      {d && !d.available ? (
        <EmptyState icon={<TrendingUp className="h-6 w-6" />} title={t('pos.emptyNoData')} />
      ) : null}
      {d && d.available && d.rows.length === 0 ? (
        <EmptyState icon={<TrendingUp className="h-6 w-6" />} title={t('pos.emptyNoMatch')} />
      ) : null}
      {d && d.available && d.rows.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={t('pos.sales')} value={ils(d.totals.netSalesAgorot, locale, 0)} />
            <StatCard label={t('pos.mixCost')} value={ils(d.totals.theoreticalCostAgorot, locale, 0)} />
            <StatCard
              label={t('pos.actual')}
              value={pct(d.totals.foodCostBp, locale)}
              tone={d.totals.foodCostBp == null ? 'neutral' : d.totals.foodCostBp <= targetBp ? 'primary' : 'warn'}
            />
          </div>
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pos-table">
              <thead className="text-xs text-subtle">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 text-start font-semibold">{t('pos.dish')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.sold')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.avgPrice')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.menuFc')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.actualFc')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.gap')}</th>
                  <th scope="col" className="px-4 py-3 text-end font-semibold">{t('pos.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.recipeId} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/recipes/${r.recipeId}`} className="font-medium text-ink hover:text-primary">
                        <Name name={r.name} nameEn={r.nameEn} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{formatNumber(r.qtySold, locale)}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{r.avgNetPriceAgorot == null ? '—' : ils(r.avgNetPriceAgorot, locale)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{pct(r.menuFoodCostBp, locale)}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{r.actualFoodCostBp == null ? t('pos.noSales') : pct(r.actualFoodCostBp, locale)}</td>
                    <td className="px-4 py-3 text-end">
                      {r.gapBp == null ? (
                        '—'
                      ) : Math.abs(r.gapBp) < 5 ? (
                        // Under 0.05 points rounds to "0%": say "≈0" in a neutral tone, not an amber "+0%".
                        <Badge>≈0</Badge>
                      ) : (
                        <Badge tone={r.gapBp > 100 ? 'danger' : r.gapBp > 0 ? 'warning' : 'accent'}>
                          <bdi dir="ltr" className="tabular-nums">
                            {r.gapBp > 0 ? '+' : r.gapBp < 0 ? '−' : ''}
                            {pct(Math.abs(r.gapBp), locale)}
                          </bdi>
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{ils(r.theoreticalCostAgorot, locale, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {d.unmatchedCount > 0 ? (
            <p className="text-xs text-subtle">{t('pos.unmatched', { count: formatNumber(d.unmatchedCount, locale) })}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const EXAMPLE_CSV = [
  'recipe,ingredient,quantity,unit,waste_pct,menu_price,sub_recipe,yield_qty,yield_unit',
  'שניצל,חזה עוף,220,גרם,8,62,,,',
  'שניצל,קמח לבן,30,גרם,,,,,',
  'שניצל,שמן קנולה,60,מ״ל,,,,,',
].join('\n');

function ImportTab({ onDone }: { onDone: () => void }) {
  const t = useT(recipesNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [csv, setCsv] = useState('');
  const check = trpc.recipes.importCsv.useMutation({ onError: (e) => toast.error(friendlyError(e, tc)) });
  const commit = trpc.recipes.importCsv.useMutation({
    onSuccess: async (r) => {
      if (!r.ok) return;
      toast.success(t('import.done', { count: formatNumber(r.recipes.length, locale) }));
      setCsv('');
      check.reset();
      await utils.recipes.invalidate();
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const result = commit.data && !commit.data.ok ? commit.data : check.data;
  const canCommit = useMemo(() => !!check.data?.ok && check.variables?.csv === csv, [check.data, check.variables, csv]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('import.title')}</h2>
        <p className="text-sm text-muted">{t('import.subtitle')}</p>
        <p className="mt-1 text-xs text-subtle">{t('import.columns')}</p>
      </div>
      <Card padding="sm" className="space-y-3">
        <Field label={t('import.file')} htmlFor="csv-file">
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            className="block text-sm text-muted file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
            }}
          />
        </Field>
        <Field label={t('import.paste')} htmlFor="csv-text">
          <Textarea id="csv-text" rows={8} dir="auto" value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCsv(EXAMPLE_CSV)}>
            {t('import.example')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!csv.trim()} loading={check.isPending} onClick={() => check.mutate({ csv, dryRun: true })}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('import.check')}
          </Button>
          <Button size="sm" disabled={!canCommit} loading={commit.isPending} onClick={() => commit.mutate({ csv, dryRun: false })}>
            {t('import.commit', { count: formatNumber(check.data?.recipes.length ?? 0, locale) })}
          </Button>
        </div>
      </Card>
      {result ? (
        result.errors.length ? (
          <Card padding="sm" className="border-danger/40">
            <p className="mb-2 text-sm font-semibold text-danger">{t('import.errorsTitle')}</p>
            <ul className="space-y-1 text-sm text-muted">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {t('import.errorRow', {
                    row: formatNumber(e.row, locale),
                    message: t(`import.errors.${e.code}`, { value: e.value ?? '' }),
                  })}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card padding="sm">
            <p className="mb-2 text-sm font-semibold text-primary">{t('import.ok')}</p>
            <ul className="space-y-1 text-sm">
              {result.recipes.map((r) => (
                <li key={r.name} className="flex justify-between gap-3">
                  <span {...originalProps(r.name)}>{r.name}</span>
                  <span className="text-muted">
                    {t('import.lines', { count: formatNumber(r.lines, locale) })} ·{' '}
                    <Badge tone={r.action === 'create' ? 'accent' : 'warning'}>{t(`import.${r.action}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}
    </div>
  );
}
