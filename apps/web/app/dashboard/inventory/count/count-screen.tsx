'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowRight, Check, CircleAlert, ClipboardList, CloudUpload, Plus, Search, Send, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  Input,
  LinkButton,
  Money,
  Sheet,
  Spinner,
  cn,
  friendlyError,
  useAnnounce,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { originalProps } from '@/lib/i18n/original';
import { UnitText } from '@/lib/components/UnitText';
import { moneyText } from '@/lib/components/money/format';
import { AREAS, classifyQty, dayText, qtyText, type Area, type LineEdit } from '../inventory-ui';
import { guardFlags, guardMessageKey, type GuardFlag } from './guard';
import { nextUncounted } from './nav';
import { backoffMs, interimQueue, migrateLegacyPending, type Attribution } from './_outbox';

type Draft = NonNullable<inferRouterOutputs<AppRouter>['inventory']['current']>;
type DraftLine = Draft['lines'][number];
type Done = inferRouterOutputs<AppRouter>['inventory']['complete'];
type Edit = LineEdit;

export interface CountViewer {
  userId: string;
  name: string | null;
}

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

/** Today in Israel, YYYY-MM-DD. */
function todayIL(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/**
 * The count as a field instrument (W2-07): a phone in the walk-in. Sticky area
 * header + chips, Enter walks to the next uncounted line (0 taps per line), the
 * previous count shown muted, an instant guard on outliers, and every keystroke
 * on the device before it goes to the server (nothing lost with no signal).
 */
export function CountScreen({ viewer, initial }: { viewer: CountViewer; initial?: Draft | null }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const current = trpc.inventory.current.useQuery(undefined, {
    refetchOnWindowFocus: false,
    ...(initial !== undefined ? { initialData: initial } : {}),
  });
  const start = trpc.inventory.start.useMutation({
    onSuccess: () => void utils.inventory.current.invalidate(),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const [done, setDone] = useState<Done | null>(null);

  if (done) return <DoneSummary done={done} />;
  if (current.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label={t('home.loading')}>
        <Spinner />
      </div>
    );
  }
  if (current.isError) {
    return (
      <div role="status">
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
      </div>
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
  return <CountForm key={current.data.id} draft={current.data} viewer={viewer} onDone={setDone} />;
}

function CountForm({ draft, viewer, onDone }: { draft: Draft; viewer: CountViewer; onDone: (d: Done) => void }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const announce = useAnnounce();
  const utils = trpc.useUtils();
  const money = draft.showMoney;
  const by: Attribution = useMemo(() => ({ userId: viewer.userId, name: viewer.name }), [viewer.userId, viewer.name]);

  // Local edits win over the server copy until the server has them.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [ambiguous, setAmbiguous] = useState<Record<string, [string, string]>>({});
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [queued, setQueued] = useState(0);
  const [others, setOthers] = useState<string[]>([]);
  const [flushError, setFlushError] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [acceptUncounted, setAcceptUncounted] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [search, setSearch] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [dateValue, setDateValue] = useState(draft.countDate);
  const [discardOpen, setDiscardOpen] = useState(false);

  const save = trpc.inventory.saveLines.useMutation();
  const storage = useMemo(() => browserStorage(), []);
  const q = useMemo(() => interimQueue(draft.id, storage), [draft.id, storage]);
  // One save at a time, in order: an older quantity can never land after a newer one.
  const inFlight = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  // `gone`: the draft was finished / discarded elsewhere — stop for good. `mounted`: no timer behind a left screen.
  const gone = useRef(false);
  const mounted = useRef(false);
  const refreshQueue = useCallback(() => {
    setQueued(q.size());
    setOthers(q.othersBy(viewer.userId));
  }, [q, viewer.userId]);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const run = inFlight.current.then(async () => {
      const batch = q.edits();
      const ids = Object.keys(batch);
      if (ids.length === 0 || gone.current) return ids.length === 0;
      setSaveState('saving');
      try {
        await save.mutateAsync({ countId: draft.id, lines: ids.map((productId) => ({ productId, ...batch[productId] })) });
        q.ack(batch);
        attempts.current = 0;
        refreshQueue();
        setSaveState('saved');
        setFlushError(null);
        void utils.inventory.current.invalidate();
        return q.size() === 0;
      } catch (e) {
        setSaveState('error');
        const code = (e as { data?: { code?: string } }).data?.code;
        if (code === 'CONFLICT' || code === 'NOT_FOUND') {
          // Finished or discarded elsewhere (another phone/tab): stop, don't loop.
          gone.current = true;
          q.clear();
          refreshQueue();
          toast.error(friendlyError(e, tc));
          void utils.inventory.invalidate();
        } else {
          attempts.current += 1;
          refreshQueue();
          if (mounted.current) timer.current = setTimeout(() => void flushRef.current(), backoffMs(attempts.current));
        }
        return false;
      }
    });
    inFlight.current = run;
    return run;
  }, [draft.id, save, utils, toast, tc, q, refreshQueue]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Mount: move the old pending rows onto the queue (zero loss), then replay what is queued.
  useEffect(() => {
    mounted.current = true;
    migrateLegacyPending(draft.id, storage);
    const saved = q.edits();
    if (Object.keys(saved).length > 0) {
      setEdits((prev) => ({ ...saved, ...prev }));
      void flushRef.current();
    }
    refreshQueue();
    try {
      const c = storage?.getItem(`rm.inventory.confirmed.${draft.id}`);
      if (c) setConfirmed(JSON.parse(c) as Record<string, string>);
    } catch {
      // no confirmations kept: the guard asks again
    }
    return () => {
      mounted.current = false;
      void flushRef.current();
    };
  }, [draft.id, q, storage, refreshQueue]);

  // Back online / back on screen: send now. The phone locks / the tab hides: send now.
  useEffect(() => {
    const now = () => void flushRef.current();
    const onVis = () => void flushRef.current();
    window.addEventListener('online', now);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', now);
    return () => {
      window.removeEventListener('online', now);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', now);
    };
  }, []);

  const queue = (productId: string, e: Edit) => {
    q.put({ [productId]: e }, by);
    refreshQueue();
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], ...e } }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  };

  const lines = useMemo(
    () =>
      draft.lines.map((l) => {
        const e = edits[l.productId];
        return { ...l, savedQty: l.qty, qty: e && 'qty' in e ? (e.qty ?? null) : l.qty, storageArea: (e?.storageArea ?? l.storageArea) as Area };
      }),
    [draft.lines, edits],
  );
  type Line = (typeof lines)[number];
  const guardOf = useCallback(
    (l: Line) =>
      guardFlags({ qty: l.qty, expectedQty: l.expectedQty, unitCost: money ? l.unitCost : null, serverValueFlag: l.valueFlag, savedQty: l.savedQty }),
    [money],
  );
  const counted = lines.filter((l) => l.qty != null).length;
  const pctDone = lines.length ? Math.round((counted / lines.length) * 100) : 0;
  const needle = search.trim().toLowerCase();
  const visible = needle ? lines.filter((l) => l.name.toLowerCase().includes(needle) || (l.nameEn ?? '').toLowerCase().includes(needle)) : lines;
  const byArea = useMemo(
    () => AREAS.map((a) => [a, visible.filter((l) => l.storageArea === a)] as const).filter(([, ls]) => ls.length > 0),
    [visible],
  );
  const allAreas = useMemo(() => AREAS.map((a) => [a, lines.filter((l) => l.storageArea === a)] as const).filter(([, ls]) => ls.length > 0), [lines]);
  const valueOf = (l: Line) => (money ? (guardOf(l).valueAgorot ?? (l.qty != null && l.qty === l.savedQty ? (l.valueAgorot ?? null) : null)) : null);
  const liveTotal = money ? lines.reduce((a, l) => a + (valueOf(l) ?? 0), 0) : null;

  // The flags still open (not confirmed for the qty now on screen).
  const flagged = lines
    .map((l) => ({ l, g: guardOf(l) }))
    .filter(({ l, g }) => g.flags.length > 0 && confirmed[l.productId] !== l.qty);

  const setDate = trpc.inventory.setMeta.useMutation({
    onSuccess: () => {
      setDateOpen(false);
      void utils.inventory.current.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const complete = trpc.inventory.complete.useMutation({
    onSuccess: (d) => {
      gone.current = true;
      q.clear();
      try {
        storage?.removeItem(`rm.inventory.confirmed.${draft.id}`);
      } catch {
        // nothing to clean
      }
      void utils.inventory.invalidate();
      onDone(d);
    },
    onError: (e) => {
      const last = /^NOT_AFTER_LAST:(\d{4}-\d{2}-\d{2})$/.exec(e.message);
      toast.error(
        last ? (last[1] === todayIL() ? t('count.notAfterLastToday') : t('count.notAfterLast', { date: dayText(last[1]!, locale) })) : friendlyError(e, tc),
      );
    },
  });
  const submit = trpc.inventory.submitForClose.useMutation({
    onSuccess: () => {
      toast.success(t('count.submitDone'));
      void utils.inventory.current.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const discard = trpc.inventory.discard.useMutation({
    onSuccess: () => {
      gone.current = true;
      q.clear();
      setDiscardOpen(false);
      void utils.inventory.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });

  const focusLine = (productId: string | null) => {
    if (!productId) return false;
    const el = document.getElementById(`qty-${productId}`) as HTMLInputElement | null;
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  };
  const goNext = (fromId: string) => {
    const nav = visible.map((l) => ({ productId: l.productId, area: l.storageArea, counted: l.qty != null || l.productId === fromId }));
    const next = nextUncounted(nav, fromId, AREAS);
    const fromArea = lines.find((l) => l.productId === fromId)?.storageArea;
    const toArea = lines.find((l) => l.productId === next)?.storageArea;
    if (next && toArea && toArea !== fromArea) announce(t(`areas.${toArea}`));
    if (!focusLine(next)) focusPrimary();
  };

  const onQty = (productId: string, raw: string) => {
    setInputs((p) => ({ ...p, [productId]: raw }));
    const c = classifyQty(raw);
    setAmbiguous((p) => {
      if (!(productId in p)) return p;
      const n = { ...p };
      delete n[productId];
      return n;
    });
    if (c.kind === 'typing') {
      setInvalid((p) => ({ ...p, [productId]: false }));
      return;
    }
    if (c.kind === 'invalid') {
      setInvalid((p) => ({ ...p, [productId]: true }));
      return;
    }
    setInvalid((p) => ({ ...p, [productId]: false }));
    if (c.kind === 'ambiguous') {
      // "1,250": a thousand and a quarter, or one and a quarter? Ask; queue nothing until it is answered.
      setAmbiguous((p) => ({ ...p, [productId]: c.options }));
      return;
    }
    queue(productId, { qty: c.kind === 'empty' ? null : c.value });
  };
  const pickAmbiguous = (productId: string, v: string) => {
    setAmbiguous((p) => {
      const n = { ...p };
      delete n[productId];
      return n;
    });
    setInputs((p) => ({ ...p, [productId]: qtyText(v) }));
    queue(productId, { qty: v });
  };
  const confirmFlag = (l: Line) => {
    const next = { ...confirmed, [l.productId]: l.qty ?? '' };
    setConfirmed(next);
    try {
      storage?.setItem(`rm.inventory.confirmed.${draft.id}`, JSON.stringify(next));
    } catch {
      // kept in memory for this visit
    }
  };

  const unpricedCounted = lines.filter((l) => l.qty != null && (l.status === 'noPrice' || l.status === 'unitMismatch')).length;
  const uncounted = lines.filter((l) => l.qty == null);
  const namesText = (ls: Array<{ name: string; nameEn: string | null }>) => {
    const names = ls.slice(0, 8).map((l) => (locale === 'en' && l.nameEn ? l.nameEn : l.name));
    return ls.length > 8 ? `${names.join(', ')} ${t('count.more', { count: ls.length - 8 })}` : names.join(', ');
  };
  // "Today" and the primary actions wait for hydration: the server's clock and render can't be trusted
  // to match the phone's, and a tap before hydration would be lost (the lines render from server data).
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIL()), []);
  const hydrated = today != null;
  const ilsText = (agorot: number) => moneyText(agorot / 100, 'tile', locale);
  const focusPrimary = () => document.getElementById('count-primary')?.focus();
  const headRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  // The sticky area headers sit right under the sticky top block; the list ends above the pinned bar.
  useEffect(() => {
    const set = () => {
      const root = document.documentElement;
      root.style.setProperty('--count-head-h', `${headRef.current?.offsetHeight ?? 0}px`);
      root.style.setProperty('--count-foot-h', `${footRef.current?.offsetHeight ?? 0}px`);
    };
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    if (headRef.current) ro?.observe(headRef.current);
    if (footRef.current) ro?.observe(footRef.current);
    return () => ro?.disconnect();
  }, []);

  const finish = async () => {
    if (!(await flush())) {
      setFlushError(q.size());
      return;
    }
    complete.mutate({
      countId: draft.id,
      acceptUncounted: uncounted.length > 0 ? acceptUncounted : undefined,
      confirmedFlags: Object.keys(confirmed).filter((id) => lines.find((l) => l.productId === id)?.qty === confirmed[id]),
    });
  };
  const handOff = async () => {
    if (!(await flush())) {
      setFlushError(q.size());
      return;
    }
    submit.mutate({ countId: draft.id });
  };

  return (
    <div data-mode="field" data-testid="count-field" className="pb-[calc(var(--count-foot-h,12rem)+1.5rem)]">
      {/* Sticky top: date chip, search, area chips — the walk-in's map. */}
      <div ref={headRef} className="sticky top-0 z-20 -mx-4 border-b border-line bg-surface px-4 pb-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <LinkButton href="/dashboard/inventory" variant="ghost" size="sm" className="touch-target -ms-2">
            <ArrowRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
            {t('count.back')}
          </LinkButton>
          <Button variant="secondary" size="sm" className="touch-target" onClick={() => setDateOpen(true)} data-testid="count-date-chip">
            {t('count.dateChip', {
              date: draft.countDate === today ? t('count.todayDate', { date: dayText(draft.countDate, locale) }) : dayText(draft.countDate, locale),
            })}
          </Button>
        </div>
        <h1 className="mt-1 text-xl font-bold text-ink">{t('title')}</h1>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input
            type="search"
            aria-label={t('count.search')}
            placeholder={t('count.search')}
            className="ps-9 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="count-search"
          />
        </div>
        <nav aria-label={t('count.areaChips')} className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {allAreas.map(([area, ls]) => {
            const c = ls.filter((l) => l.qty != null).length;
            return (
              <a
                key={area}
                href={`#area-${area}`}
                className="touch-target inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-[length:var(--focus-width,2px)] focus-visible:ring-primary"
                data-testid={`area-chip-${area}`}
              >
                <Ring done={c} total={ls.length} />
                {t(`areas.${area}`)}
                <span className="tabular-nums text-muted">
                  {c}/{ls.length}
                </span>
              </a>
            );
          })}
          <Button variant="ghost" size="sm" className="touch-target shrink-0" aria-pressed={arranging} onClick={() => setArranging((v) => !v)} data-testid="arrange-toggle">
            {arranging ? t('count.arrangeDone') : t('count.arrange')}
          </Button>
        </nav>
        {queued > 0 && saveState !== 'saving' && (saveState === 'error' || (typeof navigator !== 'undefined' && !navigator.onLine)) ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted" role="status" data-testid="count-queue">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-ink">
              <CloudUpload className="h-4 w-4" aria-hidden="true" />
              {t('count.queued', { count: queued })}
            </span>
            {others.length > 0 ? <span>{t('count.countedBy', { name: others.join(', ') })}</span> : null}
            <Button variant="ghost" size="sm" className="touch-target" onClick={() => void flush()}>
              {t('count.queuedSend')}
            </Button>
          </div>
        ) : null}
      </div>

      {arranging ? <p className="mt-3 text-sm text-muted">{t('count.arrangeHint')}</p> : null}
      {draft.lastClosedDate && draft.countDate <= draft.lastClosedDate ? (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-warn" role="status" data-testid="closed-on-warn">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {draft.lastClosedDate === today ? t('count.notAfterLastToday') : t('count.closedOnWarn', { date: dayText(draft.lastClosedDate, locale) })}
        </p>
      ) : null}
      {draft.submittedAt ? (
        <p className="mt-3 text-sm text-muted" data-testid="count-submitted">
          {t('count.submittedNote', { name: draft.submittedBy ?? '—' })}
        </p>
      ) : null}
      {lines.length === 0 ? <p className="mt-4 text-sm text-muted">{t('count.emptyList')}</p> : null}
      {needle && visible.length === 0 ? <p className="mt-4 text-sm text-muted">{t('count.searchEmpty')}</p> : null}

      {byArea.map(([area, ls]) => {
        const all = lines.filter((l) => l.storageArea === area);
        const c = all.filter((l) => l.qty != null).length;
        const areaValue = money ? all.reduce((a, l) => a + (valueOf(l) ?? 0), 0) : null;
        return (
          <section key={area} id={`area-${area}`} className="mt-3 scroll-mt-[var(--count-head-h,0px)]" aria-labelledby={`area-h-${area}`}>
            <h2
              id={`area-h-${area}`}
              className="sticky top-[var(--count-head-h,0px)] z-10 -mx-4 bg-surface-2 px-4 py-2 text-base font-semibold text-ink"
              data-testid={`area-header-${area}`}
            >
              {t(`areas.${area}`)} · <span className="tabular-nums">{c}/{all.length}</span>
              {areaValue != null ? (
                <>
                  {' · '}
                  <Money agorot={areaValue} context="tile" />
                </>
              ) : null}
            </h2>
            <ul className="mt-2 space-y-2">
              {ls.map((l) => {
                const inputId = `qty-${l.productId}`;
                const text = inputs[l.productId] ?? qtyText(l.qty);
                const bad = invalid[l.productId];
                const g = guardOf(l);
                const open = g.flags.length > 0 && confirmed[l.productId] !== l.qty;
                const msgKey = open ? guardMessageKey(g.flags, money, g.valueAgorot) : null;
                const amb = ambiguous[l.productId];
                return (
                  <li key={l.productId} data-testid={`line-${l.productId}`}>
                    <Card padding="none" className={cn('px-3 py-2', l.qty != null && 'border-primary/30', open && 'border-warn')}>
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink">{localName(l.name, l.nameEn, locale)}</p>
                          {l.prevQty != null ? (
                            <p className="text-sm text-muted" data-testid="last-time">
                              {t('count.lastTime', { qty: qtyText(l.prevQty) })}
                              {l.receivedSince != null && l.receivedSince !== '0.0000' ? <> · {t('count.receivedSince', { qty: qtyText(l.receivedSince) })}</> : null}
                            </p>
                          ) : null}
                        </div>
                        {arranging ? (
                          <div className="shrink-0">
                            <label className="sr-only" htmlFor={`area-sel-${l.productId}`}>
                              {t('count.area')}
                            </label>
                            <select
                              id={`area-sel-${l.productId}`}
                              value={l.storageArea}
                              onChange={(e) => queue(l.productId, { storageArea: e.target.value as Area })}
                              className="min-h-12 rounded-control border border-line-strong bg-surface px-2 text-base text-ink focus:outline-none focus-visible:ring-[length:var(--focus-width,2px)] focus-visible:ring-primary"
                            >
                              {AREAS.map((a) => (
                                <option key={a} value={a}>
                                  {t(`areas.${a}`)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2">
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
                                'h-14 w-28 rounded-control border bg-surface px-3 text-end text-2xl tabular-nums text-ink placeholder-subtle focus:border-primary focus:outline-none focus-visible:ring-[length:var(--focus-width,3px)] focus-visible:ring-primary',
                                bad || open ? 'border-warn' : 'border-line-strong',
                              )}
                              value={text}
                              placeholder="—"
                              aria-invalid={bad ? true : undefined}
                              aria-describedby={open ? `guard-${l.productId}` : undefined}
                              onChange={(e) => onQty(l.productId, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  goNext(l.productId);
                                }
                              }}
                              onBlur={() => void flush()}
                            />
                            <span className="w-14 text-sm text-ink">
                              <UnitText unit={l.unit} />
                            </span>
                          </div>
                        )}
                      </div>
                      {money && l.priceSource && l.unitCost ? (
                        <p className="mt-1 text-sm text-muted" data-testid="price-source">
                          <PriceSourceText unitCost={l.unitCost} unit={l.unit} source={l.priceSource} />
                        </p>
                      ) : null}
                      {money && l.qty != null && (l.status === 'noPrice' || l.status === 'unitMismatch') ? (
                        <Badge tone="neutral" className="mt-1">
                          {t('count.noPrice')}
                        </Badge>
                      ) : null}
                      {amb ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink" role="status" data-testid="qty-ambiguous">
                          {t('count.ambiguous', { a: amb[0], b: amb[1] })}
                          {amb.map((opt) => (
                            <Button key={opt} size="sm" variant="secondary" className="touch-target" onClick={() => pickAmbiguous(l.productId, opt)}>
                              {opt}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      {msgKey ? (
                        <div id={`guard-${l.productId}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-control bg-warn/10 px-3 py-2 text-sm text-ink" role="status" data-testid="qty-guard">
                          <CircleAlert className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            {t(`count.${msgKey}`, {
                              qty: qtyText(l.qty),
                              unit: l.unit,
                              value: g.valueAgorot != null ? ilsText(g.valueAgorot) : '',
                              expected: qtyText(l.expectedQty),
                            })}
                          </span>
                          <Button size="sm" variant="secondary" className="touch-target" onClick={() => confirmFlag(l)} data-testid="guard-confirm">
                            {t('count.guardConfirm')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="touch-target"
                            onClick={() => {
                              const el = document.getElementById(inputId) as HTMLInputElement | null;
                              el?.focus();
                              el?.select();
                            }}
                          >
                            {t('count.guardFix')}
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <AddProduct countId={draft.id} existing={new Set(lines.map((l) => l.productId))} beforeAdd={flush} />

      {draft.canDiscard ? (
        <div className="mt-8">
          <Button variant="ghost" className="touch-target text-danger" onClick={() => setDiscardOpen(true)} data-testid="count-discard">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('count.discard')}
          </Button>
        </div>
      ) : null}

      {/* One primary action, pinned to the bottom third of the phone. */}
      <div
        ref={footRef}
        className="fixed inset-x-0 bottom-[calc(max(var(--rm-bottomnav-h,0px),env(safe-area-inset-bottom))+var(--consent-h,0px))] z-30 border-t border-line bg-surface p-3 lg:bottom-[var(--consent-h,0px)]"
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-2" data-testid="count-progress">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-ink">{t('count.progress', { counted, lines: lines.length })}</span>
              {money && liveTotal != null ? (
                <span className="text-muted">
                  {t('count.liveValue')}: <Money agorot={liveTotal} context="tile" className="font-semibold text-ink" />
                </span>
              ) : null}
              <span className="text-muted" role="status" aria-live="polite">
                {saveState === 'saving' ? t('count.saving') : saveState === 'saved' && queued === 0 ? t('count.saved') : ''}
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
          {flushError != null ? (
            <p className="mb-2 text-sm text-ink" role="status" data-testid="flush-error">
              {t('count.flushFailed', { count: flushError || queued })}
            </p>
          ) : null}
          {confirming ? (
            <div role="region" aria-labelledby="finish-title" className="space-y-2">
              <p id="finish-title" className="font-semibold text-ink">
                {t('count.finishTitle')}
              </p>
              <p className="text-sm text-muted">{t('count.finishBody', { date: dayText(draft.countDate, locale) })}</p>
              {flagged.length > 0 ? (
                <div className="text-sm text-ink" data-testid="flags-panel">
                  <p className="font-semibold">{t('count.flagsPanel', { count: flagged.length })}</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {flagged.map(({ l }) => (
                      <li key={l.productId}>
                        <button
                          type="button"
                          className="touch-target min-h-12 rounded-full border border-warn px-3 text-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[length:var(--focus-width,2px)] focus-visible:ring-primary"
                          onClick={() => {
                            setConfirming(false);
                            setTimeout(() => focusLine(l.productId), 0);
                          }}
                        >
                          {locale === 'en' && l.nameEn ? l.nameEn : l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted">{t('count.flagsBlock')}</p>
                </div>
              ) : null}
              {uncounted.length > 0 ? (
                <div className="space-y-1 text-sm text-ink" data-testid="uncounted-list">
                  <p className="flex items-center gap-1.5">
                    <CircleAlert className="h-4 w-4 text-warn" aria-hidden="true" />
                    {t('count.notCountedWarn', { count: uncounted.length })}
                  </p>
                  <p className="text-sm text-muted">{t('count.uncountedList', { names: namesText(uncounted) })}</p>
                  <label className="flex min-h-12 items-start gap-2 text-sm text-ink">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={acceptUncounted} onChange={(e) => setAcceptUncounted(e.target.checked)} />
                    {t('count.acceptUncounted')}
                  </label>
                </div>
              ) : null}
              {unpricedCounted > 0 && money ? <p className="text-sm text-muted">{t('count.unpricedWarn', { count: unpricedCounted })}</p> : null}
              <div className="flex flex-col gap-2">
                <Button
                  id="count-primary"
                  size="xl"
                  className="touch-target"
                  loading={complete.isPending}
                  disabled={flagged.length > 0 || (uncounted.length > 0 && !acceptUncounted)}
                  onClick={() => void finish()}
                  data-testid="finish-confirm"
                >
                  <Check className="h-5 w-5" aria-hidden="true" />
                  {t('count.finishConfirm')}
                </Button>
                <Button variant="secondary" className="touch-target" onClick={() => setConfirming(false)}>
                  {t('count.cancel')}
                </Button>
              </div>
            </div>
          ) : draft.canClose ? (
            <Button id="count-primary" size="xl" className="touch-target" disabled={!hydrated || counted === 0} onClick={() => setConfirming(true)} data-testid="count-finish">
              {counted === 0 ? t('count.nothingCounted') : t('count.finish')}
            </Button>
          ) : (
            <Button
              id="count-primary"
              size="xl"
              className="touch-target"
              disabled={!hydrated || counted === 0 || !!draft.submittedAt}
              loading={submit.isPending}
              onClick={() => void handOff()}
              data-testid="count-submit"
            >
              <Send className="h-5 w-5" aria-hidden="true" />
              {draft.submittedAt ? t('count.submitDone') : t('count.submit')}
            </Button>
          )}
        </div>
      </div>

      <Sheet
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        title={t('count.dateSheetTitle')}
        description={t('count.dateSheetNote')}
        primary={
          <Button
            size="xl"
            loading={setDate.isPending}
            disabled={!today || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || dateValue > today || dateValue === draft.countDate}
            onClick={() => setDate.mutate({ countId: draft.id, countDate: dateValue })}
          >
            {t('count.dateSave')}
          </Button>
        }
      >
        <label className="block text-sm text-muted" htmlFor="count-date">
          {t('count.date')}
        </label>
        <DateField id="count-date" className="mt-1 text-base" min="2000-01-01" max={today ?? undefined} value={dateValue} onValueChange={(v) => setDateValue(v ?? '')} />
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        title={t('count.discardTitle', { date: dayText(draft.countDate, locale), count: counted })}
        body={t('count.discardBody')}
        confirmLabel={t('count.discardConfirmCta')}
        cancelLabel={t('count.cancel')}
        loading={discard.isPending}
        onConfirm={() => discard.mutate({ countId: draft.id })}
        onClose={() => setDiscardOpen(false)}
      />
    </div>
  );
}

/** A completion ring for an area chip (done / total), decorative: the text next to it says the same. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 0 : done / total;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" className="text-primary" strokeWidth="3" strokeDasharray={`${c * frac} ${c}`} />
    </svg>
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
        <Plus className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input aria-label={t('count.addTitle')} placeholder={t('count.addPlaceholder')} className="ps-9 text-base" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="min-w-0 text-sm text-ink">{localName(p.name, p.nameEn, locale)}</span>
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  // a11y-06: focus lands on the summary heading after Finish.
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <Card padding="lg" className="mx-auto max-w-lg text-center" data-testid="count-done">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
        <Check className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-bold text-ink focus:outline-none" data-testid="count-done-title">
        {t('count.doneTitle')}
      </h1>
      <p className="mt-2 text-3xl font-bold text-ink" data-testid="count-done-value">
        <Money agorot={done.foodValueAgorot} context="tile" />
      </p>
      <p className="mt-1 text-sm text-muted" data-testid="count-done-stock">
        {t('detail.stockLine', {
          food: moneyText(done.foodValueAgorot / 100, 'line', locale),
          total: moneyText(done.totalValueAgorot / 100, 'line', locale),
        })}
      </p>
      <p className="mt-1 text-sm text-muted">
        {dayText(done.countDate, locale)} · {t('count.doneCounted', { counted: done.counted })}
      </p>
      {done.notCounted > 0 ? <p className="mt-2 text-sm text-ink">{t('count.notCountedWarn', { count: done.notCounted })}</p> : null}
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

/** "₪149.00 per kg · invoice ‹4711›, 20 Oct 2026, HaKerem Butchery" — the paid price the owner recognises, never truncated. */
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
  const price = moneyText(Number(unitCost), 'line', locale);
  return source.invoiceNumber ? (
    <>
      {t('count.priceFrom', { price, unit, invoice: '⁨' + source.invoiceNumber + '⁩', date, supplier: source.supplierName ?? '—' })}
    </>
  ) : (
    <>{t('count.priceFromNoInvoice', { price, unit, supplier: source.supplierName ?? '—', date })}</>
  );
}
