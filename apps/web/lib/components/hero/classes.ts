/**
 * Class strings the hero's server shell (LeakHero) and its client islands (HeroFold) share. They
 * live in a plain module: a value exported from a 'use client' file reaches a server component as
 * a client reference, not as the string. Roles and the spacing scale only.
 */

/** The foot row (SPEC §10.1 "35 חשבוניות נבדקו…" + the toggle): a rule above, the row wraps on a phone. */
export const HERO_FOOT_ROW = 'flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-rule py-3';

/** The foot row's line: the whole row below `sm` (the toggle wraps under it, at the start), the rest of it above. */
export const HERO_FOOT_LINE = 'min-w-0 basis-full text-body-sm text-fg-secondary sm:flex-1 sm:basis-auto';

/**
 * A text link inside the hero: underlined (links are underlined, never colour alone), 24 px tall
 * at the desk (SPEC §5); the hero's coarse-pointer rule in globals.css lifts every hero link to 44 px.
 */
export const HERO_LINK =
  'inline-flex min-h-6 items-center text-body-sm font-medium text-primary underline decoration-1 underline-offset-2 hover:text-primary-bold-hover';
