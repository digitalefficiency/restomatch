'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, Check, CircleAlert, ClipboardList, Plus, Search, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, EmptyState, Input, LinkButton, Spinner, cn, friendlyError, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { originalProps } from '@/lib/i18n/original';
import { ils, priceText } from '../../recipes/recipe-ui';
import { AREAS, dayText, mergeRetry, normalizeQty, pendingStore, qtyText, type Area, type LineEdit } from '../inventory-ui';

type Draft = NonNullable<inferRouterOutputs<AppRouter>['inventory']['current']>;
type Done = inferRouterOutputs<AppRouter>['inventory']['complete'];
type Edit = LineEdit;

const SAVE_DELAY_MS = 700;

/** localStorage when the browser allows it (private mode / blocked storage → null). */
function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function localName(he: string, en: string | null, locale: string) {
  const text = locale === 'en' && en ? en : he;
  return <span {...originalProps(text)}>{text}</span>;
}

/**
 * The count, mobile-first (390 px, in the walk-in). Every keystroke is kept
 * locally and autosaved (debounced, and flushed when the phone locks / the tab
 * hides), so closing the phone mid-count resumes where it stopped.
 */
export function CountScreen() {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const current = trpc.inventory.current.useQuery(undefined, { refetchOnWindowFocus: false });
  const start = trpc.inventory.start.useMutation({
    onSuccess: () => void utils.inventory.current.invalidate(),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const [done, setDone] = useState<Done | null>(null);

  if (done) return <DoneSummary done={done} />;
  if (current.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (current.isError) {
    return (
      <EmptyState
        icon={<CircleAlert className="h-6 w-6" />}
        title={t('count.loadError')}
        description={friendlyError(current.error, tc)}
        action={
          <Button variant="secondary" onClick={() => void current.refetch()} className="touch-target">
            {t('count.retry')}
          </Button>
        }
      />
    );
  }
  if (!current.data) {
    return (
      <EmptyState
        icon={<ClipboardList className="h-6 w-6" />}
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button onClick={() => start.mutate()} loading={start.isPending} className="touch-target">
            {t('home.start')}
          </Button>
        }
      />
    );
  }
  return <CountForm key={current.data.id} draft={current.data} onDone={setDone} />;
}

function CountForm({ draft, onDone }: { draft: Draft; onDone: (d: Done) => void }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();

  // Local edits win over the server copy until saved.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const pending = useRef<Record<string, Edit>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [acceptUncounted, setAcceptUncounted] = useState(false);

  const save = trpc.inventory.saveLines.useMutation();
  // One save at a time, in order: a newer flush waits for the one in flight, so
  // an older quantity can never land after a newer one, and Finish only runs
  // once every keystroke is on the server.
  const inFlight = useRef<Promise<boolean>>(Promise.resolve(true));
  // `gone`: the server says the draft was finished / discarded elsewhere — stop for good.
  // `mounted`: no retry timer is scheduled behind a screen that was left.
  const gone = useRef(false);
  const mounted = useRef(false);
  // Unsaved edits are mirrored in localStorage per count, so a reload or a dead tab loses nothing.
  const store = useMemo(() => pendingStore(draft.id, browserStorage()), [draft.id]);
  // The batch on the wire stays in storage until the server has it.
  const sending = useRef<Record<string, Edit>>({});
  const persist = useCallback(() => store.write(mergeRetry(sending.current, pending.current)), [store]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const run = inFlight.current.then(async () => {
      const batch = pending.current;
      const ids = Object.keys(batch);
      if (ids.length === 0 || gone.current) return ids.length === 0;
      pending.current = {};
      sending.current = batch;
      setSaveState('saving');
      try {
        await save.mutateAsync({ countId: draft.id, lines: ids.map((productId) => ({ productId, ...batch[productId] })) });
        sending.current = {};
        persist();
        setSaveState('saved');
        void utils.inventory.current.invalidate();
        return true;
      } catch (e) {
        // Keep the unsaved edits under any newer ones, field by field.
        sending.current = {};
        pending.current = mergeRetry(batch, pending.current);
        setSaveState('error');
        const code = (e as { data?: { code?: string } }).data?.code;
        if (code === 'CONFLICT' || code === 'NOT_FOUND') {
          // Finished or discarded elsewhere (another phone/tab): stop, don't loop.
          gone.current = true;
          store.write({});
          toast.error(friendlyError(e, tc));
          void utils.inventory.invalidate();
        } else {
          persist();
          if (mounted.current) timer.current = setTimeout(() => void flush(), 3000);
        }
        return false;
      }
    });
    inFlight.current = run;
    return run;
  }, [draft.id, save, utils, toast, tc, store, persist]);

  // Mount: replay edits a previous visit didn't get to save. Unmount (leaving
  // the screen): save what is queued now, and no timer keeps firing behind it.
  // Strict Mode mounts, unmounts and re-mounts in development: both are idempotent.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    const saved = store.read();
    if (Object.keys(saved).length > 0) {
      pending.current = mergeRetry(saved, pending.current);
      setEdits((prev) => mergeRetry(saved, prev));
      void flushRef.current();
    }
    return () => {
      mounted.current = false;
      void flushRef.current();
    };
  }, [store]);

  const queue = (productId: string, e: Edit) => {
    pending.current[productId] = { ...pending.current[productId], ...e };
    persist();
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], ...e } }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // The phone locks or the tab hides: save now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flush]);

  const lines = useMemo(
    () =>
      draft.lines.map((l) => {
        const e = edits[l.productId];
        return { ...l, qty: e && 'qty' in e ? (e.qty ?? null) : l.qty, storageArea: (e?.storageArea ?? l.storageArea) as Area };
      }),
    [draft.lines, edits],
  );
  const counted = lines.filter((l) => l.qty != null).length;
  const pctDone = lines.length ? Math.round((counted / lines.length) * 100) : 0;
  const byArea = useMemo(() => AREAS.map((a) => [a, lines.filter((l) => l.storageArea === a)] as const).filter(([, ls]) => ls.length > 0), [lines]);

  const setDate = trpc.inventory.setMeta.useMutation({
    onSuccess: () => void utils.inventory.current.invalidate(),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const complete = trpc.inventory.complete.useMutation({
    onSuccess: (d) => {
      gone.current = true;
      pending.current = {};
      store.write({});
      void utils.inventory.invalidate();
      onDone(d);
    },
    onError: (e) => {
      const last = /^NOT_AFTER_LAST:(\d{4}-\d{2}-\d{2})$/.exec(e.message);
      toast.error(last ? t('count.notAfterLast', { date: dayText(last[1]!, locale) }) : friendlyError(e, tc));
    },
  });
  const discard = trpc.inventory.discard.useMutation({
    onSuccess: () => {
      gone.current = true;
      pending.current = {};
      store.write({});
      void utils.inventory.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  const onQty = (productId: string, raw: string) => {
    setInputs((p) => ({ ...p, [productId]: raw }));
    const v = normalizeQty(raw);
    // "2," is still being typed: no red flash, nothing queued yet.
    if (v === undefined) {
      setInvalid((p) => ({ ...p, [productId]: false }));
      return;
    }
    if (v === null) {
      setInvalid((p) => ({ ...p, [productId]: true }));
      return;
    }
    setInvalid((p) => ({ ...p, [productId]: false }));
    queue(productId, { qty: v === '' ? null : v });
  };

  const unpricedCounted = lines.filter((l) => l.qty != null && (l.status === 'noPrice' || l.status === 'unitMismatch')).length;
  // Blank ≠ zero: an empty line is "not counted" and closing needs an explicit OK.
  const uncounted = lines.filter((l) => l.qty == null);
  const checks = lines.filter((l) => l.check);
  const namesText = (ls: Array<{ name: string; nameEn: string | null }>) => {
    const names = ls.slice(0, 8).map((l) => (locale === 'en' && l.nameEn ? l.nameEn : l.name));
    return ls.length > 8 ? `${names.join(', ')} ${t('count.more', { count: ls.length - 8 })}` : names.join(', ');
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

  return (
    <div className="pb-56">
      <LinkButton href="/dashboard/inventory" variant="ghost" size="sm" className="touch-target -ms-2 mb-2">
        <ArrowRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
        {t('count.back')}
      </LinkButton>
      <h1 className="text-2xl font-bold text-ink">{t('count.title', { date: dayText(draft.countDate, locale) })}</h1>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted" htmlFor="count-date">
          {t('count.date')}
          <Input
            id="count-date"
            type="date"
            className="mt-1 w-44 text-base"
            min="2000-01-01"
            max={today}
            defaultValue={draft.countDate}
            key={draft.countDate}
            onBlur={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01' && v <= today && v !== draft.countDate) setDate.mutate({ countId: draft.id, countDate: v });
            }}
          />
        </label>
      </div>

      {lines.length === 0 ? <p className="mt-4 text-sm text-muted">{t('count.emptyList')}</p> : null}

      {byArea.map(([area, ls]) => (
        <section key={area} className="mt-5" aria-labelledby={`area-${area}`}>
          <h2 id={`area-${area}`} className="mb-2 text-sm font-semibold text-muted">
            {t(`areas.${area}`)} · {ls.filter((l) => l.qty != null).length}/{ls.length}
          </h2>
          <ul className="space-y-2">
            {ls.map((l) => {
              const inputId = `qty-${l.productId}`;
              const text = inputs[l.productId] ?? qtyText(l.qty);
              const bad = invalid[l.productId];
              return (
                <li key={l.productId}>
                  <Card padding="none" className={cn('flex items-center gap-3 px-3 py-2', l.qty != null && 'border-primary/30')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{localName(l.name, l.nameEn, locale)}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <label className="sr-only" htmlFor={`area-sel-${l.productId}`}>
                          {t('count.area')}
                        </label>
                        <select
                          id={`area-sel-${l.productId}`}
                          value={l.storageArea}
                          onChange={(e) => queue(l.productId, { storageArea: e.target.value as Area })}
                          className="rounded-lg border border-line-strong bg-surface px-2 py-0.5 text-base text-muted md:text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          {AREAS.map((a) => (
                            <option key={a} value={a}>
                              {t(`areas.${a}`)}
                            </option>
                          ))}
                        </select>
                        {l.qty != null && l.status === 'ok' && l.valueAgorot != null ? (
                          <bdi dir="ltr" className="tabular-nums">{ils(l.valueAgorot, locale)}</bdi>
                        ) : null}
                        {l.qty != null && (l.status === 'noPrice' || l.status === 'unitMismatch') ? <Badge tone="neutral">{t('count.noPrice')}</Badge> : null}
                        {l.check ? (
                          <span title={t('count.checkHint')}>
                            <Badge tone="warning">{t('count.check')}</Badge>
                          </span>
                        ) : null}
                      </div>
                      {l.priceSource && l.unitCost ? (
                        <p className="mt-0.5 truncate text-[11px] text-subtle" data-testid="price-source">
                          <PriceSourceText unitCost={l.unitCost} unit={l.unit} source={l.priceSource} />
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <label className="sr-only" htmlFor={inputId}>
                        {t('count.qtyLabel', { name: locale === 'en' && l.nameEn ? l.nameEn : l.name, unit: l.unit })}
                      </label>
                      <input
                        id={inputId}
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        dir="ltr"
                        className={cn(
                          'w-20 rounded-xl border bg-surface px-2 py-2 text-end text-base tabular-nums text-ink placeholder-subtle focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                          bad ? 'border-danger' : 'border-line-strong',
                        )}
                        value={text}
                        placeholder="—"
                        aria-invalid={bad ? true : undefined}
                        onChange={(e) => onQty(l.productId, e.target.value)}
                        onBlur={() => void flush()}
                      />
                      <span className="w-10 truncate text-xs text-muted">{l.unit}</span>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <AddProduct countId={draft.id} existing={new Set(lines.map((l) => l.productId))} beforeAdd={flush} />

      <div className="mt-8 flex flex-wrap gap-3">
        <Button
          variant="ghost"
          className="touch-target text-danger"
          loading={discard.isPending}
          onClick={() => {
            if (window.confirm(t('count.discardConfirm'))) discard.mutate({ countId: draft.id });
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t('count.discard')}
        </Button>
      </div>

      {/* Finish: one primary action, pinned to the bottom of the phone screen. */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+var(--consent-h,0px))] z-20 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-[var(--consent-h,0px)]">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2" data-testid="count-progress">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-ink">{t('count.progress', { counted, lines: lines.length })}</span>
              <span className="text-muted">
                {t('count.liveValue')}: <bdi dir="ltr" className="font-semibold tabular-nums text-ink">{ils(draft.totalValueAgorot, locale, 0)}</bdi>
              </span>
              <span className="text-muted" role="status" aria-live="polite">
                {saveState === 'saving' ? t('count.saving') : saveState === 'saved' ? t('count.saved') : saveState === 'error' ? t('count.saveError') : ''}
              </span>
            </div>
            <div
              className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={lines.length}
              aria-valuenow={counted}
              aria-label={t('count.progress', { counted, lines: lines.length })}
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pctDone}%` }} />
            </div>
          </div>
          {confirming ? (
            <div role="dialog" aria-modal="false" aria-labelledby="finish-title" className="space-y-2">
              <p id="finish-title" className="font-semibold text-ink">
                {t('count.finishTitle')}
              </p>
              <p className="text-sm text-muted">{t('count.finishBody', { date: dayText(draft.countDate, locale) })}</p>
              {uncounted.length > 0 ? (
                <div className="space-y-1 text-sm text-warn" data-testid="uncounted-list">
                  <p className="flex items-center gap-1.5">
                    <CircleAlert className="h-4 w-4" aria-hidden="true" />
                    {t('count.notCountedWarn', { count: uncounted.length })}
                  </p>
                  <p className="text-xs">{t('count.uncountedList', { names: namesText(uncounted) })}</p>
                  <label className="flex items-start gap-2 text-xs text-ink">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acceptUncounted} onChange={(e) => setAcceptUncounted(e.target.checked)} />
                    {t('count.acceptUncounted')}
                  </label>
                </div>
              ) : null}
              {checks.length > 0 ? <p className="text-xs text-warn">{t('count.checkWarn', { count: checks.length, names: namesText(checks) })}</p> : null}
              {unpricedCounted > 0 ? <p className="text-sm text-muted">{t('count.unpricedWarn', { count: unpricedCounted })}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="touch-target"
                  loading={complete.isPending}
                  disabled={uncounted.length > 0 && !acceptUncounted}
                  onClick={async () => {
                    if (await flush()) complete.mutate({ countId: draft.id, acceptUncounted: uncounted.length > 0 ? acceptUncounted : undefined });
                  }}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t('count.finishConfirm')}
                </Button>
                <Button variant="secondary" className="touch-target" onClick={() => setConfirming(false)}>
                  {t('count.cancel')}
                </Button>
              </div>
            </div>
          ) : draft.canClose ? (
            <Button className="touch-target w-full" disabled={counted === 0} onClick={() => setConfirming(true)}>
              {counted === 0 ? t('count.nothingCounted') : t('count.finish')}
            </Button>
          ) : (
            <p className="text-center text-sm text-muted" data-testid="closers-only">
              {t('count.closersOnly')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AddProduct({ countId, existing, beforeAdd }: { countId: string; existing: Set<string>; beforeAdd: () => Promise<boolean> }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [q, setQ] = useState('');
  const search = trpc.inventory.searchProducts.useQuery({ q: q.trim() }, { enabled: q.trim().length > 0, staleTime: 30_000 });
  const add = trpc.inventory.saveLines.useMutation({
    onSuccess: () => {
      setQ('');
      void utils.inventory.current.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const results = (search.data ?? []).filter((p) => !existing.has(p.id)).slice(0, 8);
  return (
    <section className="mt-8" aria-labelledby="add-title">
      <h2 id="add-title" className="mb-2 text-sm font-semibold text-muted">
        {t('count.addTitle')}
      </h2>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input
          aria-label={t('count.addTitle')}
          placeholder={t('count.addPlaceholder')}
          className="ps-9 text-base"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="min-w-0 truncate text-sm text-ink">{localName(p.name, p.nameEn, locale)}</span>
              <Button
                size="sm"
                variant="secondary"
                className="touch-target"
                loading={add.isPending && add.variables?.lines[0]?.productId === p.id}
                onClick={async () => {
                  await beforeAdd();
                  add.mutate({ countId, lines: [{ productId: p.id, qty: null }] });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('count.add')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DoneSummary({ done }: { done: Done }) {
  const t = useT(inventoryNs);
  const locale = useLocale();
  return (
    <Card padding="lg" className="mx-auto max-w-lg text-center" data-testid="count-done">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
        <Check className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-3 text-xl font-bold text-ink">{t('count.doneTitle')}</h1>
      <p className="mt-2 text-3xl font-bold tabular-nums text-ink" data-testid="count-done-value">
        <bdi dir="ltr">{ils(done.totalValueAgorot, locale, 0)}</bdi>
      </p>
      <p className="mt-1 text-sm text-muted">
        {dayText(done.countDate, locale)} · {t('count.doneCounted', { counted: done.counted })}
      </p>
      {done.notCounted > 0 ? <p className="mt-2 text-sm text-warn">{t('count.notCountedWarn', { count: done.notCounted })}</p> : null}
      {done.unpriced > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {t('count.unpricedWarn', { count: done.unpriced })}{' '}
          {done.unpricedNames
            .slice(0, 5)
            .map((n) => (locale === 'en' && n.nameEn ? n.nameEn : n.name))
            .join(', ')}
        </p>
      ) : null}
      <div className="mt-5 flex justify-center">
        <LinkButton href="/dashboard/inventory" className="touch-target">
          {t('count.toPeriod')}
        </LinkButton>
      </div>
    </Card>
  );
}

/** "₪149.00 per kg · invoice 4711, 20 Oct 2026, HaKerem Butchery" — the paid price the owner recognises. */
export function PriceSourceText({
  unitCost,
  unit,
  source,
}: {
  unitCost: string;
  unit: string;
  source: { invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null; observedAt: string };
}) {
  const t = useT(inventoryNs);
  const locale = useLocale();
  const date = source.invoiceDate ? dayText(source.invoiceDate, locale) : dayText(source.observedAt.slice(0, 10), locale);
  const price = priceText(unitCost, locale);
  return source.invoiceNumber ? (
    <>{t('count.priceFrom', { price, unit, invoice: source.invoiceNumber, date, supplier: source.supplierName ?? '—' })}</>
  ) : (
    <>{t('count.priceFromNoInvoice', { price, unit, supplier: source.supplierName ?? '—', date })}</>
  );
}
