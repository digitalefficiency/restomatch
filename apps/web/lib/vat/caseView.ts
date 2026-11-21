/**
 * AU-08 (A13): pure view logic for the allocation case — the card's stage line
 * and the cockpit field. Every helper returns a `vat` message key + params, so
 * the components only translate (he/en parity lives in messages/vat).
 *
 * Format checks here mirror the server (`vat.setAllocationNumber` is the
 * authority); they only drive inline feedback before a round-trip.
 */

export type AllocationStage = 'new' | 'requested' | 'overdue_request' | 'closing' | 'expired';
export type NumberState = 'missing' | 'invalid' | 'valid';

export interface ViewLine {
  key: string;
  params?: Record<string, string | number>;
}

const DAY_MS = 86_400_000;

/** Israel calendar day (YYYY-MM-DD) of an instant. */
export function israelDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function wholeDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/** Spaces / dashes as printed are dropped; the 9 digits or null. */
export function normaliseAllocationInput(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(v) ? v : null;
}

export function numberStateOf(raw: string | null | undefined): NumberState {
  const v = raw?.trim();
  if (!v) return 'missing';
  return normaliseAllocationInput(v) ? 'valid' : 'invalid';
}

/** The field's state chip: "חסר" / "לא תקין" / "תקין (פורמט)". Never claims more than the format. */
export function numberStateLine(state: NumberState): ViewLine {
  return { key: state === 'valid' ? 'field.validFormat' : state === 'invalid' ? 'field.invalid' : 'field.missing' };
}

/**
 * The card's stage line for one supplier group. `requestedAt` is the latest
 * request for the group; `daysLeft` its most urgent invoice.
 */
export function stageLine(args: {
  stage: AllocationStage;
  requestedAt: string | null;
  daysLeft: number;
  todayIso: string;
}): ViewLine {
  switch (args.stage) {
    case 'expired':
      return { key: 'case.stageExpired' };
    case 'closing':
      return { key: 'case.stageClosing', params: { days: Math.max(0, args.daysLeft) } };
    case 'overdue_request':
    case 'requested': {
      const days = args.requestedAt ? wholeDays(israelDay(new Date(args.requestedAt)), args.todayIso) : 0;
      if (args.stage === 'overdue_request') return { key: 'case.stageOverdue', params: { days } };
      if (days <= 0) return { key: 'case.stageRequestedToday' };
      if (days === 1) return { key: 'case.stageRequestedOne' };
      return { key: 'case.stageRequested', params: { days } };
    }
    default:
      return { key: 'case.stageNew' };
  }
}

/** The worst stage of a supplier group (what the card shows once per supplier). */
const STAGE_RANK: Record<AllocationStage, number> = { expired: 4, closing: 3, overdue_request: 2, requested: 1, new: 0 };
export function groupStage(stages: ReadonlyArray<AllocationStage>): AllocationStage {
  return stages.reduce<AllocationStage>((acc, s) => (STAGE_RANK[s] > STAGE_RANK[acc] ? s : acc), 'new');
}

/** The primary hand-off label: first ask, or a reminder once a request is on record. */
export function handoffCtaKey(requestedAt: string | null): string {
  return requestedAt ? 'case.reminderCta' : 'case.requestCta';
}

/** The cockpit deadline line ("אפשר לקזז את המע״מ עד 31.03.2027 (עוד 42 ימים)"). */
export function deadlineLine(deadlineIso: string, daysLeft: number): ViewLine {
  const date = `${deadlineIso.slice(8, 10)}.${deadlineIso.slice(5, 7)}.${deadlineIso.slice(0, 4)}`;
  if (daysLeft < 0) return { key: 'field.expired', params: { date } };
  if (daysLeft === 0) return { key: 'field.deadlineToday', params: { date } };
  return { key: 'field.deadline', params: { date, days: daysLeft } };
}

/** An idempotency key for one user action (replays return the recorded result). */
export function newClientMutationId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
