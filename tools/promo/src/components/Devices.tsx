import React from 'react';
import { Img, staticFile } from 'remotion';
import { C } from '../theme';

/**
 * A real screenshot inside a device screen: scroll (px of screen width units),
 * optional focus-pull (everything outside a radial window is blurred + dimmed).
 */
export const Screen: React.FC<{
  src: string;
  width: number; // rendered screen width in px
  scroll?: number; // px (in rendered units)
  focus?: { x: number; y: number; r: number; amount: number }; // x,y in rendered px of the visible window
  opacity?: number;
  clip?: string; // CSS clip-path for wipes
  top?: number; // px safe-area inset (phone status bar / dynamic island)
  redact?: { y: number; h: number; x?: number; w?: number }[]; // strips (units of image width) to blur, e.g. a dev stub id
}> = ({ src, width, scroll = 0, focus, opacity = 1, clip, top = 0, redact = [] }) => {
  const img = (
    <div style={{ position: 'relative', transform: `translateY(${top - scroll}px)` }}>
      <Img src={staticFile(src)} style={{ width, display: 'block' }} />
      {redact.map((r, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: r.y * width,
            height: r.h * width,
            left: (r.x ?? 0) * width,
            width: (r.w ?? 1) * width,
            backdropFilter: 'blur(5px)',
            WebkitBackdropFilter: 'blur(5px)',
            background: 'rgba(14,21,18,0.35)',
            borderRadius: 6,
          }}
        />
      ))}
    </div>
  );
  const a = focus?.amount ?? 0;
  const mask = focus
    ? `radial-gradient(ellipse ${focus.r}px ${focus.r * 0.62}px at ${focus.x}px ${focus.y}px, transparent 0%, transparent 55%, black 100%)`
    : undefined;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity, clipPath: clip, background: '#0E1512' }}>
      {img}
      {focus && a > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            maskImage: mask,
            WebkitMaskImage: mask,
            filter: `blur(${a * 7}px) brightness(${1 - a * 0.55})`,
          }}
        >
          {img}
        </div>
      ) : null}
    </div>
  );
};

/** Laptop: aluminium-black lid + deck. Screen aspect 16:10. Children = screen content. */
export const Laptop: React.FC<{
  width: number;
  glare?: number; // -1..1 position of the glass reflection
  children: React.ReactNode;
}> = ({ width, glare = 0, children }) => {
  const bezel = Math.round(width * 0.016);
  const screenW = width - bezel * 2;
  const screenH = Math.round(screenW * 0.625);
  const lidH = screenH + bezel * 2;
  return (
    <div style={{ width, position: 'relative', transformStyle: 'preserve-3d' }}>
      {/* lid */}
      <div
        style={{
          width,
          height: lidH,
          borderRadius: width * 0.022,
          background: 'linear-gradient(180deg, #1d2421 0%, #0b0f0d 100%)',
          boxShadow: `0 0 0 2px #2c3631, 0 0 0 3px #0a0d0c, 0 60px 120px rgba(0,0,0,0.6), 0 0 120px ${C.primary}14`,
          padding: bezel,
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: bezel * 0.35,
            left: '50%',
            width: bezel * 0.4,
            height: bezel * 0.4,
            borderRadius: 99,
            background: '#1f2a25',
            transform: 'translateX(-50%)',
          }}
        />
        <div
          style={{
            width: screenW,
            height: screenH,
            borderRadius: width * 0.006,
            overflow: 'hidden',
            position: 'relative',
            background: C.bg,
          }}
        >
          {children}
          {/* glass reflection */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: `linear-gradient(115deg, transparent ${30 + glare * 20}%, rgba(255,255,255,0.06) ${42 + glare * 20}%, transparent ${55 + glare * 20}%)`,
            }}
          />
        </div>
      </div>
      {/* deck */}
      <div
        style={{
          position: 'relative',
          width: width * 1.14,
          left: -width * 0.07,
          height: width * 0.022,
          marginTop: -2,
          borderRadius: `2px 2px ${width * 0.02}px ${width * 0.02}px`,
          background: 'linear-gradient(180deg, #3a443f 0%, #1b211e 45%, #0d110f 100%)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.55)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            width: width * 0.16,
            height: width * 0.008,
            transform: 'translateX(-50%)',
            borderRadius: `0 0 ${width * 0.01}px ${width * 0.01}px`,
            background: '#0d110f',
          }}
        />
      </div>
    </div>
  );
};

export const laptopScreen = (width: number) => {
  const bezel = Math.round(width * 0.016);
  const w = width - bezel * 2;
  return { w, h: Math.round(w * 0.625) };
};

/** Phone with titanium frame and dynamic island. Screen aspect 390:844. */
export const Phone: React.FC<{ width: number; children: React.ReactNode; glare?: number }> = ({
  width,
  children,
  glare = 0,
}) => {
  const frame = Math.round(width * 0.04);
  const sw = width - frame * 2;
  const sh = Math.round((sw * 844) / 390);
  return (
    <div
      style={{
        width,
        height: sh + frame * 2,
        borderRadius: width * 0.16,
        padding: frame,
        boxSizing: 'border-box',
        background: 'linear-gradient(145deg, #4a554f 0%, #1a201d 30%, #0b0e0c 60%, #3b4540 100%)',
        boxShadow: `0 0 0 2px #0a0d0c, 0 70px 140px rgba(0,0,0,0.65), 0 0 120px ${C.primary}18`,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: sw,
          height: sh,
          borderRadius: width * 0.125,
          overflow: 'hidden',
          position: 'relative',
          background: C.bg,
        }}
      >
        {children}
        <div
          style={{
            position: 'absolute',
            top: sw * 0.03,
            left: '50%',
            transform: 'translateX(-50%)',
            width: sw * 0.3,
            height: sw * 0.085,
            borderRadius: 99,
            background: '#000',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `linear-gradient(120deg, transparent ${25 + glare * 25}%, rgba(255,255,255,0.07) ${38 + glare * 25}%, transparent ${52 + glare * 25}%)`,
          }}
        />
      </div>
    </div>
  );
};

export const phoneScreen = (width: number) => {
  const frame = Math.round(width * 0.04);
  const w = width - frame * 2;
  return { w, h: Math.round((w * 844) / 390) };
};
