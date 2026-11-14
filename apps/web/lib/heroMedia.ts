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
   *
   * The #320 review-fix render of the sample-month films: only the ONE sample month
   * (₪2,250 · 1.5% of ₪150,000 · ₪910 incl. the ₪104.80 keg · ₪720 · Value ₪2,250 / ₪1,530 /
   * ₪720), a "דוגמה · מספרים להמחשה" tag on every frame, a ₪-free receiver beat, no URL. Pinned
   * by SHA-256 in APPROVED_MEDIA_FILES; the ₪760 cut and #318's cut are in REJECTED_PROMO_SHA256.
   * The 16:9 film is offered on sm+ only (page.tsx) until a 9:16 cut exists.
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
   * sampleMonth.ts (S10 @84532705) reuses the same file names, so the gate
   * pins file CONTENT: every /media file this module references must match a
   * SHA-256 in APPROVED_MEDIA_FILES (unit test). Set to null to fall back to
   * HeroMatch on phones. The cut is Hebrew-only: phoneLoopFor('en') is null.
   */
  phoneLoop: {
    webm: '/media/hero-loop-9x16.webm',
    mp4: '/media/hero-loop-9x16.mp4',
    poster: '/media/hero-poster-9x16.jpg',
    /** Same frame as WebP (S10 #318, Q4): 18–21 KB instead of the 53 KB JPEG on phones. */
    posterSrcSet: '/media/hero-poster-9x16-540.webp 540w, /media/hero-poster-9x16-810.webp 810w',
  } as null | { webm: string; mp4: string; poster: string; posterSrcSet?: string },
  /** The 9:16 frame fills the phone's width (below `sm`). */
  phonePosterSizes: '100vw',
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
 * Hero media approved to ship, by content (path → SHA-256 of the file under
 * public/). EVERY /media path referenced above (loops, posters, srcSet WebPs,
 * the phone cut, the promo once re-enabled) must be here (SEC-2 gate). Only
 * renders of the ONE sample month (sampleMonth.ts) go here, after a frame
 * check. A re-render with new bytes needs a new entry.
 */
export const APPROVED_MEDIA_FILES: Readonly<Record<string, string>> = {
  // S10 @84532705 9:16 — frames checked at 2 s / 8 s / 11 s + poster. Figures:
  // ₪2,250 · 1.5% · ₪910 · ₪720, plus the one line-level example
  // "לדוגמה: בירה מהחבית · ₪104.80" (a gap inside the ₪910; see sampleMonth.ts).
  '/media/hero-loop-9x16.webm': 'bb92915b36d7085ea3d4a8d7a55345005a778a7617d39a272d341c2811b7201c',
  '/media/hero-loop-9x16.mp4': '88dc84c95091048fa7f97fa6424961075a76a63c7045712c87d153c27b3c7b13',
  '/media/hero-poster-9x16.jpg': 'a1f903849a393dceb26ce3ec936b9342a438fd4aadd0a5ceecd190cdbbd7530f',
  // S10 @84532705 16:9 he + en loops and their posters (re-rendered from the same sample month).
  '/media/hero-loop.webm': '0118fcdb113ee8dbe4edac62485d8e97cdd4639fd097a2a2d0d82a9a1d825633',
  '/media/hero-loop.mp4': '10e102a7fa0bbc4b6df7390cf280ffc66a9476ea406e44b708026bd7d0158e8c',
  '/media/hero-poster.jpg': 'a101cfc30508c613fd994d7cfe9b420efa3256cc29af541f34f1730d38b48553',
  '/media/hero-poster-768.webp': 'cd090087ba618ca7f7f3d86742d71342f04c4ef93745d8839c5e849de8fdf19a',
  '/media/hero-poster-1280.webp': '54b4e696bd0e9851cbcae5e7c83ab54c9e3993021dc7a43ff20febbee47f5566',
  '/media/hero-loop-en.webm': '55e0bceef798099dd17394a17b19e2da955136d63bf1d85447a70d8d461b7d9b',
  '/media/hero-loop-en.mp4': '34923b49ce9c58cb685be071b2dc592c9754cd071e35dc0b44204382dc94fe51',
  '/media/hero-poster-en.jpg': '7e717404e6daab01d8eb41e6f90dcefa01ed6d96c626cfe578f67fdcb9fc55e2',
  '/media/hero-poster-en-768.webp': 'ef5302c39d0b016a897ea8c56814908742c4932fbdd8c5057ce837ab6182e373',
  '/media/hero-poster-en-1280.webp': '411276b88384dbf16ee45b42a3e5859c1db50141996f439b22bf6c94ca18d96f',
  // S10 #318 @b0937588 9:16 poster WebPs (540×960, 810×1440) — same frame as hero-poster-9x16.jpg.
  '/media/hero-poster-9x16-540.webp': '3b451f8fc3f98b37a1dab53f57192be0fea5f59dc3f5a50e1104da31222615fe',
  '/media/hero-poster-9x16-810.webp': '0f014686e33de7f7ceca2108b69e10e45ee4675b61b9da9cd41e63b9d9b46b5b',
  // #320 review-fix re-render, round 2 (14.11: end card = the real CTA, ₪720 T2, stamps readable), from the sample month only. Frame gate
  // (tools/promo/scripts/frame-check.mjs, he + en): DOM probe every 2 s + every 0.2 s through the
  // receiver beat (33.2–40.9 s) + the poster — Sample tag on every frame, NO ₪ in the receiver beat
  // (drawn screen: quantities and states only), no URL; pixel check of the tag on every 2 s grab of
  // the files below and on the posters. ₪ at the visual left in Hebrew; "פער" for undecided money.
  '/media/promo-he-720.mp4': '40d41107df594f9981b96a33d4edee0b7216e5ba5a0372f9b9a27668327cf00d',
  '/media/promo-en-720.mp4': '0547675725d511e50851de8d3c180ff842868ad9b5d75a5c8ec3c80749dca83e',
  '/media/promo-poster-he.jpg': 'e496b602babd00b2f49b3f7b3606f1e7f100cbd735db775a0aed2833643ebfb4',
  '/media/promo-poster-en.jpg': '67f0bcaec1c8d3b69f0268c027616940e8b0ce1ef81a1b30b108d413a68b1056',
};

