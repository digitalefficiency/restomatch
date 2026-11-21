'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, CloudOff, Loader2, Minus, Pencil } from 'lucide-react';
import { Button } from '@/lib/components';
import type { ReconciliationLine, ReconciliationResult } from '@/app/showcase/receiver/_mock';
import { asOrderedPatch, confirmSpotCheck, countProgress, lineKey, unresolvedOrderLines, type LineMark } from '@/app/showcase/receiver/_state';
import type { LineSaveUi } from '@/app/showcase/receiver/_steps/AdjustQuantities';
import { ActionBar } from '@/app/showcase/receiver/_steps/ActionBar';
import { HebrewToggle, ItemName, useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import type { QtyTolerance } from '@/app/showcase/receiver/_steps/qtyEntry';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { Translator } from '@/lib/i18n/translate';
import { pickSpotCheck } from './_count';
import { billedBeside, dockGaps, mainAction, needsCloseCheck, orderedForCount, rowNote, rowState, type RowNote } from './_dock';
import { PHONE_CTA } from './_phone';
import { DockCloseSheet, type DocState } from './dock-close-sheet';
import { DockQtySheet } from './dock-qty-sheet';
import { DockSpotSheet } from './dock-spot-sheet';

type TD = Translator<typeof receivingDelivery.he>;

/** How long a bulk "mark the rest" can be undone (AdjustQuantities.UNDO_MS, unchanged). */
const UNDO_MS = 10_000;

interface Props {
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  onUpdateMark: (key: string, patch: Partial<LineMark>) => void;
  /** Close the receipt (the wizard's submit). `finalMarks` when the close itself changed marks ("everything arrived"). */
  onSubmit: (finalMarks?: Record<string, LineMark>) => void;
  /** Back to the invoice comparison (only when an invoice was read). */
  onBack?: () => void;
  /** The supplier: the screen's first line. */
  supplierName: string;
  saveStates?: Record<string, LineSaveUi>;
  onRetrySave?: () => void;
  /** The matching engine's quantity tolerance (read on the server). */
  tolerance?: QtyTolerance;
  /** The receipt was reopened mid-count (marks restored). */
  resumed?: boolean;
  closing?: boolean;
  /** Offline / not saved / session expired / uncounted: shown by the button that closes. */
  footerMessage?: React.ReactNode;
  /** Flag `dockCountFirst`: the sheet opens empty and the document is asked for before closing. */
  countFirst?: boolean;
  /** The document of this receipt. */
  doc?: DocState;
  /** The document can (still) be photographed: the camera button, and the check before closing, offer it. */
  onPhoto?: (opts?: { closeAfter?: boolean }) => void;
  /** View only: every line and count stays visible; no tick, no sheet, no bulk, no close. */
  readOnly?: boolean;
}

/**
 * The delivery check on a phone (DS3-05, SPEC §10.3): one row per item, a large
 * tick at the thumb's side (the start edge) that means "arrived as ordered", the
 * count or a pencil at the other edge that opens the quantity sheet, and one
 * button at the bottom that always says the next step with its count. Rows keep
 * their height when they are marked; a marked row steps back, an open one stays
 * the strongest.
 *
 * Every rule is the wizard's existing one: the marks and patches of
 * showcase/receiver/_state.ts, the spot check before any bulk mark (owner
 * decision 20), the ten-second undo of a bulk mark, closing only when every line
 * is resolved, the engine's quantity tolerance. What is new is the look, the
 * sheet with the pad, one button instead of a disabled close under a text
 * button, and a short check before closing when there is a gap.
 */
export function DockCount({
  result,
  marks,
  onUpdateMark,
  onSubmit,
  onBack,
  supplierName,
  saveStates,
  onRetrySave,
  tolerance,
  resumed = false,
  closing = false,
  footerMessage,
  countFirst = false,
  doc = 'none',
  onPhoto,
  readOnly = false,
}: Props) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();
  const { resolved, total } = countProgress(result, marks);
  const [undo, setUndo] = useState<{ previous: Record<string, LineMark>; count: number } | null>(null);
  const [spot, setSpot] = useState<{ keys: string[]; mode: 'all' | 'rest' } | null>(null);
  const [spotMismatch, setSpotMismatch] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  // The check before closing; it remembers the marks of a close that changed them ("everything arrived").
  const [check, setCheck] = useState<{ finalMarks?: Record<string, LineMark> } | null>(null);
  // Focus never falls to the page when a control it is on goes away (the spot check closing on a
  // close that waits, the undo button leaving).
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const [focusAfterSpot, setFocusAfterSpot] = useState(false);
  const focusMain = () => mainRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => {
      if (undoRef.current && document.activeElement === undoRef.current) focusMain();
      setUndo(null);
    }, UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const lines = useMemo(() => orderedForCount(result.lines), [result.lines]);
  const byKey = useMemo(() => new Map(result.lines.map((l) => [lineKey(l), l])), [result.lines]);
  const action = mainAction({ result, marks, spotMismatch, closing });
  const gaps = dockGaps(result, check?.finalMarks ?? marks, tolerance);
  const failedSaves = Object.values(saveStates ?? {}).filter((s) => s === 'error').length;
  const unresolvedOrder = unresolvedOrderLines(result, marks);

  const progressText = td('delivery.count.progress', { done: formatNumber(resolved, locale), total: formatNumber(total, locale) });
  const items = td('delivery.dock.items', { count: total, n: formatNumber(total, locale) });

  /** Both bulk actions start with a blind count of (up to) two random order lines. */
  function startSpotCheck(mode: 'all' | 'rest') {
    const keys = pickSpotCheck(unresolvedOrder.filter((l) => l.poQty !== null).map(lineKey));
    if (keys.length === 0) return;
    setSpotMismatch(false);
    setUndo(null);
    setSpot({ keys, mode });
  }

  /** Close now, or first the short check when there is something to check. */
  function requestClose(finalMarks?: Record<string, LineMark>) {
    const found = dockGaps(result, finalMarks ?? marks, tolerance);
    if (needsCloseCheck({ gaps: found.length, photographed: doc !== 'none', countFirst })) setCheck({ finalMarks });
    else onSubmit(finalMarks);
  }

  function confirmSpot(counts: Record<string, number>) {
    if (!spot) return;
    const r = confirmSpotCheck(result, marks, counts, tolerance);
    for (const key of Object.keys(r.previous)) onUpdateMark(key, r.next[key]!);
    const mode = spot.mode;
    setSpot(null);
    setFocusAfterSpot(true);
    if (r.mismatched.length > 0) {
      setSpotMismatch(true);
      return;
    }
    const bulked = Object.keys(r.previous).filter((k) => r.next[k]?.method === 'bulk_as_ordered').length;
    if (mode === 'all' && result.lines.every((l) => r.next[lineKey(l)]?.touched)) {
      requestClose(r.next);
      return;
    }
    // The spot counts are hand counts; only a real bulk is offered for undo.
    if (bulked > 0) setUndo({ previous: r.previous, count: bulked });
  }

  function undoMarkRest() {
    if (!undo) return;
    for (const [key, prev] of Object.entries(undo.previous)) onUpdateMark(key, { ...prev, touched: prev.touched });
    setUndo(null);
    // The undo button goes; the main button (now "mark the rest" again) takes the focus.
    requestAnimationFrame(focusMain);
  }

  // The spot check closed. The dialog hands focus back to the button that opened it; when that button
  // now waits (disabled), focus goes on: to the undo of the bulk, or to the first line still to count.
  useEffect(() => {
    if (spot || !focusAfterSpot) return;
    setFocusAfterSpot(false);
    const main = mainRef.current?.querySelector('button');
    if (main && !main.disabled) return;
    const target =
      undoRef.current ??
      rootRef.current?.querySelector<HTMLButtonElement>('[data-testid="count-line"][data-resolved="false"] [data-testid="count-edit"]');
    target?.focus({ preventScroll: true });
  }, [spot, focusAfterSpot]);

  function tick(line: ReconciliationLine) {
    const key = lineKey(line);
    const state = rowState(line, marks[key], tolerance);
    // One tap never replaces a count that was typed: on a gap the circle opens the quantity.
    if (state === 'gap') return setEditKey(key);
    setUndo(null);
    onUpdateMark(key, state === 'ok' ? { touched: false } : asOrderedPatch(line));
  }

  const status: { text: string; tone: 'calm' | 'warn' } | null = undo
    ? { text: td('delivery.count.markedRest', { count: formatNumber(undo.count, locale) }), tone: 'calm' }
    : spotMismatch && unresolvedOrder.length > 0
      ? { text: td('delivery.count.spotMismatch'), tone: 'warn' }
      : action.kind === 'wait' && unresolvedOrder.length === 0
        ? { text: td('delivery.count.unorderedNeeds'), tone: 'calm' }
        : action.kind === 'close' && countFirst
          ? { text: doc === 'none' ? td('delivery.dock.status.allMarkedNoDoc') : td('delivery.dock.status.allMarked'), tone: 'calm' }
          : null;
  // Why the close waits, for the disabled button's description (the undo text may be on screen meanwhile).
  const waitText =
    action.kind !== 'wait'
      ? null
      : spotMismatch && unresolvedOrder.length > 0
        ? td('delivery.count.spotMismatch')
        : unresolvedOrder.length === 0
          ? td('delivery.count.unorderedNeeds')
          : null;

  return (
    <div ref={rootRef} dir={dir} data-testid="delivery-check" data-count-first={countFirst ? 'true' : 'false'} className="mx-auto w-full max-w-xl">
      <header className="mb-3 flex flex-col">
        <p className="text-title-sm text-ink" data-testid="count-supplier">
          {supplierName}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-body-sm text-muted">
          <h1 tabIndex={-1} data-step-heading="" className="text-body-sm font-normal text-muted outline-none">
            {t('steps.adjust.title')}
          </h1>
          <span aria-hidden="true">·</span>
          <span>{items}</span>
        </div>
      </header>

      {resumed && resolved > 0 ? (
        <p role="status" className="mb-3 rounded-card border border-line bg-surface-2 px-4 py-3 text-body text-ink" data-testid="count-resumed">
          {td('delivery.count.resumed', { done: formatNumber(resolved, locale), total: formatNumber(total, locale) })}
        </p>
      ) : null}

      <div className="mb-2 flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={progressText}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={resolved}
          className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-2"
        >
          <div className="h-full rounded-pill bg-primary-bold transition-[width] duration-short ease-standard motion-reduce:transition-none" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 text-body-sm font-medium tabular-nums text-ink" data-testid="count-progress">
          {progressText}
        </span>
      </div>

      <div className="mb-1 flex justify-end empty:hidden">
        <HebrewToggle />
      </div>

      {/* Nothing is editable while the receipt is closing (an edit would be saved after the close). */}
      <fieldset disabled={closing} className="m-0 min-w-0 border-0 p-0">
        <ul className="mb-4 border-t border-line" data-testid="count-list">
          {lines.map((line) => {
            const key = lineKey(line);
            const mark = marks[key];
            if (!mark) return null;
            return (
              <CountRow
                key={key}
                line={line}
                mark={mark}
                readOnly={readOnly}
                saveState={saveStates?.[key]}
                tolerance={tolerance}
                blind={countFirst}
                editing={editKey === key}
                td={td}
                locale={locale}
                onTick={() => tick(line)}
                onEdit={() => setEditKey(key)}
                onEditClose={() => setEditKey(null)}
                onSave={(patch) => {
                  onUpdateMark(key, patch);
                  setUndo(null);
                  setEditKey(null);
                }}
              />
            );
          })}
        </ul>
      </fieldset>

      {onBack ? (
        <button type="button" onClick={onBack} className="min-h-12 text-body text-muted underline underline-offset-4 hover:text-ink">
          {t('steps.adjust.backToResults')}
        </button>
      ) : null}

      {readOnly ? null : (
        <ActionBar testId="count-actions">
          {status || onPhoto || doc !== 'none' ? (
            // Wraps when a long label (a receiver language) would squeeze the status: the camera then takes its own line.
            <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1">
              <div className="flex min-w-[10rem] flex-1 items-center gap-2" data-testid={undo ? 'mark-rest-undo' : undefined}>
                <p
                  // For the eye; screen readers hear the same words from the two live regions below.
                  aria-hidden="true"
                  className={`flex min-w-0 flex-1 items-center gap-2 text-body ${status?.tone === 'warn' ? 'font-semibold text-ink' : 'text-muted'}`}
                  data-testid={status?.tone === 'warn' ? 'spot-mismatch' : 'count-status'}
                >
                  {status?.tone === 'warn' ? <AlertTriangle className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" /> : null}
                  <span className="min-w-0">{status?.text}</span>
                </p>
                {undo ? (
                  <button ref={undoRef} type="button" onClick={undoMarkRest} className="min-h-12 shrink-0 rounded-card px-3 text-body font-semibold text-primary underline-offset-4 hover:underline">
                    {td('delivery.count.undo')}
                  </button>
                ) : null}
              </div>
              <DocButton doc={doc} onPhoto={onPhoto ? () => onPhoto() : undefined} td={td} />
            </div>
          ) : null}
          {/* With a footer on screen, its words stand alone (never the same alert twice); Retry stays beside it. */}
          {failedSaves > 0 && !footerMessage ? (
            <p role="alert" className="flex min-h-12 items-center justify-between gap-3 text-body text-ink" data-testid="count-save-failed">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
                {td('delivery.count.saveFailed', { count: formatNumber(failedSaves, locale) })}
              </span>
              {onRetrySave ? (
                <button type="button" onClick={onRetrySave} className="min-h-12 shrink-0 rounded-card px-3 font-semibold text-primary underline underline-offset-4">
                  {td('delivery.count.retry')}
                </button>
              ) : null}
            </p>
          ) : null}
          {footerMessage ? (
            <div className="flex min-h-12 items-center justify-between gap-3">
              <div role="alert" className="text-body font-medium text-ink" data-testid="count-footer-message">
                {footerMessage}
              </div>
              {failedSaves > 0 && onRetrySave ? (
                <button type="button" onClick={onRetrySave} className="min-h-12 shrink-0 rounded-card px-3 font-semibold text-primary underline underline-offset-4">
                  {td('delivery.count.retry')}
                </button>
              ) : null}
            </div>
          ) : null}
          {/* Always mounted, so each new message is spoken: one polite region, one alert region. */}
          <p className="sr-only" role="status">
            {status?.tone === 'calm' ? status.text : ''}
          </p>
          <p className="sr-only" role="alert">
            {status?.tone === 'warn' ? status.text : ''}
          </p>
          <span id="count-wait-reason" className="sr-only">
            {waitText ?? ''}
          </span>
          <div ref={mainRef} className="contents">
            <MainButton action={action} td={td} locale={locale} waitReason={waitText ? 'count-wait-reason' : undefined} onAll={() => startSpotCheck('all')} onRest={() => startSpotCheck('rest')} onClose={() => requestClose()} />
          </div>
        </ActionBar>
      )}

      <DockSpotSheet
        lines={spot ? spot.keys.map((k) => byKey.get(k)).filter((l): l is ReconciliationLine => Boolean(l)) : null}
        onConfirm={confirmSpot}
        onCancel={() => setSpot(null)}
      />
      <DockCloseSheet
        open={check !== null}
        gaps={gaps}
        doc={doc}
        askPhoto={countFirst && doc === 'none' && Boolean(onPhoto)}
        onBack={() => setCheck(null)}
        onClose={() => {
          const finalMarks = check?.finalMarks;
          setCheck(null);
          onSubmit(finalMarks);
        }}
        onPhoto={() => {
          setCheck(null);
          onPhoto?.({ closeAfter: true });
        }}
      />
    </div>
  );
}

/** The one button at the bottom: the next step and its count. Filled only to close. */
function MainButton({
  action,
  td,
  locale,
  waitReason,
  onAll,
  onRest,
  onClose,
}: {
  action: ReturnType<typeof mainAction>;
  td: TD;
  locale: 'he' | 'en';
  /** The status line that says why the close waits. */
  waitReason?: string;
  onAll: () => void;
  onRest: () => void;
  onClose: () => void;
}) {
  switch (action.kind) {
    case 'closing':
      return (
        <Button size="xl" disabled className={PHONE_CTA} data-testid="close-receipt" icon={<Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}>
          {td('delivery.count.closing')}
        </Button>
      );
    case 'all':
      return (
        <Button size="xl" variant="secondary" onClick={onAll} className={PHONE_CTA} data-testid="all-arrived" icon={<Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}>
          {td('delivery.count.allArrived', { count: formatNumber(action.count, locale) })}
        </Button>
      );
    case 'rest':
      return (
        <Button size="xl" variant="secondary" onClick={onRest} className={PHONE_CTA} data-testid="mark-rest" icon={<Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}>
          {td('delivery.dock.actions.markRest', { count: formatNumber(action.count, locale) })}
        </Button>
      );
    case 'close':
      return (
        <Button size="xl" onClick={onClose} className={PHONE_CTA} data-testid="close-receipt">
          {td('delivery.count.close')}
        </Button>
      );
    default:
      // Every line must be resolved first; the status line above says what is left.
      return (
        <Button size="xl" disabled aria-describedby={waitReason} className={PHONE_CTA} data-testid="close-receipt">
          {td('delivery.count.close')}
        </Button>
      );
  }
}

/** The document: a camera while it can still be photographed, a quiet state once it was. */
function DocButton({ doc, onPhoto, td }: { doc: DocState; onPhoto?: () => void; td: TD }) {
  if (doc !== 'none') {
    return (
      <span className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-pill border border-ok-subtle bg-ok-subtle px-4 text-body font-medium text-ok" data-testid="count-doc" data-doc={doc}>
        {doc === 'queued' ? <CloudOff className="h-5 w-5" aria-hidden="true" /> : <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}
        {doc === 'queued' ? td('delivery.dock.doc.queued') : td('delivery.dock.doc.done')}
      </span>
    );
  }
  if (!onPhoto) return null;
  return (
    <button
      type="button"
      onClick={onPhoto}
      className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-pill border border-line-strong bg-surface px-4 text-body font-medium text-ink transition-colors duration-micro ease-standard hover:bg-surface-2"
      data-testid="count-scan-invoice"
    >
      <Camera className="h-5 w-5" aria-hidden="true" />
      {td('delivery.dock.actions.photo')}
    </button>
  );
}

/** One item: the tick at the start edge, the name and what was ordered, the count or a pencil at the end. */
function CountRow({
  line,
  mark,
  readOnly,
  saveState,
  tolerance,
  blind,
  editing,
  td,
  locale,
  onTick,
  onEdit,
  onEditClose,
  onSave,
}: {
  line: ReconciliationLine;
  mark: LineMark;
  readOnly: boolean;
  saveState?: LineSaveUi;
  tolerance?: QtyTolerance;
  blind: boolean;
  editing: boolean;
  td: TD;
  locale: 'he' | 'en';
  onTick: () => void;
  onEdit: () => void;
  onEditClose: () => void;
  onSave: (patch: Partial<LineMark>) => void;
}) {
  const unit = useUnitLabel();
  const u = line.poUnit ?? line.invoiceUnit;
  const unitText = u ? unit(u) : '';
  const name = locale === 'en' && line.productNameEn ? line.productNameEn : line.productName;
  const state = rowState(line, mark, tolerance);
  const onOrder = line.poLineId !== null && line.poQty !== null;
  const qty = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 3 });
  const withUnit = (v: number) => `${qty(v)}${unitText ? ` ${unitText}` : ''}`;
  const note = rowNote(line, mark, tolerance);
  const noteText = rowNoteText(note, td, withUnit);
  // Today's order of steps reads the invoice first: the billed quantity stays beside the order (never in a blind count).
  const billed = blind ? null : billedBeside(line);
  const missing = mark.rejectReason === 'missing';
  const result = missing ? (onOrder ? td('delivery.count.missingTag') : td('delivery.count.notArrived')) : null;

  return (
    <li
      data-testid="count-line"
      data-resolved={mark.touched ? 'true' : 'false'}
      data-state={state}
      className={`flex min-h-[var(--count-row-h)] items-center gap-3 border-b border-line py-2 transition-colors duration-short ease-standard ${state === 'gap' ? 'bg-warn-subtle' : ''}`}
    >
      {onOrder && !readOnly ? (
        <button
          type="button"
          onClick={onTick}
          aria-pressed={state === 'gap' ? undefined : state === 'ok'}
          aria-label={state === 'gap' ? td('delivery.dock.aria.gapFor', { name }) : td('delivery.count.arrivedFor', { name })}
          className={`inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-pill border-2 transition-colors duration-short ease-standard ${
            state === 'ok'
              ? 'border-ok-subtle bg-ok-subtle text-ok'
              : state === 'gap'
                ? 'border-warn-dot-ring bg-warn-dot text-ink'
                : 'border-ink bg-surface text-line-strong active:bg-surface-2'
          }`}
          data-testid="count-arrived"
        >
          {state === 'gap' ? <Minus className="h-7 w-7" strokeWidth={3} aria-hidden="true" /> : <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />}
        </button>
      ) : (
        <span aria-hidden="true" className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-pill border-2 border-dashed border-line" />
      )}

      <div className="min-w-0 flex-1 py-1">
        {/* A marked row steps back (secondary ink, never an opacity: every text keeps AA); an open one stays the strongest. */}
        <ItemName he={line.productName} en={line.productNameEn} className={`text-title-sm transition-colors duration-short ease-standard ${state === 'ok' ? 'font-normal text-muted' : 'font-medium text-ink'}`} />
        {noteText || billed !== null || line.status === 'price_diff' || saveState ? (
          <p className={`flex flex-wrap items-center gap-x-2 text-body-sm ${state === 'gap' ? 'text-ink' : 'text-muted'}`}>
            {noteText ? <span data-testid={note?.kind === 'bulk' ? 'count-bulk-tag' : undefined}>{noteText}</span> : null}
            {billed !== null ? <span>{td('delivery.count.billed', { qty: withUnit(billed) })}</span> : null}
            {line.status === 'price_diff' ? <span data-testid="count-price-note">{td('delivery.review.priceToManager')}</span> : null}
            <SaveState state={saveState} td={td} />
          </p>
        ) : null}
      </div>

      {readOnly ? (
        mark.touched ? (
          <span className="shrink-0 text-end text-title-sm tabular-nums text-ink" data-testid="count-line-result">
            {result ?? withUnit(mark.qtyReceived)}
          </span>
        ) : null
      ) : mark.touched ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={td('delivery.dock.aria.changeQty', { name, qty: result ?? withUnit(mark.qtyReceived) })}
          className={`inline-flex h-14 min-w-[84px] shrink-0 flex-col items-end justify-center rounded-card border px-3 text-end transition-colors duration-micro ease-standard hover:bg-surface-2 ${
            state === 'ok' ? 'border-transparent' : 'border-line-strong bg-surface'
          }`}
          data-testid="count-edit"
        >
          <span className={`text-title-sm tabular-nums ${state === 'ok' ? 'font-normal text-muted' : 'font-medium text-ink'}`} data-testid="count-line-result">
            {result ?? qty(mark.qtyReceived)}
          </span>
          {!missing && unitText ? <span className="text-caption text-muted">{unitText}</span> : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          // "Another quantity" is the alternative to the tick; a line not on the order has no tick.
          aria-label={onOrder ? td('delivery.dock.aria.other', { name }) : td('delivery.count.editFor', { name })}
          className="inline-flex h-14 w-[84px] shrink-0 items-center justify-center rounded-card border border-line-strong bg-surface text-muted transition-colors duration-micro ease-standard hover:bg-surface-2 hover:text-ink"
          data-testid="count-edit"
        >
          <Pencil className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {readOnly ? null : (
        <DockQtySheet open={editing} line={line} mark={mark} name={name} tolerance={tolerance} blind={blind} onClose={onEditClose} onSave={onSave} />
      )}
    </li>
  );
}

function rowNoteText(note: RowNote, td: TD, withUnit: (v: number) => string): string | null {
  if (!note) return null;
  switch (note.kind) {
    case 'ordered': {
      const text = td('delivery.count.ordered', { qty: withUnit(note.ordered) });
      return note.damaged ? td('delivery.dock.row.withDamage', { text }) : text;
    }
    case 'notOrdered':
      return td('delivery.count.notOrdered');
    case 'missing':
      return td('delivery.count.missingTag');
    case 'damaged':
      return td('delivery.dock.row.damaged');
    case 'bulk':
      return td('delivery.count.bulkTag');
  }
}

/** The line's save state, small and quiet: only what needs the receiver's eye (saving, on the phone, failed). */
function SaveState({ state, td }: { state?: LineSaveUi; td: TD }) {
  if (!state) return null;
  if (state === 'saved') {
    return (
      <span className="sr-only" data-testid="line-save-state" data-state="saved">
        {td('delivery.count.saved')}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 ${state === 'error' ? 'text-danger' : 'text-muted'}`} data-testid="line-save-state" data-state={state}>
      {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : state === 'queued' ? <CloudOff className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
      {state === 'saving' ? td('delivery.count.saving') : state === 'queued' ? td('delivery.count.queued') : td('delivery.count.saveError')}
    </span>
  );
}
