import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import { taskRow } from '@/lib/components/notifications/rows';
import type { Task } from '@/lib/components/notifications/model';
import type { NeedDot, NeedRow } from './needs-you';

/**
 * "מחכה לך" rows for the home card (DS3 SPEC §10.1; v2 B1–B3), on top of the task spine's own
 * rows (`taskRow`, shared with the bell and left as it is). Pure: the ₪ is the task's server
 * figure, untouched; this only decides how a row reads — its dot, its solid pill, and the VAT
 * basis said beside its amount.
 */

type T = Translator<typeof overviewHe>;

/** The three VAT bases, in the product's own words (leaks `claims.basis.*`), resolved by the caller. */
export interface BasisWords {
  excl: string;
  incl: string;
  vat: string;
}

/**
 * The basis each money row is measured on BY CONSTRUCTION (v2 B1): the decision queue is before
 * VAT, the pay run sums invoice totals including VAT, VAT-at-risk is a VAT amount. Credit-request
 * rows add up requests of any basis (a duplicate is claimed incl. VAT, a VAT gap is a VAT amount),
 * so they state none until the task spine splits them (request R2).
 */
const BASIS_OF: Partial<Record<Task['type'], keyof BasisWords>> = {
  decision: 'excl',
  payment_due: 'incl',
  allocation_missing: 'vat',
};

/**
 * The dot by meaning (SPEC §2, v2 B3): red only when a payment is blocked — a decision row with
 * blocking gaps; grey for what merely waits; amber for everything else that waits for handling
 * (VAT within 7 days of its deadline is urgent, but it blocks nothing).
 */
export function needDotOf(task: Pick<Task, 'type' | 'tone' | 'blocking'>): NeedDot {
  if (task.type === 'decision' && task.blocking > 0) return 'leak';
  if (task.tone === 'neutral') return 'neutral';
  return 'warn';
}

export interface NeedRowsOptions {
  t: T;
  locale: Locale;
  /** Side amounts in the row's notes (formatIls), as the bell formats them. */
  sideMoney: (agorot: number) => string;
  basis: BasisWords;
  /**
   * May the basis sit once, beside the card's title? Only where that title is on screen (the owner's
   * card); the manager's and the bookkeeper's titles are screen-reader-only at the desk, so their
   * rows always say their basis themselves.
   */
  chipAllowed?: boolean;
}

export interface NeedRows {
  rows: NeedRow[];
  /**
   * The basis chip beside the card's title: only when EVERY money row in the card (the rows behind
   * "עוד" too) is before VAT by construction. Then the rows carry no caption of their own; otherwise
   * no chip and each money row states its basis under its amount (KNOWN-ISSUES "Owner home").
   */
  chip: string | null;
}

/**
 * Tasks → the card's rows, in the server's order, "mine" only. The task stays paired with its row
 * until the end (v2 B2), so a decision row can say how many of its gaps block a payment as the
 * solid pill — from `task.blocking`, inside its sub line — while `taskRow` and the bell keep their
 * own words ("5 פערים · 2 חוסמים תשלום").
 */
export function needRowsOf(tasks: readonly Task[], { t, locale, sideMoney, basis, chipAllowed = true }: NeedRowsOptions): NeedRows {
  const n = (v: number | string | null | undefined) => formatNumber(Number(v ?? 0), locale);
  const pairs = tasks
    .filter((task) => task.scope === 'mine')
    .map((task) => ({ task, row: taskRow(task, t, locale, sideMoney) }))
    .filter((p): p is { task: Task; row: NonNullable<typeof p.row> } => p.row !== null);

  const money = pairs.filter((p) => p.row.agorot !== null);
  const allExcl = chipAllowed && money.length > 0 && money.every((p) => BASIS_OF[p.task.type] === 'excl');

  const rows = pairs.map(({ task, row }): NeedRow => {
    const out: NeedRow = { ...row, dot: needDotOf(task) };
    if (task.type === 'decision' && task.blocking > 0) {
      const d = task.detail ?? {};
      // The count of gaps (a formatted figure in a plain placeholder, as taskRow passes it), the
      // review part as taskRow joins it; the blockers move into the pill, a number for its ICU plural.
      out.sub = [t('needs.decide.sub', { count: n(task.count) }), Number(d.toReview) > 0 ? t('needs.decide.review', { count: n(d.toReview) }) : null]
        .filter(Boolean)
        .join(' · ');
      out.pill = t('needs.blocking', { count: task.blocking });
    }
    const b = BASIS_OF[task.type];
    if (!allExcl && row.agorot !== null && b) out.basis = basis[b];
    return out;
  });

  return { rows, chip: allExcl ? basis.excl : null };
}

/**
 * Staff "מחכה לך" (the chef's home): counts only — the server sends no ₪ for staff and the row
 * renders none — with the dot by meaning. A task whose figure already has its own block on that
 * home (`homed`) is not repeated.
 */
export function staffNeedRowsOf(tasks: readonly Task[], homed: readonly Task['type'][], t: T, locale: Locale): NeedRow[] {
  return tasks
    .filter((task) => task.scope === 'mine' && !homed.includes(task.type))
    .map((task) => ({ task, row: taskRow({ ...task, ilsAgorot: null }, t, locale, () => '') }))
    .filter((p): p is { task: Task; row: NonNullable<typeof p.row> } => p.row !== null)
    .map(({ task, row }) => ({ ...row, agorot: null, notes: undefined, dot: needDotOf(task) }));
}
