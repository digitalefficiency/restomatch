'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { AlertTriangle, ArrowDown, ArrowUp, FlaskConical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  cn,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { UnitText } from '@/lib/components/UnitText';
import { translateUnit } from '@restomatch/translate/units';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { originalProps } from '@/lib/i18n/original';
import {
  LIGHT_TONE,
  agorotToInput,
  convertsTo,
  ils,
  pct,
  priceText,
  trimDecimal,
  unitOptions,
} from './recipe-ui';
import { PriceAlertLine } from './price-alert';
import { parseDecimalInput } from './decimal';
import { buildPreviewInput, type LineProblem } from './workbench';
import { useRecipePreview } from './use-recipe-preview';

type Detail = inferRouterOutputs<AppRouter>['recipes']['get'];
type Preview = inferRouterOutputs<AppRouter>['recipes']['preview'];
type LiveLine = Preview['lines'][number];

interface Line {
  key: string;
  productId: string | null;
  subRecipeId: string | null;
  name: string;
  nameEn: string | null;
  sourceUnit: string | null;
  unitPrice: string | null;
  quantity: string;
  unit: string;
  wastePct: string;
  unitsPerProductUnit: string;
  costAgorot?: number;
  status?: string;
}

const RECIPE_ERRORS = ['duplicateName', 'cycle', 'notSubRecipe', 'unitMismatch', 'inUse', 'notFound', 'productNotFound', 'subRecipeNotFound', 'tooLarge', 'importFailed'] as const;
let seq = 0;
const newKey = () => `l${++seq}`;

function fromDetail(d: Detail): Line[] {
  return d.items.map((it) => ({
    key: it.id,
    productId: it.productId,
    subRecipeId: it.subRecipeId,
    name: it.name,
    nameEn: it.nameEn,
    sourceUnit: it.sourceUnit,
    unitPrice: it.unitPrice,
    quantity: trimDecimal(it.quantity),
    unit: it.unit,
    wastePct: trimDecimal(it.wastePct),
    unitsPerProductUnit: trimDecimal(it.unitsPerProductUnit),
    costAgorot: it.costAgorot,
    status: it.status,
  }));
}

