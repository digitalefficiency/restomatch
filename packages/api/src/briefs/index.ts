/** AU-04 role briefs: pure builders for the existing schedules (06:00, 09:00, 10:00, 19:00, match). */
export type { BriefContext, BriefLocale, BriefMessage } from './types';
export { briefCopy, type BriefCopy } from './copy';
export { briefIls } from './money';
export { goLink, mailtoLink, waDigits, waMeLink } from './links';
export { briefOptionOn, type BriefOptionKey } from './options';
export { isPerishableSkip, PERISHABLE_CUTOFF_HOUR } from './perishable';
export { receiverMorningBrief, type ReceiverDelivery, type ReceiverMorningInput } from './receiverMorning';
export { EVENING_ROLES, eveningBrief, type EveningInput, type EveningRole } from './evening';
export { newOrderPath, orderReminderBrief, type OrderReminderInput } from './orderReminder';
export {
  lateTruckManagerBrief,
  lateTruckReceiverBrief,
  lateTruckSupplierText,
  type LateTruckInput,
  type LateTruckManagerMessage,
} from './lateTruck';
export {
  findingIdentity,
  identitySetHash,
  matchAlertBrief,
  newFindingKeys,
  type FindingIdentityInput,
  type MatchAlertInput,
} from './matchAlert';

/** The outbox dedupe key shape every AU-04 send uses: `au:<A-id>:<rid>:<recipientId>:<suffix>`. */
export function briefDedupeKey(
  msg: { automationId: string; dedupeSuffix: string },
  restaurantId: string,
  recipientId: string,
): string {
  return `au:${msg.automationId}:${restaurantId}:${recipientId}:${msg.dedupeSuffix}`;
}
