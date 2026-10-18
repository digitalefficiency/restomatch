import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, LINES, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, lerp, prog } from '../theme';
import { zones } from '../layout';
import { CaptionZone, Callout, DeviceZone, Spotlight } from '../components/Stage';
import { Phone, phoneScreen, Screen } from '../components/Devices';
import { FadeUp, RiseLine } from '../components/primitives';

export const RECEIVER_DURATION = 250;

// Strips to blur on the phone captures (units of image width): the demo e-mail line, and the
// local dev-OCR-stub line ("Invoice DEV-… · OCR confidence 100%") — not what a customer sees.
const EMAIL = { y: 0.105, h: 0.04, x: 0.16, w: 0.62 };
const STUB = { y: 0.715, h: 0.05, x: 0.03, w: 0.94 };

/** One invoice line that is scanned and re-typeset from Hebrew into English. */
const MorphLine: React.FC<{ i: number; at: number; w: number }> = ({ i, at, w }) => {
  const k = Math.min(1, w / 760); // type scale for narrow panels
  const f = useCurrentFrame();
  const l = LINES[i];
  // phase 1: the beam sweeps right→left and wipes the Hebrew away behind it;
  // phase 2: only after the line is empty, the English rises in. Never both at once.
  const p = prog(f, at, at + 22, EASE_IN_OUT);
  const appear = prog(f, 8 + i * 5, 26 + i * 5);
  const flagColor = l.flag ? C.gold : C.primary;
  const beamX = (1 - p) * w;
  const en = prog(f, at + 20, at + 34);
  const done = en;
  return (
    <div
      style={{
        position: 'relative',
        height: 92 * k,
        width: w,
        marginBottom: 14 * k,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 30}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 18,
          background: done > 0.5 ? C.surface : 'rgba(244,241,232,0.06)',
          border: `1.5px solid ${done > 0.5 ? flagColor + '66' : 'rgba(244,241,232,0.18)'}`,
        }}
      />
      {/* Hebrew (paper) — visible left of the beam */}
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          inset: 0,
          padding: `0 ${24 * k}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          clipPath: `inset(0 ${w - beamX}px 0 0)`,
          opacity: p < 1 ? 1 : 0,
          fontFamily: FONT.sans,
          color: C.paper,
          fontSize: 36 * k,
          fontWeight: 600,
          filter: `blur(${p * 2}px)`,
        }}
      >
        <span>{l.he}</span>
        <span style={{ fontFamily: FONT.sans, fontSize: 28 * k, opacity: 0.8 }}>
          {l.qty} · <bdi dir="rtl">{`${l.price.replace('₪', '')} ₪`}</bdi>
        </span>
      </div>
      {/* English — revealed behind the beam */}
      <div
        dir="ltr"
        style={{
          position: 'absolute',
          inset: 0,
          padding: `0 ${24 * k}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: en,
          transform: `translateY(${(1 - en) * 18}px)`,
          filter: `blur(${(1 - en) * 6}px)`,
          fontFamily: FONT.sans,
          color: C.ink,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 36 * k, fontWeight: 700 }}>{l.en}</span>
          <span dir="rtl" style={{ fontSize: 20 * k, color: C.subtle, textAlign: 'left' }}>
            {l.he}
          </span>
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: 26 * k, color: C.muted }}>
          {l.qtyEn} × {l.price}
        </span>
      </div>
      {p > 0 && p < 1 ? (
        <div
          style={{
            position: 'absolute',
            top: -6,
            bottom: -6,
            left: beamX - 2,
            width: 4,
            background: C.primary,
            boxShadow: `0 0 26px 6px ${C.primary}aa`,
            borderRadius: 4,
          }}
        />
      ) : null}
    </div>
  );
};

// Cherry-tomatoes card on the real English reconciliation (units of the 390-px screen width).
const CARD = { x0: 0.054, y0: 1.965, x1: 0.946, y1: 2.35 };
const TOP = 0.11; // status-bar inset
const SCROLL = 1.19; // brings the card to mid-screen

