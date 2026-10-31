'use client';

import { AlertTriangle, Check, CloudOff, Loader2, Minus, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LineStatus, ReconciliationLine, ReconciliationResult } from '../_mock';
import {
  DAMAGED_PATCH,
  MISSING_PATCH,
  asOrderedPatch,
  confirmSpotCheck,
  countProgress,
  lineKey,
  qtyPatch,
  unresolvedOrderLines,
  type LineMark,
} from '../_state';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { Translator } from '@/lib/i18n/translate';
import { ActionBar, PRIMARY_56, SECONDARY_48 } from './ActionBar';
import { HebrewToggle, ItemName, useUnitLabel } from './english';
import { outsideTolerance, parseQty, qtyInputText, qtyKind, roundQty, type QtyTolerance } from './qtyEntry';
import { StepHeader } from './SupplierSelect';
import { pickSpotCheck } from '@/app/dashboard/receiving/[poId]/_count';

type TD = Translator<typeof receivingDelivery.he>;

/** Per-line save state shown on the line (the wizard's line outbox); keyed by lineKey. */
export type LineSaveUi = 'saving' | 'saved' | 'queued' | 'error';

/** How long the bulk "mark the rest" can be undone. */
export const UNDO_MS = 10_000;

interface Props {
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  onUpdateMark: (key: string, patch: Partial<LineMark>) => void;
  /** Close the receipt. `finalMarks` is passed when the close itself changed marks ("everything arrived"). */
  onSubmit: (finalMarks?: Record<string, LineMark>) => void;
  /** Back to the invoice comparison (only when an invoice was read). */
  onBack?: () => void;
  /** Showcase: kept for the old prop; the bar is positioned by --rm-field-bar-bottom now. */
  footerBottomClass?: string;
  eyebrow?: string;
  saveStates?: Record<string, LineSaveUi>;
  onRetrySave?: () => void;
  /** The matching engine's quantity tolerance — a typed weight outside it asks for one confirm. */
  tolerance?: QtyTolerance;
  /** The receipt was reopened mid-count (marks restored). */
  resumed?: boolean;
  closing?: boolean;
  /** A message for the footer (offline / lines not saved) — shown by the close, not at the top (RCV-27). */
  footerMessage?: React.ReactNode;
  /** Extra rows under the screen (the wizard's banners stay above). */
  children?: React.ReactNode;
}

/** Lines whose invoice differs in a way the receiver must look at (shown open). */
const NEEDS_EYES: ReadonlySet<LineStatus> = new Set(['qty_diff', 'unordered', 'missing_from_invoice']);

/**
 * Delivery Check (W1-06; RCV-01/14/15, mobile-field-03): EVERY line can be
 * counted. Lines that need a look open first; the rest are one-line rows with
 * ✓ "arrived" and "edit". Nothing is pre-resolved — "invoice = order" is not
 * "arrived". One primary at the bottom: "everything arrived as ordered (12)"
 * before anything is marked, then "mark the rest as ordered (8)" (10 s undo)
 * above a close that unlocks when every line is resolved.
 */
