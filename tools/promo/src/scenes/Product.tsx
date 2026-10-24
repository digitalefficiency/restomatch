import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, prog } from '../theme';
import { zones } from '../layout';
import { Laptop, laptopScreen, Screen } from '../components/Devices';
import { CaptionZone, Callout, DeviceZone, Spotlight } from '../components/Stage';
import { Eyebrow, FadeUp, RiseLine } from '../components/primitives';
import { autoScroll, emailStrip, rectFor } from '../rects';

// Focus rects (units of screenshot width; x0,y0,x1,y1) measured on the captures in public/shots.
type U = [number, number, number, number];
const FOCUS: Record<Locale, Record<'hero' | 'beer' | 'appr' | 'claim', U>> = {
  // beer = product → change columns of the leak-detective row; claim = amount column + total line
  he: { hero: [0.615, 0.378, 0.89, 0.49], beer: [0.34, 1.012, 0.885, 1.052], appr: [0.58, 0.298, 0.882, 0.366], claim: [0.117, 0.345, 0.5, 0.407] },
  en: { hero: [0.12, 0.378, 0.38, 0.49], beer: [0.08, 1.054, 0.66, 1.092], appr: [0.118, 0.298, 0.42, 0.366], claim: [0.46, 0.345, 0.883, 0.407] },
};

// One beat per screen. Within a beat (relative to `push`): camera push 0→28,
// spotlight opens 22→34 (12 f), holds to 80 (≈1.5 s), closes 80→92, camera pulls back 86→112.
const BEATS = [
  { key: 'dashboard', from: 0, focus: 'hero', push: 56, accent: C.danger },
  { key: 'leaks', from: 172, focus: 'beer', push: 192, accent: C.danger },
  { key: 'approvals', from: 290, focus: 'appr', push: 310, accent: C.gold },
  { key: 'claims', from: 408, focus: 'claim', push: 428, accent: C.primary },
] as const;
const PUSH = 28;
const SPOT_IN = 22;
const SPOT_OUT = 80;
const PULL = 86;

export const PRODUCT_DURATION = 556;

