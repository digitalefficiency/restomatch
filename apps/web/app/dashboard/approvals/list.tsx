'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Clock, FileText, MoreHorizontal, Send, Undo2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { intlLocaleOf } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import { Badge, Card, LoadMore, Textarea, cn, type BadgeTone } from '@/lib/components';
import { WhyLine } from '@/lib/components/flags';
import { BatchBar } from '@/lib/components/table/BatchBar';
import { useTableUrlState } from '@/lib/components/table/useTableUrlState';
import { Peek } from '@/lib/components/desk/Peek';
import { deskKeyOf, isTypingTarget, moveIndex } from '@/lib/components/desk/keys';
import { useMediaQuery } from '@/lib/components/desk/useMediaQuery';
import { DeadlineChip } from '@/lib/components/money';
import { BULK_CAP_AGOROT, bulkSelection, groupByInvoice, newClientMutationId } from './groups';
import {
  EscalateSheet,
  EvidenceBody,
  GroupHeader,
  HistoryDisclosure,
  KeysButton,
  KeysHelp,
  effectLine,
  ils,
} from './desk';
import {
  ageDays,
  amountLabelKey,
  canEscalate,
  decisionActions,
  discrepancyLabel,
  displayName,
  parseDecidedConflict,
  resolutionLabel,
  severityLabel,
  waiveReasons,
  whyLine,
  whyText,
  type DecisionAction,
  type WaiveReason,
} from './vocab';

type QueueItem = inferRouterOutputs<AppRouter>['approvals']['myQueue'][number];
export type QueueSummary = inferRouterOutputs<AppRouter>['approvals']['queueSummary'];
type T = Translator<typeof approvalsHe>;

/** The view filters the server page was rendered with (URL → myQueue input). */
export interface QueueFilters {
  types?: QueueItem['type'][];
  severities?: QueueItem['severity'][];
  supplierIds?: string[];
  /** The notification landing: one invoice's rows (`?invoice=<id>`). */
  invoiceIds?: string[];
}

// Must equal the server page size so "has more" is right on first paint.
const PAGE = 50;
/** Optimistic exit (approvals-04): the card leaves in 150 ms, then focus moves on. */
const EXIT_MS = 150;
/** Undo toast lifetime (R-7); the server allows a little more (REOPEN_WINDOW_MS). */
const UNDO_MS = 10_000;

/** A duplicate's ₪ (incl. VAT) is reported apart from the claimable total. */
const OUTSIDE_CLAIMABLE_TOTAL = new Set(['DUPLICATE_INVOICE']);

type Decide =
  | { procedure: 'approve' }
  | { procedure: 'reject'; reason: string; reasonCode: WaiveReason | 'reviewed' }
  | { procedure: 'escalate'; note?: string };

interface UndoState {
  id: string;
  /** A bulk decision: every id it decided (undo = reopenMany). */
  ids?: string[];
  text: string;
  /** Epoch ms when the toast ends (paused → `remaining` holds the rest). */
  until: number;
  remaining: number | null;
  failed?: boolean;
}

