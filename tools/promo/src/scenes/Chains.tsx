import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, Locale } from '../copy';
import { C, EASE_IN, FONT, prog } from '../theme';
import { FadeUp, RiseLine } from '../components/primitives';

export const CHAINS_DURATION = 110;

/**
 * "Chains & branches" — a DESIGNED concept card, not a screenshot (the chain
 * view is being built in parallel). It carries a visible "design concept" tag
 * and shows no ₪ figures, only relative bars.
 */
export const Chains: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].chains;
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const vertical = height > width;
  const exit = prog(f, CHAINS_DURATION - 16, CHAINS_DURATION, EASE_IN);
  const bars = [0.62, 0.38, 0.84, 0.27];
  const cardW = vertical ? 900 : 980;
  const tilt = 1 - prog(f, 0, 40);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1600, opacity: 1 - exit }}>
      <div dir={dir} style={{ fontFamily: FONT.sans, color: C.ink, textAlign: 'center', marginBottom: 46 }}>
        <RiseLine at={2} style={{ fontSize: 80, fontWeight: 800 }}>
          {t.title}
        </RiseLine>
        <FadeUp at={12}>
          <div style={{ fontSize: 34, color: C.muted, marginTop: 10 }}>{t.sub}</div>
        </FadeUp>
      </div>
      <div
        dir={dir}
        style={{
          width: cardW,
          padding: 40,
          borderRadius: 28,
          background: `linear-gradient(160deg, ${C.surface2} 0%, ${C.surface} 100%)`,
          border: `1.5px solid ${C.line}`,
          boxShadow: `0 50px 120px rgba(0,0,0,.55), 0 0 80px ${C.primary}10`,
          transform: `rotateX(${tilt * 30}deg) translateY(${tilt * 120}px)`,
          opacity: prog(f, 4, 26),
          fontFamily: FONT.sans,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -20,
            [isRtl ? 'left' : 'right']: 30,
            padding: '6px 16px',
            borderRadius: 99,
            border: `1.5px dashed ${C.gold}`,
            color: C.gold,
            background: C.bg,
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          {t.concept}
        </div>
        <div style={{ color: C.subtle, fontSize: 22, marginBottom: 22, letterSpacing: '0.04em' }}>{t.col}</div>
        {t.branches.map((b, i) => {
          const p = prog(f, 22 + i * 6, 52 + i * 6);
          const hot = bars[i] > 0.7;
          return (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: i < 3 ? 22 : 0 }}>
              <div style={{ width: 200, fontSize: 32, fontWeight: 600, color: C.ink }}>{b}</div>
              <div style={{ flex: 1, height: 22, borderRadius: 22, background: C.bg, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${bars[i] * 100 * p}%`,
                    height: '100%',
                    borderRadius: 22,
                    background: hot ? `linear-gradient(90deg, ${C.danger}aa, ${C.danger})` : `linear-gradient(90deg, ${C.primary}88, ${C.primary})`,
                    boxShadow: hot ? `0 0 20px ${C.danger}88` : undefined,
                    marginInlineStart: 0,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
