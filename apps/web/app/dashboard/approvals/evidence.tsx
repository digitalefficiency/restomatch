'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { IconButton } from '@/lib/components/Button';
import { Skeleton } from '@/lib/components/Skeleton';
import { cn } from '@/lib/components/cn';
import { StatusChip, StatusDot } from '@/lib/components/feedback/StatusChip';
import { DirIcon, Icon } from '@/lib/components/icon';
import { Money } from '@/lib/components/money/Money';
import { formatDay } from '@/lib/components/money/format';
import { MatchTable, type MatchCellView } from '@/lib/components/desk/MatchTable';
import { CalcCard, FactCard } from './calc-line';
import { DecisionBar, GroupApprove, claimNoteShown, type DecisionBlockText } from './decision-bar';
import {
  amountBasisOf,
  claimNoteOf,
  decisionBlockOf,
  effectOf,
  evidenceKindOf,
  tableOf,
  toNumber4,
  type Cell,
  type CellValue,
  type DecisionBlock,
  type GapNote,
} from './desk-facts';
import { basisText, itemName, qtyText, unitText } from './desk-text';
import type { DeskController, DeskDensity, DeskMode, GapDocument, How, QueueItem } from './desk-types';
import { DocumentsBlock } from './documents';
import { DeskEmpty } from './empty';
import { HistoryDisclosure } from './history';
import { useRenderNow } from './queue';
import { Template } from './rich-message';
import { ageDays, ageLabel, discrepancyLabel, displayName, resolutionLabel, severityLabel } from './vocab';

type T = Translator<typeof approvalsHe>;
type Locale = 'he' | 'en';

/**
 * #190 seam (DS3-04 spec §0 Q10, §2.9): the words of a decision block. Today the only block is the page question,
 * and its branch is empty until #190 lands.
 */
export function blockText(block: DecisionBlock | null, t: T): DecisionBlockText | null {
  switch (block?.kind) {
    case 'pageQuestion':
      // TODO(#190): { title, body, cta } from its three card.pageQuestion* keys and
      // href `/dashboard/inbox/compare?invoice=${block.invoiceId}`.
      void t;
      return null;
    default:
      return null;
  }
}

/** Two literal class maps per region (§4.0): the desk switches at xl; the landing ('single') is narrow, unprefixed. */
const EVID: Record<DeskMode, string> = {
  desk: 'flex min-w-0 flex-col xl:min-h-0 xl:flex-1 xl:bg-canvas',
  single: 'flex min-w-0 flex-col',
};
const BODY: Record<DeskMode, string> = {
  desk: 'xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-7 xl:pb-5 xl:group-data-[density=compact]/desk:px-6 xl:group-data-[density=compact]/desk:pb-3.5',
  single: '',
};
const TOP: Record<DeskMode, string> = {
  desk: 'flex min-h-9 flex-wrap items-center gap-2.5 max-xl:gap-2 xl:px-7 xl:pt-5 xl:group-data-[density=compact]/desk:px-6 xl:group-data-[density=compact]/desk:pt-3.5',
  single: 'flex min-h-9 flex-wrap items-center gap-2',
};
const TOP_SPACER: Record<DeskMode, string> = {
  desk: 'flex-1 max-xl:basis-full',
  single: 'flex-1 basis-full',
};
const POSITION: Record<DeskMode, string> = {
  desk: 'num text-caption text-fg-tertiary max-xl:flex-1',
  single: 'num flex-1 text-caption text-fg-tertiary',
};
/** §4.10: the body enters only after a pointer action; key and keyboard changes never animate. */
const MOTION = {
  next: 'motion-safe:transition-[opacity,transform] motion-safe:duration-short motion-safe:ease-enter [@starting-style]:opacity-0 ltr:[@starting-style]:translate-x-3 rtl:[@starting-style]:-translate-x-3',
  prev: 'motion-safe:transition-[opacity,transform] motion-safe:duration-short motion-safe:ease-enter [@starting-style]:opacity-0 ltr:[@starting-style]:-translate-x-3 rtl:[@starting-style]:translate-x-3',
  none: '',
} as const;
/** The table's values: one type size per layout (never two sizes of one property on a plain element). */
const VALUE: Record<'responsive' | 'narrow', string> = {
  responsive: 'text-title-md text-fg max-xl:text-body xl:group-data-[density=compact]/desk:text-body',
  narrow: 'text-body text-fg',
};
const UNIT: Record<'responsive' | 'narrow', string> = {
  responsive: 'text-body-sm font-normal text-fg-secondary max-xl:text-caption',
  narrow: 'text-caption font-normal text-fg-secondary',
};

