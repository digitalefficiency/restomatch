import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, FONT, LIGHT } from '../theme';
import { Background } from '../components/Background';
import { Laptop, laptopScreen, Screen } from '../components/Devices';
import { Chip } from '../components/primitives';
import { zones } from '../layout';
import { emailStrip } from '../rects';

export const HERO_LOOP_FRAMES = 360; // 12 s @ 30 fps

/**
 * Landing hero loop (for S6): the real dashboard on a slowly orbiting laptop,
 * a scan beam and floating ₪ callouts. EVERY motion is a function of the loop
 * phase (sin/cos of 2π·t, or a window strictly inside the loop), so frame 360
 * equals frame 0 → seamless when the <video> loops.
 */
export const HeroLoop: React.FC<{ locale: Locale; light?: boolean }> = ({ locale, light = true }) => {
  // light stage (default) sits on the light landing; dark stage = the original command-center look
  const K = light ? LIGHT : C;
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale];
  const ph = (f % HERO_LOOP_FRAMES) / HERO_LOOP_FRAMES;
  const tau = Math.PI * 2;
  const s = Math.sin(tau * ph);
  const c = Math.cos(tau * ph);
  const isRtl = locale === 'he';

  const { device, caption } = zones(width, height, locale);
  const W = Math.round(device.w * 0.88);
  const { w: sw } = laptopScreen(W);
  // gentle scroll down and back (periodic)
  const scroll = ((1 - c) / 2) * 0.16 * sw;
  const ry = -9 * s + (isRtl ? 6 : -6);
  const rx = 9 + 2.5 * c;
  const y = 10 * Math.sin(tau * ph * 2);

  // scan beam: crosses the screen once per loop, between 25% and 55% of the loop
  const beamT = (ph - 0.25) / 0.3;
  const beamOn = beamT > 0 && beamT < 1;

  const chip = (k: number) => {
    // each chip floats on its own phase and breathes in/out (periodic)
    const o = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tau * (ph + k / 3)));
    const dy = 8 * Math.sin(tau * (ph * 2 + k / 3));
    return { opacity: o, transform: `translateY(${dy}px)` };
  };
  const focus = { x: (isRtl ? 0.8 : 0.2) * sw, y: (isRtl ? 0.385 : 0.34) * sw - scroll, r: 300, amount: 0 };

  return (
    <AbsoluteFill style={{ background: K.bgDeep }}>
      <Background period={HERO_LOOP_FRAMES} intensity={light ? 0.7 : 0.9} light={light} />
      <div
        style={{
          position: 'absolute',
          left: device.x,
          top: device.y,
          width: device.w,
          height: device.h,
          perspective: 1800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ transform: `translateY(${y + 10}px) rotateX(${rx}deg) rotateY(${ry}deg)`, transformStyle: 'preserve-3d' }}>
          <Laptop width={W} glare={ry / 12} finish={light ? 'silver' : 'dark'}>
            <Screen src={`shots/dashboard-${locale}-full.png`} width={sw} scroll={scroll} focus={focus} redact={[emailStrip(`dashboard-${locale}-full`, isRtl ? { y: 0.027, h: 0.013, x: 0.72, w: 0.21 } : { y: 0.027, h: 0.013, x: 0.075, w: 0.21 })]} />
            {beamOn ? (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${beamT * 100}%`,
                  height: 3,
                  background: `linear-gradient(90deg, transparent, ${K.primary}, transparent)`,
                  boxShadow: `0 0 30px 6px ${K.primary}66`,
                  opacity: Math.sin(Math.PI * beamT),
                }}
              />
            ) : null}
          </Laptop>
        </div>
      </div>
      {/* callouts live in the caption zone only — never over the device (layout.ts) */}
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          position: 'absolute',
          left: caption.x,
          top: caption.y,
          width: caption.w,
          height: caption.h,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          gap: 26,
          fontFamily: FONT.sans,
        }}
      >
        <div style={chip(0)}>
          <Chip accent={K.danger} light={light} style={{ fontSize: 24 }}>
            <span>{t.product.chipLeak}</span>
            <bdi dir={isRtl ? 'rtl' : 'ltr'} style={{ color: K.danger, fontWeight: 800 }}>{ilsText(FACTS.leak, locale)}</bdi>
          </Chip>
        </div>
        <div style={chip(1)}>
          <Chip accent={K.primary} light={light} style={{ fontSize: 24 }}>
            <bdi dir="ltr" style={{ fontWeight: 800 }}>{FACTS.leakPct}</bdi>
            <span>{t.product.chipPct}</span>
          </Chip>
        </div>
        <div style={chip(2)}>
          <Chip accent={K.gold} light={light} style={{ fontSize: 24 }}>
            <span>{t.product.chipCaught}</span>
            <bdi dir={isRtl ? 'rtl' : 'ltr'} style={{ color: K.gold, fontWeight: 800 }}>{ilsText(FACTS.caught, locale)}</bdi>
          </Chip>
        </div>
      </div>
      <div dir={isRtl ? 'rtl' : 'ltr'} style={{ position: 'absolute', inset: 0, fontFamily: FONT.sans, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            [isRtl ? 'left' : 'right']: 24,
            fontSize: 15,
            color: light ? LIGHT.muted : C.subtle,
            letterSpacing: '0.04em',
          }}
        >
          {t.loop.chip}
        </div>
      </div>
      <div style={{ width, height }} />
    </AbsoluteFill>
  );
};
