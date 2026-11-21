// The owner home's leak card (DS3-03). The pace line and the split bar are the shared ones in
// `lib/components/data-viz` (PaceLine, SplitBar, PACE_BOX, PaceSeries): import them from there.
export { LeakHero, HeroNote } from './LeakHero';
export type { LeakHeroLink, LeakHeroPart, LeakHeroProps } from './LeakHero';
export { HeroAmount } from './HeroAmount';
export type { HeroAmountProps } from './HeroAmount';
export { HeroFold, useFold, useHeroFoldOpen, useHeroFoldOpened } from './HeroFold';
export type { Fold } from './HeroFold';
export { PacePlaceholder } from './PacePlaceholder';
export {
  DAY_MS,
  HERO_CTA_CLASS,
  HERO_ENTRY_CSS,
  HERO_HOLD_ANIMATION,
  SPLIT_MIN_AGOROT,
  THIN_BASE_INVOICES,
  agorotOf,
  bucketDayIndex,
  calcRowsGuard,
  cubicBezier,
  daySpan,
  heroCtaVariant,
  heroDelta,
  heroMonthKey,
  heroSplitForm,
  leakHeroState,
  leakSplit,
  msOf,
  paceSeries,
  parseCubicBezier,
  showsPct,
  todayDayIndex,
} from './model';
export type {
  CalcReport,
  DeltaDirection,
  HeroCtaVariant,
  HeroDelta,
  HeroFigures,
  HeroSplitForm,
  LeakHeroState,
  PaceInput,
  PacePeriod,
  PacePoint,
} from './model';
