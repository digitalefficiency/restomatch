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

/** Web-optimized promo (≈60 s, 720p, ~6–8 MB) per locale. */
export type PromoSources = Partial<Record<Locale, string>>;

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
   * Full promo shown in the "Watch 60 seconds" modal, per locale (S10's v2 film).
   * null — or no file for the viewer's locale — hides the button (the live-demo
   * link shows instead). Nothing downloads until the modal opens.
   * When S10's files land in public/media/, set:
   *   promoVideo: { he: '/media/promo-he-720.mp4', en: '/media/promo-en-720.mp4' },
   */
  promoVideo: null as PromoSources | null,
} as const;

export type HeroMedia = typeof heroMedia;

/** The promo for this viewer's language, or null (button hidden). */
export function promoVideoFor(locale: Locale): string | null {
  return heroMedia.promoVideo?.[locale] ?? null;
}
