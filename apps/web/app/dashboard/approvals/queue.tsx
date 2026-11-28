'use client';

/**
 * The approvals desk's queue side (DS3-04 spec §2.9, §4.3, §4.9, §5.1, §5.7): the queue column with its head
 * sentence, the read-only "waiting for others" lane, one grid per tier with a row per gap, the BatchBar (desk at
 * ≥ 1280 px only), the undo toast in its queue placement and the keys legend.
 *
 * Views only: everything renders from the controller (`DeskController`, use-desk.ts) and calls its intents. No tRPC,
 * no store read: what single keys draw arrives as the `singleKeys` prop (usePrefs().singleKeys, read in list.tsx);
 * the key handlers that ask `singleKeysEnabled()` live in use-desk-keys.ts and are passed in (`onRowsKeyDown`).
 * No view here moves focus: DeskView applies the controller's focus intents.
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import { Keyboard } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import { IconButton } from '@/lib/components/Button';
import { Kbd } from '@/lib/components/Kbd';
import { LoadMore } from '@/lib/components/LoadMore';
import { cn } from '@/lib/components/cn';
import { UndoToast } from '@/lib/components/desk/UndoToast';
import { StatusDot } from '@/lib/components/feedback/StatusChip';
import { Money } from '@/lib/components/money/Money';
import { daysUntil, formatDay } from '@/lib/components/money/format';
import { BatchBar } from '@/lib/components/table/BatchBar';
import { batchBasisBlock, deltaAgorot, headParts, tierOf, type HeadParts, type Tier } from './desk-facts';
import { rowSub, rowTitle } from './desk-text';
import type { DeskController, DeskMode, How, QueueItem, QueueRowView, QueueSummary } from './desk-types';
import { Template } from './rich-message';
import { UNDO_FAILED_MS, UNDO_VISIBLE_MS } from './undo-window';
import { ageDays, ageLabel } from './vocab';

type T = Translator<typeof approvalsHe>;

/* ───────────────────────────── the render's clock ───────────────────────────── */

/**
 * "Today" for this render (#418; moved from list.tsx:92-99 so the views can read it): the server passes its clock
 * (`nowMs`), so the day counts in the server HTML and on hydration come from ONE instant (never a render near Israel
 * midnight or a cached page hydrated later). `ApprovalsList` wraps the desk in `<NowProvider value={nowMs}>`.
 */
const NowCtx = createContext<number | null>(null);
// The repo's React types need the Provider cast (as lib/components/feedback/LiveRegion.tsx).
export const NowProvider = NowCtx.Provider as unknown as React.ComponentType<{
  value: number | null;
  children: React.ReactNode;
}>;

/** The render's "today" from the server's clock; undefined without a provider (the day helpers then use now). */
export function useRenderNow(): Date | undefined {
  const ms = useContext(NowCtx);
  return ms != null ? new Date(ms) : undefined;
}

/* ───────────────────────────── classes (literal maps: Tailwind sees every class) ───────────────────────────── */

const QUEUE: Record<DeskMode, string> = {
  desk: 'flex flex-col xl:min-h-0 xl:w-[22rem] xl:shrink-0 xl:border-e xl:border-line-rule 2xl:w-[24.25rem]',
  single: 'flex flex-col',
};

const HEAD: Record<DeskMode, string> = {
  desk: 'pb-3 xl:px-5 xl:pt-4 xl:pb-3 xl:group-data-[density=compact]/desk:pt-3',
  single: 'pb-3',
};

/** Forced colours: a solid outline on the focus dial (§4 FC_OUTLINE). */
const FC_OUTLINE =
  'forced-colors:[outline:var(--focus-width)_solid_Highlight] forced-colors:[outline-offset:calc(var(--focus-width)*-1)]';

/** 53 px regular (7 + 20 + 18 + 8) / 43 px compact (4 + 18 + 16 + 5): the dials follow `data-density` on the root. */
const ROW =
  'relative flex items-start rounded-control ps-1 pe-3 pt-[var(--decision-row-pt)] pb-[var(--decision-row-pb)] transition-colors duration-micro ease-standard';

