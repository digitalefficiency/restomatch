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
   * The English cut isn't produced yet, so English viewers get the Hebrew film
   * (no 404) — add `en: { src: '/media/promo-en-720.mp4', poster: '/media/promo-poster-en.jpg' }`
   * when S10 delivers it. null hides the button. Nothing downloads until the modal opens.
   */
  promoVideo: {
    he: { src: '/media/promo-he-720.mp4', poster: '/media/promo-poster-he.jpg' },
  } as PromoSources | null,
} as const;

export type HeroMedia = typeof heroMedia;

/** The promo for this viewer's language (Hebrew cut as fallback), or null (button hidden). */
export function promoVideoFor(locale: Locale): PromoFilm | null {
  const films = heroMedia.promoVideo;
  return films?.[locale] ?? films?.he ?? null;
}
