/**
 * Landing-page media (produced by session S10, served from public/media/).
 *
 * `available: false` → the hero shows the animated product mock (HeroMatch);
 * flip to `true` once hero-loop.{webm,mp4} + hero-poster.jpg exist and the hero
 * plays the muted loop instead (poster first, video lazy). `promoVideo: null`
 * hides the "Watch 60 seconds" button; set it to the promo MP4 path to enable
 * the modal. Paths are root-relative so they work behind any origin.
 */
export const heroMedia = {
  available: true,
  loop: {
    webm: '/media/hero-loop.webm',
    mp4: '/media/hero-loop.mp4',
  },
  poster: '/media/hero-poster.jpg',
  /** Full promo (≈60 s) shown in a modal; null hides the button. */
  promoVideo: null as string | null,
} as const;

export type HeroMedia = typeof heroMedia;
