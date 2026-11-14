/**
 * The AU-04 owner options, read from `restaurants.settings.automations` — the
 * path AU-01's registry owns. INTERIM until AU-01's `automationOption(settings, key)`
 * merges: default ON (today's e-mails keep flowing); only an explicit `false` turns
 * a brief off. Swap the body for `automationOption` in this one place.
 */
export type BriefOptionKey = 'receiverBrief' | 'orderReminders' | 'supplierDelays' | 'eveningDigest';

export function briefOptionOn(settings: unknown, key: BriefOptionKey): boolean {
  const automations = (settings as { automations?: Record<string, unknown> } | null | undefined)?.automations;
  return automations?.[key] !== false;
}
