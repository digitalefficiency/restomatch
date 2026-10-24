import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, Locale } from '../copy';
import { C, EASE_OUT, FONT, lerp, prog } from '../theme';
import { FadeUp, LightSweep, RiseLine } from '../components/primitives';

/** The app icon (apps/web/app/icon.svg), drawn on. */
export const Logo: React.FC<{ size: number; draw: number }> = ({ size, draw }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <rect width="64" height="64" rx="16" fill={C.primary} />
    <path
      d="M20 14h24v36l-4-3-4 3-4-3-4 3-4-3-4 3z"
      fill="none"
      stroke={C.onPrimary}
      strokeWidth="4"
      strokeLinejoin="round"
      strokeDasharray={140}
      strokeDashoffset={140 * (1 - draw)}
    />
    <path
      d="M26 26h12M26 34h8"
      stroke={C.onPrimary}
      strokeWidth="4"
      strokeLinecap="round"
      strokeDasharray={20}
      strokeDashoffset={20 * (1 - prog(draw, 0.6, 1))}
    />
  </svg>
);

export const Cta: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].cta;
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const vertical = height > width;
  const pop = prog(f, 0, 24, EASE_OUT);
  const draw = prog(f, 6, 40);
  const wordIn = prog(f, 14, 40);
  const ring = prog(f, 4, 50);
  const logoSize = vertical ? 150 : 130;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT.sans }}>
      {/* expanding ring */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          border: `2px solid ${C.primary}`,
          opacity: (1 - ring) * 0.6,
          transform: `scale(${lerp(0.3, 3.2, ring)})`,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, flexDirection: vertical ? 'column' : 'row' }} dir="ltr">
        <div
          style={{
            transform: `scale(${lerp(0.4, 1, pop)}) rotate(${lerp(-25, 0, pop)}deg)`,
            opacity: pop,
            filter: `drop-shadow(0 0 40px ${C.primary}66)`,
          }}
        >
          <Logo size={logoSize} draw={draw} />
        </div>
        <div style={{ position: 'relative', overflow: 'hidden', paddingBottom: 6 }}>
          <div
            style={{
              fontSize: vertical ? 130 : 132,
              fontWeight: 800,
              color: C.ink,
              letterSpacing: '-0.035em',
              transform: `translateX(${(1 - wordIn) * -60}px)`,
              opacity: wordIn,
              filter: `blur(${(1 - wordIn) * 10}px)`,
              lineHeight: 1,
            }}
          >
            Resto<span style={{ color: C.primary }}>Match</span>
          </div>
          <LightSweep at={44} dur={30} opacity={0.55} />
        </div>
      </div>
      <div dir={dir} style={{ marginTop: 46, textAlign: 'center' }}>
        <RiseLine at={34} style={{ fontSize: vertical ? 60 : 58, fontWeight: 700, color: C.ink }}>
          {t.tagline}
        </RiseLine>
      </div>
      <FadeUp at={58}>
        <div style={{ marginTop: 54, display: 'flex', gap: 26, alignItems: 'center', flexDirection: vertical ? 'column' : 'row' }} dir={dir}>
          <div
            style={{
              padding: '20px 44px',
              borderRadius: 18,
              background: C.primary,
              color: C.onPrimary,
              fontSize: 36,
              fontWeight: 800,
              boxShadow: `0 0 60px ${C.primary}55`,
            }}
          >
            {t.action}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 36, color: C.muted, letterSpacing: '0.02em' }} dir="ltr">
            {t.url}
          </div>
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
};
