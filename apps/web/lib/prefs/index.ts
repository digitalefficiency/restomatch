/**
 * Personal display preferences (DS3-06). Client-safe entry; the server entry is
 * `@/lib/prefs/server` (PrefsRoot, readDisplayChoices). Contract: ./README.md.
 */
export * from './schema';
export { getDisplayChoices, setDisplayChoices, singleKeysEnabled, subscribeDisplay } from './store';
export { PrefsProvider, usePrefs, type PrefsApi } from './PrefsProvider';
export { TOUCH_QUERY, useIsTouch } from './media';
