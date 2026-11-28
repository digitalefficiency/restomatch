import { automationOption } from '../automations/options';

/**
 * The AU-04 owner options: AU-01's `automationOption` (registry default when unset).
 * Kept as a thin alias so the job call sites stay one line.
 */
export type BriefOptionKey =
  | 'receiverBrief'
  | 'receiverLateNotice'
  | 'rematchAlerts'
  | 'orderReminders'
  | 'supplierDelays'
  | 'eveningDigest';

export function briefOptionOn(settings: unknown, key: BriefOptionKey): boolean {
  return automationOption(settings, key);
}
