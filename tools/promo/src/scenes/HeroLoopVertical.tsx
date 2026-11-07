import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText } from '../copy';
import { FONT, LIGHT } from '../theme';
import { Background } from '../components/Background';
import { Chip } from '../components/primitives';
import { HERO_LOOP_FRAMES } from './HeroLoop';

/**
 * Portrait (9:16) landing hero loop for phones, Hebrew / light. Instead of a whole dashboard
 * on a device (unreadable at 390 px), it shows two REAL cards at about their native phone
 * scale: the leak hero from the 390 px dashboard capture and the top approvals task card.
 * Like HeroLoop, every motion is periodic in the 12 s loop, so frame 360 = frame 0.
 */

// Source crops in image px of the 2× captures (public/shots), measured on the files and
// framed tight to the right-aligned (RTL) content so the text stays legible at 390 px:
// - hero: stops above the wrapped "…לפני / מע״מ" line; the trailing "מתוך ₪42,263 לפני" is covered;
// - task: badge + title, product, estimated loss; the product line is cut after "חבית 30 ל׳".
const HERO = { src: 'shots/dashboard-he-phone.png', imgW: 780, x: 340, y: 1030, w: 388, h: 278, cover: { x: 300, y: 1266, w: 54, h: 42 } };
const TASK = { src: 'shots/approvals-he.png', imgW: 2880, x: 2090, y: 880, w: 420, h: 170, cover: { x: 2088, y: 924, w: 101, h: 50 } };

type Crop = { src: string; imgW: number; x: number; y: number; w: number; h: number; cover?: { x: number; y: number; w: number; h: number } };

/** A crop of a real capture, scaled to `width`, inside a light card with a tone rail (T1/T2). */
const CropCard: React.FC<{ crop: Crop; width: number; rail: string; pad: number; style?: React.CSSProperties }> = ({ crop, width, rail, pad, style }) => {
  const k = (width - pad * 2) / crop.w;
  return (
    <div
      style={{
        position: 'relative',
        width,
        padding: pad,
        boxSizing: 'border-box',
        background: '#FFFFFF',
        borderRadius: 36,
        border: `2px solid ${rail}33`,
        boxShadow: '0 2px 4px rgba(15,31,23,0.06), 0 30px 70px rgba(15,31,23,0.14)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 12, background: rail }} />
      <div style={{ position: 'relative', width: crop.w * k, height: crop.h * k, overflow: 'hidden' }}>
        <Img src={staticFile(crop.src)} style={{ position: 'absolute', width: crop.imgW * k, left: -crop.x * k, top: -crop.y * k, maxWidth: 'none' }} />
        {crop.cover ? (
          <div
            style={{
              position: 'absolute',
              left: (crop.cover.x - crop.x) * k,
              top: (crop.cover.y - crop.y) * k,
              width: crop.cover.w * k,
              height: crop.cover.h * k,
              background: '#FFFFFF',
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

export const HeroLoopVertical: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY.he;
  const K = LIGHT;
  const ph = (f % HERO_LOOP_FRAMES) / HERO_LOOP_FRAMES;
  const tau = Math.PI * 2;
  const wave = (k: number, amp: number, n = 1) => amp * Math.sin(tau * (ph * n + k));
  const breathe = (k: number) => 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(tau * (ph + k)));

  const cardW = Math.round(width * 0.89); // title-safe: 5.5% each side
  // scan beam over the hero card, strictly inside the loop (20%–50%)
  const beamT = (ph - 0.2) / 0.3;
  const beamOn = beamT > 0 && beamT < 1;
  // the leak number gets a soft danger halo that peaks once per loop
  const halo = 0.5 + 0.5 * Math.sin(tau * (ph - 0.25));

  return (
    <AbsoluteFill dir="rtl" style={{ background: K.bgDeep, fontFamily: FONT.sans }}>
      <Background period={HERO_LOOP_FRAMES} intensity={0.7} light />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: height * 0.035, paddingBottom: height * 0.03 }}>
        <div style={{ position: 'relative', transform: `translateY(${wave(0, 10)}px)` }}>
          <CropCard crop={HERO} width={cardW} rail={K.danger} pad={44} style={{ boxShadow: `0 2px 4px rgba(15,31,23,0.06), 0 30px 70px rgba(15,31,23,0.14), 0 0 ${90 * halo}px ${K.danger}${Math.round(30 + 40 * halo).toString(16)}` }} />
          {beamOn ? (
            <div
              style={{
                position: 'absolute',
                left: 24,
                right: 24,
                top: `${8 + beamT * 84}%`,
                height: 3,
                background: `linear-gradient(90deg, transparent, ${K.primary}, transparent)`,
                boxShadow: `0 0 30px 6px ${K.primary}55`,
                opacity: Math.sin(Math.PI * beamT),
              }}
            />
          ) : null}
        </div>
        <div style={{ transform: `translateY(${wave(0.33, 10)}px)` }}>
          <CropCard crop={TASK} width={cardW} rail={K.danger} pad={40} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, marginTop: height * 0.01 }}>
          <div style={{ opacity: breathe(0), transform: `translateY(${wave(0.1, 8, 2)}px)` }}>
            <Chip accent={K.gold} light style={{ fontSize: 40, padding: '18px 34px' }}>
              <span>{t.loopVertical.held}</span>
              <bdi dir="rtl" style={{ color: K.danger, fontWeight: 800 }}>{ilsText(FACTS.apprAmount, 'he', 2)}</bdi>
            </Chip>
          </div>
          <div style={{ opacity: breathe(0.5), transform: `translateY(${wave(0.6, 8, 2)}px)` }}>
            <Chip accent={K.primary} light style={{ fontSize: 40, padding: '18px 34px' }}>
              <span>{t.loopVertical.claim}</span>
            </Chip>
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', bottom: height * 0.05, left: width * 0.055, fontSize: 30, color: K.muted, letterSpacing: '0.04em' }}>
        {t.loop.chip}
      </div>
    </AbsoluteFill>
  );
};
