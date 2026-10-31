'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bookmark,
  CalendarRange,
  ChevronDown,
  Download,
  Filter,
  GitCompareArrows,
  Layers,
  LineChart,
  Maximize2,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  X,
  Rows4,
  Table2,
  Trash2,
} from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { views } from '@/lib/i18n/messages/views';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { MessageKey } from '@/lib/i18n/translate';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import { cn } from '../cn';
import { downloadCsv, type CsvColumn, type CsvRow } from './csv';
import { deleteSavedView, listSavedViews, saveView, type SavedView } from './savedViews';
import {
  CHARTS,
  COMPARES,
  DEFAULT_VIEW,
  DENSITIES,
  DISCREPANCY_TYPES,
  GROUPS,
  PERIODS,
  SEVERITIES,
  STATUSES,
  hasFilters,
  serializeView,
  type ViewFilters,
  type ViewState,
} from './state';

export type FilterName = 'supplier' | 'category' | 'type' | 'severity' | 'status';

export interface ViewToolbarProps {
  /** Saved-views + CSV namespace, e.g. 'overview', 'leaks', 'approvals'. */
  page: string;
  /** The server-parsed view (the URL is the source of truth). */
  view: ViewState;
  period?: boolean;
  compare?: boolean;
  group?: boolean;
  chart?: boolean;
  density?: boolean;
  tv?: boolean;
  saved?: boolean;
  filters?: FilterName[];
  /** Severities offered (approvals also has `info`). */
  severities?: readonly string[];
  /** Filter options (owner.viewOptions). */
  options?: { suppliers: { id: string; name: string; nameEn: string | null }[]; categories: string[] };
  /** The current view's rows for CSV export (omit to hide the button). */
  exportData?: { columns: CsvColumn[]; rows: CsvRow[] };
}

const chip =
  'inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-primary/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';
const selectCls =
  'rounded-xl border border-line-strong bg-surface py-1.5 pe-8 ps-3 text-sm text-ink focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';
const popover =
  'absolute top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-3 shadow-card start-0';

/**
 * The reusable dashboard view bar: period, compare, group-by, filters, chart
 * type, density, TV mode, CSV export and saved views. Every change navigates
 * (router.replace) to the serialized URL, so the server re-renders the view and
 * the link is shareable. Each page opts into the controls it supports.
 */
