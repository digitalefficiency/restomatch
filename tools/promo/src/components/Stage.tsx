import React from 'react';
import { Img, staticFile, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { Rect, zones } from '../layout';

/** Device zone: everything inside is clipped to the zone (feathered on the caption side). */
export const DeviceZone: React.FC<{ locale: 'he' | 'en'; children: React.ReactNode; perspective?: number }> = ({
  locale,
  children,
  perspective = 2200,
}) => {
  const { width, height } = useVideoConfig();
  const { device } = zones(width, height, locale);
  const vertical = height > width;
  const fade = vertical
    ? 'linear-gradient(to bottom, transparent 0, black 60px, black 100%)'
    : 'linear-gradient(to right, transparent 0, black 60px, black calc(100% - 60px), transparent 100%)';
  return (
    <div
      style={{
        position: 'absolute',
        left: device.x,
        top: device.y,
        width: device.w,
        height: device.h,
        overflow: 'hidden',
        perspective,
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      {children}
    </div>
  );
};

/** Caption zone container (absolute, matches layout.ts). */
export const CaptionZone: React.FC<{ locale: 'he' | 'en'; children: React.ReactNode; justify?: 'center' | 'flex-start' }> = ({
  locale,
  children,
  justify = 'center',
}) => {
  const { width, height } = useVideoConfig();
  const { caption } = zones(width, height, locale);
  return (
    <div
      dir={locale === 'he' ? 'rtl' : 'ltr'}
      style={{
        position: 'absolute',
        left: caption.x,
        top: caption.y,
        width: caption.w,
        height: caption.h,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
      }}
    >
      {children}
    </div>
  );
};

/**
 * AE-style spotlight on one rect of a screenshot (in screen px):
 * outside → blurred + dimmed to ~33% + vignette; the rect → lifted copy
 * (+exposure, accent glow outline, scale 1.04), revealed by a mask that opens
 * from its centre line. `a` 0→1 drives everything (12-frame ramps upstream).
 */
export const Spotlight: React.FC<{
  rect: Rect; // screen px, already scroll-corrected
  a: number;
  src: string;
  imgWidth: number; // rendered image width (= screen width)
  imgTop: number; // image y offset inside the screen (top inset − scroll)
  screenW: number;
  screenH: number;
  accent?: string;
}> = ({ rect, a, src, imgWidth, imgTop, screenW, screenH, accent = C.primary }) => {
  if (a <= 0.001) return null;
  const pad = 10;
  const r = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const open = Math.min(1, a * 1.15);
  const hh = r.h * (0.15 + 0.85 * open); // mask opens from the centre line
  const hy = r.y + (r.h - hh) / 2;
  const rad = 14;
  const hole = `M0 0 H${screenW} V${screenH} H0 Z M${r.x + rad} ${hy} H${r.x + r.w - rad} Q${r.x + r.w} ${hy} ${r.x + r.w} ${hy + rad} V${hy + hh - rad} Q${r.x + r.w} ${hy + hh} ${r.x + r.w - rad} ${hy + hh} H${r.x + rad} Q${r.x} ${hy + hh} ${r.x} ${hy + hh - rad} V${hy + rad} Q${r.x} ${hy} ${r.x + rad} ${hy} Z`;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `path(evenodd, '${hole}')`,
          backdropFilter: `blur(${3 * a}px) brightness(${1 - 0.67 * a})`,
          WebkitBackdropFilter: `blur(${3 * a}px) brightness(${1 - 0.67 * a})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(ellipse ${Math.max(r.w, 200) * 0.9}px ${Math.max(r.h, 120) * 1.6}px at ${cx}px ${cy}px, transparent 40%, rgba(0,0,0,${0.55 * a}) 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: r.x,
          top: hy,
          width: r.w,
          height: hh,
          overflow: 'hidden',
          borderRadius: rad,
          transform: `scale(${1 + 0.04 * a})`,
          transformOrigin: `${r.w / 2}px ${r.h / 2 - (hy - r.y)}px`,
          boxShadow: `0 0 0 2px ${accent}${Math.round(a * 200).toString(16).padStart(2, '0')}, 0 0 ${48 * a}px ${accent}88, 0 24px 60px rgba(0,0,0,${0.6 * a})`,
          opacity: Math.min(1, a * 1.4),
          background: C.bg,
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            position: 'absolute',
            width: imgWidth,
            left: -r.x,
            top: imgTop - hy,
            filter: `brightness(${1 + 0.14 * a}) saturate(${1 + 0.1 * a})`,
          }}
        />
      </div>
    </>
  );
};

/** Callout chip in the caption zone with a leader line that runs to the zone edge facing the device. */
export const Callout: React.FC<{ locale: 'he' | 'en'; a: number; accent?: string; children: React.ReactNode }> = ({
  locale,
  a,
  accent = C.primary,
  children,
}) => {
  if (a <= 0.001) return null;
  const isRtl = locale === 'he';
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end', // chip sits on the device-facing edge, touching its leader
        opacity: a,
        transform: `translateY(${(1 - a) * 16}px)`,
        filter: `blur(${(1 - a) * 4}px)`,
        marginTop: 44,
      }}
    >
      {/* leader line toward the device (left in RTL, right in LTR), stops at the zone edge */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          [isRtl ? 'left' : 'right']: -40, // stays inside the 48px gutter
          width: 40 * a,
          height: 2,
          background: `linear-gradient(${isRtl ? 270 : 90}deg, ${accent}, transparent)`,
        }}
      />
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          padding: '16px 26px',
          borderRadius: 16,
          background: 'rgba(14,21,18,0.85)',
          border: `1.5px solid ${accent}88`,
          boxShadow: `0 0 40px ${accent}22`,
          fontSize: 29,
          fontWeight: 700,
          color: C.ink,
          maxWidth: '100%',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 99, background: accent, boxShadow: `0 0 14px ${accent}`, flex: 'none' }} />
        {children}
      </div>
    </div>
  );
};
