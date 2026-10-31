/**
 * Pure rules of the ₪-back tracker screen (unit-tested). Money is integer
 * agorot, as the recovery router returns it; formatting stays at display.
 */

export type RecoveryStatus =
  | 'claimed'
  | 'letter_sent'
  | 'acknowledged'
  | 'credited'
  | 'recovered'
  | 'disputed'
  | 'written_off';

/**
 * The allowed moves come from the SERVER (`recovery.list` → `next[]`, from
 * packages/api lifecycle.ts): this screen never mirrors the transition table.
 */
export interface NextEdge {
  to: RecoveryStatus;
  requiresReason: boolean;
  terminal: boolean;
  undoable: boolean;
}

/**
 * Ask recovery.list for EVERY claim (packages/api MAX_CLAIMS) — screens that sum
 * claims (letters, banner, tab counts) must never sum a 200-row first page.
 */
export const ALL_CLAIMS = 5000;

/** Waiting on the supplier (the countdown runs) — packages/api AWAITING_SUPPLIER. */
export const AWAITING: readonly RecoveryStatus[] = ['claimed', 'letter_sent', 'acknowledged'];
export const CLOSED: readonly RecoveryStatus[] = ['recovered', 'written_off'];
/** Moves that need a deliberate confirm (they end the claim): never a deferred one-tap. */
export const CONFIRMED_MOVES: readonly RecoveryStatus[] = ['written_off', 'recovered'];

/** The one primary step per status. `credit` = open the credit-note form (not a bare status flip). */
export type NextStep = { kind: 'move'; to: RecoveryStatus } | { kind: 'credit' } | null;
export function nextStep(status: RecoveryStatus): NextStep {
  switch (status) {
    case 'claimed':
      return { kind: 'move', to: 'letter_sent' };
    case 'letter_sent':
    case 'acknowledged':
    case 'disputed':
      return { kind: 'credit' };
    case 'credited':
      return { kind: 'move', to: 'recovered' };
    case 'written_off':
      return { kind: 'move', to: 'claimed' };
    default:
      return null;
  }
}

const tos = (next: ReadonlyArray<NextEdge | RecoveryStatus>): RecoveryStatus[] => next.map((e) => (typeof e === 'string' ? e : e.to));

/** The moves left for the ⋯ menu: the server's allowed moves except the primary step. */
export function menuMoves(status: RecoveryStatus, next: ReadonlyArray<NextEdge | RecoveryStatus>): RecoveryStatus[] {
  const primary = nextStep(status);
  return tos(next).filter((s) => !(primary?.kind === 'move' && primary.to === s));
}

/** Moves valid for EVERY selected claim (one batch call can then never half-fail on the lifecycle). */
export function batchMoves(nexts: ReadonlyArray<ReadonlyArray<NextEdge | RecoveryStatus>>): RecoveryStatus[] {
  if (nexts.length === 0) return [];
  const [first, ...rest] = nexts.map(tos);
  return first!.filter((to) => rest.every((n) => n.includes(to)));
}

/**
 * Largest-remainder (Hamilton) rounding of agorot parts to whole shekels, so the
 * printed parts add up to the printed whole: Σ round(parts) === round(Σ parts).
 */
