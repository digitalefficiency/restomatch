import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, Locale } from '../copy';
import { C, EASE_IN, FONT, prog } from '../theme';
import { FadeUp } from '../components/primitives';

const DocIcon: React.FC<{ kind: 0 | 1 | 2; size: number }> = ({ kind, size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={C.ink} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
    {kind === 0 ? (
      <>
        <path d="M14 10h26l10 10v34H14z" />
        <path d="M22 28h20M22 36h20M22 44h12" />
      </>
    ) : kind === 1 ? (
      <>
        <path d="M8 22l24-12 24 12v24L32 58 8 46z" />
        <path d="M8 22l24 12 24-12M32 34v24" />
      </>
    ) : (
      <>
        <path d="M18 8h28v48l-5-4-4 4-5-4-4 4-5-4-5 4z" />
        <path d="M25 22h14M25 30h10" />
      </>
    )}
  </svg>
);

/** 3-way match beat: Order · Delivery · Invoice lock together on the scan line. */
export const Match: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].match;
  const vertical = height > width;
  const labels = [t.po, t.gr, t.inv];
  const gap = vertical ? 300 : 380;
  const order = locale === 'he' ? [0, 1, 2] : [0, 1, 2];
  const out = prog(f, 62, 76, EASE_IN);
  const lineP = prog(f, 14, 40);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - out, transform: `scale(${1 + out * 0.15})` }}>
      <div style={{ position: 'relative', width: gap * 2 + 200, height: 260 }} dir={locale === 'he' ? 'rtl' : 'ltr'}>
        {/* connector */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: 100,
            right: 100,
            height: 4,
            borderRadius: 4,
            background: `linear-gradient(90deg, ${C.primary}, ${C.gold})`,
            boxShadow: `0 0 30px ${C.primary}88`,
            transform: `scaleX(${lineP})`,
            transformOrigin: locale === 'he' ? 'right' : 'left',
          }}
        />
        {order.map((k, i) => {
          const p = prog(f, i * 6, i * 6 + 18);
          const lock = prog(f, 26 + i * 6, 36 + i * 6);
          return (
            <div
              key={k}
              style={{
                position: 'absolute',
                top: 0,
                [locale === 'he' ? 'right' : 'left']: i * gap,
                width: 200,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                opacity: p,
                transform: `translateY(${(1 - p) * 40}px)`,
              }}
            >
              <div
                style={{
                  width: 160,
                  height: 160,
                  borderRadius: 36,
                  background: C.surface,
                  border: `2px solid ${lock > 0.5 ? C.primary : C.line}`,
                  boxShadow: `0 0 ${50 * lock}px ${C.primary}66, 0 30px 60px rgba(0,0,0,.5)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <DocIcon kind={k as 0 | 1 | 2} size={84} />
                <div
                  style={{
                    position: 'absolute',
                    top: -14,
                    [locale === 'he' ? 'left' : 'right']: -14,
                    width: 44,
                    height: 44,
                    borderRadius: 99,
                    background: C.primary,
                    color: C.onPrimary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    fontWeight: 900,
                    transform: `scale(${lock})`,
                    fontFamily: FONT.sans,
                  }}
                >
                  ✓
                </div>
              </div>
              <div style={{ marginTop: 22, fontFamily: FONT.sans, fontSize: 36, fontWeight: 700, color: C.ink }}>{labels[k]}</div>
            </div>
          );
        })}
      </div>
      <FadeUp at={30}>
        <div
          dir={locale === 'he' ? 'rtl' : 'ltr'}
          style={{
            marginTop: 40,
            fontFamily: FONT.sans,
            fontSize: vertical ? 44 : 46,
            color: C.muted,
            fontWeight: 500,
            textAlign: 'center',
            maxWidth: vertical ? 900 : 1500,
          }}
        >
          {t.line}
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
};
