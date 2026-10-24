import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, EASE_IN, FONT, isLight, prog } from '../theme';

/** Masked line reveal: the line rises out of a slot with a slight blur → sharp. */
export const RiseLine: React.FC<{
  at: number;
  dur?: number;
  out?: number; // frame to start exit (optional)
  children: React.ReactNode;
  style?: React.CSSProperties;
  dist?: number;
}> = ({ at, dur = 22, out, children, style, dist = 1.05 }) => {
  const f = useCurrentFrame();
  const p = prog(f, at, at + dur);
  const e = out === undefined ? 0 : prog(f, out, out + 14, EASE_IN);
  const y = (1 - p) * dist * 100 - e * 100;
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.12em', marginBottom: '-0.12em', ...style }}>
      <div
        style={{
          textWrap: 'balance',
          transform: `translateY(${y}%)`,
          filter: `blur(${(1 - p) * 8 + e * 6}px)`,
          opacity: p * (1 - e),
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Fade + lift + de-blur, for supporting copy and UI chips. */
export const FadeUp: React.FC<{
  at: number;
  dur?: number;
  out?: number;
  y?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, dur = 18, out, y = 24, children, style }) => {
  const f = useCurrentFrame();
  const p = prog(f, at, at + dur);
  const e = out === undefined ? 0 : prog(f, out, out + 12, EASE_IN);
  return (
    <div
      style={{
        opacity: p * (1 - e),
        transform: `translateY(${(1 - p) * y - e * 12}px) scale(${0.96 + 0.04 * p})`,
        filter: `blur(${(1 - p) * 6 + e * 4}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Slot-machine ₪ counter: every digit is a vertical reel of 0–9 that spins
 * down and lands on its value, right-most digit last. Directional (vertical)
 * motion blur via an SVG filter whose stdDeviation tracks reel velocity.
 */
export const ReelNumber: React.FC<{
  value: number;
  at: number;
  dur?: number;
  size: number;
  color?: string;
  prefix?: string;
  id: string;
  weight?: number;
}> = ({ value, at, dur = 48, size, color = C.ink, prefix = '₪', id, weight = 800 }) => {
  const f = useCurrentFrame();
  const digits = String(value).split('').map(Number);
  const h = size * 1.08;
  return (
    <div
      dir="ltr"
      style={{
        display: 'flex',
        alignItems: 'center',
        fontFamily: FONT.sans,
        fontWeight: weight,
        fontSize: size,
        color,
        lineHeight: `${h}px`,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
      }}
    >
      {prefix ? (
        <span
          style={{
            fontSize: size * 0.6,
            marginRight: size * 0.06,
            opacity: prog(f, at, at + 14),
            transform: `translateY(${size * 0.04}px)`,
          }}
        >
          {prefix}
        </span>
      ) : null}
      {digits.map((d, i) => {
        const start = at + i * 4;
        const end = start + dur + i * 6;
        const p = prog(f, start, end);
        const spins = 2 + i; // full turns before landing
        const pos = (spins * 10 + d) * p; // reel position in digits
        const pPrev = prog(f - 1, start, end);
        const v = Math.abs((spins * 10 + d) * (p - pPrev)); // digits / frame
        const blur = Math.min(v * h * 0.35, size * 0.4);
        const fid = `mb-${id}-${i}`;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              height: h,
              overflow: 'hidden',
              position: 'relative',
              width: '0.6em',
              textAlign: 'center',
              opacity: interpolate(f, [start - 2, start + 4], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <filter id={fid}>
                <feGaussianBlur stdDeviation={`0 ${blur.toFixed(2)}`} />
              </filter>
            </svg>
            <span
              style={{
                display: 'block',
                transform: `translateY(${-(pos % 10) * h}px)`,
                filter: blur > 0.3 ? `url(#${fid})` : undefined,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n, k) => (
                <span key={k} style={{ display: 'block', height: h }}>
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** Smooth count-up for ₪ numbers, formatted like the app (he "572 ₪", en "₪572"). Lands exactly on `value`. */
export const CountUp: React.FC<{ value: number; at: number; dur?: number; locale: 'he' | 'en' }> = ({
  value,
  at,
  dur = 36,
  locale,
}) => {
  const f = useCurrentFrame();
  const v = Math.round(value * prog(f, at, at + dur));
  const txt = v.toLocaleString('en-US');
  return locale === 'he' ? (
    <bdi dir="rtl" style={{ fontVariantNumeric: 'tabular-nums' }}>{`${txt} ₪`}</bdi>
  ) : (
    <bdi dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{`₪${txt}`}</bdi>
  );
};

/** Diagonal specular sweep across whatever it overlays (logo, glass, numbers). */
export const LightSweep: React.FC<{ at: number; dur?: number; opacity?: number; width?: number }> = ({
  at,
  dur = 40,
  opacity = 0.35,
  width = 18,
}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, at + dur, (t) => t);
  if (f < at || f > at + dur) return null;
  const x = -40 + p * 180;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        mixBlendMode: 'color-dodge',
        background: `linear-gradient(105deg, transparent ${x - width}%, rgba(255,255,255,${opacity}) ${x}%, transparent ${x + width}%)`,
      }}
    />
  );
};

/** Glass callout chip with a glowing dot — the house annotation. */
export const Chip: React.FC<{
  children: React.ReactNode;
  accent?: string;
  big?: boolean;
  light?: boolean; // white card chip for the light stage
  style?: React.CSSProperties;
}> = ({ children, accent = C.primary, big, light = isLight(), style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: big ? 18 : 12,
      padding: big ? '18px 30px' : '12px 22px',
      borderRadius: 999,
      background: light ? '#FFFFFF' : 'rgba(14,21,18,0.78)',
      border: `1.5px solid ${accent}${light ? '66' : '55'}`,
      boxShadow: light
        ? '0 1px 2px rgba(15,31,23,0.08), 0 14px 36px rgba(15,31,23,0.12)'
        : `0 0 0 1px rgba(0,0,0,0.3), 0 18px 50px rgba(0,0,0,0.45), 0 0 40px ${accent}22`,
      backdropFilter: light ? undefined : 'blur(14px)',
      color: light ? '#0F1F17' : C.ink,
      fontFamily: FONT.sans,
      fontSize: big ? 34 : 26,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    <span
      style={{
        width: big ? 14 : 10,
        height: big ? 14 : 10,
        borderRadius: 99,
        background: accent,
        boxShadow: `0 0 14px ${accent}`,
        flex: 'none',
      }}
    />
    {children}
  </div>
);

/** Small uppercase-ish eyebrow with the brand gradient tick (as in the app's section headers). */
export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({
  children,
  color = C.primary,
  size = 24,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    <div
      style={{
        width: 64,
        height: 4,
        borderRadius: 4,
        background: `linear-gradient(90deg, ${C.primary}, ${C.gold})`,
      }}
    />
    <div style={{ color, fontFamily: FONT.sans, fontSize: size, fontWeight: 600, letterSpacing: '0.02em' }}>
      {children}
    </div>
  </div>
);