/** The current gap: the info-sub fill and the start rail on the `--rail-w` dial (D13). */
const ROW_CURRENT = cn(
  'bg-surface-selected before:absolute before:inset-y-2.5 before:start-0 before:w-[var(--rail-w)] before:rounded-pill before:bg-info-dot',
  FC_OUTLINE,
);

/** A done row's result rises in after a pointer decision (§4.10); key and keyboard decisions never animate. */
const RESULT_MOTION =
  'motion-safe:transition-[opacity,transform] motion-safe:duration-short motion-safe:ease-enter [@starting-style]:opacity-0 [@starting-style]:translate-y-1';

/** pointer click (`detail` ≥ 1) or a keyboard-activated button (`detail` 0, or no event). */
function howOfClick(e: unknown): How {
  const detail = (e as { detail?: unknown } | null | undefined)?.detail;
  return typeof detail === 'number' && detail > 0 ? 'pointer' : 'keyboard';
}

/** A role's name ("בעלים"), or the stored value when the catalog has none. */
function roleName(t: T, role: string): string {
  const out = t(`roles.${role}` as MessageKey<typeof approvalsHe>);
  return out.startsWith('roles.') ? role : out;
}

/* ───────────────────────────── the column ───────────────────────────── */

/**
 * The queue column (§4.3). At the desk: the head, the BatchBar while a selection exists, the rows (≥ 1280 px), the
 * undo toast (wide) and the keys legend (≥ 1024 px). On the landing (`single`): the head only. Below 1280 px the
 * rows, the BatchBar and its basis line are not shown: one gap at a time (§4.8, §5.7).
 */
export function QueueColumn({
  c,
  mode,
  singleKeys,
  wide,
  onRowsKeyDown,
}: {
  c: DeskController;
  mode: DeskMode;
  /** usePrefs().singleKeys: what is DRAWN (the legend, the toast's Z cap, `#desk-keys-sr`). */
  singleKeys: boolean;
  wide: boolean;
  onRowsKeyDown: React.KeyboardEventHandler<HTMLElement>;
}) {
  const t = useT(approvals);
  const desk = mode === 'desk';
  const undo = c.undo;
  const selection = c.selection;
  return (
    <section aria-labelledby="desk-queue-h" data-desk-queue="" className={QUEUE[mode]}>
      <h2 id="desk-queue-h" className="sr-only">
        {t('desk.sr.queue')}
      </h2>
      <p id="desk-keys-sr" className="sr-only">
        {t(singleKeys ? 'desk.sr.keysOn' : 'desk.sr.keysOff')}
      </p>
      <p id="desk-batch-block-sr" className="sr-only">
        {t('desk.batchBlock')}
      </p>
      <p id="desk-batch-vat-sr" className="sr-only">
        {t('desk.batchVat')}
      </p>
      <QueueHead c={c} mode={mode} />
      {desk && selection.ids.size > 0 ? (
        <>
          <BatchBar
            className="hidden xl:flex xl:mx-2 xl:mb-1"
            count={selection.rows.length}
            sum={{ kind: 'sum', sumAgorot: selection.sumAgorot, unknownCount: 0 }}
            notes={selection.note ? [selection.note] : []}
            actions={[
              {
                id: 'approve',
                label: t('desk.batchApprove'),
                // Not a filled primary (one filled primary per viewport); the decision bar's claim steps down
                // to secondary while a selection exists (R13).
                primary: false,
                disabled: selection.disabled,
                disabledReason: selection.reason ?? undefined,
                // BatchBar hands its click event to onRun: a keyboard-activated approve (detail 0) does not animate
                // the bulk undo toast (§4.10).
                onRun: (e?: unknown) => c.approveChecked(howOfClick(e)),
              },
            ]}
            onClear={() => c.clearChecked()}
          />
          <p data-testid="desk-batch-basis" className="hidden text-caption text-fg-tertiary xl:mx-2 xl:mb-1 xl:block">
            {t('desk.batchBasis')}
          </p>
        </>
      ) : null}
      {desk ? (
        <div
          data-record=""
          data-testid="approvals-list"
          data-desk-rows=""
          // The rows scroll: the one global focus outline is drawn inside each cell (DS3-00 hook), never clipped.
          data-focus="inset"
          onKeyDown={onRowsKeyDown}
          className="hidden xl:block xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-2 xl:pb-2 xl:pt-1.5"
        >
          {c.tiers.map((tr) => (
            <TierSection key={tr.tier} tier={tr.tier} rows={tr.rows} open={tr.open} c={c} selectable={desk} />
          ))}
          <LoadMore onClick={() => c.loadMore()} loading={c.loadingMore} hasMore={c.hasMore} />
        </div>
      ) : null}
      {desk && wide && undo ? (
        <UndoToast
          placement="queue"
          text={undo.text}
          undoLabel={t('undo.action')}
          capAt={undo.capAt}
          visibleMs={UNDO_VISIBLE_MS}
          failedMs={UNDO_FAILED_MS}
          failed={undo.failed}
          busy={undo.busy}
          instant={undo.instant}
          keyHint={singleKeys}
          // The toast hands its click event to onUndo: a keyboard-activated "בטלו" (detail 0) never animates.
          onUndo={(e?: unknown) => c.undoLast(howOfClick(e))}
          onExpire={(info) => c.expireUndo(info)}
        />
      ) : null}
      {/* Nothing to decide and nothing to undo: no keys to teach (the calm empty state stays calm). */}
      {desk && (c.live.length > 0 || c.undo != null) ? (
        <KeysLegend singleKeys={singleKeys} asking={c.asking != null} onOpenHelp={() => c.setKeysOpen(true)} />
      ) : null}
    </section>
  );
}

