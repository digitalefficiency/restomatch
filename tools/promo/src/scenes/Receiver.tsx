import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, LINES, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, lerp, prog } from '../theme';
import { Phone, phoneScreen, Screen } from '../components/Devices';
import { FadeUp, RiseLine } from '../components/primitives';

export const RECEIVER_DURATION = 230;

/** One invoice line that is scanned and re-typeset from Hebrew into English. */
const MorphLine: React.FC<{ i: number; at: number; w: number }> = ({ i, at, w }) => {
  const f = useCurrentFrame();
  const l = LINES[i];
  const p = prog(f, at, at + 26, EASE_IN_OUT); // beam progress across the line (right → left)
  const appear = prog(f, 8 + i * 5, 26 + i * 5);
  const flagColor = l.flag === 'price' ? C.gold : l.flag === 'qty' ? C.gold : C.primary;
  const beamX = (1 - p) * w; // from the right edge (where Hebrew starts) to the left
  const done = prog(f, at + 18, at + 30);
  return (
    <div
      style={{
        position: 'relative',
        height: 92,
        width: w,
        marginBottom: 14,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 30}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 18,
          background: lerp(0, 1, done) > 0.5 ? C.surface : 'rgba(244,241,232,0.06)',
          border: `1.5px solid ${done > 0.5 ? flagColor + '66' : 'rgba(244,241,232,0.18)'}`,
        }}
      />
      {/* Hebrew (paper) — visible left of the beam */}
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          inset: 0,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          clipPath: `inset(0 ${w - beamX}px 0 0)`,
          fontFamily: FONT.sans,
          color: C.paper,
          fontSize: 36,
          fontWeight: 600,
          filter: `blur(${p * 2}px)`,
        }}
      >
        <span>{l.he}</span>
        <span style={{ fontFamily: FONT.sans, fontSize: 30, opacity: 0.8 }}>
          {l.qty} · <bdi dir="ltr">{l.price}</bdi>
        </span>
      </div>
      {/* English — revealed behind the beam */}
      <div
        dir="ltr"
        style={{
          position: 'absolute',
          inset: 0,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          clipPath: `inset(0 0 0 ${beamX}px)`,
          fontFamily: FONT.sans,
          color: C.ink,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 36, fontWeight: 700 }}>{l.en}</span>
          <span dir="rtl" style={{ fontSize: 20, color: C.subtle, textAlign: 'left' }}>
            {l.he}
          </span>
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: 28, color: C.muted }}>
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

export const Receiver: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].receiver;
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const vertical = height > width;
  const side = isRtl ? -1 : 1;

  const PW = vertical ? 520 : 470;
  const { w: psw, h: psh } = phoneScreen(PW);
  const enter = prog(f, 0, 34);
  const exit = prog(f, RECEIVER_DURATION - 22, RECEIVER_DURATION, EASE_IN);
  // phone screen: receiving inbox → reconciliation (English lines + Hebrew under)
  const swap = prog(f, 96, 112, EASE_IN_OUT);
  const scroll = lerp(0, 0.75, prog(f, 120, 200, EASE_IN_OUT)) * psw;
  const ry = lerp(-28 * side, -10 * side, enter) + Math.sin(f / 40) * 2;

  const lineW = vertical ? 900 : 880;

  const phone = (
    <div
      style={{
        transform: `translateY(${(1 - enter) * 600 + exit * -80}px) rotateY(${ry}deg) rotateX(${lerp(30, 6, enter)}deg) rotateZ(${-2 * side}deg)`,
        opacity: 1 - exit,
        transformStyle: 'preserve-3d',
      }}
    >
      <Phone width={PW} glare={ry / 30}>
        <Screen src="shots/receiving-po-en.png" width={psw} opacity={1 - swap} />
        <Screen src="shots/reconcile-en.png" width={psw} scroll={scroll} opacity={swap} />
      </Phone>
    </div>
  );

  const copy = (
    <div dir={dir} style={{ fontFamily: FONT.sans, color: C.ink, opacity: 1 - exit }}>
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
      <RiseLine at={12} style={{ fontSize: vertical ? 64 : 62, fontWeight: 800, lineHeight: 1.08, marginTop: 24, whiteSpace: 'nowrap' }}>
        {t.title}
      </RiseLine>
      <RiseLine at={22} style={{ fontSize: vertical ? 64 : 62, fontWeight: 800, lineHeight: 1.08, color: C.primary }}>
        {t.title2}
      </RiseLine>
      <FadeUp at={34}>
        <div style={{ fontSize: 30, color: C.muted, marginTop: 20, lineHeight: 1.4, maxWidth: lineW }}>{t.sub}</div>
      </FadeUp>
      <div style={{ marginTop: 34 }} dir="ltr">
        {LINES.map((_, i) => (
          <MorphLine key={i} i={i} at={58 + i * 16} w={lineW} />
        ))}
      </div>
    </div>
  );

  if (vertical) {
    return (
      <AbsoluteFill style={{ perspective: 1800, alignItems: 'center' }}>
        <div style={{ position: 'absolute', top: 120, left: 90, right: 90 }}>{copy}</div>
        <div style={{ position: 'absolute', top: 1180, transform: 'scale(0.62)', transformOrigin: 'top center' }}>{phone}</div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ perspective: 1800 }}>
      <div
        style={{
          position: 'absolute',
          top: height / 2 - (psh + PW * 0.08) / 2,
          left: width / 2 + side * 560 - PW / 2,
        }}
      >
        {phone}
      </div>
      <div style={{ position: 'absolute', top: 120, [isRtl ? 'right' : 'left']: 110, width: lineW }}>{copy}</div>
    </AbsoluteFill>
  );
};
