import React from 'react';
import { AbsoluteFill, Composition, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { loadFonts } from './fonts';
import { applyFacts, COPY, Facts, Locale } from './copy';
import { C, FONT, setStage } from './theme';
import { Background } from './components/Background';
import { Hook } from './scenes/Hook';
import { Problem } from './scenes/Problem';
import { Match } from './scenes/Match';
import { Product, PRODUCT_DURATION } from './scenes/Product';
import { Receiver, RECEIVER_DURATION } from './scenes/Receiver';
import { Value } from './scenes/Value';
import { Cta } from './scenes/Cta';
import { HeroLoop, HERO_LOOP_FRAMES } from './scenes/HeroLoop';
import { HeroLoopVertical } from './scenes/HeroLoopVertical';
import { PhoneDash, PHONE_DASH_DURATION } from './scenes/PhoneDash';

loadFonts();

type Props = { locale: Locale; facts?: Partial<Facts>; light?: boolean };

/** Crossfade wrapper: every scene fades in/out over 8 frames on top of its own motion. */
const Shell: React.FC<{ d: number; children: React.ReactNode }> = ({ d, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, d - 8, d], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

type Beat = { from: number; d: number; el: (l: Locale) => React.ReactNode };

// Main film timeline (30 fps). Overlaps of ~8 frames = crossfades.
const RECEIVER_FROM = 986; // overlaps the laptop exit — no empty frame
// no chains beat: the site's sample month has no branch figures
const VALUE_FROM = RECEIVER_FROM + RECEIVER_DURATION - 8;
export const TIMELINE: Beat[] = [
  { from: 0, d: 180, el: (l) => <Hook locale={l} /> },
  { from: 172, d: 206, el: (l) => <Problem locale={l} /> },
  { from: 368, d: 82, el: (l) => <Match locale={l} /> },
  { from: 440, d: PRODUCT_DURATION, el: (l) => <Product locale={l} /> },
  { from: RECEIVER_FROM, d: RECEIVER_DURATION, el: (l) => <Receiver locale={l} /> },
  { from: VALUE_FROM, d: 1646 - VALUE_FROM, el: (l) => <Value locale={l} duration={1646 - VALUE_FROM} /> },
  { from: 1638, d: 162, el: (l) => <Cta locale={l} /> },
];
export const PROMO_FRAMES = 1800;

const VERTICAL: Beat[] = [
  { from: 0, d: 170, el: (l) => <Hook locale={l} /> },
  { from: 162, d: PHONE_DASH_DURATION, el: (l) => <PhoneDash locale={l} /> },
  { from: 162 + PHONE_DASH_DURATION - 8, d: RECEIVER_DURATION, el: (l) => <Receiver locale={l} /> },
  { from: 162 + PHONE_DASH_DURATION + RECEIVER_DURATION - 16, d: 200, el: (l) => <Value locale={l} duration={200} /> },
];
const VLAST = VERTICAL[VERTICAL.length - 1];
export const VERTICAL_FRAMES = VLAST.from + VLAST.d - 8 + 130;
VERTICAL.push({ from: VLAST.from + VLAST.d - 8, d: 130, el: (l) => <Cta locale={l} /> });

const Film: React.FC<Props & { beats: Beat[] }> = ({ locale, beats }) => (
  <AbsoluteFill style={{ background: C.bgDeep }}>
    <Background period={600} />
    {beats.map((b, i) => (
      <Sequence key={i} from={b.from} durationInFrames={b.d} layout="none">
        <Shell d={b.d}>{b.el(locale)}</Shell>
      </Sequence>
    ))}
  </AbsoluteFill>
);

// `facts` input prop overrides the demo numbers (copy.ts FACTS) for a re-render after a seed change.
// `light` (default true — the product's light identity) picks the stage palette; light:false = dark stage.
/** A legible "דוגמה / Sample" tag for the whole film: every figure is the site's sample month. */
const SampleTag: React.FC<{ locale: Locale }> = ({ locale }) => (
  <div
    dir={locale === 'he' ? 'rtl' : 'ltr'}
    style={{
      position: 'absolute',
      top: 54,
      [locale === 'he' ? 'left' : 'right']: 96, // the device side: the caption zone stays clear
      fontFamily: FONT.sans,
      fontSize: 26,
      fontWeight: 700,
      color: C.gold,
      background: '#FFFFFF',
      border: `1.5px solid ${C.gold}66`,
      borderRadius: 999,
      padding: '8px 22px',
      boxShadow: '0 6px 18px rgba(15,31,23,0.08)',
    }}
  >
    {COPY[locale].sampleTag}
  </div>
);

const Promo: React.FC<Props> = ({ locale, facts, light }) => {
  setStage(light ?? true);
  applyFacts(facts);
  return (
    <AbsoluteFill>
      <Film locale={locale} beats={TIMELINE} />
      <SampleTag locale={locale} />
    </AbsoluteFill>
  );
};
const PromoVertical: React.FC<Props> = ({ locale, facts, light }) => {
  setStage(light ?? true);
  applyFacts(facts);
  return <Film locale={locale} beats={VERTICAL} />;
};
const Loop: React.FC<Props> = ({ locale, facts, light }) => {
  setStage(light ?? true);
  applyFacts(facts);
  return <HeroLoop locale={locale} light={light ?? true} />;
};

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ locale: 'he' as Locale }} />
    <Composition
      id="PromoVertical"
      component={PromoVertical}
      durationInFrames={VERTICAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ locale: 'he' as Locale }}
    />
    <Composition id="HeroLoop" component={Loop} durationInFrames={HERO_LOOP_FRAMES} fps={30} width={1280} height={720} defaultProps={{ locale: 'he' as Locale }} />
    <Composition id="HeroLoopVertical" component={HeroLoopVertical} durationInFrames={HERO_LOOP_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