/* ───────────────────────────── the head ───────────────────────────── */

/**
 * The queue head (§4.3): ONE sentence from the (optimistic) server summary, never from the loaded rows: the count,
 * the claimable ₪ before VAT and, when any, the blockers. `summary-count` exists only when the count is ≥ 2 (the
 * `=1` branch reads "פער אחד") and `summary-claimable` only when the ₪ is > 0; `data-count`, `data-blockers` and
 * `data-claimable-agorot` carry the figures in every state (P12). No count-up (SPEC §8).
 */
export function QueueHead({ c, mode }: { c: DeskController; mode: DeskMode }) {
  const t = useT(approvals);
  const locale = useLocale();
  const summary = c.summary;
  const parts = headParts(summary);
  const count = parts.kind === 'some' ? parts.count : 0;
  const blockers = parts.kind === 'some' ? parts.blockers : 0;
  return (
    <div data-testid="approvals-summary" className={HEAD[mode]}>
      <p
        data-testid="approvals-summary-line"
        data-count={count}
        data-blockers={blockers}
        data-claimable-agorot={Math.round(summary.claimableIls * 100)}
        className="text-body-sm text-fg-secondary"
      >
        {parts.kind === 'empty' ? (
          t('desk.head.empty')
        ) : (
          <Template
            text={t(parts.clause === 'none' ? 'desk.head.sentence' : 'desk.head.sentenceBlock')}
            values={{
              gaps: (
                <b className="font-medium text-fg">
                  <Template
                    text={t('desk.head.gaps', { count })}
                    values={{
                      n: (
                        <bdi data-testid="summary-count" className="num">
                          {formatNumber(count, locale)}
                        </bdi>
                      ),
                    }}
                  />
                </b>
              ),
              sum:
                parts.claimableIls > 0 ? (
                  <Template
                    text={t('desk.head.sum')}
                    values={{
                      // Not split: one text node (W1-05:312 parses its innerText).
                      amount: (
                        <b className="font-medium text-fg" data-testid="summary-claimable">
                          <Money value={parts.claimableIls} context="line" />
                        </b>
                      ),
                    }}
                  />
                ) : (
                  t('desk.head.noSum')
                ),
              blockers: blockersClause(t, locale, parts),
            }}
          />
        )}
      </p>
      {summary.duplicateIls > 0 ? (
        <p data-testid="desk-dup-line" className="mt-1 text-caption text-fg-tertiary">
          <Template
            text={t('desk.head.duplicates')}
            values={{ amount: <Money value={summary.duplicateIls} context="line" /> }}
          />
        </p>
      ) : null}
      {summary.vatIls > 0 ? (
        <p data-testid="desk-vat-line" className="mt-0.5 text-caption text-fg-tertiary">
          <Template text={t('desk.head.vat')} values={{ amount: <Money value={summary.vatIls} context="line" /> }} />
        </p>
      ) : null}
      {summary.others && summary.others.count > 0 ? <OthersLane summary={summary} className="mt-3" /> : null}
    </div>
  );
}

