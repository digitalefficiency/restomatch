import type { RestaurantSettings } from '@restomatch/db';

/**
 * AU-13 options (A18). INTERIM until AU-01's `automations/options.ts` and the
 * registry rows `priceCreepDigest`, `contractExpiry`, `priceListDiff` land.
 * Defaults (orchestrator decision 7.11): the rows that replace behaviour
 * already on main (`priceCreepDigest`, `contractExpiry`) default ON, so nothing
 * existing changes; the genuinely new `priceListDiff` defaults OFF until the
 * catalog import record exists. `settings.automations.<key>` (boolean)
 * overrides a default. On AU-01's merge this reader
 * becomes its `automationOption(settings, key)` — one line.
 *
 * The dish section keeps using the existing `dishPriceAlert` feature flag.
 */
export type DigestOptionKey = 'priceCreepDigest' | 'contractExpiry' | 'priceListDiff';

export type DigestOptions = Record<DigestOptionKey, boolean>;

export const DIGEST_OPTION_DEFAULTS: DigestOptions = { priceCreepDigest: true, contractExpiry: true, priceListDiff: false };

export function digestOptions(settings: RestaurantSettings | null | undefined): DigestOptions {
  const raw = (settings as { automations?: Record<string, unknown> } | null | undefined)?.automations ?? {};
  const opt = (k: DigestOptionKey) => (typeof raw[k] === 'boolean' ? (raw[k] as boolean) : DIGEST_OPTION_DEFAULTS[k]);
  return { priceCreepDigest: opt('priceCreepDigest'), contractExpiry: opt('contractExpiry'), priceListDiff: opt('priceListDiff') };
}