/** `readOnly` (owner decision I3, the bookkeeper): every input disabled, no save / trial / delete; the live numbers still show. */
export function RecipeEditor({ recipeId, startAsSub = false, readOnly = false }: { recipeId?: string; startAsSub?: boolean; readOnly?: boolean }) {
  const t = useT(recipesNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const detail = trpc.recipes.get.useQuery({ id: recipeId ?? '' }, { enabled: !!recipeId });
  const subs = trpc.recipes.subRecipes.useQuery();
  // Dish price alert (flag `dishPriceAlert`) for this dish, if any.
  const alertsQ = trpc.recipes.priceAlerts.useQuery(undefined, { enabled: !!recipeId, staleTime: 60_000 });
  const priceAlert = alertsQ.data?.enabled ? alertsQ.data.alerts.find((a) => a.recipeId === recipeId) : undefined;

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [category, setCategory] = useState('');
  const [isSub, setIsSub] = useState(startAsSub);
  const [yieldQty, setYieldQty] = useState(startAsSub ? '1' : '1');
  const [yieldUnit, setYieldUnit] = useState(startAsSub ? 'ק״ג' : 'מנה');
  const [menuPrice, setMenuPrice] = useState('');
  const [includesVat, setIncludesVat] = useState(true);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(!recipeId);
  // "נסה בלי לשמור": a trial of the draft — the preview runs, nothing can be saved.
  const [trial, setTrial] = useState(false);

  const loadFrom = (d: Detail) => {
    setName(d.recipe.name);
    setNameEn(d.recipe.nameEn ?? '');
    setCategory(d.recipe.category ?? '');
    setIsSub(d.recipe.isSubRecipe);
    setYieldQty(trimDecimal(d.recipe.yieldQty));
    setYieldUnit(d.recipe.yieldUnit);
    setMenuPrice(agorotToInput(d.recipe.menuPriceAgorot));
    setIncludesVat(d.recipe.menuPriceIncludesVat);
    setActive(d.recipe.active);
    setNotes(d.notes ?? '');
    setLines(fromDetail(d));
    setLoaded(true);
  };
  useEffect(() => {
    if (detail.data) loadFrom(detail.data);
  }, [detail.data]);

  const errorText = (e: unknown) => {
    const msg = (e as { message?: string })?.message ?? '';
    const code = RECIPE_ERRORS.find((c) => msg === `recipes.${c}`);
    return code ? t(`errors.${code}`) : friendlyError(e, tc);
  };

  const save = trpc.recipes.save.useMutation({
    onSuccess: async ({ id }) => {
      toast.success(t('editor.saved'));
      await utils.recipes.invalidate();
      if (!recipeId) router.replace(`/dashboard/recipes/${id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const del = trpc.recipes.delete.useMutation({
    onSuccess: async () => {
      toast.success(t('editor.deleted'));
      // Never refetch the deleted recipe (recipes.get → NOT_FOUND): drop it, refresh the lists.
      utils.recipes.get.setData({ id: recipeId ?? '' }, undefined);
      router.push('/dashboard/recipes');
      await Promise.all([utils.recipes.list.invalidate(), utils.recipes.changes.invalidate(), utils.recipes.subRecipes.invalidate()]);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const menuParsed = parseDecimalInput(menuPrice, 'ils');
  const menuAgorot = menuParsed.kind === 'ok' ? menuParsed.agorot : null;
  const invalidPrice = menuParsed.kind === 'invalid' || menuParsed.kind === 'ambiguous' || (menuAgorot ?? 0) > 10_000_000;
  /** A typed decimal ("1,5") in the API's dot form; anything else is sent as typed (the server rejects it). */
  const qtyText = (v: string) => {
    const p = parseDecimalInput(v, 'qty');
    return p.kind === 'ok' ? p.text : v.trim();
  };

  const built = useMemo(
    () => buildPreviewInput({ id: recipeId, name, isSub, yieldQty, yieldUnit, menuPrice, includesVat, lines }),
    [recipeId, name, isSub, yieldQty, yieldUnit, menuPrice, includesVat, lines],
  );
  const preview = useRecipePreview(loaded ? built.input : null);
  const live = preview.data;
  const liveByKey = useMemo(() => {
    const m = new Map<string, LiveLine>();
    if (live) built.keys.forEach((k, i) => live.lines[i] && m.set(k, live.lines[i]!));
    return m;
  }, [live, built.keys]);

  const submit = () => {
    if (trial || readOnly) return;
    save.mutate({
      id: recipeId,
      name: name.trim(),
      nameEn: nameEn.trim() || null,
      category: category.trim() || null,
      isSubRecipe: isSub,
      yieldQty: qtyText(yieldQty) || '1',
      yieldUnit: yieldUnit.trim() || 'מנה',
      menuPriceAgorot: isSub || menuAgorot == null ? null : menuAgorot,
      menuPriceIncludesVat: includesVat,
      active,
      notes: notes.trim() || null,
      items: lines.map((l) => ({
        productId: l.productId,
        subRecipeId: l.subRecipeId,
        quantity: qtyText(l.quantity),
        unit: l.unit,
        wastePct: Number(qtyText(l.wastePct || '0')),
        unitsPerProductUnit: qtyText(l.unitsPerProductUnit) || null,
      })),
    });
  };

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch, costAgorot: undefined, status: undefined } : l)));
  const move = (i: number, d: -1 | 1) =>
    setLines((ls) => {
      const j = i + d;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const r = detail.data?.recipe;
  const availableSubs = (subs.data ?? []).filter((s) => s.id !== recipeId);

  if (!loaded) return <p className="text-sm text-muted">…</p>;

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_18rem]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-6">
        {priceAlert && alertsQ.data?.enabled ? (
          <div>
            <p className="mb-1 text-xs text-subtle">{t('alert.banner')}</p>
            <PriceAlertLine alert={priceAlert} targetBp={alertsQ.data.targetBp} />
          </div>
        ) : null}
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label={t('editor.name')} htmlFor="r-name">
            <Input id="r-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
          </Field>
          <Field label={t('editor.nameEn')} htmlFor="r-name-en">
            <Input id="r-name-en" maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('editor.category')} htmlFor="r-cat">
            <Input id="r-cat" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} dir="auto" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('editor.yieldQty')} htmlFor="r-yield" hint={t('editor.yieldHint')}>
              <Input id="r-yield" inputMode="decimal" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </Field>
            <Field label={t('editor.yieldUnit')} htmlFor="r-yield-unit">
              <Select id="r-yield-unit" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)}>
                {['מנה', 'ק״ג', 'גרם', 'ליטר', 'מ״ל', 'יח׳'].concat(['מנה', 'ק״ג', 'גרם', 'ליטר', 'מ״ל', 'יח׳'].includes(yieldUnit) ? [] : [yieldUnit]).map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u, locale, t('units.portion'))}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
            <input type="checkbox" checked={isSub} onChange={(e) => setIsSub(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t('editor.isSub')}
          </label>
          {!isSub ? (
            <>
              <Field label={t('editor.menuPrice')} htmlFor="r-price">
                <Input
                  id="r-price"
                  inputMode="decimal"
                  value={menuPrice}
                  onChange={(e) => setMenuPrice(e.target.value)}
                  aria-invalid={invalidPrice || undefined}
                  className={cn(invalidPrice && 'border-danger')}
                />
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1 text-sm text-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includesVat} onChange={(e) => setIncludesVat(e.target.checked)} className="h-4 w-4 accent-primary" />
                  {t('editor.includesVat')}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-primary" />
                  {t('editor.active')}
                </label>
              </div>
            </>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-ink">{t('editor.ingredients')}</h2>
          {lines.length === 0 ? <p className="mb-4 text-sm text-subtle">{t('editor.noItems')}</p> : null}
          <ul className="space-y-3">
            {lines.map((l, i) => (
              <LineRow
                key={l.key}
                line={l}
                live={liveByKey.get(l.key)}
                problem={built.problems.get(l.key)}
                first={i === 0}
                last={i === lines.length - 1}
                onChange={(patch) => update(l.key, patch)}
                onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                onMove={(d) => move(i, d)}
              />
            ))}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ProductPicker
              onPick={(p) =>
                setLines((ls) => [
                  ...ls,
                  {
                    key: newKey(),
                    productId: p.id,
                    subRecipeId: null,
                    name: p.name,
                    nameEn: p.nameEn,
                    sourceUnit: p.unit,
                    unitPrice: p.unitPrice,
                    quantity: '',
                    unit: unitOptions(p.unit)[0]!,
                    wastePct: '0',
                    unitsPerProductUnit: '',
                  },
                ])
              }
            />
            {availableSubs.length ? (
              <Field label={t('editor.addSub')} htmlFor="r-add-sub">
                <Select
                  id="r-add-sub"
                  value=""
                  onChange={(e) => {
                    const s = availableSubs.find((x) => x.id === e.target.value);
                    if (!s) return;
                    setLines((ls) => [
                      ...ls,
                      {
                        key: newKey(),
                        productId: null,
                        subRecipeId: s.id,
                        name: s.name,
                        nameEn: s.nameEn,
                        sourceUnit: s.yieldUnit,
                        unitPrice: null,
                        quantity: '',
                        unit: unitOptions(s.yieldUnit)[0]!,
                        wastePct: '0',
                        unitsPerProductUnit: '',
                      },
                    ]);
                  }}
                >
                  <option value="">{t('editor.subPick')}</option>
                  {availableSubs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {displayName(s.name, s.nameEn, locale).primary}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        </Card>

        <Field label={t('editor.notes')} htmlFor="r-notes">
          <Textarea id="r-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
        </Field>
        <PhoneSummary isSub={isSub} live={live} saved={r} pending={preview.pending} />
      </fieldset>

      <aside className="space-y-4 lg:sticky lg:top-36 lg:self-start">
        <Card flow className="space-y-3" data-testid="recipe-live">
          <LiveSummary isSub={isSub} live={live} saved={r} pending={preview.pending} error={preview.error} />
          {readOnly ? (
            <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted" data-testid="recipe-readonly">
              {t('workbench.readOnly')}
            </p>
          ) : trial ? (
            <>
              <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted" role="status">
                {t('workbench.sandbox.on')}
              </p>
              {recipeId && detail.data ? (
                <Button type="button" variant="secondary" className="w-full" onClick={() => loadFrom(detail.data!)}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t('workbench.sandbox.reset')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  if (detail.data) loadFrom(detail.data);
                  setTrial(false);
                }}
              >
                {t('workbench.sandbox.exit')}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" className="w-full" loading={save.isPending} disabled={!name.trim() || invalidPrice}>
                {t('editor.save')}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setTrial(true)} data-testid="recipe-trial">
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                {t('workbench.sandbox.toggle')}
              </Button>
              {recipeId ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-danger"
                  loading={del.isPending}
                  onClick={() => {
                    if (window.confirm(t('editor.deleteConfirm', { name }))) del.mutate({ id: recipeId });
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('editor.delete')}
                </Button>
              ) : null}
            </>
          )}
        </Card>
      </aside>
    </form>
  );
}

type Saved = Detail['recipe'] | undefined;

/** The live numbers: the preview of the draft, else the saved recipe. */
function current(live: Preview | undefined, saved: Saved) {
  if (live) return live;
  if (!saved) return null;
  return {
    batchCostAgorot: saved.batchCostAgorot,
    portionCostAgorot: saved.portionCostAgorot,
    netMenuPriceAgorot: saved.netMenuPriceAgorot,
    foodCostBp: saved.foodCostBp,
    grossMarginAgorot: saved.grossMarginAgorot,
    targetBp: null,
    gapToTargetBp: null,
    light: saved.light,
    complete: saved.complete,
    lines: [] as LiveLine[],
  };
}

function LiveSummary({ isSub, live, saved, pending, error }: { isSub: boolean; live: Preview | undefined; saved: Saved; pending: boolean; error: boolean }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const v = current(live, saved);
  if (!v) return <p className="text-sm text-subtle">{pending ? t('workbench.updating') : t('editor.preview')}</p>;
  const missing = v.lines.filter((l) => l.status !== 'ok').length;
  const gap = v.gapToTargetBp;
  const target = v.targetBp;
  return (
    <div className="space-y-3">
      <div aria-live="polite" aria-atomic="true">
        <Stat label={isSub ? t('workbench.liveBatch') : t('workbench.live')} value={ils(isSub ? v.batchCostAgorot : v.portionCostAgorot, locale)} big />
      </div>
      {!isSub ? (
        <>
          <Stat label={t('editor.netPrice')} value={ils(v.netMenuPriceAgorot, locale)} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">{t('editor.foodCost')}</span>
            <Badge tone={LIGHT_TONE[v.light]}>{v.foodCostBp == null ? t('list.light.none') : pct(v.foodCostBp, locale)}</Badge>
          </div>
          {v.netMenuPriceAgorot == null ? (
            <p className="text-xs text-subtle">{t('workbench.noMenuPrice')}</p>
          ) : gap != null && target != null ? (
            <p className={cn('text-xs', gap > 0 ? 'text-warn' : 'text-muted')} data-testid="recipe-gap">
              {gap > 0
                ? t('workbench.gapAbove', { gap: pct(gap, locale), target: pct(target, locale) })
                : gap < 0
                  ? t('workbench.gapBelow', { gap: pct(-gap, locale), target: pct(target, locale) })
                  : t('workbench.gapOn', { target: pct(target, locale) })}
            </p>
          ) : null}
          <Stat label={t('editor.margin')} value={ils(v.grossMarginAgorot, locale)} />
        </>
      ) : null}
      {missing ? <p className="text-xs text-warn">{t('workbench.partial', { count: missing })}</p> : null}
      {error ? (
        <p className="text-xs text-muted" role="status">
          {t('workbench.previewError')}
        </p>
      ) : pending ? (
        <p className="text-xs text-subtle">{live ? t('workbench.stale') : t('workbench.updating')}</p>
      ) : null}
    </div>
  );
}

/** Phone only: the plate cost and food % stay in view while the chef scrolls the ingredients. */
function PhoneSummary({ isSub, live, saved, pending }: { isSub: boolean; live: Preview | undefined; saved: Saved; pending: boolean }) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const v = current(live, saved);
  if (!v) return null;
  return (
    <div
      className="sticky bottom-20 z-30 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-card backdrop-blur lg:hidden"
      data-testid="recipe-live-phone"
      aria-hidden="true"
    >
      <span className="text-sm text-muted">{isSub ? t('workbench.liveBatch') : t('workbench.live')}</span>
      <span className="flex items-center gap-2">
        <span className={cn('text-lg font-bold tabular-nums text-ink', pending && 'opacity-70')}>
          {ils(isSub ? v.batchCostAgorot : v.portionCostAgorot, locale)}
        </span>
        {!isSub && v.foodCostBp != null ? <Badge tone={LIGHT_TONE[v.light]}>{pct(v.foodCostBp, locale)}</Badge> : null}
      </span>
    </div>
  );
}

function unitLabel(u: string, locale: string, portion: string): string {
  if (u === 'מנה') return portion;
  return locale === 'he' ? u : (translateUnit(u) ?? u);
}

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted">{label}</span>
      <span className={cn('tabular-nums text-ink', big ? 'text-2xl font-bold' : 'font-semibold')}>{value}</span>
    </div>
  );
}

function LineRow({
  line: l,
  live,
  problem,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  line: Line;
  live?: LiveLine;
  problem?: LineProblem;
  first: boolean;
  last: boolean;
  onChange: (p: Partial<Line>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const d = displayName(l.name, l.nameEn, locale);
  const needsBridge = !convertsTo(l.unit, l.sourceUnit);
  const opts = unitOptions(l.sourceUnit);
  if (!opts.includes(l.unit)) opts.push(l.unit);
  const id = `line-${l.key}`;
  // The live preview wins over the last saved cost (it is the draft on screen).
  const costAgorot = live ? live.costAgorot : l.costAgorot;
  const status = live ? live.status : l.status;
  const qtyError = problem
    ? problem.kind === 'ambiguous'
      ? t('workbench.qtyAmbiguous', { raw: problem.raw })
      : t('workbench.qtyInvalid')
    : undefined;
  return (
    <li className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-ink" {...originalProps(d.secondary ? null : d.primary)}>
            {d.primary}
          </span>
          {l.subRecipeId ? <Badge className="ms-2">{t('list.subRecipes').split(' ')[0]}</Badge> : null}
          <p className="text-xs text-subtle">
            {l.productId ? (
              l.unitPrice ? (
                <>
                  {t('editor.price', { price: priceText(l.unitPrice, locale), unit: '' })}
                  <UnitText unit={l.sourceUnit} />
                </>
              ) : (
                <span className="text-warn">{t('editor.noPrice')}</span>
              )
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {costAgorot !== undefined && !problem ? (
            <span className="me-2 text-sm font-semibold tabular-nums text-ink" data-testid="line-cost">
              {ils(costAgorot, locale)}
            </span>
          ) : null}
          {status && status !== 'ok' && !problem ? (
            <Badge tone="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
              {t(`editor.status.${status as 'missingPrice'}`)}
            </Badge>
          ) : null}
          <Button type="button" size="sm" variant="ghost" disabled={first} onClick={() => onMove(-1)} aria-label={t('editor.moveUp')}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={last} onClick={() => onMove(1)} aria-label={t('editor.moveDown')}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label={t('editor.remove')}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('editor.qty')} htmlFor={`${id}-q`} error={qtyError}>
          <Input id={`${id}-q`} required inputMode="decimal" value={l.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
        </Field>
        <Field label={t('editor.unit')} htmlFor={`${id}-u`}>
          <Select id={`${id}-u`} value={l.unit} onChange={(e) => onChange({ unit: e.target.value })}>
            {opts.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u, locale, t('units.portion'))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('editor.waste')} htmlFor={`${id}-w`}>
          <Input id={`${id}-w`} inputMode="decimal" value={l.wastePct} onChange={(e) => onChange({ wastePct: e.target.value })} title={t('editor.wasteHint')} />
        </Field>
      </div>
      {live && live.shareBp > 0 ? (
        <div className="mt-2 flex items-center gap-2" data-testid="line-share">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-full bg-primary/60" style={{ width: `${live.shareBp / 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted">{t('workbench.shareOf', { pct: pct(live.shareBp, locale) })}</span>
        </div>
      ) : null}
      {needsBridge ? (
        <Field
          className="mt-2"
          label={t('editor.bridge', { unit: unitLabel(l.unit, locale, t('units.portion')), productUnit: unitLabel(l.sourceUnit ?? '', locale, t('units.portion')) })}
          htmlFor={`${id}-b`}
          hint={t('editor.bridgeHint', { unit: unitLabel(l.unit, locale, t('units.portion')), productUnit: unitLabel(l.sourceUnit ?? '', locale, t('units.portion')) })}
        >
          <Input id={`${id}-b`} required inputMode="decimal" value={l.unitsPerProductUnit} onChange={(e) => onChange({ unitsPerProductUnit: e.target.value })} className="max-w-[10rem]" />
        </Field>
      ) : null}
    </li>
  );
}

function ProductPicker({
  onPick,
}: {
  onPick: (p: { id: string; name: string; nameEn: string | null; unit: string | null; unitPrice: string | null }) => void;
}) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const [raw, setRaw] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setSearch(raw.trim()), 200);
    return () => clearTimeout(h);
  }, [raw]);
  const q = trpc.recipes.searchProducts.useQuery({ search, limit: 12 }, { enabled: open, placeholderData: (p) => p });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  return (
    <div className="relative">
      <Field label={t('editor.addProduct')} htmlFor="r-add-product">
        <div className="relative">
          <Plus className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input
            id="r-add-product"
            role="combobox"
            aria-expanded={open}
            aria-controls="r-add-product-list"
            autoComplete="off"
            placeholder={t('editor.productSearch')}
            value={raw}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setRaw(e.target.value)}
            className="ps-9"
          />
        </div>
      </Field>
      {open ? (
        <ul
          id="r-add-product-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
        >
          {rows.length === 0 ? <li className="px-3 py-2 text-sm text-subtle">{t('editor.noResults')}</li> : null}
          {rows.map((p) => {
            const d = displayName(p.name, p.nameEn, locale);
            return (
              <li key={p.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(p);
                    setRaw('');
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">
                    <span {...originalProps(d.secondary ? null : d.primary)}>{d.primary}</span>
                    {d.secondary ? <span className="ms-1.5 text-xs text-subtle">{d.secondary}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {p.unitPrice ? (
                      <>
                        {priceText(p.unitPrice, locale)} / <UnitText unit={p.unit} />
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
