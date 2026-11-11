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
  /** `close.checklist`: the register month (`?month=`) the invoice steps link to. */
  monthOffset: number;
  /** `close.checklist`: the register's awaiting tab for the month. */
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
  /** The queue where the number lives; null = no button (state `off`, or the number has no screen). */
  href: string | null;
  /** The single primary CTA of the page. */
  primary: boolean;
  /** The figure is all open items now, not only the month. */
  openNow: boolean;
}

export const LEDGER_HREF = '/dashboard/suppliers/ledger';

/**
 * Where each number lives. Step 1 opens the W2-02 register's awaiting tab for the same
 * month, so the step's count is exactly what the link shows. VAT at risk has no screen
 * of its own (the home card is gone, W2-08): no button.
 */
export function hrefOf(key: StepKey, s: Pick<CloseSources, 'consolidated' | 'monthOffset'>): string | null {
  switch (key) {
    case 'unchecked':
      return `/dashboard/invoices?month=${s.monthOffset}&view=awaiting`;
    case 'gaps':
      return '/dashboard/approvals';
    case 'claims':
      return '/dashboard/recovery';
    case 'consolidated':
      return s.consolidated.firstInvoiceId ? `/dashboard/invoices/${s.consolidated.firstInvoiceId}` : LEDGER_HREF;
    case 'deliveryNotes':
      return LEDGER_HREF;
    case 'vat':
      // AU-08: the VAT-at-risk card (request / reminder hand-off) is mounted below the checklist.
      return '#vat-at-risk';
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
      href: state === 'off' ? null : hrefOf(key, s),
      primary,
      openNow: OPEN_NOW.has(key),
    };
  });
}

/**
 * Done out of every step shown (the header must match the list). `open` = steps left to
 * act on; when it is 0 the page says so instead (pending / off steps never block the close).
 */
export function progress(steps: readonly Step[]): { done: number; total: number; open: number } {
  return {
    done: steps.filter((st) => st.state === 'done').length,
    total: steps.length,
    open: steps.filter((st) => st.state === 'todo').length,
  };
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