export function AdjustQuantities({
  result,
  marks,
  onUpdateMark,
  onSubmit,
  onBack,
  eyebrow,
  saveStates,
  onRetrySave,
  tolerance,
  resumed = false,
  closing = false,
  footerMessage,
  children,
}: Props) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();
  const { resolved, total } = countProgress(result, marks);
  const unresolvedOrder = unresolvedOrderLines(result, marks);
  const [undo, setUndo] = useState<{ previous: Record<string, LineMark>; count: number } | null>(null);
  // The blind spot check that precedes every bulk "as ordered" (owner decision 20, default).
  const [spot, setSpot] = useState<{ keys: string[]; mode: 'all' | 'rest' } | null>(null);
  const [spotMismatch, setSpotMismatch] = useState(false);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(result.lines.filter((l) => NEEDS_EYES.has(l.status) && !marks[lineKey(l)]?.touched).map(lineKey)),
  );

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const ordered = [
    ...result.lines.filter((l) => NEEDS_EYES.has(l.status)),
    ...result.lines.filter((l) => !NEEDS_EYES.has(l.status)),
  ];

  /** Both bulk actions start with a blind count of (up to) two random order lines. */
  function startSpotCheck(mode: 'all' | 'rest') {
    const keys = pickSpotCheck(unresolvedOrder.filter((l) => l.poQty !== null).map(lineKey));
    if (keys.length === 0) return;
    setSpotMismatch(false);
    setUndo(null);
    setSpot({ keys, mode });
  }

  function confirmSpot(counts: Record<string, number>) {
    if (!spot) return;
    const r = confirmSpotCheck(result, marks, counts, tolerance);
    for (const key of Object.keys(r.previous)) onUpdateMark(key, r.next[key]!);
    setSpot(null);
    if (r.mismatched.length > 0) {
      setSpotMismatch(true);
      return;
    }
    const bulked = Object.keys(r.previous).filter((k) => r.next[k]?.method === 'bulk_as_ordered').length;
    if (spot.mode === 'all' && result.lines.every((l) => r.next[lineKey(l)]?.touched)) {
      onSubmit(r.next);
      return;
    }
    // The spot counts are hand counts; only a real bulk is offered for undo.
    if (bulked > 0) setUndo({ previous: r.previous, count: bulked });
  }

  function undoMarkRest() {
    if (!undo) return;
    for (const [key, prev] of Object.entries(undo.previous)) onUpdateMark(key, { ...prev, touched: prev.touched });
    setUndo(null);
  }

  const toggle = (key: string, value?: boolean) =>
    setOpen((s) => {
      const next = new Set(s);
      if (value ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const progressText = td('delivery.count.progress', {
    done: formatNumber(resolved, locale),
    total: formatNumber(total, locale),
  });
  const allDone = total > 0 && resolved === total;

  return (
    <div dir={dir} data-testid="delivery-check">
      <StepHeader compact eyebrow={eyebrow ?? td('delivery.count.eyebrow')} title={t('steps.adjust.title')} subtitle={td('delivery.count.subtitle')} />

      {resumed && resolved > 0 ? (
        <p role="status" className="mb-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-base text-ink" data-testid="count-resumed">
          {td('delivery.count.resumed', { done: formatNumber(resolved, locale), total: formatNumber(total, locale) })}
        </p>
      ) : null}

      <div className="mb-4 flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={progressText}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={resolved}
          className="h-2 flex-1 overflow-hidden rounded-full border border-line-strong bg-surface"
        >
          <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 text-base font-semibold tabular-nums text-ink" data-testid="count-progress">
          {progressText}
        </span>
      </div>

      <div className="mb-3 flex justify-end">
        <HebrewToggle />
      </div>

      <ul className="mb-4 space-y-3">
        {ordered.map((line) => {
          const key = lineKey(line);
          const mark = marks[key];
          if (!mark) return null;
          return (
            <CountLine
              key={key}
              line={line}
              mark={mark}
              open={open.has(key)}
              onToggle={(v) => toggle(key, v)}
              onUpdate={(patch) => onUpdateMark(key, patch)}
              saveState={saveStates?.[key]}
              onRetrySave={onRetrySave}
              tolerance={tolerance}
              td={td}
              locale={locale}
            />
          );
        })}
      </ul>

      {onBack ? (
        <button type="button" onClick={onBack} className="min-h-12 text-base text-muted underline underline-offset-4 hover:text-ink">
          {t('steps.adjust.backToResults')}
        </button>
      ) : null}

      {children}

      <ActionBar testId="count-actions">
        {spot ? (
          <SpotCheck
            lines={spot.keys.map((k) => result.lines.find((l) => lineKey(l) === k)!).filter(Boolean)}
            onConfirm={confirmSpot}
            onCancel={() => setSpot(null)}
            td={td}
            locale={locale}
          />
        ) : (
        <>
        {spotMismatch && unresolvedOrder.length > 0 ? (
          <p role="alert" className="flex items-start gap-2 text-base font-semibold text-ink" data-testid="spot-mismatch">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
            {td('delivery.count.spotMismatch')}
          </p>
        ) : null}
        {footerMessage ? (
          <div role="alert" className="text-base font-medium text-ink" data-testid="count-footer-message">
            {footerMessage}
          </div>
        ) : null}
        {undo ? (
          <p role="status" className="flex min-h-12 items-center justify-between gap-3 text-base text-ink" data-testid="mark-rest-undo">
            <span>{td('delivery.count.markedRest', { count: formatNumber(undo.count, locale) })}</span>
            <button type="button" onClick={undoMarkRest} className="min-h-12 rounded-xl px-4 font-semibold text-primary underline underline-offset-4">
              {td('delivery.count.undo')}
            </button>
          </p>
        ) : resolved > 0 && unresolvedOrder.length > 0 && !spotMismatch ? (
          <button type="button" onClick={() => startSpotCheck('rest')} className={SECONDARY_48} data-testid="mark-rest">
            {td('delivery.count.markRest', { count: formatNumber(unresolvedOrder.length, locale) })}
          </button>
        ) : null}
        {closing ? (
          <button type="button" disabled className={PRIMARY_56} data-testid="close-receipt">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {td('delivery.count.closing')}
          </button>
        ) : resolved === 0 && unresolvedOrder.length > 0 && !spotMismatch ? (
          <button type="button" onClick={() => startSpotCheck('all')} className={PRIMARY_56} data-testid="all-arrived">
            <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
            {td('delivery.count.allArrived', { count: formatNumber(unresolvedOrder.length, locale) })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={!allDone}
            aria-describedby={allDone ? undefined : 'count-close-reason'}
            className={PRIMARY_56}
            data-testid="close-receipt"
          >
            {allDone ? (
              <>
                <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
                {td('delivery.count.closeCount', { done: formatNumber(resolved, locale), total: formatNumber(total, locale) })}
              </>
            ) : (
              <span id="count-close-reason">{progressText}</span>
            )}
          </button>
        )}
        </>
        )}
      </ActionBar>
    </div>
  );
}

interface LineProps {
  line: ReconciliationLine;
  mark: LineMark;
  open: boolean;
  onToggle: (open?: boolean) => void;
  onUpdate: (patch: Partial<LineMark>) => void;
  saveState?: LineSaveUi;
  onRetrySave?: () => void;
  tolerance?: QtyTolerance;
  td: TD;
  locale: 'he' | 'en';
}

/** One order line: a row (✓ / edit) that opens into the editor in place. */
function CountLine({ line, mark, open, onToggle, onUpdate, saveState, onRetrySave, tolerance, td, locale }: LineProps) {
  const unit = useUnitLabel();
  const lineUnit = line.poUnit ?? line.invoiceUnit;
  const name = locale === 'en' && line.productNameEn ? line.productNameEn : line.productName;
  const onOrder = line.poLineId !== null;
  const asOrdered = onOrder && mark.touched && mark.rejectReason == null && mark.condition === 'ok' && line.poQty !== null && roundQty(mark.qtyReceived) === roundQty(line.poQty);
  const missing = mark.rejectReason === 'missing';
  const damaged = mark.condition === 'damaged';
  const qtyText = (q: number) => `${formatNumber(q, locale, { maximumFractionDigits: 3 })}${lineUnit ? ` ${unit(lineUnit)}` : ''}`;
  const editorId = `count-editor-${lineKey(line)}`;

  return (
    <li
      data-testid="count-line"
      data-resolved={mark.touched ? 'true' : 'false'}
      className={`count-line rounded-2xl border bg-surface p-4 ${mark.touched ? 'border-line' : 'border-line-strong'} ${open ? 'adjust-card' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ItemName he={line.productName} en={line.productNameEn} className="text-[17px] font-semibold leading-6 text-ink" />
          <p className="mt-1 text-base text-muted">
            {onOrder && line.poQty !== null ? td('delivery.count.ordered', { qty: qtyText(line.poQty) }) : td('delivery.count.notOrdered')}
            {line.invoiceQty !== null && (line.poQty === null || roundQty(line.invoiceQty) !== roundQty(line.poQty)) ? (
              <> · {td('delivery.count.billed', { qty: qtyText(line.invoiceQty) })}</>
            ) : null}
          </p>
          {line.status === 'price_diff' ? (
            <p className="mt-1 text-sm text-muted" data-testid="count-price-note">
              {td('delivery.review.priceToManager')}
            </p>
          ) : null}
        </div>
        {mark.touched && !open ? (
          <p className="shrink-0 text-end text-lg font-bold tabular-nums text-ink" data-testid="count-line-result">
            {missing ? td('delivery.count.missingTag') : qtyText(mark.qtyReceived)}
            {damaged ? <span className="block text-sm font-semibold text-warn">{td('delivery.count.damagedTag')}</span> : null}
            {mark.method === 'bulk_as_ordered' ? (
              <span className="block text-sm font-normal text-muted" data-testid="count-bulk-tag">
                {td('delivery.count.bulkTag')}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {!open ? (
        <div className="mt-3 flex gap-2">
          {onOrder ? (
            <button
              type="button"
              aria-pressed={asOrdered}
              aria-label={td('delivery.count.arrivedFor', { name })}
              onClick={() => onUpdate(asOrderedPatch(line))}
              className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-base font-semibold ${
                asOrdered ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface text-ink hover:border-primary'
              }`}
              data-testid="count-arrived"
            >
              <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
              {td('delivery.count.arrived')}
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={false}
            aria-controls={editorId}
            aria-label={td('delivery.count.editFor', { name })}
            onClick={() => onToggle(true)}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-base font-semibold text-ink hover:border-primary"
            data-testid="count-edit"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {td('delivery.count.edit')}
          </button>
        </div>
      ) : (
        <LineEditor
          id={editorId}
          line={line}
          mark={mark}
          name={name}
          unitLabel={lineUnit ? unit(lineUnit) : ''}
          onUpdate={onUpdate}
          onDone={() => onToggle(false)}
          tolerance={tolerance}
          td={td}
          locale={locale}
          qtyText={qtyText}
        />
      )}

      <SaveState state={saveState} onRetry={onRetrySave} td={td} />
    </li>
  );
}

function LineEditor({
  id,
  line,
  mark,
  name,
  unitLabel,
  onUpdate,
  onDone,
  tolerance,
  td,
  locale,
  qtyText,
}: {
  id: string;
  line: ReconciliationLine;
  mark: LineMark;
  name: string;
  unitLabel: string;
  onUpdate: (patch: Partial<LineMark>) => void;
  onDone: () => void;
  tolerance?: QtyTolerance;
  td: TD;
  locale: 'he' | 'en';
  qtyText: (q: number) => string;
}) {
  const kind = qtyKind(line.poUnit ?? line.invoiceUnit);
  const [text, setText] = useState(qtyInputText(mark.qtyReceived));
  const [pendingConfirm, setPendingConfirm] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  // Follow outside changes (a chip, "mark the rest", undo) unless the receiver is typing.
  useEffect(() => {
    if (!focused.current) setText(qtyInputText(mark.qtyReceived));
  }, [mark.qtyReceived]);

  const onOrder = line.poLineId !== null;

  function commit(qty: number, typed: boolean) {
    const pct = typed && kind === 'measured' && tolerance ? outsideTolerance(line.poQty, qty, tolerance) : null;
    if (pct !== null && qty > 0) {
      // Far from the order: keep the number, ask once before it counts as resolved.
      setPendingConfirm(pct);
      onUpdate({ ...qtyPatch(mark, qty), touched: false });
      return;
    }
    setPendingConfirm(null);
    onUpdate(qtyPatch(mark, qty));
  }

  function step(delta: number) {
    const next = Math.max(0, roundQty(mark.qtyReceived + delta));
    setText(qtyInputText(next));
    commit(next, false);
  }

  const chip = (active: boolean, extra = '') =>
    `inline-flex min-h-12 items-center gap-1.5 rounded-full border px-4 text-base font-semibold ${extra} ${
      active ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface text-ink hover:border-primary'
    }`;
  const isAsOrdered = mark.touched && line.poQty !== null && roundQty(mark.qtyReceived) === roundQty(line.poQty) && mark.rejectReason == null;
  const isMissing = mark.rejectReason === 'missing';
  const isDamaged = mark.condition === 'damaged';
  const qtyLabel = td('delivery.count.qtyFor', { name, unit: unitLabel || '—' });

  return (
    <div id={id} className="mt-3 space-y-3" data-testid="count-editor">
      <div className="flex items-center justify-center gap-3">
        {kind === 'counted' ? (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={td('delivery.count.decreaseFor', { name })}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink active:bg-surface-2"
          >
            <Minus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
        <label className="flex min-w-0 items-baseline gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            dir="ltr"
            role={kind === 'counted' ? 'spinbutton' : undefined}
            aria-valuenow={kind === 'counted' ? mark.qtyReceived : undefined}
            aria-label={qtyLabel}
            value={text}
            onFocus={(e) => {
              focused.current = true;
              e.currentTarget.select();
            }}
            onBlur={() => {
              focused.current = false;
              setText(qtyInputText(mark.qtyReceived));
            }}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseQty(e.target.value);
              if (v !== null) commit(v, true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
            }}
            className="h-14 w-28 rounded-xl border-2 border-line-strong bg-surface text-center text-2xl font-bold tabular-nums text-ink"
            data-testid="count-qty"
          />
          {unitLabel ? <span className="text-base text-muted">{unitLabel}</span> : null}
        </label>
        {kind === 'counted' ? (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={td('delivery.count.increaseFor', { name })}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink active:bg-surface-2"
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {pendingConfirm !== null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/50 bg-surface px-3 py-2" data-testid="count-tolerance">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span className="flex-1 text-base text-ink">
            {td('delivery.count.outsideTolerance', {
              pct: formatPercent(pendingConfirm, locale, 0),
              ordered: line.poQty !== null ? qtyText(line.poQty) : '—',
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              setPendingConfirm(null);
              onUpdate({ touched: true });
            }}
            className="min-h-12 rounded-xl bg-primary px-4 text-base font-semibold text-on-primary"
            data-testid="count-confirm-qty"
          >
            {td('delivery.count.confirmQty')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {onOrder && line.poQty !== null ? (
          <button type="button" aria-pressed={isAsOrdered} onClick={() => { setPendingConfirm(null); onUpdate(asOrderedPatch(line)); }} className={chip(isAsOrdered)} data-testid="chip-as-ordered">
            {td('delivery.count.ordered', { qty: qtyText(line.poQty) })}
          </button>
        ) : null}
        <button type="button" aria-pressed={isMissing} onClick={() => { setPendingConfirm(null); onUpdate(MISSING_PATCH); }} className={chip(isMissing)} data-testid="chip-missing">
          {onOrder ? td('delivery.count.missingTag') : td('delivery.count.notArrived')}
        </button>
        {onOrder ? (
          <button type="button" aria-pressed={isDamaged} onClick={() => onUpdate(isDamaged ? { condition: 'ok', rejectReason: null } : DAMAGED_PATCH)} className={chip(isDamaged)} data-testid="chip-damaged">
            {td('delivery.count.damagedTag')}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        aria-expanded={true}
        aria-controls={id}
        onClick={onDone}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-base font-semibold text-ink"
        data-testid="count-done"
      >
        {td('delivery.count.doneEditing')}
      </button>
    </div>
  );
}

/**
 * The blind count before a bulk "as ordered": the ordered quantity is NOT
 * shown (the receiver writes what is on the dock), and the bulk only goes
 * through when every count agrees with the order.
 */
function SpotCheck({
  lines,
  onConfirm,
  onCancel,
  td,
  locale,
}: {
  lines: ReconciliationLine[];
  onConfirm: (counts: Record<string, number>) => void;
  onCancel: () => void;
  td: TD;
  locale: 'he' | 'en';
}) {
  const unit = useUnitLabel();
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  const parsed = Object.fromEntries(lines.map((l) => [lineKey(l), parseQty(values[lineKey(l)] ?? '')]));
  const ready = lines.every((l) => parsed[lineKey(l)] !== null);
  return (
    <form
      className="space-y-3"
      data-testid="spot-check"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onConfirm(parsed as Record<string, number>);
      }}
    >
      <div>
        <p className="text-base font-semibold text-ink">{td('delivery.count.spotTitle')}</p>
        <p className="text-sm text-muted">{td('delivery.count.spotHint')}</p>
      </div>
      {lines.map((l, i) => {
        const key = lineKey(l);
        const name = locale === 'en' && l.productNameEn ? l.productNameEn : l.productName;
        const u = l.poUnit ? unit(l.poUnit) : '';
        return (
          <label key={key} className="flex items-center justify-between gap-3" data-testid="spot-line" data-key={key}>
            <ItemName he={l.productName} en={l.productNameEn} className="min-w-0 flex-1 text-[17px] font-semibold text-ink" />
            <span className="flex shrink-0 items-baseline gap-2">
              <input
                ref={i === 0 ? firstRef : undefined}
                type="text"
                inputMode="decimal"
                enterKeyHint={i === lines.length - 1 ? 'done' : 'next'}
                autoComplete="off"
                dir="ltr"
                aria-label={td('delivery.count.spotQtyFor', { name, unit: u || '—' })}
                value={values[key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                className="h-12 w-24 rounded-xl border-2 border-line-strong bg-surface text-center text-xl font-bold tabular-nums text-ink"
                data-testid="spot-qty"
              />
              {u ? <span className="text-base text-muted">{u}</span> : null}
            </span>
          </label>
        );
      })}
      <button type="submit" disabled={!ready} className={PRIMARY_56} data-testid="spot-confirm">
        <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
        {td('delivery.count.spotConfirm')}
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY_48} data-testid="spot-cancel">
        {td('delivery.count.spotCancel')}
      </button>
    </form>
  );
}

function SaveState({ state, onRetry, td }: { state?: LineSaveUi; onRetry?: () => void; td: TD }) {
  if (!state) return null;
  return (
    <p className="mt-2 flex min-h-6 items-center gap-1.5 text-sm text-muted" data-testid="line-save-state" data-state={state}>
      {state === 'saving' ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {td('delivery.count.saving')}
        </>
      ) : state === 'saved' ? (
        <>
          <Check className="h-4 w-4 text-primary" strokeWidth={3} aria-hidden="true" />
          {td('delivery.count.saved')}
        </>
      ) : state === 'queued' ? (
        <>
          <CloudOff className="h-4 w-4" aria-hidden="true" />
          {td('delivery.count.queued')}
        </>
      ) : (
        <span className="flex items-center gap-2 text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {td('delivery.count.saveError')}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="min-h-12 px-2 font-semibold underline underline-offset-4">
              {td('delivery.count.retry')}
            </button>
          ) : null}
        </span>
      )}
    </p>
  );
}