/** SHA-256 of rejected promo films + posters (the ₪760 cut, and #318's demo-seed receiver beat): never approvable. */
export const REJECTED_PROMO_SHA256: readonly string[] = [
  '1d1f29db6aeb61c5d3b79bb5e55fbf3c03ddfcb7d08eebe38b40c0d53c84b8ca', // promo-he-720.mp4
  '40e10c1ba04c34edfd2399367072331adce274ed0713895bb44442ac5c0011b1', // promo-en-720.mp4
  '217e3fac676b1508fa7c1b3b9a72587c7337e4b8e047ea9238bc4cbb5f8db344', // promo-poster-he.jpg
  'aa259ecffc5e4265e0e1ec4213fa759f4c892556cd1538f0b9337041886a54f5', // promo-poster-en.jpg
  // #318 @b0937588 cut, blocked in #320 review (14.11): its receiver beat (33–41 s) showed demo-seed
  // screenshots with a second figure set (₪17.05 · lettuce ₪90.00/₪97.20 · peppers, "כפר הזיתים"),
  // "ההפסד המוערך" on undecided money, and ₪ on both sides of the number in Hebrew.
  'fa83db83faf08b103d460b31eaa3e4254f2c588c3f13ead9460ef0cd711e6f4c', // promo-he-720.mp4
  '2f39a99aaa3f17e4a744171eec9b4dc80fb5fd805adad20e5cb4f2913833dfe4', // promo-en-720.mp4
  '8cc67ef4525a82c229be95a172b57bf4f2f4ac572030eaa5281b4b32dff38aed', // promo-poster-he.jpg
  'c4fd861f83dba2d22f5b60be0944c758fe5175c05ce22b5ac0d438deeed4de04', // promo-poster-en.jpg
  // #320 @7e55012f round-1 render — superseded (end card said "תאמו הדגמה קצרה" ≠ the dialog's CTA).
  'c8b807c893f37a91368588ad70f823244a46d2446fa9fc4f38e17b7bb8ded6f0', // promo-he-720.mp4
  '88304eef45d9601377a92efc407b32356bde33427b3a05e38e316e94f53bcf1a', // promo-en-720.mp4
  '7390e09750e9be1edf8e402e636c3e16d33faf430937ce3b7e3139bfe521fa2d', // promo-poster-he.jpg
  '92570bbb49650a52c6b58b41723c250b1ba9083c6796b3cd5a97a51c16968614', // promo-poster-en.jpg
];

/**
 * Every /media path heroMedia references (srcSet entries included), so the
 * SHA gate can't miss a file that a later edit adds.
 */
export function referencedMediaPaths(media: HeroMedia = heroMedia): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const part of v.split(',')) {
        const path = part.trim().split(/\s+/)[0];
        if (path?.startsWith('/media/')) out.add(path);
      }
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(media);
  return [...out].sort();
}

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

/**
 * The 9:16 phone cut for this viewer's language. The cut is Hebrew-only, so
 * English phones get null → the localized HeroMatch mock (conductor Q1).
 */
export function phoneLoopFor(locale: Locale): HeroMedia['phoneLoop'] {
  return locale === 'he' ? heroMedia.phoneLoop : null;
}

/** The promo for this viewer's language (Hebrew cut as fallback), or null (button hidden). */
export function promoVideoFor(locale: Locale): PromoFilm | null {
  const films = heroMedia.promoVideo;
  return films?.[locale] ?? films?.he ?? null;
}

/**
 * Replace every <source> child of `video` with `pairs` (src, type), in order,
 * and return the new elements. Idempotent, so an effect that re-runs (locale
 * switch → router.refresh) never stacks a stale source ahead of the new one.
 */
export function replaceVideoSources(
  video: Pick<HTMLVideoElement, 'querySelectorAll' | 'appendChild' | 'ownerDocument'>,
  pairs: ReadonlyArray<readonly [src: string, type: string]>,
): HTMLSourceElement[] {
  video.querySelectorAll('source').forEach((s) => s.remove());
  return pairs.map(([src, type]) => {
    const s = video.ownerDocument.createElement('source');
    s.src = src;
    s.type = type;
    video.appendChild(s);
    return s;
  });
}