/** pointer click (detail ≥ 1) · keyboard-activated button (detail 0). */
const howOf = (e: React.MouseEvent): How => (e.detail === 0 ? 'keyboard' : 'pointer');

export interface EvidencePanelProps {
  c: DeskController;
  doc: GapDocument;
  mode: DeskMode;
  density: DeskDensity;
  /** usePrefs().singleKeys — what is drawn (the bar's caps); the handlers ask the store at every keydown. */
  singleKeys: boolean;
  wide: boolean;
  filtered: boolean;
  filteredNote?: string;
  onEvidenceKeyDown: React.KeyboardEventHandler<HTMLElement>;
  /** The decision bar's quiet escalate needs it (canEscalate: the owner never sees it). */
  viewerRole: string | null;
}

/**
 * The evidence column of the approvals desk (DS3-04 spec §4.4): the top line (not keyed, so prev/next keep focus),
 * then the current gap's body — keyed by the gap, so its scroll resets — with the type, the proof (the three-way
 * table and the calculation line, or the calculation alone, or a fact), the claim note, the documents, the effect,
 * "approve the whole invoice" and the history; the decision bar closes the section. Pure view of the controller: no
 * tRPC, no focus on mount (DeskView resolves focus intents).
 */
export function EvidencePanel({
  c,
  doc,
  mode,
  density,
  singleKeys,
  wide,
  filtered,
  filteredNote,
  onEvidenceKeyDown,
  viewerRole,
}: EvidencePanelProps) {
  const t = useT(approvals);
  const g = c.current;
  const compact = density === 'compact' && mode === 'desk';
  const blocked = g ? blockText(decisionBlockOf(g), t) : null;
  return (
    <section
      aria-label={t('desk.aria.evidence')}
      data-desk-evidence=""
      data-testid="approvals-evidence-pane"
      onKeyDown={onEvidenceKeyDown}
      className={EVID[mode]}
    >
      {g ? (
        <>
          <EvidenceTop c={c} mode={mode} />
          <div
            key={g.id}
            data-record=""
            data-testid="approval-evidence"
            data-id={g.id}
            className={cn(BODY[mode], '[container-type:inline-size]', MOTION[c.motion ?? 'none'])}
          >
            <EvidenceTitle g={g} />
            <Proof g={g} doc={doc} mode={mode} compact={compact} />
            <ClaimNote g={g} />
            <div data-pane="document">
              <DocumentsBlock g={g} doc={doc} mode={mode} />
            </div>
            <EffectLine g={g} />
            <GroupApprove c={c} />
            <HistoryDisclosure id={g.id} />
          </div>
        </>
      ) : c.loadingNext ? (
        <EvidenceLoading mode={mode} />
      ) : (
        <DeskEmpty summary={c.summary} filtered={filtered} filteredNote={filteredNote} mode={mode} />
      )}
      <DecisionBar c={c} mode={mode} singleKeys={singleKeys} wide={wide} viewerRole={viewerRole} blocked={blocked} />
      {/* Below 1024 px the bar is fixed: keep its height free so the last line is never under it. */}
      <div aria-hidden="true" className="h-[var(--rm-actionbar-h,0px)] lg:hidden" />
    </section>
  );
}

