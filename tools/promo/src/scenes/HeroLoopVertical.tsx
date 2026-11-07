import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, ilsText, SAMPLE } from '../copy';
import { FONT, LIGHT } from '../theme';
import { Background } from '../components/Background';
import { Chip } from '../components/primitives';
import { SampleHeroCard, SampleNeedsCard } from '../components/SampleCards';
import { HERO_LOOP_FRAMES } from './HeroLoop';

/**
 * Portrait (9:16) landing hero loop for phones, Hebrew / light. It shows the site's sample month
 * (copy.ts SAMPLE = sampleMonth.ts) as two product-style cards drawn at about phone scale, so the
 * text is legible on a 390 px screen: the leak hero (T1) and "מחכה לך" (T2).
 * Like HeroLoop, every motion is periodic in the 12 s loop, so frame 360 = frame 0.
 */
export const HeroLoopVertical: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY.he;
  const K = LIGHT;
  const ph = (f % HERO_LOOP_FRAMES) / HERO_LOOP_FRAMES;
  const tau = Math.PI * 2;
  const wave = (k: number, amp: number, n = 1) => amp * Math.sin(tau * (ph * n + k));
  const breathe = (k: number) => 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(tau * (ph + k)));

  const cardW = Math.round(width * 0.89); // title-safe: 5.5% each side
  const u = cardW / 384; // product CSS px → output px (≈ native size when shown 390 px wide)
  // scan beam over the hero card, strictly inside the loop (20%–50%)
  const beamT = (ph - 0.2) / 0.3;
  const beamOn = beamT > 0 && beamT < 1;
  // the leak number glows softly once per loop
  const glow = 0.5 + 0.5 * Math.sin(tau * (ph - 0.25));

  return (
    <AbsoluteFill dir="rtl" style={{ background: K.bgDeep, fontFamily: FONT.sans }}>
      <Background period={HERO_LOOP_FRAMES} intensity={0.7} light />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: height * 0.026, paddingBottom: height * 0.035 }}>
        <div style={{ position: 'relative', transform: `translateY(${wave(0, 10)}px)` }}>
          <SampleHeroCard u={u} width={cardW} locale="he" numberGlow={glow} />
          {beamOn ? (
            <div
              style={{
                position: 'absolute',
                left: 24,
                right: 24,
                top: `${8 + beamT * 84}%`,
                height: 3,
                background: `linear-gradient(90deg, transparent, ${K.primary}, transparent)`,
                boxShadow: `0 0 30px 6px ${K.primary}55`,
                opacity: Math.sin(Math.PI * beamT),
              }}
            />
          ) : null}
        </div>
        <div style={{ transform: `translateY(${wave(0.33, 10)}px)` }}>
          <SampleNeedsCard u={u} width={cardW} locale="he" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <div style={{ opacity: breathe(0), transform: `translateY(${wave(0.1, 8, 2)}px)` }}>
            <Chip accent={K.danger} light style={{ fontSize: 38, padding: '16px 32px' }}>
              <span>{t.loopVertical.held}</span>
              <bdi dir="rtl" style={{ color: K.danger, fontWeight: 800 }}>{ilsText(SAMPLE.decide.amount, 'he')}</bdi>
            </Chip>
          </div>
          <div style={{ opacity: breathe(0.5), transform: `translateY(${wave(0.6, 8, 2)}px)` }}>
            <Chip accent={K.primary} light style={{ fontSize: 38, padding: '16px 32px' }}>
              <span>{t.loopVertical.claim}</span>
            </Chip>
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', bottom: height * 0.035, left: width * 0.055, fontSize: 30, color: K.muted, letterSpacing: '0.04em' }}>
        {t.loop.chip}
      </div>
    </AbsoluteFill>
  );
};