export const Product: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].product;
  const isRtl = locale === 'he';
  const { device } = zones(width, height, locale);
  const side = isRtl ? 1 : -1; // laptop turns toward the caption zone

  const W = Math.round(device.w * 0.86);
  const { w: sw, h: sh } = laptopScreen(W);
  const bezel = Math.round(W * 0.016);
  const lidH = sh + bezel * 2;

  let bi = 0;
  BEATS.forEach((b, i) => {
    if (f >= b.from) bi = i;
  });
  const beat = BEATS[bi];
  const lf = f - beat.push;
  const shotName = (k: string) => (k === 'dashboard' ? `dashboard-${locale}-full` : `${k}-${locale}`);
  const focusOf = (b: (typeof BEATS)[number]) => rectFor(shotName(b.key), b.focus, FOCUS[locale][b.focus]);
  const u = focusOf(beat);
  // some focus rows sit below the first viewport: scroll the page there before the push-in
  const scrollOf = (b: (typeof BEATS)[number]) => autoScroll(focusOf(b));
  const scrollU = scrollOf(beat) * prog(lf, -16, 0, EASE_IN_OUT);
  const rect = { x: u[0] * sw, y: (u[1] - scrollU) * sw, w: (u[2] - u[0]) * sw, h: (u[3] - u[1]) * sw };

  // camera push-in: the focus rect fills the device zone
  const target = Math.min((device.w * 0.9) / rect.w, (device.h * 0.62) / rect.h, 3.4);
  const pin = prog(lf, 0, PUSH, EASE_IN_OUT) * (1 - prog(lf, PULL, PULL + 26, EASE_IN_OUT));
  const zoom = 1 + (target - 1) * pin;
  const px = bezel + rect.x + rect.w / 2 - W / 2;
  const py = bezel + rect.y + rect.h / 2 - lidH / 2;
  const tx = -zoom * px * pin;
  const ty = -zoom * py * pin;

  const enter = prog(f, 0, 40);
  const exit = prog(f, 528, 556, EASE_IN);
  const rx = (6 + (1 - enter) * 40) * (1 - pin);
  const ry = 10 * side * (1 - pin) + (1 - enter) * 20 * side;

  const spot = prog(lf, SPOT_IN, SPOT_IN + 12) * (1 - prog(lf, SPOT_OUT, SPOT_OUT + 12));

  const shot = (k: string) => (k === 'dashboard' ? `shots/dashboard-${locale}-full.png` : `shots/${k}-${locale}.png`);
  const wipe = bi > 0 ? prog(f, beat.from, beat.from + 16, EASE_IN_OUT) : 1;
  const fallbackStrip = isRtl ? { y: 0.027, h: 0.013, x: 0.72, w: 0.21 } : { y: 0.027, h: 0.013, x: 0.075, w: 0.21 };
  const redactFor = (k: string) => [emailStrip(shotName(k), fallbackStrip)];
  const d = isRtl ? 'rtl' : 'ltr';

  const callouts: Record<string, React.ReactNode> = {
    dashboard: (
      <>
        <span>{t.chipLeak}</span>
        <bdi dir={d} style={{ color: C.danger }}>{ilsText(FACTS.leak, locale)}</bdi>
        <span style={{ color: C.muted, fontWeight: 500 }}>
          · <bdi dir="ltr">{FACTS.leakPct}</bdi> {t.chipPct}
        </span>
      </>
    ),
    leaks: (
      <span>
        {t.chipBeer.replace('{from}', ilsText(FACTS.beerFrom, locale)).replace('{to}', ilsText(FACTS.beerTo, locale))}{' '}
        <bdi dir="ltr" style={{ color: C.danger }}>+10.6%</bdi>
      </span>
    ),
    approvals: (
      <>
        <span>{t.chipAppr}</span>
        <bdi dir={d} style={{ color: C.gold }}>{ilsText(104.8, locale, 2)}</bdi>
      </>
    ),
    claims: (
      <>
        <span>{t.chipClaim}</span>
        <bdi dir={d} style={{ color: C.primary }}>{ilsText(104.8, locale, 2)}</bdi>
      </>
    ),
  };

  const copy: [string, string][] = [
    [t.heroTitle, t.heroSub],
    [t.heatTitle, t.heatSub],
    [t.apprTitle, t.apprSub],
    [t.claimTitle, t.claimSub],
  ];

  return (
    <AbsoluteFill>
      <DeviceZone locale={locale}>
        <div
          style={{
            position: 'absolute',
            left: device.w / 2 - W / 2,
            top: device.h / 2 - lidH / 2 - 20,
            width: W,
            transform: `translate(${tx}px, ${ty + (1 - enter) * 500}px) scale(${zoom}) rotateX(${rx}deg) rotateY(${ry}deg)`,
            transformStyle: 'preserve-3d',
            opacity: enter * (1 - exit),
            filter: `blur(${(1 - enter) * 10 + exit * 8}px)`,
          }}
        >
          <Laptop width={W} glare={ry / 20}>
            {bi > 0 ? <Screen src={shot(BEATS[bi - 1].key)} width={sw} scroll={scrollOf(BEATS[bi - 1]) * sw} redact={redactFor(BEATS[bi - 1].key)} /> : null}
            <Screen
              src={shot(beat.key)}
              width={sw}
              scroll={scrollU * sw}
              redact={redactFor(beat.key)}
              clip={bi > 0 ? (isRtl ? `inset(0 0 0 ${(1 - wipe) * 100}%)` : `inset(0 ${(1 - wipe) * 100}% 0 0)`) : undefined}
            />
            {bi > 0 && wipe < 1 ? (
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
            <Spotlight rect={rect} a={spot} src={shot(beat.key)} imgWidth={sw} imgTop={-scrollU * sw} screenW={sw} screenH={sh} accent={beat.accent} />
          </Laptop>
        </div>
      </DeviceZone>

      <CaptionZone locale={locale}>
        <div style={{ fontFamily: FONT.sans, color: C.ink, opacity: 1 - exit }}>
          <FadeUp at={20}>
            <div style={{ marginBottom: 28, color: C.subtle, fontSize: 22, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9, background: C.primary, boxShadow: `0 0 10px ${C.primary}` }} />
              {t.realUi}
            </div>
          </FadeUp>
          <div style={{ position: 'relative', height: 520 }}>
            {BEATS.map((b, i) => {
              const at = i === 0 ? 30 : b.from + 4;
              const out = i < 3 ? BEATS[i + 1].from - 18 : 520; // exit finishes before the next caption rises
              if (f < at - 2 || f > out + 20) return null;
              const blf = f - b.push;
              const ca = prog(blf, SPOT_IN + 4, SPOT_IN + 16) * (1 - prog(blf, SPOT_OUT + 4, SPOT_OUT + 14));
              return (
                <div key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
                  <FadeUp at={at} out={out} y={10}>
                    <Eyebrow>{`0${i + 1}`}</Eyebrow>
                  </FadeUp>
                  <RiseLine at={at} out={out} style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, marginTop: 18 }}>
                    {copy[i][0]}
                  </RiseLine>
                  <FadeUp at={at + 10} out={out}>
                    <div style={{ fontSize: 32, color: C.muted, marginTop: 20, lineHeight: 1.35 }}>{copy[i][1]}</div>
                  </FadeUp>
                  <Callout locale={locale} a={ca} accent={b.accent}>
                    {callouts[b.key]}
                  </Callout>
                </div>
              );
            })}
          </div>
        </div>
      </CaptionZone>
    </AbsoluteFill>
  );
};
