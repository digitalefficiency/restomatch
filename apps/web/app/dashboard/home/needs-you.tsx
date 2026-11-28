import Link from 'next/link';
import { Check } from 'lucide-react';
import { cnMerge as cn } from '@/lib/components/cn';
import { StatusChip, StatusDot } from '@/lib/components/feedback/StatusChip';
import { DirIcon, Icon } from '@/lib/components/icon';
import { Money } from '@/lib/components/money';
import type { TaskRow } from '@/lib/components/notifications/rows';
import { NeedsMore } from './needs-more';

export type NeedTone = TaskRow['tone'];
/** The row's dot by meaning (SPEC §2): red only when a payment is blocked, amber waits for handling, grey merely waits. */
export type NeedDot = 'leak' | 'warn' | 'neutral';
/**
 * A "מחכה לך" row: the task spine's row (₪ in agorot via <Money>, or a count).
 * `href` omitted = a static row (the public sample home, W3-06 M11) — rendered
 * as a plain box with no link into the product.
 */
export type NeedRow = Omit<TaskRow, 'href'> & {
  href?: string;
  /** DS3: the dot by meaning (need-rows.ts); without it, by the row's tone. */
  dot?: NeedDot;
  /** DS3: the solid T2 pill ("2 חוסמים תשלום"), inside the sub line after its separator. */
  pill?: string;
  /** DS3: the VAT basis stated under the amount ("כולל מע״מ") when the card has no single basis. */
  basis?: string;
};

/** A row without its meaning (the showcase's static rows): the tone's old reading. */
const DOT_OF_TONE: Record<NeedTone, NeedDot> = { danger: 'leak', warn: 'warn', neutral: 'neutral' };

/**
 * Row 0's verb wears the filled primary look at rest; while focus is on another row's link, that
 * row's verb takes it and row 0's goes quiet (owner decision D7, v4 H6): one filled verb at any
 * moment, CSS only. `data-primary` stays on row 0 (the IA meter counts the page at rest).
 *  - Every verb has the same box height (32 px; 44 on a phone), so focus moving the filled look
 *    between rows never changes a row's height.
 *  - Only the ONE filled verb carries the (transparent) border, so forced colours draw that one as a
 *    button and leave every quiet verb as a word.
 */
const VERB = 'inline-flex min-h-8 items-center gap-0.5 rounded-control text-body-sm font-medium transition-colors duration-micro ease-standard max-sm:min-h-11';
const VERB_PRIMARY =
  'border border-transparent bg-primary-bold px-3 text-on-bold max-sm:px-4 group-has-[[data-needs-row]>a:not([data-primary-row]):focus-visible]/needs:border-0 group-has-[[data-needs-row]>a:not([data-primary-row]):focus-visible]/needs:bg-transparent group-has-[[data-needs-row]>a:not([data-primary-row]):focus-visible]/needs:px-0 group-has-[[data-needs-row]>a:not([data-primary-row]):focus-visible]/needs:text-primary';
const VERB_QUIET = 'text-primary';
const VERB_FOLLOWS =
  'group-focus-visible/row:border group-focus-visible/row:border-transparent group-focus-visible/row:bg-primary-bold group-focus-visible/row:px-3 group-focus-visible/row:text-on-bold';
const ARROW_PRIMARY = 'hidden group-has-[[data-needs-row]>a:not([data-primary-row]):focus-visible]/needs:inline-block';
const ARROW_FOLLOWS = 'group-focus-visible/row:hidden';

/**
 * "מחכה לך" (T2; DS3 SPEC §10.1): one card — the title (with the VAT basis beside it when every
 * amount shares one), then one row per act-now family, ranked by the caller (₪ × urgency, on the
 * server): a dot by meaning, the title and its count line, the amount and one verb. At most `max`
 * rows; the rest unfold in place above "עוד" (IA rule 4: a home holds ≤5 blocks). Inbox zero is one
 * calm line inside the card. A hook-free shell (the public sample home renders it in its client
 * tree): the only island is the "עוד" fold, and `moreLabel` is called here, never passed on.
 *
 * Markup contract (the e2e and the IA/copy meters read it): `ul[data-record] > li[data-needs-row]
 * > a[data-testid=needs-<key>]`; each li is a subgrid of the list's three columns (dot · words ·
 * amount), so every amount shares one column, its digits right-aligned.
 */
export function NeedsYou({
  title,
  rows,
  zero,
  zeroTone = 'good',
  moreLabel,
  max = 3,
  primaryFirst = false,
  basisChip,
}: {
  title: string;
  rows: NeedRow[];
  zero: string;
  /** `good` (T3) only when the whole restaurant is clear; `neutral` when it waits on others. */
  zeroTone?: 'good' | 'neutral';
  moreLabel: (count: number) => string;
  /** Rows shown before "עוד" (owner 3; manager and bookkeeper 5 — their home is the list). */
  max?: number;
  /** DS3: row 0's verb is the screen's one filled primary (finance homes; never the chef's). */
  primaryFirst?: boolean;
  /** DS3: the VAT basis beside the title ("לפני מע״מ"), only when every amount in the card has it. */
  basisChip?: string | null;
}) {
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  return (
    <section
      aria-labelledby="needs-you-title"
      data-testid="needs-you"
      className="group/needs overflow-hidden rounded-card border border-line-rule bg-surface shadow-e1"
    >
      <div data-needs-head="" className="flex items-center gap-2 border-b border-line-rule px-5 pb-3 pt-4 max-sm:px-4">
        <h2 id="needs-you-title" className="text-title-sm text-fg">
          {title}
        </h2>
        {basisChip ? (
          // The shared neutral chip (a basis, not a state: no marker).
          <span data-testid="needs-you-basis" className="flex">
            <StatusChip tone="neutral" label={basisChip} icon={null} />
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p
          data-testid="needs-you-zero"
          data-tone={zeroTone}
          className="flex min-h-12 items-center gap-2 px-5 py-3 text-body-sm font-medium max-sm:px-4"
        >
          {zeroTone === 'good' ? (
            // T3: the round green tick (SPEC §2); the words keep their meaning.
            <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-ok-dot text-on-bold">
              <Icon as={Check} size="caption" />
            </span>
          ) : null}
          <span className={zeroTone === 'good' ? 'text-fg' : 'text-fg-secondary'}>{zero}</span>
        </p>
      ) : (
        <>
          <NeedList rows={shown} primaryFirst={primaryFirst} />
          {rest.length > 0 ? (
            <NeedsMore label={moreLabel(rest.length)} preview={rest.map((r) => r.label).join(' · ')}>
              <NeedList rows={rest} primaryFirst={primaryFirst} more />
            </NeedsMore>
          ) : null}
        </>
      )}
    </section>
  );
}

