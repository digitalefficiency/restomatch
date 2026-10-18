import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, Locale } from '../copy';
import { C, EASE_IN, EASE_OUT, FONT, lerp, prog } from '../theme';
import { RiseLine } from '../components/primitives';

// Line items on the paper invoices — real product names from the seeded catalog.
const ITEMS = [
  ['עגבניה שרי', '9.5', '10.00'],
  ['חזה עוף', '30', '21.60'],
  ['בירה מהחבית — חבית 30 ל׳', '2', '575.00'],
  ['פילה סלמון', '6', '96.00'],
  ['שמן זית כתית', '5', '25.00'],
  ['מוצרלה', '6', '42.21'],
  ['מלפפון חממה', '3', '15.00'],
  ['אנטריקוט', '4', '149.00'],
  ['חמאה', '4', '46.00'],
];

const Paper: React.FC<{ i: number; supplier: string; w: number; labels: (typeof COPY)['he']['problem'] }> = ({
  i,
  supplier,
  w,
  labels,
}) => {
  const rows = [0, 1, 2, 3].map((k) => ITEMS[(i * 2 + k) % ITEMS.length]);
  const s = w / 420;
  return (
    <div
      dir="rtl"
      style={{
        width: w,
        padding: 26 * s,
        boxSizing: 'border-box',
        background: `linear-gradient(170deg, ${C.paper} 0%, #e9e4d6 100%)`,
        borderRadius: 6 * s,
        color: C.paperInk,
        fontFamily: FONT.sans,
        boxShadow: '0 40px 80px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.4) inset',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: 26 * s }}>{supplier}</div>
        <div style={{ fontSize: 15 * s, opacity: 0.6, fontFamily: FONT.mono }}>{`#${24100 + i * 7}`}</div>
      </div>
      <div style={{ fontSize: 16 * s, opacity: 0.65, marginTop: 4 * s }}>{labels.invoice}</div>
      <div style={{ height: 2 * s, background: C.paperInk, opacity: 0.8, margin: `${14 * s}px 0 ${8 * s}px` }} />
      <div style={{ display: 'flex', fontSize: 13 * s, opacity: 0.55, fontWeight: 600 }}>
        <div style={{ flex: 1 }}>{labels.item}</div>
        <div style={{ width: 60 * s }}>{labels.qty}</div>
        <div style={{ width: 80 * s, textAlign: 'left' }}>{labels.price}</div>
      </div>
      {rows.map((r, k) => (
        <div
          key={k}
          style={{
            display: 'flex',
            fontSize: 17 * s,
            padding: `${7 * s}px 0`,
            borderBottom: `1px dashed rgba(34,38,31,0.25)`,
          }}
        >
          <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{r[0]}</div>
          <div style={{ width: 60 * s, fontFamily: FONT.mono }}>{r[1]}</div>
          <div style={{ width: 80 * s, textAlign: 'left', fontFamily: FONT.mono }}>{r[2]}</div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 * s, fontWeight: 800, fontSize: 19 * s }}>
        <div>{labels.total}</div>
        <div style={{ fontFamily: FONT.mono }}>{`₪${(1180 + i * 377).toLocaleString('en-US')}.00`}</div>
      </div>
    </div>
  );
};

const Stamp: React.FC<{ text: string; at: number; color?: string; dir: 'rtl' | 'ltr' }> = ({ text, at, color = C.danger, dir }) => {
  const f = useCurrentFrame();
  const p = prog(f, at, at + 10, EASE_OUT);
  if (f < at) return null;
  return (
    <div
      dir={dir}
      style={{
        position: 'absolute',
        top: '42%',
        left: '50%',
        transform: `translate(-50%,-50%) rotate(-9deg) scale(${lerp(2.2, 1, p)})`,
        opacity: p,
        padding: '10px 22px',
        border: `4px solid ${color}`,
        borderRadius: 10,
        color,
        background: 'rgba(255,255,255,0.82)',
        fontFamily: FONT.sans,
        fontWeight: 800,
        fontSize: 30,
        whiteSpace: 'nowrap',
        boxShadow: `0 0 30px ${color}66`,
      }}
    >
      {text}
    </div>
  );
};

/** 6–13 s: invoices pile up from depth; three of them carry a leak. */
export const Problem: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].problem;
  const tHe = COPY.he.problem;
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const vertical = height > width;
  const N = 9;
  const paperW = vertical ? 380 : 400;

  // pile centre: opposite side of the copy
  const isRtl = locale === 'he';
  const pileX = vertical ? width / 2 : isRtl ? width * 0.3 : width * 0.7;
  const pileY = vertical ? height * 0.6 : height * 0.52;

  // exit: everything collapses into a horizontal scan line (handoff to Match)
  const out = prog(f, 168, 196, EASE_IN);
  const shake = f > 60 && f < 168 ? Math.sin(f * 1.7) * 2.2 * (1 - out) : 0;

  const stamps = [
    { card: 2, text: t.stampPrice, at: 78 },
    { card: 5, text: t.stampShort, at: 96 },
    { card: 7, text: t.stampUnordered, at: 114 },
  ];

  return (
    <AbsoluteFill style={{ perspective: 1400, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.6}px)` }}>
        {new Array(N).fill(0).map((_, i) => {
          const at = 4 + i * 9;
          const p = prog(f, at, at + 26, EASE_OUT);
          const pPrev = prog(f - 1, at, at + 26, EASE_OUT);
          const speed = Math.abs(p - pPrev);
          const rx = (random(`x${i}`) - 0.5) * (vertical ? 520 : 600);
          const ry = (random(`y${i}`) - 0.5) * (vertical ? 760 : 360);
          const rot = (random(`r${i}`) - 0.5) * 34;
          const fromX = (random(`fx${i}`) - 0.5) * 2600;
          const fromY = (random(`fy${i}`) - 0.5) * 1400;
          const x = lerp(fromX, rx, p);
          const y = lerp(fromY, ry, p);
          const z = lerp(-2600, 0, p);
          const rz = lerp(rot * 4, rot, p);
          const rX = lerp(60, (random(`tx${i}`) - 0.5) * 14, p);
          const rY = lerp(-50, (random(`ty${i}`) - 0.5) * 18, p);
          // collapse
          const cx = lerp(x, 0, out);
          const cy = lerp(y, 0, out);
          const sy = 1 - out * 0.985;
          const stamp = stamps.find((s) => s.card === i);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: pileX - paperW / 2,
                top: pileY - paperW * 0.55,
                transform: `translate3d(${cx}px, ${cy}px, ${z}px) rotateX(${rX}deg) rotateY(${rY}deg) rotateZ(${rz * (1 - out)}deg) scaleY(${sy})`,
                filter: `blur(${Math.min(speed * 160, 14)}px) brightness(${0.7 + 0.3 * p})`,
                opacity: p > 0 ? 1 : 0,
                zIndex: i,
              }}
            >
              <div style={{ position: 'relative' }}>
                <Paper i={i} supplier={tHe.suppliers[i % tHe.suppliers.length]} w={paperW} labels={tHe} />
                {stamp ? <Stamp text={stamp.text} at={stamp.at} dir={dir} /> : null}
              </div>
            </div>
          );
        })}
        {/* the scan line the pile collapses into */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: pileY - 1,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${C.primary}, transparent)`,
            boxShadow: `0 0 40px ${C.primary}`,
            opacity: prog(f, 176, 186) * (1 - prog(f, 196, 206)),
            transform: `scaleX(${prog(f, 172, 196)})`,
          }}
        />
      </AbsoluteFill>

      {/* copy */}
      <div
        dir={dir}
        style={{
          position: 'absolute',
          top: vertical ? 170 : height * 0.3,
          [isRtl ? 'right' : 'left']: vertical ? 70 : 130,
          [isRtl ? 'left' : 'right']: vertical ? 70 : undefined,
          width: vertical ? undefined : 860,
          fontFamily: FONT.sans,
          color: C.ink,
          opacity: 1 - out,
        }}
      >
        <RiseLine at={10} style={{ fontSize: vertical ? 74 : 72, fontWeight: 800, lineHeight: 1.1 }}>
          {t.t1}
        </RiseLine>
        <RiseLine at={40} style={{ fontSize: vertical ? 74 : 72, fontWeight: 800, lineHeight: 1.1, color: C.muted }}>
          {t.t2}
        </RiseLine>
        <RiseLine at={80} style={{ fontSize: vertical ? 56 : 54, fontWeight: 700, lineHeight: 1.2, marginTop: 26, color: C.danger }}>
          {t.t3}
        </RiseLine>
      </div>
    </AbsoluteFill>
  );
};
