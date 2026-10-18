import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, EASE_IN, FONT, prog } from '../theme';
import { CountUp, FadeUp, LightSweep, RiseLine } from '../components/primitives';

export const VALUE_DURATION = 330;

/** 42–53 s: the three demo numbers, then "without changing the daily routine". */
export const Value: React.FC<{ locale: Locale; duration?: number }> = ({ locale, duration = VALUE_DURATION }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].value;
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const vertical = height > width;
  const split = Math.round(duration * 0.55); // numbers → routine
  const exitNums = prog(f, split - 14, split, EASE_IN);
  const exit = prog(f, duration - 16, duration, EASE_IN);

  const stats = [
    { label: t.leak, value: FACTS.leak, note: `${FACTS.leakPct} ${t.leakNote.replace('{spend}', ilsText(FACTS.spend, locale))}`, color: C.danger },
    { label: t.caught, value: FACTS.caught, note: t.caughtNote, color: C.gold },
    { label: t.claimed, value: FACTS.claimed, note: t.claimedNote, color: C.primary },
  ];

  return (
    <AbsoluteFill dir={dir} style={{ fontFamily: FONT.sans, color: C.ink, opacity: 1 - exit }}>
      {f < split + 2 ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1 - exitNums,
            transform: `scale(${1 + exitNums * 0.08})`,
            filter: `blur(${exitNums * 10}px)`,
          }}
        >
          <FadeUp at={0}>
            <div style={{ fontSize: 26, color: C.subtle, letterSpacing: '0.05em', marginBottom: 50, textAlign: 'center' }}>{t.eyebrow}</div>
          </FadeUp>
          <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 70 : 90 }}>
            {stats.map((s, i) => {
              const at = 8 + i * 16;
              return (
                <FadeUp key={i} at={at} y={50}>
                  <div style={{ width: 470, textAlign: 'center', position: 'relative' }}>
                    <div style={{ fontSize: 36, fontWeight: 600, color: C.muted }}>{s.label}</div>
                    <div
                      style={{
                        fontSize: 150,
                        fontWeight: 800,
                        color: s.color,
                        lineHeight: 1.1,
                        textShadow: `0 0 70px ${s.color}44`,
                        position: 'relative',
                      }}
                    >
                      <CountUp value={s.value} at={at} dur={72 - i * 16} locale={locale} />
                      <LightSweep at={84} dur={26} opacity={0.4} />
                    </div>
                    <div style={{ height: 3, width: 120, margin: '14px auto', background: s.color, opacity: 0.6, borderRadius: 3 }} />
                    <div style={{ fontSize: 28, color: C.subtle }}>{s.note}</div>
                  </div>
                </FadeUp>
              );
            })}
          </div>
        </AbsoluteFill>
      ) : null}

      {f >= split - 4 ? (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <RiseLine at={split} style={{ fontSize: vertical ? 84 : 96, fontWeight: 800, textAlign: 'center', padding: '0 60px' }}>
            {t.calm}
          </RiseLine>
          <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 26 : 34, marginTop: 64, alignItems: 'center' }}>
            {t.steps.map((s, i) => (
              <FadeUp key={i} at={split + 16 + i * 8}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 20,
                      background: `${C.primary}1f`,
                      border: `1.5px solid ${C.primary}88`,
                      color: C.primary,
                      fontFamily: FONT.mono,
                      fontWeight: 700,
                      fontSize: 30,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 600, color: C.ink }}>{s}</div>
                  {!vertical && i < 2 ? (
                    <div style={{ width: 60, height: 2, background: C.line, marginInlineStart: 16 }} />
                  ) : null}
                </div>
              </FadeUp>
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
