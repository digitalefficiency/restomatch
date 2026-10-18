import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, prog } from '../theme';
import { Laptop, laptopScreen, Screen } from '../components/Devices';
import { Chip, Eyebrow, FadeUp, RiseLine } from '../components/primitives';

export const CHAINS_DURATION = 150;

/** Chains & branches — the REAL /dashboard/chain (S8) on the demo chain seed: ranking → price gaps. */
export const Chains: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].chains;
  const tp = COPY[locale].product;
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const side = isRtl ? -1 : 1;
  const W = 1180;
  const { w: sw } = laptopScreen(W);
  const enter = prog(f, 0, 30);
  const exit = prog(f, CHAINS_DURATION - 18, CHAINS_DURATION, EASE_IN);
  // scroll from KPIs + branch ranking down to the price-gap panel (units of image width)
  const gapAt = locale === 'he' ? 0.9 : 0.95;
  const scrollU = interpolate(f, [0, 50, 95, 150], [0.03, 0.03, gapAt, gapAt + 0.05], {
    easing: EASE_IN_OUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(f, [0, 30, 95, 150], [0.85, 1.05, 1.12, 1.15], { extrapolateRight: 'clamp' });
  const ry = (14 - 8 * enter) * side;
  const redact = [isRtl ? { y: 0.012, h: 0.01, x: 0.72, w: 0.21 } : { y: 0.012, h: 0.01, x: 0.075, w: 0.21 }];
  return (
    <AbsoluteFill style={{ perspective: 2200, opacity: 1 - exit }}>
      <div
        style={{
          position: 'absolute',
          left: width / 2 + side * 380 - W / 2,
          top: height / 2 - (sw * 0.625) / 2 - 20,
          transform: `translateY(${(1 - enter) * 400}px) scale(${zoom}) rotateX(${6 + (1 - enter) * 30}deg) rotateY(${ry}deg)`,
          opacity: enter,
        }}
      >
        <Laptop width={W} glare={ry / 20}>
          <Screen src={`shots/chain-${locale}.png`} width={sw} scroll={scrollU * sw} redact={redact} />
        </Laptop>
      </div>
      <AbsoluteFill
        style={{
          background: `linear-gradient(${isRtl ? 270 : 90}deg, rgba(8,16,12,0.96) 0%, rgba(8,16,12,0.9) 30%, rgba(8,16,12,0.55) 40%, transparent 50%)`,
          opacity: 0.85,
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
        <FadeUp at={4}>
          <div style={{ marginBottom: 28, color: C.subtle, fontSize: 22, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 9, background: C.primary, boxShadow: `0 0 10px ${C.primary}` }} />
            {tp.realUi}
          </div>
        </FadeUp>
        <Eyebrow>05</Eyebrow>
        <RiseLine at={6} style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 18 }}>
          {t.title}
        </RiseLine>
        <FadeUp at={16}>
          <div style={{ fontSize: 34, color: C.muted, marginTop: 22, lineHeight: 1.35 }}>{t.sub}</div>
        </FadeUp>
        <FadeUp at={34} out={92} style={{ marginTop: 40 }}>
          <Chip accent={C.danger} big>
            <span>{t.chipWorst}</span>
            <bdi dir="ltr" style={{ color: C.danger, fontWeight: 800 }}>{FACTS.chainLeakPct}</bdi>
          </Chip>
        </FadeUp>
        <FadeUp at={100} style={{ marginTop: -70 }}>
          <Chip accent={C.gold} big>
            {t.chipGap}
          </Chip>
        </FadeUp>
      </div>
    </AbsoluteFill>
  );
};