export function hamiltonShekels(partsAgorot: ReadonlyArray<number>): number[] {
  const total = partsAgorot.reduce((s, v) => s + v, 0);
  const target = Math.round(total / 100);
  const floors = partsAgorot.map((v) => Math.floor(v / 100));
  let left = target - floors.reduce((s, v) => s + v, 0);
  const order = partsAgorot
    .map((v, i) => ({ i, rem: v / 100 - Math.floor(v / 100) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

export interface FunnelInput {
  claimedAgorot: number;
  creditedAgorot: number;
  recoveredAgorot: number;
  outstandingAgorot: number;
  disputedAgorot: number;
  writtenOffAgorot: number;
}

export type FunnelPart = 'returned' | 'credited' | 'open' | 'disputed' | 'writtenOff';
export interface Funnel {
  /** Agorot per part; the parts partition what was claimed. */
  agorot: Record<FunnelPart, number>;
  /** Whole shekels per part (Hamilton) — they sum to `totalShekels`. */
  shekels: Record<FunnelPart, number>;
  totalAgorot: number;
  totalShekels: number;
  /** Stages נדרש → זוכה → הוחזר in whole shekels, from the same rounded parts. */
  stages: { claimed: number; credited: number; returned: number };
}

/**
 * נדרש = הוחזר + זוכה (טרם הוחזר) + פתוח + במחלוקת + ויתרנו. Every claimed agora
 * is in exactly one part: credited covers recovered, outstanding covers disputed,
 * written-off covers the shortfall of a claim recovered for less than asked.
 */
export function funnelOf(s: FunnelInput): Funnel {
  const agorot: Record<FunnelPart, number> = {
    returned: s.recoveredAgorot,
    credited: Math.max(0, s.creditedAgorot - s.recoveredAgorot),
    open: Math.max(0, s.outstandingAgorot - s.disputedAgorot),
    disputed: s.disputedAgorot,
    writtenOff: s.writtenOffAgorot,
  };
  const keys = Object.keys(agorot) as FunnelPart[];
  const rounded = hamiltonShekels(keys.map((k) => agorot[k]));
  const shekels = Object.fromEntries(keys.map((k, i) => [k, rounded[i]!])) as Record<FunnelPart, number>;
  const totalAgorot = keys.reduce((sum, k) => sum + agorot[k], 0);
  const totalShekels = rounded.reduce((a, b) => a + b, 0);
  return {
    agorot,
    shekels,
    totalAgorot,
    totalShekels,
    stages: { claimed: totalShekels, credited: shekels.returned + shekels.credited, returned: shekels.returned },
  };
}

/** Days to wait for the supplier's answer after the letter (or the claim) — the reminder job's OVERDUE_DAYS. */
export const ANSWER_DAYS = 14;

function israelDay(iso: string): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(iso))
    .split('-')
    .map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export type Countdown =
  | { tone: 'neutral' | 'warn'; daysLeft: number; dueIso: string }
  | { tone: 'danger'; daysLate: number; dueIso: string };

/** The answer countdown from COALESCE(letterSentAt, claimedAt) + 14 days; null when not waiting on the supplier. */
export function countdownOf(
  c: { status: RecoveryStatus; letterSentAt: string | null; claimedAt: string },
  nowIso: string,
): Countdown | null {
  if (!AWAITING.includes(c.status)) return null;
  const from = c.letterSentAt ?? c.claimedAt;
  const dueIso = new Date(new Date(from).getTime() + ANSWER_DAYS * 86_400_000).toISOString();
  const left = israelDay(from) + ANSWER_DAYS - israelDay(nowIso);
  if (left < 0) return { tone: 'danger', daysLate: -left, dueIso };
  return { tone: left <= 7 ? 'warn' : 'neutral', daysLeft: left, dueIso };
}

/**
 * The two T2 queues of the banner: letters never sent, and sent letters past the
 * answer window. "Late" is the SAME rule as the claims page's sent list and its
 * reminder: a supplier's letter is late when its LATEST send date is more than
 * ANSWER_DAYS ago, and then all its `letter_sent` claims wait (an acknowledged
 * claim is answered, so it is not "waiting").
 */
export function followUps(
  claims: ReadonlyArray<{
    status: RecoveryStatus;
    outstandingAgorot: number;
    letterSentAt: string | null;
    claimedAt: string;
    supplierName?: string | null;
  }>,
  nowIso: string,
): { unsent: { count: number; agorot: number }; waiting: { count: number; agorot: number } } {
  const unsent = { count: 0, agorot: 0 };
  const waiting = { count: 0, agorot: 0 };
  const sent = new Map<string, { latest: string; count: number; agorot: number }>();
  for (const c of claims) {
    if (c.outstandingAgorot <= 0) continue;
    if (c.status === 'claimed') {
      unsent.count += 1;
      unsent.agorot += c.outstandingAgorot;
    } else if (c.status === 'letter_sent' && c.letterSentAt) {
      const key = (c.supplierName ?? '').trim() || '—';
      const g = sent.get(key) ?? { latest: c.letterSentAt, count: 0, agorot: 0 };
      g.count += 1;
      g.agorot += c.outstandingAgorot;
      if (c.letterSentAt > g.latest) g.latest = c.letterSentAt;
      sent.set(key, g);
    }
  }
  for (const g of sent.values()) {
    if (israelDay(g.latest) + ANSWER_DAYS - israelDay(nowIso) < 0) {
      waiting.count += g.count;
      waiting.agorot += g.agorot;
    }
  }
  return { unsent, waiting };
}

/**
 * The ₪ a closing confirm names: "הכסף חזר" names the money that CAME BACK
 * (Σ credited), a write-off names what is given up (Σ still owed).
 */
export function confirmAgorot(
  claims: ReadonlyArray<{ creditedAgorot: number; outstandingAgorot: number }>,
  to: 'recovered' | 'written_off',
): number {
  return claims.reduce((s, c) => s + (to === 'recovered' ? c.creditedAgorot : c.outstandingAgorot), 0);
}

/** Claims grouped by supplier (phone cards), largest outstanding first. */
/**
 * Claims grouped per supplier for the desk, RANKED by what waiting costs:
 * Σ(owed agorot × days overdue) first (the server's `daysOverdue`, from the
 * shared overdue constant — never a day count of this screen), then owed ₪.
 * A supplier owing ₪0 (fully credited) never leads the open list.
 */
export function bySupplier<
  T extends { supplierId: string | null; supplierName: string | null; outstandingAgorot: number; daysOverdue?: number },
>(claims: ReadonlyArray<T>): Array<{ key: string; claims: T[]; outstandingAgorot: number; urgency: number }> {
  const m = new Map<string, { key: string; claims: T[]; outstandingAgorot: number; urgency: number }>();
  for (const c of claims) {
    const key = c.supplierId ?? c.supplierName ?? '—';
    const g = m.get(key) ?? { key, claims: [], outstandingAgorot: 0, urgency: 0 };
    g.claims.push(c);
    g.outstandingAgorot += c.outstandingAgorot;
    g.urgency += c.outstandingAgorot * Math.max(0, c.daysOverdue ?? 0);
    m.set(key, g);
  }
  return [...m.values()].sort(
    (a, b) =>
      Number(b.outstandingAgorot > 0) - Number(a.outstandingAgorot > 0) ||
      b.urgency - a.urgency ||
      b.outstandingAgorot - a.outstandingAgorot ||
      a.key.localeCompare(b.key),
  );
}

/**
 * DISPLAY-ONLY preview of the server's incl. → excl. VAT conversion
 * (packages/api recovery/service.ts `exclVatAgorot`: integer agorot, half-up,
 * the supplier's rate in basis points), so the credit form can show ✓ at 0
 * before submit. The server converts again and is the only one that books.
 */
export function previewExclAgorot(printedAgorot: number, vat: 'incl' | 'excl', rateBp: number): number {
  if (vat === 'excl') return printedAgorot;
  const den = 10_000 + rateBp;
  return Math.floor((2 * printedAgorot * 10_000 + den) / (2 * den));
}