export function ViewToolbar(props: ViewToolbarProps) {
  const { page } = props;
  const t = useT(views);
  const ta = useT(approvals);
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // Fixed per page, not useId() (see app/dashboard/search.tsx): one toolbar per page.
  const id = `view-toolbar-${page}`;
  // Optimistic: the control shows the choice at once while the server re-renders the data
  // (perf-states-12); the data regions are marked busy meanwhile and the result is announced.
  const [isPending, startTransition] = useTransition();
  const [view, setOptimisticView] = useOptimistic(props.view);
  const [announcement, setAnnouncement] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    const regions = document.querySelectorAll<HTMLElement>('[data-view-region]');
    if (isPending) {
      wasPending.current = true;
      regions.forEach((el) => el.setAttribute('aria-busy', 'true'));
      return;
    }
    regions.forEach((el) => el.removeAttribute('aria-busy'));
    if (!wasPending.current) return;
    wasPending.current = false;
    // Announce what the new view shows (pages put it on [data-view-summary]), debounced.
    const timer = setTimeout(() => {
      const summary = document.querySelector('[data-view-summary]')?.getAttribute('data-view-summary');
      setAnnouncement(summary ? t('toolbar.showing', { summary }) : t('toolbar.updated'));
    }, 500);
    return () => clearTimeout(timer);
  }, [isPending, t]);

  const [from, setFrom] = useState(view.from ?? '');
  const [to, setTo] = useState(view.to ?? '');
  const [customOpen, setCustomOpen] = useState(view.period === 'custom');
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    setSaved(listSavedViews(page));
  }, [page]);
  useEffect(() => {
    setFrom(view.from ?? '');
    setTo(view.to ?? '');
    setCustomOpen(view.period === 'custom');
  }, [view.from, view.to, view.period]);

  function go(next: ViewState) {
    const keep = new URLSearchParams(window.location.search);
    // The breakdown's legacy month offset would contradict the chosen period.
    keep.delete('m');
    const q = serializeView(next, keep).toString();
    // Same-route soft navigation. It used to stall in production builds under the
    // route-level loading.tsx boundary (removed; see scripts/check-soft-nav.mjs).
    startTransition(() => {
      setOptimisticView(next);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }
  const set = (patch: Partial<ViewState>) => go({ ...view, ...patch });
  const setFilter = <K extends keyof ViewFilters>(key: K, values: ViewFilters[K]) =>
    go({ ...view, filters: { ...view.filters, [key]: values } });

  const enabled = props.filters ?? [];
  const tvLabel = t('toolbar.tv');

  function onPeriod(value: string) {
    if (value === 'custom') {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    set({ period: value as ViewState['period'], from: undefined, to: undefined });
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    set({ period: 'custom', from: a, to: b });
  }

  function enterTv() {
    set({ tv: true });
    try {
      void document.documentElement.requestFullscreen?.()?.catch(() => {});
    } catch {
      /* fullscreen not allowed — the overlay still fills the window */
    }
  }

  const typeLabel = (v: string) => ta(`types.${v}.label` as MessageKey<typeof approvalsHe>);
  const sevLabel = (v: string) => ta(`severity.${v}` as MessageKey<typeof approvalsHe>);
  const statusLabel = (v: string) => ta(`resolution.${v}` as MessageKey<typeof approvalsHe>);

  const activeCount =
    (view.period !== DEFAULT_VIEW.period ? 1 : 0) +
    (view.compare !== DEFAULT_VIEW.compare ? 1 : 0) +
    (Object.values(view.filters) as string[][]).filter((v) => v.length > 0).length;

  const controls = (sfx: string, inSheet: boolean) => (
    <>
      {props.period ? (
        <label className="inline-flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-subtle" aria-hidden="true" />
          <span className="sr-only">{t('toolbar.period')}</span>
          <select
            className={selectCls}
            value={customOpen ? 'custom' : view.period}
            onChange={(e) => onPeriod(e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`periods.${p}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {props.period && customOpen ? (
        <form onSubmit={applyCustom} className="inline-flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`${id}${sfx}-from`}>
            {t('toolbar.from')}
          </label>
          <input
            id={`${id}${sfx}-from`}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={cn(selectCls, 'pe-3')}
            required
          />
          <span className="text-subtle" aria-hidden="true">
            –
          </span>
          <label className="sr-only" htmlFor={`${id}${sfx}-to`}>
            {t('toolbar.to')}
          </label>
          <input
            id={`${id}${sfx}-to`}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={cn(selectCls, 'pe-3')}
            required
          />
          <button type="submit" className={cn(chip, 'border-primary/40 text-primary')}>
            {t('toolbar.apply')}
          </button>
        </form>
      ) : null}

      {props.compare ? (
        <label className="inline-flex items-center gap-1.5">
          <GitCompareArrows className="h-4 w-4 text-subtle" aria-hidden="true" />
          <span className="sr-only">{t('toolbar.compare')}</span>
          <select
            className={selectCls}
            value={view.compare}
            onChange={(e) => set({ compare: e.target.value as ViewState['compare'] })}
          >
            {COMPARES.map((c) => (
              <option key={c} value={c}>
                {t(`compares.${c}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {props.group ? (
        <label className="inline-flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-subtle" aria-hidden="true" />
          <span className="text-xs text-subtle">{t('toolbar.groupBy')}</span>
          <select
            className={selectCls}
            value={view.group}
            onChange={(e) => set({ group: e.target.value as ViewState['group'] })}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`groups.${g}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {enabled.includes('supplier') && props.options?.suppliers.length ? (
        <MultiFilter
          label={t('filterNames.supplier')}
          selected={view.filters.supplierIds}
          options={props.options.suppliers.map((s) => ({ value: s.id, label: locale === 'en' && s.nameEn?.trim() ? s.nameEn : s.name }))}
          onChange={(v) => setFilter('supplierIds', v)}
          allLabel={t('toolbar.all')}
          countLabel={(n) => t('toolbar.selected', { count: n })}
        />
      ) : null}
      {enabled.includes('category') && props.options?.categories.length ? (
        <MultiFilter
          label={t('filterNames.category')}
          selected={view.filters.categories}
          options={props.options.categories.map((c) => ({ value: c, label: c }))}
          onChange={(v) => setFilter('categories', v)}
          allLabel={t('toolbar.all')}
          countLabel={(n) => t('toolbar.selected', { count: n })}
        />
      ) : null}
      {enabled.includes('type') ? (
        <MultiFilter
          label={t('filterNames.type')}
          selected={view.filters.types}
          options={DISCREPANCY_TYPES.map((v) => ({ value: v, label: typeLabel(v) }))}
          onChange={(v) => setFilter('types', v as ViewFilters['types'])}
          allLabel={t('toolbar.all')}
          countLabel={(n) => t('toolbar.selected', { count: n })}
        />
      ) : null}
      {enabled.includes('severity') ? (
        <MultiFilter
          label={t('filterNames.severity')}
          selected={view.filters.severities}
          options={(props.severities ?? SEVERITIES).map((v) => ({ value: v, label: sevLabel(v) }))}
          onChange={(v) => setFilter('severities', v as ViewFilters['severities'])}
          allLabel={t('toolbar.all')}
          countLabel={(n) => t('toolbar.selected', { count: n })}
        />
      ) : null}
      {enabled.includes('status') ? (
        <MultiFilter
          label={t('filterNames.status')}
          selected={view.filters.statuses}
          options={STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))}
          onChange={(v) => setFilter('statuses', v as ViewFilters['statuses'])}
          allLabel={t('toolbar.all')}
          countLabel={(n) => t('toolbar.selected', { count: n })}
        />
      ) : null}
      {hasFilters(view) ? (
        <button
          type="button"
          className={cn(chip, 'border-transparent bg-transparent')}
          onClick={() => go({ ...view, filters: DEFAULT_VIEW.filters })}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          {t('toolbar.clearFilters')}
        </button>
      ) : null}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {props.chart ? (
          <Segmented
            label={t('toolbar.chart')}
            value={view.chart}
            onChange={(v) => set({ chart: v as ViewState['chart'] })}
            options={CHARTS.map((c) => ({
              value: c,
              label: t(`charts.${c}`),
              icon: c === 'bar' ? BarChart3 : c === 'line' ? LineChart : Table2,
            }))}
          />
        ) : null}
        {props.density ? (
          <Segmented
            label={t('toolbar.density')}
            value={view.density}
            onChange={(v) => set({ density: v as ViewState['density'] })}
            options={DENSITIES.map((d) => ({
              value: d,
              label: t(`densities.${d}`),
              icon: d === 'comfortable' ? Rows3 : Rows4,
            }))}
          />
        ) : null}
        {props.exportData ? (
          <button
            type="button"
            className={chip}
            onClick={() =>
              downloadCsv(
                `restomatch-${page}-${new Date().toISOString().slice(0, 10)}`,
                props.exportData!.columns,
                props.exportData!.rows,
              )
            }
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('toolbar.export')}
          </button>
        ) : null}
        {props.saved ? (
          <details className="group relative">
            <summary className={cn(chip, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              {t('toolbar.saved')}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className={cn(popover, 'end-0 start-auto')}>
              {saved.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted">{t('toolbar.noSaved')}</p>
              ) : (
                <ul className="mb-2 max-h-56 space-y-1 overflow-y-auto">
                  {saved.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2">
                      <Link
                        href={s.query ? `${pathname}?${s.query}` : pathname}
                        className="min-w-0 truncate rounded-lg px-2 py-1 text-sm text-ink hover:bg-surface-2"
                      >
                        {s.name}
                      </Link>
                      <button
                        type="button"
                        aria-label={`${t('toolbar.delete')}: ${s.name}`}
                        className="rounded-lg p-1 text-subtle hover:text-danger"
                        onClick={() => setSaved(deleteSavedView(page, s.name))}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex items-center gap-2 border-t border-line pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = serializeView(view, new URLSearchParams(window.location.search));
                  q.delete('tv');
                  setSaved(saveView(page, saveName, q.toString()));
                  setSaveName('');
                }}
              >
                <label className="sr-only" htmlFor={`${id}${sfx}-save`}>
                  {t('toolbar.saveName')}
                </label>
                <input
                  id={`${id}${sfx}-save`}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={t('toolbar.saveCurrent')}
                  maxLength={60}
                  className={cn(selectCls, 'min-w-0 flex-1 pe-3')}
                />
                <button type="submit" disabled={!saveName.trim()} className={cn(chip, 'disabled:opacity-45')}>
                  {t('toolbar.save')}
                </button>
              </form>
              <p className="mt-1.5 px-1 text-xs text-subtle">{t('toolbar.savedHint')}</p>
            </div>
          </details>
        ) : null}
        {props.tv && !inSheet ? (
          <button type="button" className={chip} onClick={enterTv} aria-label={tvLabel} title={tvLabel}>
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{tvLabel}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={cn(chip, 'border-transparent bg-transparent px-2')}
          onClick={() => go({ ...DEFAULT_VIEW })}
          aria-label={t('toolbar.reset')}
          title={t('toolbar.reset')}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );

  return (
    <div className="mb-6 print:hidden" data-pending={isPending || undefined}>
      {/* Below lg: ONE "תצוגה · N" button; every control lives in a bottom sheet, so the
          T1 figure stays in the first viewport on a phone (leaks-10, command-06). */}
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <button
          type="button"
          className={cn(chip, 'min-h-11', activeCount > 0 && 'border-primary/40 text-primary')}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {activeCount > 0 ? t('toolbar.viewCount', { count: activeCount }) : t('toolbar.view')}
        </button>
        {hasFilters(view) ? (
          <button
            type="button"
            className={cn(chip, 'min-h-11 border-transparent bg-transparent')}
            onClick={() => go({ ...view, filters: DEFAULT_VIEW.filters })}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            {t('toolbar.clearFilters')}
          </button>
        ) : null}
      </div>
      <div
        role="toolbar"
        aria-label={t('toolbar.label')}
        className="hidden flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/70 p-2.5 lg:flex"
      >
        {controls('', false)}
      </div>
      {isPending ? <div className="mt-1 h-0.5 w-full animate-pulse rounded-full bg-primary/50" aria-hidden="true" /> : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <ViewSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('toolbar.label')} closeLabel={t('toolbar.close')}>
        <div role="toolbar" aria-label={t('toolbar.label')} className="flex flex-col items-stretch gap-3 [&_select]:w-full">
          {controls('-sheet', true)}
        </div>
      </ViewSheet>
    </div>
  );
}

/** The phone sheet: a modal <dialog> (focus stays inside, Esc closes), anchored to the bottom. */
function ViewSheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  // The sheet is phone-only (lg:hidden). Widening past lg while it is open would
  // leave a hidden MODAL dialog — the whole page inert — so it closes itself.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) onClose();
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, onClose]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85vh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/40 lg:hidden"
    >
      {open ? (
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden="true" />
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-muted hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              {closeLabel}
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

function MultiFilter({
  label,
  selected,
  options,
  onChange,
  allLabel,
  countLabel,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  allLabel: string;
  countLabel: (n: number) => string;
}) {
  const active = selected.length > 0;
  const summary =
    selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? countLabel(1))
      : active
        ? countLabel(selected.length)
        : allLabel;
  return (
    <details
      className="group relative"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        const d = e.currentTarget;
        if (!d.open) return;
        e.preventDefault();
        e.stopPropagation();
        d.open = false;
        d.querySelector('summary')?.focus();
      }}
    >
      <summary
        className={cn(
          chip,
          'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
          active && 'border-primary/40 text-primary',
        )}
      >
        <span className="text-xs text-subtle">{label}:</span>
        <span className="max-w-[10rem] truncate">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <fieldset className={popover}>
        <legend className="sr-only">{label}</legend>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0 truncate">{o.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </details>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5"
      onKeyDown={(e) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const i = Math.max(0, options.findIndex((o) => o.value === value));
        const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
        const forward = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
        const next =
          e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + (forward ? 1 : -1) + options.length) % options.length;
        onChange(options[next]!.value);
        (e.currentTarget.querySelectorAll('[role="radio"]')[next] as HTMLElement | undefined)?.focus();
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              on ? 'bg-primary/15 text-primary' : 'text-muted hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
