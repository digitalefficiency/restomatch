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
   * SHIP GATE (conductor, 7.11): one figure set across the site. S10's first
   * cut showed "₪760 · 1.8%" and never shipped; the re-render from
   * sampleMonth.ts (S10 @84532705: ₪2,250 · 1.5% · "ממתין להחלטה שלך" ₪910 ·
   * בקשות זיכוי ₪720) reuses the same file names, so the gate pins file
   * CONTENT: every file here must match a SHA-256 in APPROVED_PHONE_LOOP_FILES
   * (unit test). Set to null to fall back to HeroMatch on phones.
   */
  phoneLoop: {
    webm: '/media/hero-loop-9x16.webm',
    mp4: '/media/hero-loop-9x16.mp4',
    poster: '/media/hero-poster-9x16.jpg',
  } as null | { webm: string; mp4: string; poster: string },
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
 * Phone-loop renders approved to ship, by content (path → SHA-256 of the file
 * under public/). Only renders of the ONE sample month (sampleMonth.ts) go
 * here, after a frame check. A re-render with new bytes needs a new entry.
 */
export const APPROVED_PHONE_LOOP_FILES: Readonly<Record<string, string>> = {
  // S10 @84532705 — frames checked at 2 s / 8 s / 11 s + poster: ₪2,250 · 1.5% · ₪910 · ₪720 only.
  '/media/hero-loop-9x16.webm': 'bb92915b36d7085ea3d4a8d7a55345005a778a7617d39a272d341c2811b7201c',
  '/media/hero-loop-9x16.mp4': '88dc84c95091048fa7f97fa6424961075a76a63c7045712c87d153c27b3c7b13',
  '/media/hero-poster-9x16.jpg': 'a1f903849a393dceb26ce3ec936b9342a438fd4aadd0a5ceecd190cdbbd7530f',
};

/** SHA-256 of S10's first 9:16 cut (₪760 · 1.8%, a second figure set): never approvable. */
export const REJECTED_PHONE_LOOP_SHA256: readonly string[] = [
  '8a0632b620193cd3af01d51a5a75c9b49f85283e47f7f47fee8b7661932ac7d7',
  '5b4cf5e2cfccb6422ecaf8aa3e198c013f72e81a216e3ff46e46bb411ed5a4ed',
  '8c309485c7e610c4c8fb914394ec790e66e9ad1bac21753284c635e7c9f18bcf',
];

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
