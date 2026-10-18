import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, Locale } from '../copy';
import { C, EASE_IN_OUT, FONT, prog } from '../theme';
import { FadeUp, LightSweep, ReelNumber, RiseLine } from '../components/primitives';

/** 0–6 s: the owner's question, kinetic; then the ₪ reel spins up and lands. */
export const Hook: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].hook;
  const vertical = height > width;
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  // question settles big in the centre, then glides up & shrinks to make room for the number
  const lift = prog(f, 62, 92, EASE_IN_OUT);
  const qSize = vertical ? 150 : 150;
  const scale = 1 - lift * 0.42;
  const ty = -lift * (vertical ? 330 : 250);
  // camera push over the whole shot
  const push = 1 + prog(f, 0, 180, (x) => x) * 0.05;
  const numIn = prog(f, 80, 100);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${push})` }}>
      <div
        dir={dir}
        style={{
          transform: `translateY(${ty}px) scale(${scale})`,
          textAlign: 'center',
          fontFamily: FONT.sans,
          fontWeight: 800,
          fontSize: qSize,
          lineHeight: 1.02,
          color: C.ink,
          letterSpacing: locale === 'he' ? '-0.01em' : '-0.035em',
        }}
      >
        <RiseLine at={4}>{t.l1}</RiseLine>
        <RiseLine at={14}>
          <span style={{ color: C.danger, textShadow: `0 0 60px ${C.danger}55` }}>{t.l2}</span>
        </RiseLine>
        <RiseLine at={24}>{t.l3}</RiseLine>
      </div>

      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: `translateY(${vertical ? -60 : -10}px) scale(${0.9 + numIn * 0.1})`,
          opacity: numIn,
        }}
      >
        <div style={{ position: 'relative', padding: '0 30px' }}>
          <div
            style={{
              position: 'absolute',
              inset: '-30% -10%',
              background: `radial-gradient(ellipse at center, ${C.danger}33 0%, transparent 65%)`,
              opacity: prog(f, 130, 150),
            }}
          />
          <ReelNumber id="hook" value={FACTS.leak} at={84} dur={46} size={vertical ? 300 : 280} color={C.danger} />
          <LightSweep at={142} dur={30} opacity={0.5} />
        </div>
        <FadeUp at={140} style={{ marginTop: 18 }}>
          <div
            dir={dir}
            style={{
              fontFamily: FONT.sans,
              fontSize: vertical ? 44 : 40,
              color: C.muted,
              fontWeight: 500,
              textAlign: 'center',
              padding: '0 60px',
            }}
          >
            {t.sub}
          </div>
        </FadeUp>
        <FadeUp at={148}>
          <div
            dir={dir}
            style={{ marginTop: 16, fontFamily: FONT.sans, fontSize: 24, color: C.subtle, letterSpacing: '0.04em' }}
          >
            {t.tag}
          </div>
        </FadeUp>
      </div>
    </AbsoluteFill>
  );
};
