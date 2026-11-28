'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { singleKeysEnabled } from '@/lib/prefs';
import { useTableUrlState } from '@/lib/components/table/useTableUrlState';
import { barKindOf, batchBasisBlock, decisionBlockOf, groupByTier, remainingAfter } from './desk-facts';
import {
  BATCH_KEY,
  PAGE,
  askingRow,
  batchFailSel,
  batchFailureOf,
  batchMutationId,
  batchRefusalOf,
  decideFailBack,
  decideManyInput,
  decisionCall,
  deskReducer,
  failureOutcome,
  focusAfterDecision,
  howOr,
  initDeskState,
  isOpenRow,
  liveRows,
  nextOpenAfter,
  positionOf,
  reopenCall,
  resolveCurrent,
  rowStateOf,
  rowsView,
  stepOpen,
  type BatchOrigin,
  type Decide,
  type DecisionError,
} from './desk-state';
import { announceDecided, announceDecidedNoNext, batchToastText, decisionAmount, ilsText, toastText } from './desk-text';
import type {
  DeskController,
  DeskControllerInput,
  FocusIntent,
  How,
  Motion,
  Origin,
  QueueItem,
} from './desk-types';
import { BULK_CAP_AGOROT, bulkSelection, groupByInvoice, groupPrimary, newClientMutationId } from './groups';
import { DOUBLE_ACTIVATION_MS, UNDO_CAP_MS } from './undo-window';
import { canEscalate, type WaiveReason } from './vocab';

/** The undo toast's root (UndoToast, `data-testid="approvals-undo"`). */
const UNDO_TOAST = '[data-testid="approvals-undo"]';

/** Is focus inside `selector`? Read at the moment of the action, before anything re-renders. */
function focusWithin(selector: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  return el instanceof Element && el.closest(selector) != null;
}

/** Is focus in the desk's rows grid? Decides where a J/K/↑/↓ leaves focus (§5.2): rows → the new row; the bar and the
 *  narrow / landing evidence → it stays. Read at the keydown, before anything re-renders. */
function focusInRows(): boolean {
  return focusWithin('[data-desk-rows]');
}

/** What the next page brought for the gap after the last loaded one: its first new row (null: none came), or a
 *  failed request (the server still holds more; nobody knows the next gap). */
type NextPage = { ok: true; first: QueueItem | null } | { ok: false };

/**
 * The approvals desk's controller (DS3-04 spec §2.7). Owns the data and the side effects — the six decision
 * mutations of list.tsx:162-167, the summary refresh, `?sel=`, the undo, paging — and hands the views a
 * `DeskController`: plain data plus intents. The views render purely from it; focus is emitted as an intent that
 * `DeskView` resolves (§5.3).
 *
 * Every decision calls the same procedure with the same input as before (§5.4): approve {discrepancyId,
 * expectedStatus, seenClaimAgorot}, reject {discrepancyId, reason, reasonCode}, escalate {discrepancyId, note},
 * decideMany {items, decision: 'accepted', clientMutationId}, reopen {discrepancyId}, reopenMany {discrepancyIds} —
 * built by the pure `decisionCall` / `decideManyInput` / `reopenCall` of desk-state.ts. A decision shows at once
 * (optimistic) and rolls back exactly on failure.
 */
