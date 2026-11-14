/**
 * Personal display preferences (DS3-06). Client entry; the server entry is
 * `@/lib/prefs/server` (PrefsRoot, readDisplayChoices, readDeviceHints).
 * Server components import constants from `@/lib/prefs/schema` (this barrel
 * re-exports client modules). Contract: ./README.md.
 */
export * from './schema';
export { getDisplayChoices, setDisplayChoices, singleKeysEnabled, subscribeDisplay } from './store';
export { PrefsProvider, useIsApple, useIsCoarse, usePrefs, type PrefsApi } from './PrefsProvider';
export { useIsNarrow, useIsPhone, useMediaMatch } from './media';
