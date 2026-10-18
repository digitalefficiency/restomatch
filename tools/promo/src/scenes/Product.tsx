import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, prog } from '../theme';
import { Laptop, laptopScreen, Screen } from '../components/Devices';
import { Chip, Eyebrow, FadeUp, LightSweep, RiseLine } from '../components/primitives';

// Keyframed virtual camera. u = units of screenshot width (x and y), so the
// same numbers work at any laptop size. Values come from the captured shots.
type Key = { f: number; zoom: number; ux: number; uy: number; scroll: number; rx: number; ry: number };

const FOCUS = {
  he: { hero: [0.8, 0.385], tiles: [0.6, 0.4], beer: [0.62, 0.53], claim: [0.5, 0.33] },
  en: { hero: [0.2, 0.34], tiles: [0.4, 0.35], beer: [0.4, 0.48], claim: [0.5, 0.33] },
} as const;

const SCREENS = [
  { key: 'dashboard', from: 0 },
  { key: 'leaks', from: 196 },
  { key: 'approvals', from: 312 },
  { key: 'claims', from: 424 },
] as const;

export const PRODUCT_DURATION = 556;

export const Product: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].product;
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const side = isRtl ? -1 : 1; // laptop sits on the side opposite the copy
  const F = FOCUS[locale];

  const W = 1180;
  const { w: sw, h: sh } = laptopScreen(W);
  const bezel = Math.round(W * 0.016);
  const lidH = sh + bezel * 2;

  const ry0 = 14 * side; // turned toward the copy
  const keys: Key[] = [
    { f: 0, zoom: 0.78, ux: 0.5, uy: 0.3125, scroll: 0, rx: 46, ry: ry0 * 2.2 },
    { f: 40, zoom: 1, ux: 0.5, uy: 0.3125, scroll: 0, rx: 8, ry: ry0 },
    { f: 72, zoom: 1.02, ux: 0.5, uy: 0.3125, scroll: 0, rx: 6, ry: ry0 * 0.8 },
    { f: 108, zoom: 2.15, ux: F.hero[0], uy: F.hero[1], scroll: 0, rx: 0, ry: 0 },
    { f: 168, zoom: 2.25, ux: F.hero[0], uy: F.hero[1], scroll: 0, rx: 0, ry: -2 * side },
    { f: 200, zoom: 1, ux: 0.5, uy: 0.3125, scroll: 0, rx: 6, ry: ry0 * 0.7 },
    { f: 214, zoom: 1, ux: 0.5, uy: 0.3125, scroll: 0, rx: 6, ry: ry0 * 0.7 },
    { f: 246, zoom: 1.75, ux: F.tiles[0], uy: F.tiles[1], scroll: 0, rx: 2, ry: 0 },
    { f: 292, zoom: 1.85, ux: F.beer[0], uy: F.beer[1], scroll: 0, rx: 0, ry: 2 * side },
    { f: 316, zoom: 1, ux: 0.5, uy: 0.3125, scroll: 0, rx: 6, ry: ry0 * 0.6 },
    { f: 330, zoom: 1.12, ux: 0.5, uy: 0.3125, scroll: 0, rx: 5, ry: ry0 * 0.5 },
    { f: 418, zoom: 1.12, ux: 0.5, uy: 0.3125, scroll: 0.5, rx: 5, ry: ry0 * 0.5 },
    { f: 428, zoom: 1, ux: 0.5, uy: 0.3125, scroll: 0, rx: 6, ry: ry0 * 0.6 },
    { f: 470, zoom: 1.55, ux: F.claim[0], uy: F.claim[1], scroll: 0, rx: 2, ry: 0 },
    { f: 520, zoom: 1.6, ux: F.claim[0], uy: F.claim[1] + 0.03, scroll: 0, rx: 2, ry: -2 * side },
    { f: 556, zoom: 0.7, ux: 0.5, uy: 0.3125, scroll: 0, rx: 30, ry: -30 * side },
  ];
  let k = 0;
  while (k < keys.length - 2 && f >= keys[k + 1].f) k++;
  const a = keys[k];
  const b = keys[k + 1];
  const p = interpolate(f, [a.f, b.f], [0, 1], { easing: EASE_IN_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const L = (x: number, y: number) => x + (y - x) * p;
  const cam = { zoom: L(a.zoom, b.zoom), ux: L(a.ux, b.ux), uy: L(a.uy, b.uy), scroll: L(a.scroll, b.scroll), rx: L(a.rx, b.rx), ry: L(a.ry, b.ry) };

  // where the focus point should land on stage (zoom 1 → laptop centred on its side)
  const restX = width / 2 + side * 380;
  const restY = height / 2 + 30;
  const zt = Math.min(1, Math.max(0, (cam.zoom - 1) / 1.1)); // 0 at rest → 1 when zoomed
  const targetX = restX + (width / 2 + side * 120 - restX) * zt;
  const targetY = restY + (height / 2 - restY) * zt;
  // focus point in laptop-local px (laptop centre = origin)
  const scrollPx = cam.scroll * sw;
  const px = bezel + cam.ux * sw - W / 2;
  const py = bezel + cam.uy * sw - scrollPx - lidH / 2;
  const tx = targetX - width / 2 - cam.zoom * px;
  const ty = targetY - height / 2 - cam.zoom * py;

  const enter = prog(f, 0, 40);
  const exit = prog(f, 528, 556, EASE_IN);

  // which screen + wipe
  let si = 0;
  SCREENS.forEach((s, i) => {
    if (f >= s.from) si = i;
  });
  const shots = SCREENS.map((s) => {
    const name = s.key === 'dashboard' ? `dashboard-${locale}-full` : `${s.key}-${locale}`;
    return `shots/${name}.png`;
  });
  const wipe = si > 0 ? prog(f, SCREENS[si].from, SCREENS[si].from + 16, EASE_IN_OUT) : 1;

  // focus-pull amounts (blur outside the window) per beat
  const focusAmt =
    prog(f, 92, 116) * (1 - prog(f, 168, 186)) + prog(f, 236, 256) * (1 - prog(f, 300, 314)) + prog(f, 462, 480) * (1 - prog(f, 524, 540));
  const focusU = f < 200 ? F.hero : f < 316 ? (f < 270 ? F.tiles : F.beer) : F.claim;
  const focus = {
    x: focusU[0] * sw,
    y: focusU[1] * sw - scrollPx,
    r: f < 200 ? 420 : f < 316 ? 760 : 900,
    amount: focusAmt,
  };

  // blur the demo login e-mail in the app header ("owner@kfar-hazeitim.test")
  const redact = [isRtl ? { y: 0.027, h: 0.013, x: 0.72, w: 0.21 } : { y: 0.027, h: 0.013, x: 0.075, w: 0.21 }];

  const screenContent = (
    <>
      {si > 0 ? <Screen src={shots[si - 1]} width={sw} redact={redact} /> : null}
      <Screen
        src={shots[si]}
        width={sw}
        scroll={scrollPx}
        redact={redact}
        focus={focus}
        clip={si > 0 ? (isRtl ? `inset(0 0 0 ${(1 - wipe) * 100}%)` : `inset(0 ${(1 - wipe) * 100}% 0 0)`) : undefined}
      />
      {si > 0 && wipe < 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 6,
            [isRtl ? 'left' : 'right']: `${(1 - wipe) * 100}%`,
            background: C.primary,
            boxShadow: `0 0 40px 10px ${C.primary}88`,
          }}
        />
      ) : null}
    </>
  );

  // copy blocks per beat: [title, sub, in, out]
  const beats: [string, string, number, number][] = [
    [t.heroTitle, t.heroSub, 44, 186],
    [t.heatTitle, t.heatSub, 214, 300],
    [t.apprTitle, t.apprSub, 326, 410],
    [t.claimTitle, t.claimSub, 438, 520],
  ];

  return (
    <AbsoluteFill style={{ perspective: 2200, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: width / 2 - W / 2,
          top: height / 2 - lidH / 2,
          width: W,
          transform: `translate(${tx}px, ${ty + (1 - enter) * 500}px) scale(${cam.zoom}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`,
          transformStyle: 'preserve-3d',
          opacity: enter * (1 - exit),
          filter: `blur(${(1 - enter) * 10 + exit * 8}px)`,
        }}
      >
        <Laptop width={W} glare={cam.ry / 20}>
          {screenContent}
        </Laptop>
      </div>

      {/* scrim behind the copy */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(${isRtl ? 270 : 90}deg, rgba(8,16,12,0.96) 0%, rgba(8,16,12,0.9) 30%, rgba(8,16,12,0.55) 40%, transparent 50%)`,
          opacity: 0.75 + 0.25 * zt,
        }}
      />

      <div
        dir={dir}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [isRtl ? 'right' : 'left']: 110,
          width: 600,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          fontFamily: FONT.sans,
          color: C.ink,
        }}
      >
        <FadeUp at={30} out={528}>
          <div style={{ marginBottom: 28, color: C.subtle, fontSize: 22, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 9, background: C.primary, boxShadow: `0 0 10px ${C.primary}` }} />
            {t.realUi}
          </div>
        </FadeUp>
        <div style={{ position: 'relative', minHeight: 330 }}>
          {beats.map(([title, sub, at, out], i) =>
            f >= at - 2 && f <= out + 20 ? (
              <div key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
                <Eyebrow>{`0${i + 1}`}</Eyebrow>
                <RiseLine at={at} out={out} style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 18 }}>
                  {title}
                </RiseLine>
                <FadeUp at={at + 10} out={out}>
                  <div style={{ fontSize: 34, color: C.muted, marginTop: 22, lineHeight: 1.35, fontWeight: 400 }}>{sub}</div>
                </FadeUp>
              </div>
            ) : null,
          )}
        </div>
      </div>

      {/* callouts (stage space, next to the focus target) */}
      <div
        dir={dir}
        style={{
          position: 'absolute',
          left: width / 2 + side * 120,
          top: height / 2,
          transform: 'translate(-50%, -50%)',
          width: 0,
          height: 0,
        }}
      >
        {/* dashboard hero */}
        <FadeUp at={118} out={170} style={{ position: 'absolute', top: -300, [isRtl ? 'right' : 'left']: -60 }}>
          <Chip accent={C.danger} big>
            <span>{t.chipLeak}</span>
            <span style={{ color: C.danger, fontWeight: 800 }}>
              <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.leak, locale)}</bdi>
            </span>
          </Chip>
        </FadeUp>
        <FadeUp at={128} out={170} style={{ position: 'absolute', top: 210, [isRtl ? 'right' : 'left']: -60 }}>
          <Chip accent={C.primary}>
            <bdi dir="ltr" style={{ fontWeight: 800 }}>{FACTS.leakPct}</bdi>
            <span>{t.chipPct}</span>
          </Chip>
        </FadeUp>
        <FadeUp at={138} out={170} style={{ position: 'absolute', top: 290, [isRtl ? 'right' : 'left']: -60 }}>
          <Chip accent={C.gold}>
            <span>{t.chipCaught}</span>
            <span style={{ color: C.gold, fontWeight: 800 }}>
              <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.caught, locale)}</bdi>
            </span>
          </Chip>
        </FadeUp>
        {/* heatmap */}
        <FadeUp at={272} out={302} style={{ position: 'absolute', top: 120, [isRtl ? 'right' : 'left']: -40 }}>
          <Chip accent={C.danger} big>
            <bdi dir={dir}>{t.chipBeer.replace('{from}', ilsText(FACTS.beerFrom, locale)).replace('{to}', ilsText(FACTS.beerTo, locale))}</bdi>
          </Chip>
        </FadeUp>
        {/* approvals */}
        <FadeUp at={344} out={410} style={{ position: 'absolute', top: -330, [isRtl ? 'right' : 'left']: -40 }}>
          <Chip accent={C.gold} big>
            {t.chipAppr}
          </Chip>
        </FadeUp>
        {/* claims */}
        <FadeUp at={482} out={524} style={{ position: 'absolute', top: 230, [isRtl ? 'right' : 'left']: -60 }}>
          <Chip accent={C.primary} big>
            <span>{t.chipClaim}</span>
            <span style={{ color: C.primary, fontWeight: 800 }}>
              <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.claimed, locale)}</bdi>
            </span>
          </Chip>
        </FadeUp>
      </div>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <LightSweep at={110} dur={34} opacity={0.12} width={10} />
      </div>
    </AbsoluteFill>
  );
};