export function ApprovalsList({
  initial,
  initialSummary,
  filters = {},
  filtered = false,
  filteredNote,
  density = 'comfortable',
  viewerRole = null,
  landing = false,
}: {
  initial: QueueItem[];
  initialSummary: QueueSummary;
  filters?: QueueFilters;
  /** A view filter is set (the empty state then says so). */
  filtered?: boolean;
  /** The views namespace's "no rows match these filters" line. */
  filteredNote?: string;
  density?: 'comfortable' | 'compact';
  /** The signed-in member's role (hides "escalate to owner" for the owner). */
  viewerRole?: string | null;
  /** `/dashboard/approvals/[invoiceId]`: one card at a time, the 50/50 pair pinned to the thumb. */
  landing?: boolean;
}) {
  const compact = density === 'compact';
  const t = useT(approvals);
  const locale = useLocale();
  const utils = trpc.useUtils();

  // The loaded rows, in server order. Decided rows are HIDDEN, not removed, so a
  // failure or an undo puts the card back exactly where it was.
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [exiting, setExiting] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState<QueueSummary>(initialSummary);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rowError, setRowError] = useState<Record<string, { text: string; retry?: () => void }>>(
    {},
  );
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waiveFor, setWaiveFor] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const primaryRefs = useRef(new Map<string, HTMLElement | null>());
  const cardRefs = useRef(new Map<string, HTMLElement | null>());
  const emptyRef = useRef<HTMLHeadingElement | null>(null);

  const approve = trpc.approvals.approve.useMutation();
  const reject = trpc.approvals.reject.useMutation();
  const escalate = trpc.approvals.escalate.useMutation();
  const reopen = trpc.approvals.reopen.useMutation();
  const decideMany = trpc.approvals.decideMany.useMutation();
  const reopenMany = trpc.approvals.reopenMany.useMutation();

  // Desk state (W2-04): the bulk selection, the evidence target (`?sel=`), the
  // escalation sheet and the keyboard help.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [escalateFor, setEscalateFor] = useState<QueueItem | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const [url, updateUrl] = useTableUrlState();
  const wide = useMediaQuery('(min-width: 1280px)', false);
  const listRef = useRef<HTMLUListElement | null>(null);

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const visible = items.filter((d) => !hidden.has(d.id));

  /** Server totals after a decision settles (counts only — page 1 is never refetched). */
  // Overlapping refreshes (two quick decisions): only the newest request may
  // land, so an older, slower response never overwrites fresher tiles.
  const summarySeq = useRef(0);
  const refreshSummary = useCallback(async () => {
    const seq = ++summarySeq.current;
    try {
      const fresh = await utils.approvals.queueSummary.fetch(filters, { staleTime: 0 });
      if (seq === summarySeq.current) setSummary(fresh);
    } catch {
      /* the optimistic numbers stay; the next decision retries */
    }
  }, [utils, filters]);

  function adjustSummary(d: QueueItem, sign: 1 | -1) {
    setSummary((s) => ({
      ...s,
      count: Math.max(0, s.count + sign),
      blockers: Math.max(0, s.blockers + (d.severity === 'block' ? sign : 0)),
      toDecide: d.claimable
        ? { ...s.toDecide, count: Math.max(0, s.toDecide.count + sign) }
        : s.toDecide,
      toReview: d.claimable ? s.toReview : { count: Math.max(0, s.toReview.count + sign) },
      claimableIls:
        !d.claimable || OUTSIDE_CLAIMABLE_TOTAL.has(d.type)
          ? s.claimableIls
          : Math.max(
              0,
              Math.round(s.claimableIls * 100 + sign * (d.claimAgorot ?? 0)) / 100,
            ),
    }));
  }

  const focusAfter = (d: QueueItem) => {
    const rest = items.filter((x) => !hidden.has(x.id) && x.id !== d.id);
    const idx = items.findIndex((x) => x.id === d.id);
    const next =
      items.slice(idx + 1).find((x) => rest.includes(x)) ??
      [...items.slice(0, idx)].reverse().find((x) => rest.includes(x));
    requestAnimationFrame(() => {
      const el = next
        ? (primaryRefs.current.get(next.id) ?? cardRefs.current.get(next.id))
        : emptyRef.current;
      el?.focus({ preventScroll: false });
    });
  };

  function decide(d: QueueItem, action: Decide, doneLabel: string) {
    setRowError((e) => omit(e, d.id));
    setWaiveFor(null);
    setBusyId(d.id);
    setExiting((s) => add(s, d.id));
    adjustSummary(d, -1);
    const exitTimer = window.setTimeout(() => {
      setHidden((s) => add(s, d.id));
      setExiting((s) => remove(s, d.id));
      focusAfter(d);
    }, EXIT_MS);

    const call =
      action.procedure === 'approve'
        ? approve.mutateAsync({
            discrepancyId: d.id,
            expectedStatus: d.resolutionStatus as 'open' | 'escalated',
            seenClaimAgorot: d.claimAgorot,
          })
        : action.procedure === 'reject'
          ? reject.mutateAsync({
              discrepancyId: d.id,
              reason: action.reason,
              reasonCode: action.reasonCode,
            })
          : escalate.mutateAsync({ discrepancyId: d.id, note: action.note });
    const amount = money(Math.abs(Number(d.deltaAmount ?? 0)));
    const what = [itemName(locale, d) || discrepancyLabel(t, d.type), amount].join(' · ');

    call
      .then(() => {
        const left = Math.max(0, summary.count - 1);
        setAnnouncement(
          t('undo.announce', { verb: doneLabel, what, count: formatNumber(left, locale) }),
        );
        setUndo({
          id: d.id,
          text: t('undo.done', { verb: doneLabel, amount }),
          until: Date.now() + UNDO_MS,
          remaining: null,
        });
        void refreshSummary();
      })
      .catch((err: { data?: { code?: string } | null; message?: string }) => {
        window.clearTimeout(exitTimer);
        adjustSummary(d, 1);
        // Back where it was (it never left `items`).
        setExiting((s) => remove(s, d.id));
        setHidden((s) => remove(s, d.id));
        const conflict = err.data?.code === 'CONFLICT' ? parseDecidedConflict(err.message) : null;
        const moved = err.data?.code === 'CONFLICT' ? parseAmountChanged(err.message) : null;
        if (moved) {
          // The claimable ₪ changed under the decider: show the new figure, decide again.
          setItems((xs) => xs.map((x) => (x.id === d.id ? { ...x, claimAgorot: moved.nowAgorot } : x)));
          setRowError((e) => ({
            ...e,
            [d.id]: { text: t('desk.amountChanged', { amount: ils(moved.nowAgorot, locale) }) },
          }));
          void refreshSummary();
        } else if (conflict && conflict.status === 'escalated' && viewerRole === 'owner') {
          // A colleague escalated this card to ME while I looked at it: it is
          // still a decision, now mine. Update it in place and keep the actions.
          const fresh = { ...d, resolutionStatus: 'escalated', requiredRole: 'owner' as const, canAct: true };
          setItems((xs) => xs.map((x) => (x.id === d.id ? (fresh as QueueItem) : x)));
          setRowError((e) => ({ ...e, [d.id]: { text: t('desk.escalatedToYou') } }));
          void refreshSummary();
        } else if (conflict) {
          setDecided((m) => ({ ...m, [d.id]: conflictText(t, conflict, locale) }));
          void refreshSummary();
        } else {
          setRowError((e) => ({
            ...e,
            [d.id]: {
              text: err.data?.code === 'FORBIDDEN' ? t('card.forbidden') : t('card.error'),
              retry:
                err.data?.code === 'FORBIDDEN' ? undefined : () => decide(d, action, doneLabel),
            },
          }));
          requestAnimationFrame(() => primaryRefs.current.get(d.id)?.focus());
        }
      })
      .finally(() => setBusyId((b) => (b === d.id ? null : b)));
  }

  async function undoLast() {
    if (!undo || undo.failed) return;
    const { id } = undo;
    const d = items.find((x) => x.id === id);
    try {
      if (undo.ids) {
        await reopenMany.mutateAsync({ discrepancyIds: undo.ids });
        setUndo(null);
        const back = new Set(undo.ids);
        setHidden((s) => new Set([...s].filter((x) => !back.has(x))));
        for (const x of items) if (back.has(x.id)) adjustSummary(x, 1);
        setAnnouncement(t('undo.undone'));
        void refreshSummary();
        return;
      }
      await reopen.mutateAsync({ discrepancyId: id });
      setUndo(null);
      setHidden((s) => remove(s, id));
      if (d) adjustSummary(d, 1);
      setAnnouncement(t('undo.undone'));
      void refreshSummary();
      requestAnimationFrame(() =>
        (primaryRefs.current.get(id) ?? cardRefs.current.get(id))?.focus(),
      );
    } catch {
      setUndo({
        ...undo,
        text: t('undo.failed'),
        failed: true,
        until: Date.now() + 5000,
        remaining: null,
      });
    }
  }

  // Undo toast timer; paused while hovered or focused (remaining != null).
  useEffect(() => {
    if (!undo || undo.remaining != null) return;
    const ms = undo.until - Date.now();
    if (ms <= 0) {
      setUndo(null);
      return;
    }
    const h = window.setTimeout(() => setUndo((u) => (u === undo ? null : u)), ms);
    return () => window.clearTimeout(h);
  }, [undo]);
  const pauseUndo = () =>
    setUndo((u) =>
      u && u.remaining == null ? { ...u, remaining: Math.max(0, u.until - Date.now()) } : u,
    );
  const resumeUndo = () =>
    setUndo((u) =>
      u && u.remaining != null ? { ...u, until: Date.now() + u.remaining, remaining: null } : u,
    );

  async function loadMore() {
    setLoadingMore(true);
    try {
      // Keyset paging after the last loaded row (decided or not — the server
      // recomputes its sort key from the row), so rows decided elsewhere never
      // make the next page skip anything.
      const last = items[items.length - 1];
      if (!last) return;
      const next = await utils.approvals.myQueue.fetch(
        { limit: PAGE, ...filters, afterId: last.id },
        { staleTime: 0 },
      );
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...next.filter((x) => !seen.has(x.id))];
      });
      setHasMore(next.length >= PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Bulk approve (exec-desktop-08): ONE server call, all-or-nothing. The server
   * refuses a blocking row and any invoice over ₪200 on its own; the UI never
   * offers those (BatchBar / group primary), so a refusal here is a race.
   */
  // One replay id per attempt on the SAME selection: a re-tap after a lost
  // response replays (the server answers with the first result), never a 2nd batch.
  const batchAttempt = useRef<{ key: string; id: string } | null>(null);
  async function reloadQueue() {
    try {
      const fresh = await utils.approvals.myQueue.fetch({ limit: PAGE, ...filters }, { staleTime: 0 });
      setItems(fresh);
      setHidden(new Set());
      setSelected(new Set());
      setHasMore(fresh.length >= PAGE);
    } catch {
      /* the note already says the outcome is unknown */
    }
    void refreshSummary();
  }

  function decideBatch(rows: QueueItem[], doneLabel: string) {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    setBatchNote(null);
    setBusyId('batch');
    const total = rows.reduce((n, r) => n + (r.claimable ? r.claimAgorot : 0), 0);
    decideMany
      .mutateAsync({
        items: rows.map((r) => ({
          discrepancyId: r.id,
          expectedStatus: r.resolutionStatus as 'open' | 'escalated',
        })),
        decision: 'accepted',
        clientMutationId: (() => {
          const key = [...ids].sort().join(',');
          if (batchAttempt.current?.key !== key) batchAttempt.current = { key, id: newClientMutationId() };
          return batchAttempt.current.id;
        })(),
      })
      .then(() => {
        for (const r of rows) adjustSummary(r, -1);
        setHidden((s) => new Set([...s, ...ids]));
        setSelected((s) => new Set([...s].filter((x) => !ids.includes(x))));
        const text = t('desk.batchDone', { count: formatNumber(rows.length, locale), amount: ils(total, locale) });
        setAnnouncement(`${doneLabel} · ${text}`);
        setUndo({ id: ids[0]!, ids, text, until: Date.now() + UNDO_MS, remaining: null });
        batchAttempt.current = null;
        void refreshSummary();
      })
      .catch((err: { data?: { code?: string } | null }) => {
        const code = err.data?.code;
        if (code === 'CONFLICT') setBatchNote(t('desk.batchConflict'));
        else if (code === 'FORBIDDEN' || code === 'BAD_REQUEST') setBatchNote(t('desk.batchError'));
        else {
          // Network / server error: the batch may or may not have committed.
          setBatchNote(t('desk.batchUnknown'));
          void reloadQueue();
        }
      })
      .finally(() => setBusyId((b) => (b === 'batch' ? null : b)));
  }

  const liveRows = items.filter((d) => !hidden.has(d.id) && !decided[d.id]);
  const batch = bulkSelection(liveRows, selected);
  const batchReason = batch.blocked.some((b) => b.why === 'block')
    ? t('desk.batchBlock')
    : batch.blocked.some((b) => b.why === 'cannotAct')
      ? t('desk.batchCannotAct')
      : batch.blocked.some((b) => b.why === 'over_cap')
        ? t('desk.batchOverCap', { cap: ils(BULK_CAP_AGOROT, locale) })
        : undefined;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // The evidence target: `?sel=` (Back and shared links restore it).
  const selRow = url.sel ? liveRows.find((d) => d.id === url.sel) ?? null : null;
  const showEvidence = (d: QueueItem) => {
    updateUrl({ sel: d.id });
    if (!wide) setPeekOpen(true);
  };
  const escalateAllowed = (d: QueueItem) => canEscalate(d.requiredRole, viewerRole) && d.canAct !== false;

  /**
   * Desk keys (R-9), bound by `KeyboardEvent.code` (ח/ל/ס on a Hebrew layout),
   * live only while focus is inside the list and never while typing.
   */
  function onListKey(e: React.KeyboardEvent<HTMLUListElement>) {
    if (isTypingTarget(e.target)) return;
    const rows = liveRows;
    const holder = (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]');
    const cur = holder ? rows.findIndex((r) => r.id === holder.dataset.rowId) : -1;
    const d = cur >= 0 ? rows[cur]! : null;
    const focusRow = (i: number) => {
      const r = rows[i];
      if (!r) return;
      cardRefs.current.get(r.id)?.focus();
      updateUrl({ sel: r.id });
    };
    const k = deskKeyOf(e);
    if (k === 'next' || k === 'prev') {
      e.preventDefault();
      focusRow(moveIndex(cur, k === 'next' ? 1 : -1, rows.length));
      return;
    }
    if (k === 'select' && d) {
      e.preventDefault();
      if (d.severity !== 'block') toggle(d.id);
      return;
    }
    if ((k === 'open' || e.code === 'KeyO') && d && !(e.target as HTMLElement).closest('button,a')) {
      e.preventDefault();
      showEvidence(d);
      return;
    }
    if (k === 'escape' && selected.size > 0) {
      e.preventDefault();
      setSelected(new Set());
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Slash' && e.shiftKey) {
      e.preventDefault();
      setKeysOpen(true);
    } else if (e.code === 'KeyZ' && undo && !undo.failed) {
      e.preventDefault();
      void undoLast();
    } else if (d && e.code === 'Digit1') {
      e.preventDefault();
      primaryRefs.current.get(d.id)?.click();
    } else if (d && e.code === 'Digit2') {
      e.preventDefault();
      cardRefs.current.get(d.id)?.querySelector<HTMLButtonElement>('[data-testid="decide-reject"]')?.click();
    } else if (d && e.code === 'Digit3' && escalateAllowed(d)) {
      e.preventDefault();
      setEscalateFor(d);
    }
  }

  // A `?sel=` that arrives from the URL (Back, a link) scrolls its card into view once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !url.sel) return;
    restored.current = true;
    cardRefs.current.get(url.sel)?.scrollIntoView({ block: 'nearest' });
  }, [url.sel]);

  const others = summary.others;
  const roleName = (r: string) => {
    const out = t(`roles.${r}` as MessageKey<typeof approvalsHe>);
    return out.startsWith('roles.') ? r : out;
  };

  const renderCard = (d: QueueItem) => {
            if (hidden.has(d.id)) return null;
            if (decided[d.id]) {
              return (
                <li key={d.id}>
                  <Card
                    padding="sm"
                    role="status"
                    className="flex items-center justify-between gap-3 text-sm text-muted"
                  >
                    <span>{decided[d.id]}</span>
                    <button
                      type="button"
                      className="touch-target shrink-0 rounded-lg px-3 font-semibold text-ink hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
                      onClick={() => setHidden((s) => add(s, d.id))}
                    >
                      {t('card.hide')}
                    </button>
                  </Card>
                </li>
              );
            }
            return (
              <li
                key={d.id}
                ref={(el) => {
                  cardRefs.current.set(d.id, el);
                }}
                tabIndex={-1}
                data-row-id={d.id}
                className={cn(
                  'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                  exiting.has(d.id) && 'pointer-events-none -translate-y-1 opacity-0',
                )}
              >
                <DecisionCard
                  d={d}
                  t={t}
                  locale={locale}
                  compact={compact}
                  viewerRole={viewerRole}
                  busy={busyId === d.id}
                  error={rowError[d.id] ?? null}
                  waiveOpen={waiveFor === d.id}
                  onWaiveOpen={(open) => setWaiveFor(open ? d.id : null)}
                  onDecide={(action, label) => decide(d, action, label)}
                  primaryRef={(el) => {
                    primaryRefs.current.set(d.id, el);
                  }}
                  onEscalate={escalateAllowed(d) ? () => setEscalateFor(d) : undefined}
                  sticky={landing}
                  select={
                    landing || d.canAct === false ? null : (
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--c-primary)]"
                        checked={selected.has(d.id)}
                        disabled={d.severity === 'block'}
                        title={d.severity === 'block' ? t('desk.batchBlock') : undefined}
                        aria-label={t('desk.select', { name: itemName(locale, d) || discrepancyLabel(t, d.type) })}
                        onChange={() => toggle(d.id)}
                        data-testid="card-select"
                      />
                    )
                  }
                  footer={
                    <div className="mt-2 flex flex-wrap items-center gap-x-4">
                      <button
                        type="button"
                        onClick={() => showEvidence(d)}
                        aria-pressed={url.sel === d.id}
                        className="inline-flex min-h-12 items-center rounded-lg text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
                        data-testid="card-evidence"
                      >
                        {t('desk.evidence')}
                      </button>
                      <HistoryDisclosure id={d.id} t={t} locale={locale} />
                    </div>
                  }
                />
              </li>
            );
  };

  /** The decision buttons inside the evidence: they press the card's own, so there is one decision path. */
  const evidenceActions = (d: QueueItem) => (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => primaryRefs.current.get(d.id)?.click()}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-3 text-sm font-semibold text-on-primary hover:brightness-95 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        data-testid="evidence-primary"
      >
        {primaryLabel(d)}
      </button>
      {escalateAllowed(d) ? (
        <button
          type="button"
          onClick={() => setEscalateFor(d)}
          className="inline-flex h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t('decision.escalate')}
        </button>
      ) : null}
      {d.claimable ? <p className="col-span-2 text-xs text-muted">{effectLine(t, d.invoiceStatus)}</p> : null}
    </div>
  );
  const primaryLabel = (d: QueueItem) => {
    const a = decisionActions(d.type, d.claimable)[0];
    if (!a) return t('decision.reviewed');
    const amount = formatIls(Math.abs(Number(d.deltaAmount ?? 0)), { locale, maximumFractionDigits: 2 });
    return 'withAmount' in a && a.withAmount ? t(a.label).replace('{amount}', amount) : t(a.label);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <p className="sr-only" role="status" aria-live="polite" data-testid="approvals-announcer">
        {announcement}
      </p>
      {landing ? null : (
        <div className="hidden justify-end lg:flex">
          <KeysButton t={t} onOpen={() => setKeysOpen(true)} />
        </div>
      )}

      {/* Server totals (approvals-08). Phone: one line; desktop: tiles. Ink — red only on blockers.
          An empty queue shows its inbox-zero state alone, not a row of zeros. */}
      {summary.count > 0 || visible.length > 0 ? (
        <>
          <p className="text-sm text-muted sm:hidden" data-testid="approvals-summary-line">
            <bdi className="font-semibold tabular-nums text-ink">
              {formatNumber(summary.count, locale)}
            </bdi>{' '}
            {t('summary.inQueue')}
            {' · '}
            <bdi className="font-semibold tabular-nums text-ink">
              {money(summary.claimableIls)}
            </bdi>{' '}
            {t('summary.atRisk')}
            {' · '}
            <bdi
              className={cn(
                'font-semibold tabular-nums',
                summary.blockers > 0 ? 'text-danger' : 'text-ink',
              )}
            >
              {formatNumber(summary.blockers, locale)}
            </bdi>{' '}
            {t('summary.blockers')}
          </p>
          <div className="hidden gap-3 sm:grid sm:grid-cols-4" data-testid="approvals-summary">
            <SummaryTile
              label={t('summary.inQueue')}
              value={formatNumber(summary.count, locale)}
              caption={t('summary.split', {
                decide: formatNumber(summary.toDecide.count, locale),
                review: formatNumber(summary.toReview.count, locale),
              })}
              testId="summary-count"
            />
            <SummaryTile
              label={t('summary.atRisk')}
              value={money(summary.claimableIls)}
              caption={t('summary.atRiskBasis')}
              testId="summary-claimable"
            />
            <SummaryTile
              label={t('summary.blockers')}
              value={formatNumber(summary.blockers, locale)}
              danger={summary.blockers > 0}
              testId="summary-blockers"
            />
            <SummaryTile
              label={t('summary.oldest')}
              value={
                summary.oldestAt
                  ? (ageText(summary.oldestAt, locale) ?? t('card.waitingToday'))
                  : '—'
              }
              testId="summary-oldest"
            />
          </div>
          {summary.duplicateIls > 0 ? (
            <p className="text-xs text-muted">
              {t('summary.duplicates', { amount: money(summary.duplicateIls) })}
            </p>
          ) : null}
          {summary.vatIls > 0 ? (
            <p className="text-xs text-muted">{t('summary.vat', { amount: money(summary.vatIls) })}</p>
          ) : null}
        </>
      ) : null}

      {visible.length === 0 && !hasMore ? (
        <EmptyQueue
          t={t}
          headingRef={emptyRef}
          filtered={filtered}
          filteredNote={filteredNote}
          others={others}
          money={money}
          roleName={roleName}
          locale={locale}
        />
      ) : (
        <div
          className={cn(
            !landing && 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start xl:gap-5',
            !landing && '[@media(min-width:1536px)]:grid-cols-[380px_minmax(0,1fr)]',
          )}
        >
          <div className="min-w-0 space-y-3">
            {selected.size > 0 ? (
              <BatchBar
                count={batch.rows.length}
                sum={{ kind: 'sum', sumAgorot: batch.sumAgorot, unknownCount: 0 }}
                notes={batchNote ? [batchNote] : []}
                actions={[
                  {
                    id: 'approve',
                    label: t('desk.batchApprove'),
                    primary: true,
                    disabled: batch.disabled || busyId === 'batch',
                    disabledReason: batchReason,
                    onRun: () => decideBatch(batch.rows, t('decision.approved')),
                  },
                ]}
                onClear={() => setSelected(new Set())}
              />
            ) : null}
            {landing ? (
              <ul aria-label={t('title')} onKeyDown={onListKey} ref={listRef}>
                {liveRows[0] ? renderCard(liveRows[0]) : null}
              </ul>
            ) : (
              <ul
                className={compact ? 'space-y-3' : 'space-y-5'}
                aria-label={t('title')}
                onKeyDown={onListKey}
                ref={listRef}
                data-testid="approvals-list"
              >
                {groupByInvoice(items.filter((d) => !hidden.has(d.id))).map((g) => (
                  <li key={g.key} className="space-y-2">
                    <GroupHeader
                      g={g}
                      t={t}
                      locale={locale}
                      busy={busyId === 'batch'}
                      onApproveAll={() => decideBatch(g.rows.filter((r) => !decided[r.id]), t('desk.groupApproveDone'))}
                    />
                    <ul className={compact ? 'space-y-2' : 'space-y-3'}>{g.rows.map(renderCard)}</ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!landing && wide ? (
            <aside
              className="sticky top-4 hidden min-w-0 rounded-2xl border border-line bg-surface p-4 xl:block"
              aria-label={t('desk.evidenceTitle')}
              data-testid="approvals-evidence-pane"
            >
              {selRow ? (
                <EvidenceBody d={selRow} t={t} locale={locale} actions={evidenceActions(selRow)} split />
              ) : (
                <p className="text-sm text-muted">{t('desk.evidenceEmpty')}</p>
              )}
            </aside>
          ) : null}
        </div>
      )}
      <LoadMore onClick={loadMore} loading={loadingMore} hasMore={hasMore} />

      {visible.length > 0 && others.count > 0 ? (
        <OthersLane t={t} others={others} money={money} roleName={roleName} locale={locale} />
      ) : null}

      {undo ? (
        <div
          className="fixed inset-x-4 bottom-20 z-50 flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm text-ink shadow-card sm:inset-x-auto sm:bottom-6 sm:end-6 sm:w-96"
          data-testid="approvals-undo"
          onMouseEnter={pauseUndo}
          onMouseLeave={resumeUndo}
          onFocus={pauseUndo}
          onBlur={resumeUndo}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1">{undo.text}</p>
          {undo.failed ? null : (
            <button
              type="button"
              onClick={undoLast}
              disabled={reopen.isPending}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 font-semibold text-primary hover:bg-surface-2 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
              data-testid="approvals-undo-button"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              {t('undo.action')}
            </button>
          )}
        </div>
      ) : null}

      {!wide && selRow ? (
        <Peek
          open={peekOpen}
          title={t('desk.evidenceTitle')}
          onClose={() => setPeekOpen(false)}
          fullHref={selRow.invoiceId ? `/dashboard/invoices/${selRow.invoiceId}` : undefined}
          returnFocus={() => cardRefs.current.get(selRow.id)}
        >
          <EvidenceBody d={selRow} t={t} locale={locale} actions={evidenceActions(selRow)} />
        </Peek>
      ) : null}
      <EscalateSheet
        key={escalateFor?.id ?? 'none'}
        open={escalateFor != null}
        t={t}
        busy={busyId === escalateFor?.id}
        onClose={() => setEscalateFor(null)}
        onSend={(note) => {
          const d = escalateFor;
          setEscalateFor(null);
          if (d) decide(d, { procedure: 'escalate', note }, t('decision.escalated'));
        }}
      />
      <KeysHelp open={keysOpen} t={t} onClose={() => setKeysOpen(false)} />
    </div>
  );
}

/* ───────────────────────────── one decision card ───────────────────────────── */

function DecisionCard({
  d,
  t,
  locale,
  compact,
  viewerRole,
  busy,
  error,
  waiveOpen,
  onWaiveOpen,
  onDecide,
  primaryRef,
  onEscalate,
  select,
  footer,
  sticky = false,
}: {
  d: QueueItem;
  t: T;
  locale: 'he' | 'en';
  compact: boolean;
  viewerRole: string | null;
  busy: boolean;
  error: { text: string; retry?: () => void } | null;
  waiveOpen: boolean;
  onWaiveOpen: (open: boolean) => void;
  onDecide: (action: Decide, doneLabel: string) => void;
  primaryRef: (el: HTMLElement | null) => void;
  /** Opens the escalation Sheet (note chips) instead of escalating in one tap. */
  onEscalate?: () => void;
  /** The bulk-selection checkbox (desk). */
  select?: React.ReactNode;
  /** Evidence + history row under the why-line. */
  footer?: React.ReactNode;
  /** Landing page: the 50/50 pair sticks to the bottom (thumb zone). */
  sticky?: boolean;
}) {
  const isBlock = d.severity === 'block';
  const label = discrepancyLabel(t, d.type);
  const product = itemName(locale, d);
  const supplier = displayName(locale, d.supplierName, d.supplierNameEn);
  const amountNum = Math.abs(Number(d.deltaAmount ?? 0));
  const amount = formatIls(amountNum, { locale, maximumFractionDigits: 2 });
  const actions = decisionActions(d.type, d.claimable);
  const why = whyLine(t, d);
  const headId = `dq-${d.id}-title`;
  const sumId = `dq-${d.id}-summary`;
  const whyId = `dq-${d.id}-why`;
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  const menuItems: Array<{ key: string; node: React.ReactNode }> = [];
  if (canEscalate(d.requiredRole, viewerRole) && actions.some((a) => a.kind !== 'link')) {
    menuItems.push({
      key: 'escalate',
      node: (
        <button
          type="button"
          role="menuitem"
          className="flex h-12 w-full items-center gap-2 px-4 text-start text-sm text-ink hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={() => (onEscalate ? onEscalate() : onDecide({ procedure: 'escalate' }, t('decision.escalated')))}
        >
          <Send className="h-4 w-4 text-subtle" aria-hidden="true" />
          {t('decision.escalate')}
        </button>
      ),
    });
  }
  if (d.invoiceId) {
    menuItems.push({
      key: 'invoice',
      node: (
        <Link
          role="menuitem"
          href={`/dashboard/invoices/${d.invoiceId}${d.invoiceLineId ? `#line-${d.invoiceLineId}` : ''}`}
          className="flex h-12 w-full items-center gap-2 px-4 text-sm text-ink hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <FileText className="h-4 w-4 text-subtle" aria-hidden="true" />
          {t('card.fixInvoice')}
        </Link>
      ),
    });
  }

  const due = d.invoiceDueDate ? new Date(d.invoiceDueDate) : null;
  const dueDays = due
    ? Math.floor((startOfDay(due).getTime() - startOfDay(new Date()).getTime()) / 86_400_000)
    : null;

  return (
    <Card
      as="article"
      elevated
      padding="none"
      className="relative overflow-hidden"
      aria-labelledby={headId}
      aria-describedby={sumId}
      data-testid="approval-card"
      data-severity={d.severity}
    >
      {/* T2 row-tone rail on the start edge (where reading starts). */}
      {d.severity !== 'info' ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 start-0 w-[3px]', isBlock ? 'bg-danger' : 'bg-warn')}
        />
      ) : null}

      <div className={compact ? 'p-3 ps-4' : 'p-4 ps-5'}>
        <header className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {select ? <span className="flex min-h-6 items-center">{select}</span> : null}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SeverityBadge severity={d.severity} label={severityLabel(t, d.severity)} />
              <h2 id={headId} className="text-base font-bold text-ink">
                {label}
              </h2>
            </div>
            {product || supplier || d.invoiceNumber ? (
              <p className="mt-1 text-sm text-muted">
                {[product, supplier].filter(Boolean).join(' · ')}
                {d.invoiceNumber ? (
                  <>
                    {product || supplier ? ' · ' : ''}
                    <bdi className="whitespace-nowrap tabular-nums">
                      {t('card.invoice', { number: d.invoiceNumber })}
                    </bdi>
                  </>
                ) : null}
              </p>
            ) : null}
            </div>
          </div>
          {menuItems.length ? <MoreMenu t={t} items={menuItems} /> : null}
        </header>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="flex items-baseline gap-1.5 text-sm text-muted">
            {t(amountLabelKey(d.type))}
            <bdi
              className={cn(
                'text-lg font-extrabold tabular-nums',
                isBlock ? 'text-danger' : 'text-ink',
              )}
              data-testid="card-amount"
            >
              {amount}
            </bdi>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            <span
              title={formatDateTime(d.createdAt, locale)}
              className="inline-flex items-center gap-1"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {waitingText(t, d.createdAt, locale)}
            </span>
            {due && dueDays != null ? <DeadlineChip due={due} /> : null}
          </p>
        </div>

        <WhyLine id={whyId} groups={why} clamp={compact} className="mt-1.5" />
        <span id={sumId} className="sr-only">
          {t('card.srSummary', {
            label,
            who: [product, supplier].filter(Boolean).join(' · '),
            amount,
          })}
          {' · '}
          {whyText(why)}
        </span>

        {error ? (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
          >
            <span>{error.text}</span>
            {error.retry ? (
              <button
                type="button"
                onClick={error.retry}
                className="touch-target rounded-lg px-2 font-semibold underline outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
              >
                {t('card.retry')}
              </button>
            ) : null}
          </div>
        ) : null}

        <Actions
          d={d}
          t={t}
          amount={amount}
          actions={actions}
          busy={busy}
          waiveOpen={waiveOpen}
          onWaiveOpen={onWaiveOpen}
          onDecide={onDecide}
          primaryRef={primaryRef}
          rejectRef={rejectRef}
          describedBy={sumId}
          sticky={sticky}
        />
        {footer}
      </div>
    </Card>
  );
}

/** Two 50/50 48 px buttons: the claim at the start (right in RTL), "pay as billed" at the end. */
function Actions({
  d,
  t,
  amount,
  actions,
  busy,
  waiveOpen,
  onWaiveOpen,
  onDecide,
  primaryRef,
  rejectRef,
  describedBy,
  sticky = false,
}: {
  d: QueueItem;
  t: T;
  amount: string;
  actions: DecisionAction[];
  busy: boolean;
  waiveOpen: boolean;
  onWaiveOpen: (open: boolean) => void;
  onDecide: (action: Decide, doneLabel: string) => void;
  primaryRef: (el: HTMLElement | null) => void;
  rejectRef: React.MutableRefObject<HTMLButtonElement | null>;
  describedBy: string;
  sticky?: boolean;
}) {
  const btn =
    'inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20';
  const primaryCls = cn(btn, 'bg-primary text-on-primary hover:brightness-95');
  const secondaryCls = cn(btn, 'border border-line-strong bg-surface text-ink hover:bg-surface-2');
  const only = actions.length === 1 ? actions[0]! : null;

  if (only?.kind === 'link') {
    return (
      <div className="mt-3">
        <Link
          href={d.invoiceId ? `/dashboard/invoices/${d.invoiceId}` : '/dashboard/invoices'}
          className={secondaryCls}
          ref={primaryRef}
          aria-describedby={describedBy}
        >
          {t(only.label)}
        </Link>
      </div>
    );
  }
  if (only?.kind === 'review') {
    return (
      <div className="mt-3">
        <button
          type="button"
          ref={primaryRef}
          className={secondaryCls}
          disabled={busy}
          aria-describedby={describedBy}
          onClick={() =>
            onDecide(
              { procedure: 'reject', reason: t(only.label), reasonCode: 'reviewed' },
              t(only.done),
            )
          }
        >
          {t(only.label)}
        </button>
      </div>
    );
  }
  const ap = actions.find((a) => a.kind === 'approve');
  const rj = actions.find((a) => a.kind === 'reject');
  return (
    <>
      <div
        className={cn(
          'mt-3 grid grid-cols-2 gap-2',
          sticky
            ? 'sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface px-4 py-2'
            : 'sm:flex sm:justify-start sm:[&>*]:w-auto sm:[&>*]:min-w-44',
        )}
        data-testid="decide-pair"
      >
        {ap && ap.kind === 'approve' ? (
          <button
            type="button"
            ref={primaryRef}
            className={primaryCls}
            disabled={busy}
            aria-describedby={describedBy}
            data-testid="decide-approve"
            onClick={() => onDecide({ procedure: 'approve' }, t(ap.done))}
          >
            {ap.withAmount ? <Template text={t(ap.label)} values={{ amount }} /> : t(ap.label)}
          </button>
        ) : null}
        {rj && rj.kind === 'reject' ? (
          <button
            type="button"
            ref={rejectRef}
            className={secondaryCls}
            disabled={busy}
            aria-expanded={waiveOpen}
            aria-controls={`dq-${d.id}-reasons`}
            aria-describedby={describedBy}
            data-testid="decide-reject"
            onClick={() => onWaiveOpen(!waiveOpen)}
          >
            {t(rj.label)}
          </button>
        ) : null}
      </div>
      {waiveOpen && rj && rj.kind === 'reject' ? (
        <WaiveReasons
          id={`dq-${d.id}-reasons`}
          type={d.type}
          t={t}
          busy={busy}
          onCancel={() => {
            onWaiveOpen(false);
            requestAnimationFrame(() => rejectRef.current?.focus());
          }}
          onPick={(code, reason) =>
            onDecide({ procedure: 'reject', reason, reasonCode: code }, t(rj.done))
          }
        />
      ) : null}
    </>
  );
}

/** One-tap reason chips (approvals-05); "אחר" reveals a labelled textarea. Esc cancels. */
function WaiveReasons({
  id,
  type,
  t,
  busy,
  onPick,
  onCancel,
}: {
  id: string;
  type: string;
  t: T;
  busy: boolean;
  onPick: (code: WaiveReason, reason: string) => void;
  onCancel: () => void;
}) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  const reasons = waiveReasons(type);
  const titleId = `${id}-title`;
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={titleId}
      className="mt-3 rounded-xl border border-line bg-surface-2 p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      data-testid="waive-reasons"
    >
      <p id={titleId} className="mb-2 text-sm font-semibold text-ink">
        {t('reasons.title')}
      </p>
      <div className="flex flex-wrap gap-2">
        {reasons.map((code, i) => (
          <button
            key={code}
            type="button"
            ref={i === 0 ? firstRef : undefined}
            disabled={busy}
            aria-pressed={code === 'other' ? other : undefined}
            className="inline-flex min-h-12 items-center rounded-full border border-line-strong bg-surface px-4 text-sm text-ink hover:bg-surface-2 disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
            onClick={() =>
              code === 'other' ? setOther((o) => !o) : onPick(code, t(`reasons.${code}`))
            }
          >
            {t(`reasons.${code}`)}
          </button>
        ))}
      </div>
      {other ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${id}-other`} className="block text-sm font-medium text-ink">
            {t('reasons.otherLabel')}
          </label>
          <Textarea
            id={`${id}-other`}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-12 rounded-xl px-4 text-sm text-muted hover:bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
              onClick={onCancel}
            >
              {t('reasons.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !text.trim()}
              className="h-12 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
              onClick={() => onPick('other', text.trim())}
            >
              {t('reasons.otherConfirm')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "⋯": escalate and evidence live here, away from the money buttons (approvals-03). */
function MoreMenu({ t, items }: { t: T; items: Array<{ key: string; node: React.ReactNode }> }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    requestAnimationFrame(() =>
      boxRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
    );
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('card.more')}
        className="inline-flex h-12 w-12 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink sm:h-10 sm:w-10 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20"
        onClick={() => setOpen((o) => !o)}
        data-testid="card-more"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-card"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              btnRef.current?.focus();
            }
          }}
          onClick={() => setOpen(false)}
        >
          {items.map((i) => (
            <div key={i.key} role="none">
              {i.node}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyQueue({
  t,
  headingRef,
  filtered,
  filteredNote,
  others,
  money,
  roleName,
  locale,
}: {
  t: T;
  headingRef: React.MutableRefObject<HTMLHeadingElement | null>;
  filtered: boolean;
  filteredNote?: string;
  others: QueueSummary['others'];
  money: (v: number) => string;
  roleName: (r: string) => string;
  locale: 'he' | 'en';
}) {
  const single = others.byRole.length === 1 ? others.byRole[0]! : null;
  const description = filtered
    ? (filteredNote ?? t('empty.description'))
    : others.count > 0
      ? single
        ? t('empty.othersWaiting', {
            count: formatNumber(others.count, locale),
            role: roleName(single.role),
            amount: money(others.amountIls),
          })
        : t('empty.othersWaitingMany', {
            count: formatNumber(others.count, locale),
            amount: money(others.amountIls),
          })
      : t('empty.clearDescription');
  return (
    <div className="space-y-3">
      <Card
        padding="lg"
        className="flex flex-col items-center gap-2 text-center"
        data-testid="approvals-empty"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/12 text-gold">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink">
          {others.count > 0 || filtered ? t('empty.title') : t('empty.clearTitle')}
        </h2>
        <p className="max-w-md text-sm text-muted">{description}</p>
      </Card>
      {others.count > 0 ? (
        <OthersLane t={t} others={others} money={money} roleName={roleName} locale={locale} />
      ) : null}
    </div>
  );
}

/** Read-only "ממתין לאחרים" (functional-flows-07): counts per role, never a decision. */
function OthersLane({
  t,
  others,
  money,
  roleName,
  locale,
}: {
  t: T;
  others: QueueSummary['others'];
  money: (v: number) => string;
  roleName: (r: string) => string;
  locale: 'he' | 'en';
}) {
  return (
    <details
      className="rounded-xl border border-line bg-surface px-4 py-2 text-sm"
      data-testid="approvals-others"
    >
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 font-semibold text-ink rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20">
        {t('others.title')}
        <span className="font-normal text-muted">
          · <bdi className="tabular-nums">{formatNumber(others.count, locale)}</bdi> ·{' '}
          <bdi className="tabular-nums">{money(others.amountIls)}</bdi>
        </span>
      </summary>
      <ul className="space-y-1 pb-2 text-muted">
        {others.byRole.map((r) => (
          <li key={r.role}>
            {t('others.role', {
              role: roleName(r.role),
              count: formatNumber(r.count, locale),
              amount: money(r.amountIls),
            })}
          </li>
        ))}
        <li className="text-xs text-subtle">{t('others.readOnly')}</li>
      </ul>
    </details>
  );
}

function SummaryTile({
  label,
  value,
  caption,
  danger,
  testId,
}: {
  label: string;
  value: string;
  caption?: string;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <Card padding="sm" className="flex min-w-0 flex-col justify-center">
      <p className="truncate text-xs font-semibold text-subtle">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-2xl font-extrabold tabular-nums',
          danger ? 'text-danger' : 'text-ink',
        )}
      >
        <bdi data-testid={testId}>{value}</bdi>
      </p>
      {caption ? <p className="text-xs text-subtle">{caption}</p> : null}
    </Card>
  );
}

function SeverityBadge({ severity, label }: { severity: string; label: string }) {
  // Red only on block (T2); warn is amber; info stays calm.
  const tone: BadgeTone =
    severity === 'block' ? 'danger-solid' : severity === 'warn' ? 'warning-solid' : 'info';
  return <Badge tone={tone}>{label}</Badge>;
}

/** Render a message template with React values in its {placeholders}, each in a plain `<bdi>`. */
function Template({ text, values }: { text: string; values: Record<string, string> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      <bdi key={m.index} className="tabular-nums">
        {values[m[1]!] ?? m[0]}
      </bdi>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** "4 ימים" / "יומיים" (Intl unit plurals); null on the first day. */
function ageText(from: Date | string, locale: 'he' | 'en'): string | null {
  const days = ageDays(from);
  if (days === 0) return null;
  return new Intl.NumberFormat(intlLocaleOf(locale), {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  }).format(days);
}

function waitingText(t: T, from: Date | string, locale: 'he' | 'en'): string {
  const age = ageText(from, locale);
  return age ? t('card.waiting', { age }) : t('card.waitingToday');
}

function conflictText(
  t: T,
  c: { status: string; role: string | null; name: string | null; at: string | null; self: boolean },
  locale: 'he' | 'en',
): string {
  const time = c.at ? formatDateTime(c.at, locale) : '';
  const status = resolutionLabel(t, c.status);
  if (c.self) return t('card.decidedBySelf', { time, status });
  const role = c.role ? t(`roles.${c.role}` as MessageKey<typeof approvalsHe>) : null;
  const who = c.name ?? (role && !role.startsWith('roles.') ? role : t('card.someone'));
  return t('card.decidedBy', { who, time, status });
}

/** CONFLICT `approvals.amountChanged:{seenAgorot, nowAgorot}` → the new figure. */
function parseAmountChanged(message: string | undefined): { seenAgorot: number; nowAgorot: number } | null {
  const prefix = 'approvals.amountChanged:';
  if (!message?.startsWith(prefix)) return null;
  try {
    const v = JSON.parse(message.slice(prefix.length)) as { seenAgorot?: unknown; nowAgorot?: unknown };
    return typeof v.nowAgorot === 'number' && typeof v.seenAgorot === 'number'
      ? { seenAgorot: v.seenAgorot, nowAgorot: v.nowAgorot }
      : null;
  } catch {
    return null;
  }
}

/** The catalog product's name, else the invoice line's own text. */
function itemName(locale: 'he' | 'en', d: QueueItem): string {
  return (
    displayName(locale, d.productName, d.productNameEn) ||
    displayName(locale, d.lineDescription, d.lineDescriptionEn)
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
const add = (s: ReadonlySet<string>, id: string) => new Set(s).add(id);
const remove = (s: ReadonlySet<string>, id: string) => {
  const n = new Set(s);
  n.delete(id);
  return n;
};
function omit<V>(o: Record<string, V>, k: string): Record<string, V> {
  const rest = { ...o };
  delete rest[k];
  return rest;
}

/**
 * Phone: the view toolbar folds into one chip ("סינון ותצוגה (N)") so the first
 * decision is above the fold (approvals-03). From `sm` up it is always shown.
 */
export function FiltersDisclosure({
  active,
  children,
}: {
  active: number;
  children: React.ReactNode;
}) {
  const t = useT(approvals);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="approvals-filters"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'mb-3 inline-flex h-12 items-center rounded-full border px-4 text-sm font-semibold sm:hidden outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20',
          active > 0 ? 'border-primary text-primary' : 'border-line-strong text-ink',
        )}
        data-testid="approvals-filters-toggle"
      >
        {active > 0 ? t('filters.toggleActive', { count: active }) : t('filters.toggle')}
      </button>
      <div id="approvals-filters" className={open ? 'block' : 'hidden sm:block'}>
        {children}
      </div>
    </div>
  );
}