/** The head's blockers clause: one | both | all are words; some carries the count (`summary-blockers`). */
function blockersClause(t: T, locale: Locale, parts: HeadParts): React.ReactNode {
  if (parts.kind !== 'some') return null;
  switch (parts.clause) {
    case 'one':
      return t('desk.head.blockOne');
    case 'both':
      return t('desk.head.blockBoth');
    case 'all':
      return t('desk.head.blockAll');
    case 'some':
      return (
        <Template
          text={t('desk.head.blockSome', { count: parts.blockers })}
          values={{
            n: (
              <b className="font-medium text-fg">
                <bdi data-testid="summary-blockers" className="num">
                  {formatNumber(parts.blockers, locale)}
                </bdi>
              </b>
            ),
          }}
        />
      );
    default:
      return null;
  }
}

/**
 * "ממתין לאחרים" (functional-flows-07), restyled: what waits for someone else, read-only, counted before VAT by the
 * server (approvals.ts computeQueueSummary), the basis beside the amount (R7e). The scope stays "mine".
 */
export function OthersLane({ summary, className }: { summary: QueueSummary; className?: string }) {
  const t = useT(approvals);
  const locale = useLocale();
  const others = summary.others;
  return (
    <details data-testid="approvals-others" className={cn('rounded-control border border-line-rule px-3', className)}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-body-sm font-medium text-fg">
        {t('others.title')}
        <span className="font-normal text-fg-secondary">
          <Template
            text={t('others.line')}
            values={{
              count: formatNumber(others.count, locale),
              amount: <Money value={others.amountIls} context="line" />,
            }}
          />{' '}
          {t('summary.atRiskBasis')}
        </span>
      </summary>
      <ul className="pb-2 text-body-sm text-fg-secondary">
        {others.byRole.map((r) => (
          <li key={r.role} data-record="">
            <Template
              text={t('others.role', { role: roleName(t, r.role) })}
              values={{
                count: formatNumber(r.count, locale),
                amount: <Money value={r.amountIls} context="line" />,
              }}
            />
          </li>
        ))}
        <li className="text-caption text-fg-tertiary">{t('others.readOnly')}</li>
      </ul>
    </details>
  );
}

/* ───────────────────────────── tiers and rows ───────────────────────────── */

/**
 * One tier ("חוסמים תשלום", "אזהרות", "לידיעה"): a heading with the open count (none for the last loaded tier
 * while more pages wait, §5.6) and ONE `role="grid"` (Q1): rows of two gridcells, one tab stop for the whole queue.
 */
export function TierSection({
  tier,
  rows,
  open,
  c,
  selectable,
}: {
  tier: Tier;
  rows: QueueRowView[];
  open: number | null;
  c: DeskController;
  selectable: boolean;
}) {
  const t = useT(approvals);
  const locale = useLocale();
  const headingId = `desk-tier-${tier}-h`;
  return (
    <section aria-labelledby={headingId} data-testid={`desk-tier-${tier}`}>
      <h3
        id={headingId}
        className="flex items-baseline gap-1.5 px-3 pb-0.5 pt-2.5 text-caption text-fg-tertiary xl:group-data-[density=compact]/desk:pt-2 xl:group-data-[density=compact]/desk:pb-px"
      >
        <span className="font-medium text-fg-secondary">{t(`desk.tier.${tier}`)}</span>
        {open != null ? <span className="num">{formatNumber(open, locale)}</span> : null}
      </h3>
      <div role="grid" aria-labelledby={headingId} aria-describedby="desk-keys-sr" data-tier-grid={tier}>
        {rows.map((v) => (
          <QueueRow key={v.row.id} v={v} c={c} selectable={selectable} />
        ))}
      </div>
    </section>
  );
}