export const Receiver: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].receiver;
  const isRtl = locale === 'he';
  const vertical = height > width;
  const { device } = zones(width, height, locale);
  const m = 40;
  const PW = Math.round(Math.min(device.w * 0.38, vertical ? 420 : 440));
  const { w: psw, h: psh } = phoneScreen(PW);
  const phoneH = psh + Math.round(PW * 0.04) * 2;
  const panelW = device.w - PW - m * 3;
  const D = RECEIVER_DURATION;

  const enter = prog(f, 0, 34);
  const exit = prog(f, D - 18, D, EASE_IN);
  const swap = prog(f, 120, 136, EASE_IN_OUT);
  const scrollU = SCROLL * prog(f, 128, 160, EASE_IN_OUT);
  const pin = prog(f, 160, 188, EASE_IN_OUT);
  const spot = prog(f, 182, 194) * (1 - prog(f, 232, 244));
  const ca = prog(f, 186, 198) * (1 - prog(f, 234, 244));
  const panelOut = prog(f, 154, 170);

  // phone placement (device-zone px): left part of the zone, vertically centred
  const phoneX = m;
  const phoneY = (device.h - phoneH) / 2;
  const frame = Math.round(PW * 0.04);
  const rect = {
    x: CARD.x0 * psw,
    y: (CARD.y0 - scrollU + TOP) * psw,
    w: (CARD.x1 - CARD.x0) * psw,
    h: (CARD.y1 - CARD.y0) * psw,
  };
  // camera push: the card centre → device centre, card width → 80% of the zone
  const target = Math.min((device.w * 0.8) / rect.w, (device.h * 0.55) / rect.h, 2.6);
  const zoom = 1 + (target - 1) * pin;
  const cx = phoneX + frame + rect.x + rect.w / 2;
  const cy = phoneY + frame + rect.y + rect.h / 2;
  const tx = (device.w / 2 - cx) * pin;
  const ty = (device.h / 2 - cy) * pin;
  const ry = lerp(-24, -8, enter) * (isRtl ? -1 : 1) * (1 - pin);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <DeviceZone locale={locale} perspective={1800}>
        {/* camera group: phone (+ panel) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: `${cx}px ${cy}px`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: phoneX,
              top: phoneY,
              transform: `translateY(${(1 - enter) * 500}px) rotateY(${ry}deg) rotateX(${lerp(26, 4, enter) * (1 - pin)}deg)`,
              opacity: enter,
            }}
          >
            <Phone width={PW} glare={ry / 30}>
              <Screen src="shots/receiving-po-en.png" width={psw} opacity={1 - swap} top={psw * TOP} redact={[EMAIL]} />
              <Screen src="shots/reconcile-en.png" width={psw} scroll={scrollU * psw} opacity={swap} top={psw * TOP} redact={[EMAIL, STUB]} />
              {/* status bar: scrolled content passes under it, never under the island */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: psw * TOP, background: C.bg }} />
              <Spotlight
                rect={rect}
                a={spot}
                src="shots/reconcile-en.png"
                imgWidth={psw}
                imgTop={(TOP - scrollU) * psw}
                screenW={psw}
                screenH={psh}
                accent={C.primary}
              />
            </Phone>
          </div>
        </div>
        {/* Hebrew → English morph panel (designed, built from the same real lines) */}
        <div
          dir="ltr"
          style={{
            position: 'absolute',
            left: phoneX + PW + m,
            top: device.h / 2 - 260,
            width: panelW,
            opacity: enter * (1 - panelOut),
            transform: `translateX(${panelOut * 40}px)`,
          }}
        >
          <div dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: FONT.sans, color: C.subtle, fontSize: 22, marginBottom: 18, letterSpacing: '0.03em' }}>
            {t.paper}
          </div>
          {LINES.map((_, i) => (
            <MorphLine key={i} i={i} at={50 + i * 18} w={panelW} />
          ))}
        </div>
      </DeviceZone>

      <CaptionZone locale={locale} justify={vertical ? 'flex-start' : 'center'}>
        <div style={{ fontFamily: FONT.sans, color: C.ink }}>
          <FadeUp at={6}>
            <div
              style={{
                display: 'inline-block',
                padding: '8px 20px',
                borderRadius: 99,
                background: `${C.gold}22`,
                border: `1.5px solid ${C.gold}88`,
                color: C.gold,
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              {t.badge}
            </div>
          </FadeUp>
          <RiseLine at={12} style={{ fontSize: vertical ? 64 : 60, fontWeight: 800, lineHeight: 1.08, marginTop: 24 }}>
            {t.title}
          </RiseLine>
          <RiseLine at={22} style={{ fontSize: vertical ? 64 : 60, fontWeight: 800, lineHeight: 1.08, color: C.primary }}>
            {t.title2}
          </RiseLine>
          <FadeUp at={34}>
            <div style={{ fontSize: 30, color: C.muted, marginTop: 20, lineHeight: 1.4 }}>{t.sub}</div>
          </FadeUp>
          <Callout locale={locale} a={ca} accent={C.primary}>
            <span dir="ltr">Cherry tomatoes</span>
            <span style={{ color: C.muted, fontWeight: 500 }}>
              ← <bdi dir="rtl">עגבניות שרי</bdi>
            </span>
          </Callout>
        </div>
      </CaptionZone>
    </AbsoluteFill>
  );
};
