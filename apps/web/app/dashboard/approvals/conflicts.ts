/**
 * The CONFLICT texts of a decision (DS3-04 spec §1.1): `parseAmountChanged` and `conflictText`, moved verbatim from
 * list.tsx:1544-1569 (only `export` added). Pure: the controller's failureOutcome (desk-state.ts) reads them.
 */
import { formatDateTime } from '@/lib/i18n/format';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import { resolutionLabel } from './vocab';

type T = Translator<typeof approvalsHe>;

export function conflictText(
  t: T,
  c: { status: string; role: string | null; name: string | null; at: string | null; self: boolean },
  locale: 'he' | 'en',
): string {
  const time = c.at ? formatDateTime(c.at, locale) : '';
  const status = resolutionLabel(t, c.status);
  if (c.self) return t('card.decidedBySelf', { time, status });
  const role = c.role ? t(`roles.${c.role}` as MessageKey<typeof approvalsHe>) : null;
  const who = c.name ?? (role && !role.startsWith('roles.') ? role : t('card.someone'));
  return t('card.decidedBy', { who, time, status });
}

/** CONFLICT `approvals.amountChanged:{seenAgorot, nowAgorot}` → the new figure. */
export function parseAmountChanged(message: string | undefined): { seenAgorot: number; nowAgorot: number } | null {
  const prefix = 'approvals.amountChanged:';
  if (!message?.startsWith(prefix)) return null;
  try {
    const v = JSON.parse(message.slice(prefix.length)) as { seenAgorot?: unknown; nowAgorot?: unknown };
    return typeof v.nowAgorot === 'number' && typeof v.seenAgorot === 'number'
      ? { seenAgorot: v.seenAgorot, nowAgorot: v.nowAgorot }
      : null;
  } catch {
    return null;
  }
}