function NeedList({ rows, primaryFirst, more = false }: { rows: NeedRow[]; primaryFirst: boolean; more?: boolean }) {
  return (
    <ul
      data-record=""
      data-needs-list={more ? 'more' : 'shown'}
      className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 divide-y divide-line-rule', more && 'border-t border-line-rule')}
    >
      {rows.map((row, i) => (
        // Never `display: contents` on the li: it is a real box (e2e reads its position) and keeps the list's semantics.
        <li key={row.key} data-needs-row={row.key} className="col-span-3 grid grid-cols-subgrid">
          <NeedLink row={row} primary={primaryFirst && !more && i === 0} follows={primaryFirst} />
        </li>
      ))}
    </ul>
  );
}

function NeedLink({ row, primary, follows }: { row: NeedRow; primary: boolean; follows: boolean }) {
  const box = 'col-span-3 grid min-h-12 grid-cols-subgrid items-start px-5 py-3.5 max-sm:px-4';
  return row.href ? (
    // The whole row is the target (≥48 px); its focus ring is drawn inside it, so the card's
    // rounded, clipped edge never cuts it (data-focus="inset", globals.css).
    <Link
      href={row.href}
      data-testid={`needs-${row.key}`}
      data-focus="inset"
      data-primary-row={primary ? '' : undefined}
      className={cn(box, 'group/row transition-colors duration-micro ease-standard hover:bg-surface-hover')}
    >
      <NeedBody row={row} primary={primary} follows={follows} />
    </Link>
  ) : (
    <div data-testid={`needs-${row.key}`} className={box}>
      <NeedBody row={row} primary={false} follows={false} />
    </div>
  );
}

function NeedBody({ row, primary, follows }: { row: NeedRow; primary: boolean; follows: boolean }) {
  const tid = (suffix = '') => `needs-${row.key}${suffix}`;
  return (
    <>
      {/* The dot sits on the title's first line. */}
      <StatusDot tone={row.dot ?? DOT_OF_TONE[row.tone]} className="mt-1.5" />
      <span className="min-w-0">
        {/* Titles wrap at every width, never truncated (PAGE-TEXT problem #2). */}
        <span className="block text-row-title text-fg">{row.label}</span>
        {row.sub || row.pill ? (
          // Inline text, so the line reads (and is read) as one: "5 פערים · 2 חוסמים תשלום", never "5 פערים2 חוסמים…".
          <span className="mt-0.5 block text-row-sub text-fg-secondary" data-testid={tid('-sub')}>
            {row.sub}
            {row.pill ? (
              <>
                {row.sub ? ' ' : null}
                {/* The separator travels with the pill (never left at a line's end); the pill never breaks inside. */}
                <span className="whitespace-nowrap">
                  {row.sub ? '· ' : null}
                  <StatusChip tone="danger" emphasis="bold" label={row.pill} className="align-middle" />
                </span>
              </>
            ) : null}
          </span>
        ) : null}
        {row.notes ? (
          <span className="mt-0.5 block text-caption text-fg-tertiary" data-testid={tid('-notes')}>
            {row.notes}
          </span>
        ) : null}
      </span>
      {/* One column for every row's amount, the same fixed width in the shown list and behind "עוד"
          (two lists, one line-up); its digits physically right-aligned (SPEC §3). */}
      <span className="flex w-28 flex-col items-end gap-1.5">
        <span className="self-stretch text-right text-lg font-medium text-fg" data-testid={tid('-value')}>
          {row.agorot !== null ? <Money agorot={row.agorot} context="inline" decimals={row.decimals} split /> : <bdi className="tabular-nums">{row.countText}</bdi>}
        </span>
        {row.basis ? (
          <span className="-mt-1.5 self-stretch text-right text-caption text-fg-tertiary" data-testid={tid('-basis')}>
            {row.basis}
          </span>
        ) : null}
        {/* The verb's slot: every verb is as tall as the filled one, so focus moving between rows never moves a row. */}
        <span className="flex min-h-8 items-center">
          <span data-primary={primary ? '' : undefined} className={cn(VERB, primary ? VERB_PRIMARY : VERB_QUIET, !primary && follows && VERB_FOLLOWS)}>
            {row.verb}
            <DirIcon kind="forward" size="caption" className={primary ? ARROW_PRIMARY : follows ? ARROW_FOLLOWS : undefined} />
          </span>
        </span>
      </span>
    </>
  );
}