/** A delayed skeleton: nothing before 1 s, reduced motion included (R12: the global rule would show it at once). */
const SKEL = 'motion-essential motion-reduce:duration-0';

/**
 * No current gap while the next page loads (the controller's `loadingNext`: the last loaded gap was decided or hidden
 * and the server holds more): the queue is not empty, so the panel shows the evidence's shape (§4.7's frame), never
 * "הכול מטופל".
 */
function EvidenceLoading({ mode }: { mode: DeskMode }) {
  return (
    <div aria-busy="true" className={cn('flex flex-col gap-3', BODY[mode], mode === 'desk' && 'xl:pt-5')}>
      <Skeleton delayed className={cn(SKEL, 'h-6 w-48')} />
      <Skeleton delayed className={cn(SKEL, 'h-7 w-64')} />
      <Skeleton delayed className={cn(SKEL, 'h-40 rounded-card')} />
      <Skeleton delayed className={cn(SKEL, 'h-[3.75rem] rounded-card')} />
    </div>
  );
}

/**
 * The evidence's top line (§4.4 EvidenceTop): the severity pill (the one solid "חוסם תשלום" for a block), the waiting
 * pill (neutral T4), the position ("3 מתוך 12") and the prev / next buttons. Not keyed by the gap.
 */
export function EvidenceTop({ c, mode }: { c: DeskController; mode: DeskMode }) {
  const t = useT(approvals);
  const locale = useLocale();
  const today = useRenderNow();
  const g = c.current;
  if (!g) return null;
  const open = c.currentState === 'open';
  const result = c.rows.find((v) => v.row.id === g.id)?.result ?? null;
  const pill = !open ? (
    <StatusChip
      tone="neutral"
      icon={<StatusDot tone="neutral" size="sm" />}
      label={result ?? resolutionLabel(t, g.resolutionStatus)}
    />
  ) : g.severity === 'block' ? (
    <StatusChip tone="danger" emphasis="bold" label={t('desk.pill.block')} />
  ) : g.severity === 'warn' ? (
    <StatusChip tone="warn" label={severityLabel(t, 'warn')} />
  ) : (
    <StatusChip tone="neutral" icon={<StatusDot tone="neutral" size="sm" />} label={t('desk.pill.info')} />
  );
  // Days from the render's ONE clock (NowCtx, #418): server HTML and hydration agree.
  const age = ageLabel(t, ageDays(g.createdAt, today));
  const waiting = age ? t('card.waiting', { age }) : t('card.waitingToday');
  const position = !open
    ? t('desk.nav.decided')
    : c.position
      ? t('desk.nav.position', { pos: formatNumber(c.position.index, locale), total: formatNumber(c.position.total, locale) })
      : null;
  const single = mode === 'single';
  return (
    <div data-record="" className={TOP[mode]}>
      <span data-testid="desk-pill-severity" className="inline-flex">
        {pill}
      </span>
      <span data-testid="desk-pill-waiting" className="inline-flex">
        <StatusChip tone="neutral" label={waiting} />
      </span>
      <span aria-hidden="true" className={TOP_SPACER[mode]} />
      <p data-testid="desk-position" className={POSITION[mode]}>
        {position}
      </p>
      <div role="group" aria-label={t('desk.aria.nav')} className="flex gap-0.5">
        <IconButton
          data-testid="desk-prev"
          label={t('desk.aria.prev')}
          size={single ? 'lg' : 'md'}
          className={single ? undefined : 'max-xl:h-11 max-xl:w-11'}
          icon={
            single ? (
              <DirIcon kind="prev" size="body" />
            ) : (
              <>
                <Icon as={ChevronUp} size="body" className="hidden xl:block" />
                <DirIcon kind="prev" size="body" className="xl:hidden" />
              </>
            )
          }
          disabled={!c.canPrev}
          onClick={(e) => c.move(-1, howOf(e), 'nav')}
        />
        <IconButton
          data-testid="desk-next"
          label={t('desk.aria.next')}
          size={single ? 'lg' : 'md'}
          className={single ? undefined : 'max-xl:h-11 max-xl:w-11'}
          icon={
            single ? (
              <DirIcon kind="next" size="body" />
            ) : (
              <>
                <Icon as={ChevronDown} size="body" className="hidden xl:block" />
                <DirIcon kind="next" size="body" className="xl:hidden" />
              </>
            )
          }
          disabled={!c.canNext}
          onClick={(e) => c.move(1, howOf(e), 'nav')}
        />
      </div>
    </div>
  );
}

