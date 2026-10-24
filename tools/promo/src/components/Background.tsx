import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, LIGHT } from '../theme';

/**
 * The "ledger room": deep green-ink canvas, a perspective ledger grid drifting
 * toward camera, two slow light pools (money-green + gold) and dust particles.
 * Every motion here is periodic in `period` frames so it can loop seamlessly.
 */
export const Background: React.FC<{ period?: number; tint?: 'green' | 'danger'; intensity?: number; light?: boolean }> = ({
  period = 360,
  tint = 'green',
  intensity = 1,
  light = false,
}) => {
  const P = light
    ? { bg: LIGHT.bg, bgDeep: LIGHT.bgDeep, line: LIGHT.line, primary: LIGHT.primary, gold: LIGHT.gold, vignette: 'rgba(15,31,23,0.10)' }
    : { bg: C.bg, bgDeep: C.bgDeep, line: C.line, primary: C.primary, gold: C.gold, vignette: 'rgba(0,0,0,0.55)' };
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ph = (frame % period) / period; // 0..1 loop phase
  const tau = Math.PI * 2;
  const glow = light ? 'rgba(6,107,74,0.10)' : tint === 'danger' ? 'rgba(255,92,122,0.20)' : 'rgba(34,211,154,0.17)';

  const g1x = 30 + 8 * Math.sin(tau * ph);
  const g1y = 30 + 6 * Math.cos(tau * ph);
  const g2x = 72 + 7 * Math.cos(tau * ph);
  const g2y = 75 + 5 * Math.sin(tau * ph);

  const particles = new Array(46).fill(0).map((_, i) => {
    const x0 = random(`px${i}`) * width;
    const y0 = random(`py${i}`) * height;
    // integer screen-heights per loop → the drift wraps seamlessly (off the top edge)
    const k = random(`ps${i}`) > 0.6 ? 2 : 1;
    const y = (((y0 - ph * height * k) % height) + height) % height;
    const x = x0 + Math.sin(tau * (ph + random(`pw${i}`))) * 14;
    const size = 1 + random(`pz${i}`) * 2.2;
    const tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(tau * (ph * 2 + random(`pt${i}`))));
    return { x, y, size, tw };
  });

  // grid scroll: one cell per loop → seamless
  const cell = 90;
  const off = ph * cell;

  return (
    <AbsoluteFill style={{ background: P.bgDeep, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 45%, ${P.bg} 0%, ${P.bgDeep} 70%)`,
        }}
      />
      {/* perspective ledger floor */}
      <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: '50% 30%' }}>
        <div
          style={{
            position: 'absolute',
            left: '-50%',
            width: '200%',
            top: '52%',
            height: '120%',
            transform: 'rotateX(72deg)',
            transformOrigin: '50% 0%',
            backgroundImage: `linear-gradient(${P.line} 1px, transparent 1px), linear-gradient(90deg, ${P.line} 1px, transparent 1px)`,
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: `0px ${off}px`,
            opacity: 0.55 * intensity,
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 25%, black 55%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 25%, black 55%, transparent 100%)',
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${g1x}% ${g1y}%, ${glow} 0%, transparent 38%), radial-gradient(circle at ${g2x}% ${g2y}%, rgba(224,179,65,0.10) 0%, transparent 35%)`,
          opacity: intensity,
        }}
      />
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: i % 5 === 0 ? P.gold : P.primary,
            opacity: p.tw * 0.55 * intensity,
            boxShadow: `0 0 ${p.size * 4}px ${i % 5 === 0 ? P.gold : P.primary}`,
          }}
        />
      ))}
      {/* vignette */}
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${P.vignette} 100%)` }}
      />
    </AbsoluteFill>
  );
};
