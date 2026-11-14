/**
 * W3-09 / AU-11 c · Failed-send rescue: which placed POs the orderer should hear
 * about (pure). It reads the send state only and never retries the outbox row —
 * retries are `outboxDispatch` (H-05). The orderer finishes the send from their
 * own WhatsApp on the PO page (W2-06).
 */
import type { SendState } from '../routers/orders';

export const RESCUE_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export interface RescueCandidate {
  poId: string;
  poStatus: string;
  placedAt: Date | null;
  sendState: SendState;
  /** The orderer marked it sent from their own phone (W2-06 `markSentManually`). */
  sentManually: boolean;
  hasGoodsReceipt: boolean;
}

export function needsSendRescue(c: RescueCandidate, now: Date): boolean {
  if (c.poStatus === 'draft' || c.poStatus === 'cancelled') return false;
  if (!c.placedAt) return false;
  const age = now.getTime() - c.placedAt.getTime();
  if (age < 0 || age > RESCUE_LOOKBACK_MS) return false;
  if (c.sentManually || c.hasGoodsReceipt) return false;
  return c.sendState === 'failed' || c.sendState === 'skipped';
}

export function sendRescueDedupeKey(restaurantId: string, userId: string, poId: string): string {
  return `au:A16c:${restaurantId}:${userId}:${poId}`;
}