/** The gap's type as the panel's heading (focus target of Enter / O, never on mount), then item, supplier, invoice. */
function EvidenceTitle({ g }: { g: QueueItem }) {
  const t = useT(approvals);
  const locale = useLocale();
  const parts: React.ReactNode[] = [];
  const item = itemName(locale, g);
  if (item) parts.push(<bdi>{item}</bdi>);
  const supplier = displayName(locale, g.supplierName, g.supplierNameEn);
  if (supplier) parts.push(<bdi>{supplier}</bdi>);
  if (g.invoiceNumber) {
    parts.push(
      g.invoiceDate ? (
        <Template text={t('desk.ev.invoiceOn')} values={{ number: g.invoiceNumber, date: formatDay(g.invoiceDate, locale) }} />
      ) : (
        <Template text={t('card.invoice')} values={{ number: g.invoiceNumber }} />
      ),
    );
  }
  return (
    <>
      <h2 tabIndex={-1} data-desk-heading="" className="mt-2.5 text-title-md text-fg xl:group-data-[density=compact]/desk:mt-1.5">
        {discrepancyLabel(t, g.type)}
      </h2>
      {parts.length > 0 ? (
        <p className="mt-0.5 text-body-sm text-fg-secondary">
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 ? ', ' : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

/** The proof by the gap's kind (§4.4): the three-way table + the calculation, the calculation alone, or a fact. */
function Proof({ g, doc, mode, compact }: { g: QueueItem; doc: GapDocument; mode: DeskMode; compact: boolean }) {
  const kind = evidenceKindOf(g.type);
  if (kind === 'fact') return <FactCard g={g} doc={doc} mode={mode} compact={compact} />;
  return (
    <>
      {kind === 'table' ? <EvidenceTable g={g} doc={doc} mode={mode} compact={compact} /> : null}
      <CalcCard g={g} doc={doc} mode={mode} compact={compact} />
    </>
  );
}

/** A cell's value: a quantity with its unit, a unit price (before VAT, "לפי החוזה" under a contract price), or a word. */
function cellNode(v: CellValue, flagged: boolean, layout: 'responsive' | 'narrow', t: T, locale: Locale): React.ReactNode {
  // The flagged cell's value stays ink in the table's semibold (§4.4); the rest are medium.
  const weight = flagged ? 'font-semibold' : 'font-medium';
  switch (v.kind) {
    case 'qty':
      return (
        <span className={cn('num flex flex-wrap items-baseline gap-x-1.5', VALUE[layout], weight)}>
          <bdi>{formatNumber(toNumber4(v.v4), locale, { maximumFractionDigits: 3 })}</bdi>
          {v.unit ? <small className={UNIT[layout]}>{unitText(locale, v.unit)}</small> : null}
        </span>
      );
    case 'price':
      return (
        <span className={cn('num block', VALUE[layout], weight)}>
          <Money value={toNumber4(v.v4)} context="unit" split quietParts />
          {v.contract ? <span className="block text-caption font-normal text-fg-tertiary">{t('desk.table.byContract')}</span> : null}
        </span>
      );
    default:
      return <span className="text-caption text-fg-tertiary">{t(`desk.table.${v.word}`)}</span>;
  }
}

/** The flagged cell's written gap: a quantity or a percent, never ₪. */
function gapText(gap: GapNote, t: T, locale: Locale): string | null {
  if (!gap) return null;
  if (gap.kind === 'qty') {
    const qty = qtyText(locale, gap.v4, gap.unit);
    return t(gap.direction === 'more' ? 'desk.table.gapMore' : 'desk.table.gapLess', { qty });
  }
  const pct = formatPercent(gap.ratio, locale, 1);
  if (gap.p90) return t('desk.table.pctOverP90', { pct });
  return t(gap.direction === 'more' ? 'desk.table.pctMore' : 'desk.table.pctLess', { pct });
}

const CELLS: readonly Cell[] = ['ordered', 'received', 'billed'];

/** The three-way table (§4.4, SPEC §10.2): what was ordered, received and billed, every value from the row. */
function EvidenceTable({ g, doc, mode, compact }: { g: QueueItem; doc: GapDocument; mode: DeskMode; compact: boolean }) {
  const t = useT(approvals);
  const locale = useLocale();
  const facts = tableOf(g);
  if (!facts) return null;
  const layout = mode === 'single' ? 'narrow' : 'responsive';
  const gap = gapText(facts.gap, t, locale);
  const cells = (row: 'qty' | 'price'): [MatchCellView, MatchCellView, MatchCellView] => {
    const [ordered, received, billed] = CELLS.map((cell): MatchCellView => {
      const flagged = facts.flagged.row === row && facts.flagged.cell === cell;
      return { cell, flagged, gap: flagged ? gap : undefined, content: cellNode(facts[row][cell], flagged, layout, t, locale) };
    });
    return [ordered!, received!, billed!];
  };
  return (
    <MatchTable
      caption={t('desk.sr.tableCaption')}
      columns={[
        {
          label: t('desk.table.ordered'),
          sub: g.poDate ? <Template text={t('desk.evidenceOrderOf')} values={{ date: formatDay(g.poDate, locale) }} /> : undefined,
        },
        {
          label: t('desk.table.received'),
          sub:
            doc.status === 'ready' && doc.grReceivedAt ? (
              <Template text={t('desk.table.receivedOf')} values={{ date: formatDay(doc.grReceivedAt, locale) }} />
            ) : undefined,
        },
        {
          label: t('desk.table.billed'),
          sub: g.invoiceNumber ? <Template text={t('card.invoice')} values={{ number: g.invoiceNumber }} /> : undefined,
        },
      ]}
      rows={[
        { label: t('desk.table.qty'), cells: cells('qty') },
        // Unit prices are before VAT (R7g): the basis sits under the row's header.
        { label: t('desk.table.unitPrice'), sub: t('summary.atRiskBasis'), cells: cells('price') },
      ]}
      tone={facts.tone}
      compact={compact}
      layout={layout}
    />
  );
}

/** Why the claim differs from |Δ| (§4.4 ClaimNote): capped by the invoice total, or nothing open to request (R5). */
function ClaimNote({ g }: { g: QueueItem }) {
  const t = useT(approvals);
  const note = claimNoteOf(g);
  if (!note || !claimNoteShown(g)) return null;
  return (
    <p id="desk-claim-note" data-testid="desk-claim-note" className="mt-2 text-caption text-fg-secondary">
      {note.kind === 'capped' ? (
        <Template
          text={t('desk.claim.capped', { basis: basisText(t, amountBasisOf(g.type)) })}
          values={{
            claim: <Money agorot={note.claimAgorot} context="line" />,
            delta: <Money agorot={note.deltaAgorot} context="line" />,
          }}
        />
      ) : (
        t('desk.claim.none')
      )}
    </p>
  );
}

/** What deciding does to the money (claim rows): offset at payment, or a credit request once the invoice is paid. */
function EffectLine({ g }: { g: QueueItem }) {
  const t = useT(approvals);
  const effect = effectOf(g);
  if (!effect) return null;
  return (
    <p data-testid="desk-effect" className="mt-3 text-body-sm text-fg-secondary">
      {t(effect === 'paid' ? 'desk.effect.paid' : 'desk.effect.unpaid')}
    </p>
  );
}
