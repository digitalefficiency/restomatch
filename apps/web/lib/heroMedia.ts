/**
 * Landing-page media (produced by session S10, served from public/media/).
 *
 * `available: false` → the hero shows the animated product mock (HeroMatch);
 * flip to `true` once hero-loop.{webm,mp4} + hero-poster.jpg exist and the hero
 * plays the muted loop instead (poster first, video lazy). `promoVideo: null`
 * hides the "Watch 60 seconds" button; set it per locale (below) to enable the
 * modal. Paths are root-relative so they work behind any origin.
 */
import type { Locale } from './i18n/config';

/** Web-optimized promo film (≈60 s, 720p, ~6–8 MB, faststart) + its poster. */
export interface PromoFilm {
  src: string;
  poster?: string;
}
/** Per locale; a locale without its own cut falls back to the Hebrew film. */
export type PromoSources = Partial<Record<Locale, PromoFilm>>;

export const heroMedia = {
  available: true,
  loop: {
    webm: '/media/hero-loop.webm',
    mp4: '/media/hero-loop.mp4',
  },
  poster: '/media/hero-poster.jpg',
  /** Same frame as WebP (derived from the poster): the LCP image on phones is ~11 KB instead of 52 KB. */
  posterSrcSet: '/media/hero-poster-768.webp 768w, /media/hero-poster-1280.webp 1280w',
  /** The hero frame is at most max-w-xl (36rem) wide. */
  posterSizes: '(min-width: 640px) 36rem, 100vw',
  /**
   * Full promo shown in the "Watch 60 seconds" modal (S10's film, per locale).
   * null hides the button. Nothing downloads until the modal opens.
   */
  promoVideo: {
    he: { src: '/media/promo-he-720.mp4', poster: '/media/promo-poster-he.jpg' },
    en: { src: '/media/promo-en-720.mp4', poster: '/media/promo-poster-en.jpg' },
  } as PromoSources | null,
  /**
   * 9:16 phone loop (W3-06b). Phones (below `sm`) get only these files — never
   * the 16:9 loop too. null = phones show the legible HeroMatch mock.
   *
   * SHIP GATE (conductor, 7.11): one figure set across the site. The first S10
   * cut (hero-loop-9x16.*) shows "₪760 · 1.8%", a second month figure, so it
   * must not ship. phoneLoop stays null until S10's re-render from
   * sampleMonth.ts (₪2,250 · 1.5%, "ממתין להחלטה שלך" ₪910) lands and its files
   * are added to APPROVED_PHONE_LOOP_FILES. If that isn't on #293 by Wed 11.11
   * 12:00 IL, Thursday ships with null. A unit test enforces both.
   */
  phoneLoop: null as null | { webm: string; mp4: string; poster: string },
  /** English hero loop (same motion, English dashboard + callouts); Hebrew is the default above. */
  loopEn: {
    webm: '/media/hero-loop-en.webm',
    mp4: '/media/hero-loop-en.mp4',
    poster: '/media/hero-poster-en.jpg',
    posterSrcSet: '/media/hero-poster-en-768.webp 768w, /media/hero-poster-en-1280.webp 1280w',
  },
} as const;

export type HeroMedia = typeof heroMedia;

/**
 * Phone-loop files rendered from the ONE sample month (sampleMonth.ts) and
 * approved to ship. Empty until S10's re-render lands; the first cut
 * (hero-loop-9x16.*, ₪760 · 1.8%) is deliberately NOT here.
 */
export const APPROVED_PHONE_LOOP_FILES: readonly string[] = [];

/** Below Tailwind's `sm` (640px): the phone cut. */
export const PHONE_MEDIA = '(max-width: 639.98px)';

/**
 * Which loop a viewport plays: one set of sources, never both (page weight).
 * Pure, so the unit test pins the choice.
 */
export function loopSourcesFor(
  isPhone: boolean,
  desk: { webm: string; mp4: string },
  phone: { webm: string; mp4: string } | null,
): { webm: string; mp4: string } {
  return isPhone && phone
    ? { webm: phone.webm, mp4: phone.mp4 }
    : { webm: desk.webm, mp4: desk.mp4 };
}

/** The hero loop + poster for this viewer's language (Hebrew is the default). */
export function heroLoopFor(locale: Locale) {
  if (locale === 'en') return heroMedia.loopEn;
  return { ...heroMedia.loop, poster: heroMedia.poster, posterSrcSet: heroMedia.posterSrcSet };
}

/** The promo for this viewer's language (Hebrew cut as fallback), or null (button hidden). */
export function promoVideoFor(locale: Locale): PromoFilm | null {
  const films = heroMedia.promoVideo;
  return films?.[locale] ?? films?.he ?? null;
}