/**
 * The row's due line (§4.3): due today or later → "לתשלום עד {date}"; past due → "באיחור מ־{date}"; no due date →
 * how long it has waited. Plain tertiary text: no second T2 mark per row (no DeadlineChip). Days count from the
 * render's one clock (#418).
 */
function dueLineOf(t: T, locale: Locale, row: QueueItem, today: Date | undefined): string {
  const due = row.invoiceDueDate ? new Date(row.invoiceDueDate) : null;
  if (due && !Number.isNaN(due.getTime())) {
    const date = formatDay(due, locale);
    return daysUntil(due, today) >= 0 ? t('card.due', { date }) : t('desk.row.late', { date });
  }
  const age = ageLabel(t, ageDays(row.createdAt, today));
  return age ? t('card.waiting', { age }) : t('card.waitingToday');
}

/**
 * One gap in the queue (§4.3): `role="row"` with the bulk checkbox cell (desk only; disabled for block and VAT rows
 * with the reason, R6/R20) and the focusable summary cell (`data-row-id`, roving tabindex). The current gap is
 * `aria-current` (D13: fill + start rail); a done row lives exactly as long as its undo (Q4): result in place of the
 * due line, `aria-disabled`, a click does nothing. Money is ink (tertiary when done), never red.
 */
export function QueueRow({ v, c, selectable }: { v: QueueRowView; c: DeskController; selectable: boolean }) {
  const t = useT(approvals);
  const locale = useLocale();
  const today = useRenderNow();
  const rowRef = useRef<HTMLDivElement>(null);
  const { row, state, current } = v;
  const id = row.id;
  const open = state === 'open';

  // §5.1: the current row scrolls into the queue's view (nearest, never moving focus). A hidden row (below 1280 px)
  // has no box, so nothing scrolls there.
  useEffect(() => {
    if (current) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const title = rowTitle(t, locale, row);
  const sub = rowSub(t, locale, row);
  const tier = tierOf(row);
  const dotTone = open && tier === 'block' ? 'leak' : open && tier === 'warn' ? 'warn' : 'neutral';
  // R6: a block row and a VAT gap never join a batch (the server would still accept the VAT gap).
  const noBatch: 'block' | 'vat' | null = row.severity === 'block' ? 'block' : batchBasisBlock(row);
  const noBatchText = noBatch === 'block' ? t('desk.batchBlock') : noBatch === 'vat' ? t('desk.batchVat') : undefined;
  const noBatchId = noBatch === 'block' ? 'desk-batch-block-sr' : noBatch === 'vat' ? 'desk-batch-vat-sr' : undefined;
  const absAgorot = deltaAgorot(row) ?? 0n; // exact (R8): never Number() on the NUMERIC string

  return (
    <div
      ref={rowRef}
      role="row"
      data-testid="approval-row"
      data-row=""
      data-id={id}
      data-severity={row.severity}
      data-state={state}
      data-invoice-number={row.invoiceNumber ?? ''}
      className={cn(ROW, current ? ROW_CURRENT : open ? 'hover:bg-surface-hover' : '')}
    >
      <div role="gridcell" className="flex w-6 shrink-0 justify-center pt-0.5">
        {selectable && open && row.canAct !== false ? (
          // A disabled <input> shows no tooltip in most browsers: the reason sits on the label (R20).
          <label className="flex size-6 items-center justify-center [@media(pointer:coarse)]:size-11" title={noBatchText}>
            <input
              type="checkbox"
              tabIndex={-1}
              data-row-check=""
              data-testid="card-select"
              className="size-4 accent-primary-bold"
              checked={v.checked}
              disabled={noBatch !== null}
              onChange={() => c.toggleChecked(id)}
              aria-label={t('desk.select', { name: title })}
              aria-describedby={noBatchId}
            />
          </label>
        ) : null}
      </div>
      <div
        role="gridcell"
        tabIndex={v.roving ? 0 : -1}
        data-row-id={id}
        data-testid="card-evidence"
        aria-current={current ? 'true' : undefined}
        aria-disabled={open ? undefined : 'true'}
        onClick={() => {
          if (open) c.select(id);
        }}
        onFocus={() => {
          if (open && !current) c.select(id);
        }}
        className="grid min-w-0 flex-1 cursor-pointer grid-cols-[0.5rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-control"
      >
        <StatusDot tone={dotTone} size="md" className="mt-1.5 forced-color-adjust-none" />
        <span className="min-w-0">
          <span className={cn('block truncate text-row-title', open ? 'font-medium text-fg' : 'font-normal text-fg-secondary')}>
            {title}
          </span>
          <span className={cn('block truncate text-row-sub', open ? 'text-fg-secondary' : 'text-fg-tertiary')}>{sub}</span>
        </span>
        {/* The column's own line metrics are the row title's: an inline-block in a block takes the inherited
            16/24 strut otherwise, and the column would outgrow title + sub-line (53 / 43 px rows, R17/P14). */}
        <span className="text-end text-row-title">
          {absAgorot > 0n ? (
            <span
              data-testid="card-amount"
              className={cn('inline-block min-w-[4.9em] text-right text-row-title', !open && 'text-fg-tertiary')}
            >
              {/* leading-none: the split ₪ (12 px) on the digits' baseline would add ~1 px to the line under the
                  inherited row-title line-height (a 44 px compact row); the strut alone sets the line. */}
              <Money agorot={Number(absAgorot)} context="line" split quietParts={open} className="leading-none" />
            </span>
          ) : null}
          {/* .num: the dates of the due lines stand in a column (§11.1). font-normal: not the title's weight. */}
          <span className="num block whitespace-nowrap text-caption font-normal text-fg-tertiary">
            {open ? (
              dueLineOf(t, locale, row, today)
            ) : (
              <b className={cn('font-medium text-fg-secondary', c.motion === 'next' && RESULT_MOTION)}>{v.result}</b>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────── the keys legend ───────────────────────────── */

/**
 * The keys legend at the queue's foot (§4.3; desk mode, from 1024 px as today's keys button, P11d). The caps and
 * words are `aria-hidden` (the grids are described by `#desk-keys-sr`); the help button sits outside that wrapper
 * (axe aria-hidden-focus). Keys off → one sentence; asking → only Esc.
 */
export function KeysLegend({
  singleKeys,
  asking,
  onOpenHelp,
}: {
  singleKeys: boolean;
  asking: boolean;
  onOpenHelp: () => void;
}) {
  const t = useT(approvals);
  return (
    <div
      data-testid="desk-keys-legend"
      className="hidden flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-rule px-3.5 py-2.5 text-caption text-fg-secondary lg:flex max-xl:mb-3 max-xl:px-0"
    >
      <div aria-hidden="true" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {asking ? (
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd>
            {t('desk.legend.asking')}
          </span>
        ) : !singleKeys ? (
          <span>{t('desk.legend.keysOff')}</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd>
              {t('desk.legend.move')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>1</Kbd>
              {t('desk.legend.claim')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>2</Kbd>
              {t('desk.legend.pay')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Z</Kbd>
              {t('desk.legend.undo')}
            </span>
          </>
        )}
      </div>
      <IconButton
        label={t('desk.keysTitle')}
        icon={<Keyboard className="h-4 w-4" aria-hidden="true" />}
        size="sm"
        className="ms-auto"
        onClick={() => onOpenHelp()}
        data-testid="approvals-keys-open"
      />
    </div>
  );
}
