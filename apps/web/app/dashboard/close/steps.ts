/**
 * Month close checklist — the pure step rules (W3-05a).
 *
 * One home per number: each step shows a figure that is computed in exactly one
 * place and links to the queue where it lives. Steps 1, 4, 5 come from
 * `close.checklist`; step 2 from `approvals.queueSummary` (the home's ONE
 * "ממתין להחלטה שלך" figure); step 3 from recovery `followUps().unsent`; step 6
 * from `owner.vatAtRisk('open')`; step 7 waits for the logged export runs (slice b).
 *
 * States → emphasis tier:
 *   done    — nothing left (T3, calm green ✓)
 *   todo    — items to act on (T2, solid warn badge + ₪; ONE primary CTA, on the first todo step)
 *   pending — consolidated invoices waiting / not tracked yet (T4 neutral, never an alarm)
 *   off     — feature off or no data source (T4 neutral)
 */

export type StepKey = 'unchecked' | 'gaps' | 'claims' | 'consolidated' | 'deliveryNotes' | 'vat' | 'exports';
export type StepState = 'done' | 'todo' | 'pending' | 'off';

export const STEP_ORDER: readonly StepKey[] = [
  'unchecked',
  'gaps',
  'claims',
  'consolidated',
  'deliveryNotes',
  'vat',
  'exports',
];

/** Steps whose figure is everything open now, not only the chosen month (the source has no month scope). */
export const OPEN_NOW: ReadonlySet<StepKey> = new Set(['gaps', 'claims', 'vat']);

export interface Figure {
  count: number;
  /** ₪ (shekels, agora-exact). */
  amountIls: number;
}

export interface CloseSources {
  /** `close.checklist`. */
  unchecked: Figure;
  consolidated: Figure & { firstInvoiceId: string | null };
  deliveryNotes: Figure | null;
  /** `approvals.queueSummary().toDecide`; null when unavailable. */
  gaps: Figure | null;
  /** recovery `followUps().unsent` (agorot → shekels by the caller); null when recovery is off. */
  claims: Figure | null;
  /** `owner.vatAtRisk('open')`; null when the flag is off. */
  vat: Figure | null;
}

export interface Step {
  key: StepKey;
  state: StepState;
  count: number | null;
  amountIls: number | null;
  href: string;
  /** The single primary CTA of the page. */
  primary: boolean;
  /** The figure is all open items now, not only the month. */
  openNow: boolean;
}

export const LEDGER_HREF = '/dashboard/suppliers/ledger';

/** Where each number lives. The unchecked-invoices link is an interim until W2-02's register. */
export function hrefOf(key: StepKey, s: Pick<CloseSources, 'consolidated'>): string {
  switch (key) {
    case 'unchecked':
      return '/dashboard/inbox?filter=needs_review'; // TODO(W2-02): the invoice register's unchecked view
    case 'gaps':
      return '/dashboard/approvals';
    case 'claims':
      return '/dashboard/recovery';
    case 'consolidated':
      return s.consolidated.firstInvoiceId ? `/dashboard/invoices/${s.consolidated.firstInvoiceId}` : LEDGER_HREF;
    case 'deliveryNotes':
      return LEDGER_HREF;
    case 'vat':
      return '/dashboard'; // the home's VAT-at-risk card
    case 'exports':
      return '/dashboard/exports';
  }
}

function stateOf(key: StepKey, f: Figure | null): StepState {
  if (key === 'exports') return 'pending'; // slice b ticks it from the logged runs
  if (f == null) return 'off';
  if (f.count === 0) return 'done';
  return key === 'consolidated' ? 'pending' : 'todo';
}

export function buildSteps(s: CloseSources): Step[] {
  let primaryTaken = false;
  return STEP_ORDER.map((key) => {
    const f = key === 'exports' ? null : s[key];
    const state = stateOf(key, f);
    const primary = state === 'todo' && !primaryTaken;
    if (primary) primaryTaken = true;
    return {
      key,
      state,
      count: f ? f.count : null,
      amountIls: f ? f.amountIls : null,
      href: hrefOf(key, s),
      primary,
      openNow: OPEN_NOW.has(key),
    };
  });
}

/** Done out of the actionable steps (pending / off steps never count against the close). */
export function progress(steps: readonly Step[]): { done: number; total: number } {
  const counted = steps.filter((st) => st.state === 'done' || st.state === 'todo');
  return { done: counted.filter((st) => st.state === 'done').length, total: counted.length };
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function localYmd(now: Date, tz: string): { y: number; m: number; d: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

const key = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return key(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/** The month being closed: the previous one during days 1–10 (the close window), else the current one. */
export function defaultMonth(now: Date, tz = 'Asia/Jerusalem'): string {
  const { y, m, d } = localYmd(now, tz);
  const cur = key(y, m);
  return d <= 10 ? shiftMonth(cur, -1) : cur;
}

export function currentMonth(now: Date, tz = 'Asia/Jerusalem'): string {
  const { y, m } = localYmd(now, tz);
  return key(y, m);
}

/** `?month=` if valid and not in the future, else the default. */
export function resolveMonth(raw: string | undefined, now: Date, tz = 'Asia/Jerusalem'): string {
  if (raw && MONTH_RE.test(raw) && raw <= currentMonth(now, tz)) return raw;
  return defaultMonth(now, tz);
}