export function useDesk(input: DeskControllerInput): DeskController {
  const { filters, viewerRole, mode, wide } = input;
  const t = useT(approvals);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const router = useRouter();
  const [s, dispatch] = useReducer(deskReducer, input, initDeskState);
  const [url, updateUrl] = useTableUrlState();

  const approve = trpc.approvals.approve.useMutation();
  const reject = trpc.approvals.reject.useMutation();
  const escalate = trpc.approvals.escalate.useMutation();
  const reopen = trpc.approvals.reopen.useMutation();
  const decideMany = trpc.approvals.decideMany.useMutation();
  const reopenMany = trpc.approvals.reopenMany.useMutation();

  /** Server totals after a decision settles (counts only — page 1 is never refetched). */
  // Overlapping refreshes (two quick decisions): only the newest request may
  // land, so an older, slower response never overwrites fresher tiles.
  const summarySeq = useRef(0);
  const refreshSummary = useCallback(async () => {
    const seq = ++summarySeq.current;
    try {
      const fresh = await utils.approvals.queueSummary.fetch(filters, { staleTime: 0 });
      if (seq === summarySeq.current) dispatch({ type: 'summary/set', summary: fresh });
    } catch {
      /* the optimistic numbers stay; the next decision retries */
    }
  }, [utils, filters]);
  /** An optimistic change is about to move the totals: a refresh asked for before it would land server totals that
   *  still count these rows, and a rollback would then add them back twice — it may no longer land. Every decision
   *  settles with a refresh of its own (OK or failure), so the head is corrected right after. */
  const holdSummary = () => {
    summarySeq.current += 1;
  };

  // The current gap = `?sel=` when it is open or decided elsewhere, else the first open row. Resolved, never written:
  // nothing touches the URL on load (consent-clearance:55, W1-04:248-259).
  const sel = url.sel;
  const current = resolveCurrent(s, sel);

  // The latest values for handlers and async callbacks (a decision's response reads the state of its own time).
  const stateRef = useRef(s);
  stateRef.current = s;
  const selRef = useRef(sel);
  selRef.current = sel;
  const currentRef = useRef(current);
  currentRef.current = current;
  /** The 350 ms double-activation guard (reset when a decision failed or met a CONFLICT, D30). */
  const lastDecisionAt = useRef(0);
  /** One replay id per attempt on the same selection (decideMany's clientMutationId). */
  const batchAttempt = useRef<{ key: string; id: string } | null>(null);
  /** Counts announcements: one built later (when the next page lands) never replaces a newer one. */
  const announceSeq = useRef(0);

  /** `?sel=` through the table URL state (replaceState, other parameters kept); null removes it. */
  const writeSel = (id: string | null) => {
    selRef.current = id;
    updateUrl({ sel: id });
  };
  const setFocus = (focus: FocusIntent | null) => dispatch({ type: 'focus/set', focus });
  const announce = (text: string) => {
    announceSeq.current += 1;
    dispatch({ type: 'announce', text });
  };

  // No multi-select below 1280 px (§5.7, R13/P3): the selection clears when the window narrows.
  useEffect(() => {
    if (!wide) dispatch({ type: 'check/clear' });
  }, [wide]);

  // R9: the reasons row belongs to one gap. select / move / prev-next close it themselves; when `?sel=` changes from
  // outside (Back, another table hook) it closes here, so the keys never stay in "asking" for a gap not shown.
  const askingId = s.asking?.id ?? null;
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (askingId != null && askingId !== currentId) dispatch({ type: 'ask/close' });
  }, [askingId, currentId]);

  /* ───────────────────────── one decision ───────────────────────── */

  function decide(
    d: QueueItem,
    action: Decide,
    doneLabel: string,
    amountKind: 'claim' | 'delta',
    how: How,
    origin: Origin,
  ): void {
    const st = stateRef.current;
    if (st.inFlight.has(d.id) || !isOpenRow(st, d.id)) return;
    if (Date.now() - lastDecisionAt.current < DOUBLE_ACTIVATION_MS) return;
    // #190 seam: a page question blocks approve and reject, never an escalation (P13).
    if (action.procedure !== 'escalate' && decisionBlockOf(d)) return;
    lastDecisionAt.current = Date.now();
    const nextId = nextOpenAfter(st, d.id);
    const next = nextId ? (st.items.find((x) => x.id === nextId) ?? null) : null;
    const countBefore = st.summary.count; // the announcer's "נותרו" counts from before the decision (list.tsx:261)
    const advance = currentRef.current?.id === d.id;
    // No loaded gap comes next, but the server holds more: the queue is not empty — the next page brings the next gap.
    const awaitingPage = nextId == null && st.hasMore;
    // Where `?sel=` went because of this decision: the next loaded gap, or the next page's first gap once the
    // controller brought it up. A failure rolls back while `?sel=` still names it (the user has not moved).
    let landedOn: string | null = nextId;
    dispatch({ type: 'decide/start', ids: [d.id], how, result: doneLabel });
    holdSummary();
    let nextPage: Promise<NextPage> | null = null;
    if (advance) {
      writeSel(nextId);
      setFocus(focusAfterDecision({ how, origin, nextId, hasMore: st.hasMore }));
      if (awaitingPage) {
        nextPage = continueOnNextPage(
          (id) => focusAfterDecision({ how, origin, nextId: id }),
          (id) => {
            landedOn = id;
          },
        );
      }
    }
    const sentAt = Date.now();
    const req = decisionCall(d, action);
    const call: Promise<unknown> =
      req.procedure === 'approve'
        ? approve.mutateAsync(req.input)
        : req.procedure === 'reject'
          ? reject.mutateAsync(req.input)
          : escalate.mutateAsync(req.input);
    call.then(
      () => {
        const amount = decisionAmount(d, amountKind);
        dispatch({
          type: 'decide/ok',
          ids: [d.id],
          undo: {
            text: toastText(t, locale, doneLabel, amount),
            sentAt,
            capAt: sentAt + UNDO_CAP_MS,
            instant: how !== 'pointer',
            failed: false,
            busy: false,
            ids: [d.id],
            bulk: false,
          },
        });
        const remaining = remainingAfter(countBefore);
        if (nextPage) {
          // The next gap is the next page's first: name it once the page has landed — "אין עוד פערים" only when the
          // page brought no new gap, and no claim at all when it failed.
          const seq = announceSeq.current;
          void nextPage.then((p) => {
            if (seq !== announceSeq.current) return; // a newer announcement has spoken since
            announce(
              p.ok
                ? announceDecided(t, locale, doneLabel, d, amount, p.first, remaining, singleKeysEnabled())
                : announceDecidedNoNext(t, locale, doneLabel, d, amount, singleKeysEnabled()),
            );
          });
        } else if (awaitingPage) {
          announce(announceDecidedNoNext(t, locale, doneLabel, d, amount, singleKeysEnabled()));
        } else {
          announce(announceDecided(t, locale, doneLabel, d, amount, next, remaining, singleKeysEnabled()));
        }
        void refreshSummary();
      },
      (err: unknown) => {
        lastDecisionAt.current = 0;
        const outcome = failureOutcome(err as DecisionError | null, d, viewerRole, t, locale);
        dispatch({
          type: 'decide/fail',
          ids: [d.id],
          outcome,
          retry: outcome.kind === 'error' ? { action, doneLabel, amountKind } : null,
        });
        // The user has not moved: back to the failed gap, its bar speaks (§5.3).
        const back = decideFailBack({ advance, sel: selRef.current, landedOn, id: d.id, outcome: outcome.kind });
        if (back) {
          writeSel(back.sel);
          setFocus(back.focus);
        }
        void refreshSummary(); // every outcome: the server's totals replace whatever landed while it was in flight
      },
    );
  }

  /* ───────────────────────── bulk and group (optimistic, R11) ───────────────────────── */

  async function reloadQueue() {
    try {
      const fresh = await utils.approvals.myQueue.fetch({ limit: PAGE, ...filters }, { staleTime: 0 });
      dispatch({ type: 'rows/reset', rows: fresh, hasMore: fresh.length >= PAGE });
    } catch {
      /* the note already says the outcome is unknown */
    }
    void refreshSummary();
  }

  /**
   * Bulk approve (exec-desktop-08): ONE server call, all-or-nothing. The server refuses a blocking row and any
   * invoice over ₪200 on its own; the UI never offers those (BatchBar / group primary), so a refusal here is a race.
   * Only rows still open join (exactly the rows batch/start marks, so a rollback restores exactly them).
   */
  function decideBatch(rows: QueueItem[], origin: BatchOrigin, how: How): void {
    const st = stateRef.current;
    const open = rows.filter((r) => isOpenRow(st, r.id));
    if (open.length === 0 || st.inFlight.has(BATCH_KEY)) return;
    if (Date.now() - lastDecisionAt.current < DOUBLE_ACTIVATION_MS) return;
    lastDecisionAt.current = Date.now();
    const ids = open.map((r) => r.id);
    batchAttempt.current = batchMutationId(batchAttempt.current, ids, newClientMutationId);
    const clientMutationId = batchAttempt.current.id;
    const sumAgorot = open.reduce((n, r) => n + (r.claimable ? Math.max(0, r.claimAgorot) : 0), 0);
    const verb = origin === 'group' ? t('desk.groupApproveDone') : t('decision.approved');
    const cur = currentRef.current;
    const advance = cur != null && ids.includes(cur.id);
    const target = advance ? nextOpenAfter(st, ids[ids.length - 1]!, new Set(ids)) : (cur?.id ?? null);
    const awaitingPage = advance && target == null && st.hasMore;
    // Where `?sel=` went (as decide()): a group refusal returns while `?sel=` still names it.
    let landedOn: string | null = target;
    dispatch({ type: 'batch/start', ids, origin, result: t('decision.approved') });
    holdSummary();
    if (advance) writeSel(target);
    setFocus(target ? { to: 'row', id: target } : awaitingPage ? { to: 'stay' } : { to: 'empty' });
    if (awaitingPage) {
      void continueOnNextPage(
        (id) => ({ to: 'row', id }),
        (id) => {
          landedOn = id;
        },
      );
    }
    const sentAt = Date.now();
    decideMany.mutateAsync(decideManyInput(open, clientMutationId)).then(
      () => {
        batchAttempt.current = null;
        const text = batchToastText(t, locale, open.length, sumAgorot);
        dispatch({
          type: 'batch/ok',
          ids,
          undo: {
            text,
            sentAt,
            capAt: sentAt + UNDO_CAP_MS,
            instant: how !== 'pointer', // key and keyboard changes never animate (§4.10)
            failed: false,
            busy: false,
            ids,
            bulk: true,
          },
        });
        announce(`${verb} · ${text}`);
        void refreshSummary();
      },
      (err: unknown) => {
        lastDecisionAt.current = 0;
        const failure = batchFailureOf(err as DecisionError | null);
        const note = t(failure.note);
        dispatch({ type: 'batch/fail', ids, origin, note });
        const back = batchFailSel({ origin, advance, sel: selRef.current, target: landedOn, ids });
        if (back != null) {
          // The user has not moved: back to the refused invoice's first gap, its bar shows the note.
          writeSel(back);
          setFocus({ to: 'primary' });
        }
        // A selection's note sits in the BatchBar, which is no live region and goes once a reload clears the
        // selection (batchUnknown): the announcer says it.
        if (origin === 'selection') announce(note);
        // Network / server error: the batch may or may not have committed — reload (it refreshes the totals too).
        if (failure.unknown) void reloadQueue();
        else void refreshSummary();
      },
    );
  }

  /* ───────────────────────── undo ───────────────────────── */

  function undoLast(how: How): void {
    const u = stateRef.current.undo;
    if (!u || u.failed || u.busy) return;
    const first = u.ids[0];
    const req = reopenCall(u);
    if (!first || !req) return;
    if (Date.now() >= u.capAt) {
      // Never ask the server after the cap. The toast goes: a click or Enter on its button had focus inside it, and so
      // had a Z pressed there — focus moves on (§5.3), never to body.
      expireUndo({ hadFocus: how !== 'key' || focusWithin(UNDO_TOAST) });
      return;
    }
    dispatch({ type: 'undo/start', sentAt: u.sentAt });
    const call: Promise<unknown> =
      req.procedure === 'reopenMany' ? reopenMany.mutateAsync(req.input) : reopen.mutateAsync(req.input);
    call.then(
      () => {
        dispatch({ type: 'undo/ok', ids: u.ids, sentAt: u.sentAt, how });
        writeSel(first);
        setFocus({ to: 'row', id: first });
        announce(t('undo.undone'));
        void refreshSummary();
      },
      () => dispatch({ type: 'undo/fail', sentAt: u.sentAt, text: t('undo.failed') }),
    );
  }

  function expireUndo(info: { hadFocus: boolean }): void {
    dispatch({ type: 'undo/expire', sentAt: stateRef.current.undo?.sentAt });
    if (!info.hadFocus) return;
    const cur = currentRef.current;
    setFocus(cur ? { to: 'row', id: cur.id } : { to: 'empty' });
  }

  /* ───────────────────────── paging ───────────────────────── */

  /** The page request in flight: a second caller shares it (one page at a time). */
  const fetching = useRef<Promise<{ fresh: QueueItem[]; hasMore: boolean }> | null>(null);

  /** Keyset paging after the last LOADED row (decided or not — the server recomputes its sort key from the row), so
   *  rows decided elsewhere never make the next page skip anything. Resolves with the rows that were new and the
   *  page's own "has more" (the state has not re-rendered yet when the caller reads it). */
  function fetchMore(): Promise<{ fresh: QueueItem[]; hasMore: boolean }> {
    if (fetching.current) return fetching.current;
    const st = stateRef.current;
    const last = st.items[st.items.length - 1];
    if (!last) return Promise.resolve({ fresh: [], hasMore: st.hasMore });
    dispatch({ type: 'loadMore/busy', busy: true });
    const page = (async () => {
      try {
        const next = await utils.approvals.myQueue.fetch({ limit: PAGE, ...filters, afterId: last.id }, { staleTime: 0 });
        const seen = new Set(stateRef.current.items.map((x) => x.id));
        const hasMore = next.length >= PAGE;
        dispatch({ type: 'rows/append', rows: next, hasMore });
        return { fresh: next.filter((x) => !seen.has(x.id)), hasMore };
      } finally {
        fetching.current = null;
        dispatch({ type: 'loadMore/busy', busy: false });
      }
    })();
    fetching.current = page;
    return page;
  }

  function loadMore(): void {
    fetchMore().then(
      ({ fresh, hasMore }) => {
        // The LoadMore button unmounts once nothing is left: the first new row takes focus if it was lost (§5.3).
        if (!hasMore && fresh[0]) setFocus({ to: 'row', id: fresh[0].id, onlyIfLost: true });
      },
      () => {
        /* the rows shown stay right; LoadMore keeps its button, so the next click retries */
      },
    );
  }

  /**
   * The last loaded gap is gone (decided, or hidden) while the server holds more: load the next page and bring its
   * first gap up — unless the user moved meanwhile. On narrow and on the landing there is no LoadMore button (the rows
   * are desk-only), so without this the next page would be out of reach (today's list shows LoadMore at every width).
   * `onGo(id)` runs just before the first gap is brought up (the caller's rollback follows it). Resolves with what the
   * page brought (the announcer names that first gap).
   */
  function continueOnNextPage(focusFor: (id: string) => FocusIntent, onGo?: (id: string) => void): Promise<NextPage> {
    if (!stateRef.current.hasMore) return Promise.resolve({ ok: true, first: null });
    return fetchMore().then(
      ({ fresh }): NextPage => {
        const first = fresh[0] ?? null;
        if (first && selRef.current == null) {
          onGo?.(first.id);
          go(first.id, null, focusFor(first.id));
        }
        return { ok: true, first };
      },
      (): NextPage => ({ ok: false }), // the empty state stays; the queue head still counts what the server holds
    );
  }

  /* ───────────────────────── moving ───────────────────────── */

  function go(id: string | null, motion: Motion, focus: FocusIntent | undefined): void {
    writeSel(id);
    dispatch({ type: 'nav', motion, focus });
  }

  function move(delta: 1 | -1, how: How, via: 'key' | 'nav', from?: string): void {
    const st = stateRef.current;
    const cur = currentRef.current;
    const keyFromRows = via === 'key' && focusInRows();
    const focusFor = (id: string): FocusIntent =>
      via === 'nav' ? { to: 'navFallback', from: delta > 0 ? 'next' : 'prev' } : keyFromRows ? { to: 'row', id } : { to: 'stay' };
    const motion: Motion = how === 'pointer' ? (delta > 0 ? 'next' : 'prev') : null;
    // A key on another row's cell or checkbox steps from that row, as list.tsx:486-488 stepped from the focused card.
    const fromId = typeof from === 'string' ? from : (cur?.id ?? null);
    const target = stepOpen(st, fromId, delta);
    if (target) {
      go(target, motion, focusFor(target));
      return;
    }
    if (delta > 0 && st.hasMore) {
      // The last live row with more on the server: load, then step (§5.1). The reasons row closes now (R9).
      if (st.asking) dispatch({ type: 'ask/close' });
      const selBefore = selRef.current;
      fetchMore().then(
        ({ fresh }) => {
          const first = fresh[0]; // a new row is open: nobody here decided it yet
          if (first && selRef.current === selBefore) go(first.id, motion, focusFor(first.id));
        },
        () => {
          /* nothing new arrived: the gap stays */
        },
      );
    }
  }

  function select(id: string): void {
    if (!isOpenRow(stateRef.current, id)) return; // done and elsewhere rows: a click does nothing (Q4)
    go(id, null, undefined);
  }

  /** Enter / O on a row cell (§5.2): the evidence heading, through the focus chain. A row that is open and not current
   *  is selected first — its heading renders with the selection, and the intent is applied after that render. */
  function focusHeading(id?: string): void {
    const cur = currentRef.current;
    if (typeof id === 'string' && id !== cur?.id && isOpenRow(stateRef.current, id)) {
      go(id, null, { to: 'heading' });
      return;
    }
    setFocus({ to: 'heading' });
  }

  /* ───────────────────────── the bar's actions ───────────────────────── */

  /** The current gap, when it can be decided (open, not blocked by #190). */
  function decidable(): QueueItem | null {
    const cur = currentRef.current;
    if (!cur || !isOpenRow(stateRef.current, cur.id) || decisionBlockOf(cur)) return null;
    return cur;
  }

  function claim(how: How, origin: Origin): void {
    const cur = decidable();
    if (!cur) return;
    switch (barKindOf(cur)) {
      case 'link':
        // Key 1 does what it does today: it opens the invoice to link it to its order (P11a).
        router.push(cur.invoiceId ? `/dashboard/invoices/${cur.invoiceId}` : '/dashboard/invoices');
        return;
      case 'review':
        decide(
          cur,
          { procedure: 'reject', reason: t('decision.reviewed'), reasonCode: 'reviewed' },
          t('decision.reviewedDone'),
          'delta',
          how,
          origin,
        );
        return;
      case 'duplicate':
        decide(cur, { procedure: 'approve' }, t('decision.duplicateHeld'), 'delta', how, origin);
        return;
      default:
        decide(cur, { procedure: 'approve' }, t('decision.approved'), 'claim', how, origin);
    }
  }

  /** Pointer or keyboard alike, the first chip takes focus (§5.3, W1-07:228). */
  function openReasons(how: How, origin: Origin): void {
    const cur = decidable();
    if (!cur) return;
    const kind = barKindOf(cur);
    if (kind !== 'claimPay' && kind !== 'duplicate') return; // only these pay as billed
    dispatch({ type: 'ask/open', id: cur.id, origin });
    setFocus({ to: 'firstChip' });
  }

  function closeReasons(): void {
    const asking = stateRef.current.asking;
    if (!asking) return;
    dispatch({ type: 'ask/close' });
    // Origin queue at the desk → back to the row's cell; the bar (and narrow / landing) → "שלמו כפי שחויב".
    setFocus(mode === 'desk' && wide && asking.origin === 'queue' ? { to: 'row', id: asking.id } : { to: 'reject' });
  }

  function pay(code: WaiveReason, reason: string, how: How): void {
    const st = stateRef.current;
    const row = askingRow(st);
    if (!row || !st.asking || decisionBlockOf(row)) return; // decides asking.id only (R9)
    decide(row, { procedure: 'reject', reason, reasonCode: code }, t('decision.rejected'), 'delta', how, st.asking.origin);
  }

  function requestEscalate(origin: Origin): void {
    const cur = currentRef.current;
    if (!cur || !isOpenRow(stateRef.current, cur.id)) return;
    if (!canEscalate(cur.requiredRole, viewerRole) || cur.canAct === false) return; // the owner never sees it
    dispatch({ type: 'escalate/open', id: cur.id, origin });
  }

  function sendEscalation(note: string | undefined, how?: How): void {
    const st = stateRef.current;
    const e = st.escalateFor;
    dispatch({ type: 'escalate/close' });
    if (!e) return;
    const row = st.items.find((x) => x.id === e.id);
    // The Sheet's send button: keyboard-like unless the view says it was a pointer click; focus per
    // focusAfterDecision (§5.3).
    if (row) decide(row, { procedure: 'escalate', note }, t('decision.escalated'), 'delta', howOr(how, 'keyboard'), e.origin);
  }

  function retry(how?: How): void {
    const st = stateRef.current;
    const cur = currentRef.current;
    const r = cur ? st.retry[cur.id] : undefined;
    // "נסו שוב" sits in the bar's alert: the same decision again, focus as for a bar action of that kind.
    if (cur && r) decide(cur, r.action, r.doneLabel, r.amountKind, howOr(how, 'keyboard'), 'bar');
  }

  function hideElsewhere(): void {
    const st = stateRef.current;
    const cur = currentRef.current;
    if (!cur || !st.elsewhere.has(cur.id)) return;
    const nextId = nextOpenAfter(st, cur.id);
    dispatch({ type: 'elsewhere/hide', id: cur.id });
    writeSel(nextId);
    // No loaded gap next but more on the server: not empty — focus stays until the next page brings its first gap.
    setFocus(nextId ? { to: 'row', id: nextId } : st.hasMore ? { to: 'stay' } : { to: 'empty' });
    if (nextId == null) void continueOnNextPage((id) => ({ to: 'row', id }));
  }

  /* ───────────────────────── bulk selection ───────────────────────── */

  function toggleChecked(id: string): void {
    if (mode !== 'desk' || !wide) return; // no multi-select below 1280 px or on the landing (§5.7)
    const st = stateRef.current;
    const row = st.items.find((x) => x.id === id);
    if (!row || !isOpenRow(st, id) || row.canAct === false) return;
    const why = batchRefusalOf(row);
    if (why) {
      announce(why === 'block' ? t('desk.batchBlock') : t('desk.batchVat'));
      return;
    }
    dispatch({ type: 'check/toggle', id });
  }

  const live = liveRows(s);
  const checkedIds: ReadonlySet<string> = new Set(live.filter((x) => s.checked.has(x.id)).map((x) => x.id));
  const bulk = bulkSelection(live, checkedIds);
  const vatPicked = bulk.rows.some((r) => batchBasisBlock(r) != null);
  const batchBusy = s.inFlight.has(BATCH_KEY);
  const batchReason = bulk.blocked.some((b) => b.why === 'block')
    ? t('desk.batchBlock')
    : vatPicked
      ? t('desk.batchVat')
      : bulk.blocked.some((b) => b.why === 'cannotAct')
        ? t('desk.batchCannotAct')
        : bulk.blocked.some((b) => b.why === 'over_cap')
          ? t('desk.batchOverCap', { cap: ilsText(locale, BULK_CAP_AGOROT) })
          : null;
  const selectionDisabled = bulk.disabled || vatPicked || batchBusy;

  function approveChecked(how?: How): void {
    if (mode !== 'desk' || selectionDisabled || bulk.rows.length === 0) return;
    decideBatch(bulk.rows, 'selection', howOr(how, 'pointer'));
  }

  function approveInvoice(invoiceId: string, how?: How): void {
    const rows = liveRows(stateRef.current).filter((x) => x.invoiceId === invoiceId);
    const g = groupByInvoice(rows)[0];
    // §5.8: never with a block row or a VAT gap (R6), only when the group primary is allowed (≤ the cap, ₪ > 0).
    if (!g || rows.some((r) => batchRefusalOf(r) != null || decisionBlockOf(r) != null) || !groupPrimary(g).ok) return;
    decideBatch(rows, 'group', howOr(how, 'pointer'));
  }

  /* ───────────────────────── the view's data ───────────────────────── */

  const currentState = current ? rowStateOf(s, current.id) : null;
  const rows = rowsView(s, current?.id ?? null);
  const tiers = groupByTier(
    rows.map((v) => ({ severity: v.row.severity, v })),
    (x) => x.v.state === 'open',
    s.hasMore,
  ).map((g) => ({ tier: g.tier, open: g.open, rows: g.rows.map((x) => x.v) }));
  const nextId = current && currentState === 'open' ? nextOpenAfter(s, current.id) : null;
  const next = nextId ? (s.items.find((x) => x.id === nextId) ?? null) : null;
  const siblings = current
    ? live.filter((x) => (current.invoiceId ? x.invoiceId === current.invoiceId : x.id === current.id))
    : [];
  const escalateRow = s.escalateFor ? s.items.find((x) => x.id === s.escalateFor?.id) : undefined;

  return {
    mode,
    rows,
    tiers,
    live,
    current,
    currentState,
    next,
    position: positionOf(s, current?.id ?? null),
    canPrev: current != null && stepOpen(s, current.id, -1) != null,
    canNext: current != null && (stepOpen(s, current.id, 1) != null || s.hasMore),
    summary: s.summary,
    hasMore: s.hasMore,
    loadingMore: s.loadingMore,
    loadingNext: current == null && s.loadingMore && s.hasMore,
    siblings,
    note: current ? (s.notes[current.id] ?? null) : null,
    elsewhereText: current ? (s.elsewhere.get(current.id)?.text ?? null) : null,
    asking: s.asking,
    undo: s.undo,
    announcement: s.announcement,
    selection: {
      ids: checkedIds,
      rows: bulk.rows,
      sumAgorot: bulk.sumAgorot,
      disabled: selectionDisabled,
      reason: batchReason,
      note: s.batchNote,
      busy: batchBusy,
    },
    escalateFor: s.escalateFor && escalateRow ? { row: escalateRow, origin: s.escalateFor.origin } : null,
    keysOpen: s.keysOpen,
    focus: s.focus,
    motion: s.motion,

    select,
    move,
    claim,
    openReasons,
    closeReasons,
    pay,
    requestEscalate,
    escalate: sendEscalation,
    closeEscalate: () => dispatch({ type: 'escalate/close' }),
    undoLast,
    expireUndo,
    toggleChecked,
    clearChecked: () => dispatch({ type: 'check/clear' }),
    approveChecked,
    approveInvoice,
    hideElsewhere,
    retry,
    loadMore,
    setKeysOpen: (open: boolean) => dispatch({ type: 'keys/open', open }),
    focusQueue: () => {
      const cur = currentRef.current;
      if (cur) setFocus({ to: 'row', id: cur.id });
    },
    focusHeading,
    consumeFocus: () => setFocus(null),
  };
}
