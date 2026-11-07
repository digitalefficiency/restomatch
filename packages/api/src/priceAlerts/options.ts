import type { RestaurantSettings } from '@restomatch/db';

/**
 * AU-13 options (A18). INTERIM until AU-01's `automations/options.ts` and the
 * registry rows `priceCreepDigest`, `contractExpiry`, `priceListDiff` land:
 * all default ON (brief §3), and an explicit `false` under
 * `settings.automations.<key>` turns one off. On AU-01's merge this reader
 * becomes its `automationOption(settings, key)` — one line.
 *
 * The dish section keeps using the existing `dishPriceAlert` feature flag.
 */
export type DigestOptionKey = 'priceCreepDigest' | 'contractExpiry' | 'priceListDiff';

export type DigestOptions = Record<DigestOptionKey, boolean>;

export function digestOptions(settings: RestaurantSettings | null | undefined): DigestOptions {
  const raw = (settings as { automations?: Record<string, unknown> } | null | undefined)?.automations ?? {};
  const on = (k: DigestOptionKey) => raw[k] !== false;
  return { priceCreepDigest: on('priceCreepDigest'), contractExpiry: on('contractExpiry'), priceListDiff: on('priceListDiff') };
}
