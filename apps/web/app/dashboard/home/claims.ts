import { ANSWER_DAYS, type followUps } from '../recovery/logic';
/**
 * SUPERSEDED (W2-08): the home reads its claim rows from the task spine
 * (`tasks.mine` → claim_to_send / credit_to_match). Kept with its test until
 * W2-10 moves `followUps` server-side; needs-rows.test.ts pins the two rules.
 */
interface NeedRow {
  key: string;
  tone: 'danger' | 'warn' | 'neutral';
  label: string;
  value: string;
  sub?: string;
  verb: string;
  href: string;
}

type Queues = ReturnType<typeof followUps>;

/**
 * The home's credit-claim rows = the recovery page's two follow-up queues
 * (recovery/logic followUps: letters never sent; sent letters past the ANSWER_DAYS
 * (a week) answer window — an acknowledged claim is answered, so not waiting). Same rule,
 * same figures (to the agora), same wording, and the row lands on that banner.
 */
export function claimNeedRows(
  q: Queues,
  f: { t: (key: 'needs.claimsWaiting.label' | 'needs.claimsWaiting.sub' | 'needs.claimsWaiting.verb' | 'needs.claimsUnsent.label' | 'needs.claimsUnsent.sub' | 'needs.claimsUnsent.verb', vars?: Record<string, string | number>) => string; money: (agorot: number) => string; n: (v: number) => string },
): NeedRow[] {
  const rows: NeedRow[] = [];
  if (q.waiting.count > 0) {
    rows.push({
      key: 'claimsWaiting',
      tone: 'warn',
      label: f.t('needs.claimsWaiting.label', { days: f.n(ANSWER_DAYS) }),
      value: f.money(q.waiting.agorot),
      sub: f.t('needs.claimsWaiting.sub', { count: f.n(q.waiting.count) }),
      verb: f.t('needs.claimsWaiting.verb'),
      href: '/dashboard/recovery',
    });
  }
  if (q.unsent.count > 0) {
    rows.push({
      key: 'claimsUnsent',
      tone: 'warn',
      label: f.t('needs.claimsUnsent.label'),
      value: f.money(q.unsent.agorot),
      sub: f.t('needs.claimsUnsent.sub', { count: f.n(q.unsent.count) }),
      verb: f.t('needs.claimsUnsent.verb'),
      href: '/dashboard/recovery',
    });
  }
  return rows;
}
