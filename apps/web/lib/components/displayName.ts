import type { Locale } from '@/lib/i18n/config';

/**
 * Pick the name to show for a product / supplier in the active locale
 * ("Receiver in English", migration 0028). Hebrew is the source of truth and
 * always the Hebrew display; English shows `name_en` when present and keeps the
 * Hebrew original as secondary text so staff can match it to the paper. Without
 * an English name, English falls back to the Hebrew original (no secondary).
 */
export function displayName(
  he: string,
  en: string | null | undefined,
  locale: Locale,
): { primary: string; secondary: string | null } {
  const english = en?.trim();
  if (locale === 'en' && english) {
    return { primary: english, secondary: english === he ? null : he };
  }
  return { primary: he, secondary: null };
}
