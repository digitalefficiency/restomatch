/**
 * Favourites (sidebar spec §0, §7.1, §13): pages a user stars from the top bar.
 * They show as a "מועדפים" group after the top items, only once the user has
 * starred something, and are stored per role (`favouritesStorageKey`). Pure
 * list logic; storage lives in `prefs.ts`.
 */

/**
 * At most five stars per role. A sidebar recents tray was rejected because it
 * pushed money down the panel; the cap keeps favourites from doing the same.
 */
export const MAX_FAVOURITES = 5;

/**
 * Star or unstar `key`. A key that is absent goes at the end, so the list
 * keeps the order the user built it in. When the list already holds
 * `MAX_FAVOURITES`, nothing changes and `full` is true: the star explains the
 * cap instead of silently evicting an older pick. A key that is present is
 * removed. `added` tells the caller which announcement to make. Never mutates
 * `list`.
 *
 * Pass the list the viewer actually sees (`sanitizeFavourites` output), not
 * the raw stored one: a stored key the viewer can no longer open has no star
 * to remove it, so counting it would refuse a fifth visible star for good.
 */
export function toggleFavourite(list: readonly string[], key: string): { list: string[]; added: boolean; full: boolean } {
  if (list.includes(key)) return { list: list.filter((k) => k !== key), added: false, full: false };
  if (list.length >= MAX_FAVOURITES) return { list: [...list], added: false, full: true };
  return { list: [...list, key], added: true, full: false };
}

/**
 * Stored favourites cleaned for the current viewer: the user's order kept,
 * duplicates dropped, only keys in `allowed`, at most `MAX_FAVOURITES`. Stars
 * outlive role changes, feature flags and registry renames, so a page this
 * viewer can no longer open (or a key that no longer exists) drops out here
 * rather than rendering a dead link. A dropped key never takes up one of the
 * five places.
 */
export function sanitizeFavourites(list: readonly string[], allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const key of list) {
    if (out.length >= MAX_FAVOURITES) break;
    if (allowed.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}
