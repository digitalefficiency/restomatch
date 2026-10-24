import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, prog } from '../theme';
import { zones } from '../layout';
import { Laptop, laptopScreen, Screen } from '../components/Devices';
import { CaptionZone, Callout, DeviceZone, Spotlight } from '../components/Stage';
import { Eyebrow, FadeUp, RiseLine } from '../components/primitives';

export const CHAINS_DURATION = 150;

// Branch-ranking row #1 (leakiest branch) on the REAL /dashboard/chain capture (units of image width).
const ROW: Record<Locale, [number, number, number, number]> = {
  he: [0.44, 0.583, 0.883, 0.616], // % of spend · leak · branch
  en: [0.117, 0.583, 0.54, 0.616],
};

/** Chains & branches — real S8 chain dashboard (seed:chain-demo), spotlight on the leakiest branch. */
export const Chains: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].chains;
  const tp = COPY[locale].product;
  const isRtl = locale === 'he';
  const side = isRtl ? 1 : -1;
  const { device } = zones(width, height, locale);
  const W = Math.round(device.w * 0.86);
  const { w: sw, h: sh } = laptopScreen(W);
  const bezel = Math.round(W * 0.016);
  const lidH = sh + bezel * 2;
  const u = ROW[locale];
  const rect = { x: u[0] * sw, y: u[1] * sw, w: (u[2] - u[0]) * sw, h: (u[3] - u[1]) * sw };

  const enter = prog(f, 0, 30);
  const exit = prog(f, CHAINS_DURATION - 18, CHAINS_DURATION, EASE_IN);
  const pin = prog(f, 34, 62, EASE_IN_OUT);
  const target = Math.min((device.w * 0.9) / rect.w, (device.h * 0.62) / rect.h, 3.4);
  const zoom = 1 + (target - 1) * pin;
  const px = bezel + rect.x + rect.w / 2 - W / 2;
  const py = bezel + rect.y + rect.h / 2 - lidH / 2;
  const spot = prog(f, 56, 68) * (1 - prog(f, 126, 138));
  const ca = prog(f, 60, 72) * (1 - prog(f, 130, 140));
  const rx = (6 + (1 - enter) * 30) * (1 - pin);
  const ry = 10 * side * (1 - pin);
  const redact = [isRtl ? { y: 0.012, h: 0.01, x: 0.72, w: 0.21 } : { y: 0.012, h: 0.01, x: 0.075, w: 0.21 }];

  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <DeviceZone locale={locale}>
        <div
          style={{
            position: 'absolute',
            left: device.w / 2 - W / 2,
            top: device.h / 2 - lidH / 2 - 20,
            width: W,
            transform: `translate(${-zoom * px * pin}px, ${-zoom * py * pin + (1 - enter) * 400}px) scale(${zoom}) rotateX(${rx}deg) rotateY(${ry}deg)`,
            opacity: enter,
          }}
        >
          <Laptop width={W} glare={ry / 20}>
            <Screen src={`shots/chain-${locale}.png`} width={sw} redact={redact} />
            <Spotlight rect={rect} a={spot} src={`shots/chain-${locale}.png`} imgWidth={sw} imgTop={0} screenW={sw} screenH={sh} accent={C.danger} />
          </Laptop>
        </div>
      </DeviceZone>
      <CaptionZone locale={locale}>
        <div style={{ fontFamily: FONT.sans, color: C.ink }}>
          <FadeUp at={4}>
            <div style={{ marginBottom: 28, color: C.subtle, fontSize: 22, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9, background: C.primary, boxShadow: `0 0 10px ${C.primary}` }} />
              {tp.realUi}
            </div>
          </FadeUp>
          <Eyebrow>05</Eyebrow>
          <RiseLine at={6} style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, marginTop: 18 }}>
            {t.title}
          </RiseLine>
          <FadeUp at={16}>
            <div style={{ fontSize: 32, color: C.muted, marginTop: 20, lineHeight: 1.35 }}>{t.sub}</div>
          </FadeUp>
          <Callout locale={locale} a={ca} accent={C.danger}>
            <span>{t.chipWorst}</span>
            <bdi dir="ltr" style={{ color: C.danger }}>{FACTS.chainLeakPct}</bdi>
          </Callout>
        </div>
      </CaptionZone>
    </AbsoluteFill>
  );
};
