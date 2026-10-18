import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, Locale } from '../copy';
import { C, EASE_IN, EASE_OUT, FONT, lerp, prog } from '../theme';
import { RiseLine } from '../components/primitives';

// Paper invoice props: each supplier sells what it really sells (seeded catalog names),
// every line total = qty × price, and the total is the sum of the lines.
type Row = [string, number, number]; // item, qty, unit price
const INVOICES: { supplier: string; rows: Row[] }[] = [
  { supplier: 'ירקות השרון', rows: [['עגבניות שרי', 15, 14], ['מלפפונים', 12, 5.87], ['חסה ערבית', 20, 4.5], ['כוסברה', 10, 3.01]] },
  { supplier: 'דגי הים התיכון', rows: [['פילה סלמון', 6, 96]] },
  { supplier: 'משקאות שטיינברג', rows: [['בירה מהחבית — חבית 30 ל׳', 2, 575]] },
  { supplier: 'מחלבות הגליל', rows: [['מוצרלה', 6, 42.21], ['חמאה', 4, 46], ['חלב 3%', 37.5, 6.43], ['גבינה בולגרית', 4.5, 37.81]] },
  { supplier: 'קצביית הכרם', rows: [['אנטריקוט', 4, 149], ['חזה עוף', 30, 21.6]] },
];
const CARD_INVOICE = [0, 1, 2, 3, 4, 0, 1, 3, 4]; // card i → invoice
const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const lineTotal = (r: Row) => Math.round(r[1] * r[2] * 100) / 100;

const Paper: React.FC<{ i: number; w: number; labels: (typeof COPY)['he']['problem'] }> = ({ i, w, labels }) => {
  const inv = INVOICES[CARD_INVOICE[i]];
  const total = inv.rows.reduce((acc, r) => acc + lineTotal(r), 0);
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
        <div style={{ fontWeight: 800, fontSize: 26 * s }}>{inv.supplier}</div>
        <div style={{ fontSize: 15 * s, opacity: 0.6, fontFamily: FONT.mono }}>{`#${24100 + i * 7}`}</div>
      </div>
      <div style={{ fontSize: 16 * s, opacity: 0.65, marginTop: 4 * s }}>{labels.invoice}</div>
      <div style={{ height: 2 * s, background: C.paperInk, opacity: 0.8, margin: `${14 * s}px 0 ${8 * s}px` }} />
      <div style={{ display: 'flex', fontSize: 13 * s, opacity: 0.55, fontWeight: 600 }}>
        <div style={{ flex: 1 }}>{labels.item}</div>
        <div style={{ width: 48 * s }}>{labels.qty}</div>
        <div style={{ width: 64 * s }}>{labels.price}</div>
        <div style={{ width: 84 * s, textAlign: 'left' }}>{labels.total}</div>
      </div>
      {inv.rows.map((r, k) => (
        <div key={k} style={{ display: 'flex', fontSize: 16 * s, padding: `${7 * s}px 0`, borderBottom: '1px dashed rgba(34,38,31,0.25)' }}>
          <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[0]}</div>
          <div style={{ width: 48 * s, fontFamily: FONT.mono }}>{r[1]}</div>
          <div style={{ width: 64 * s, fontFamily: FONT.mono }}>{r[2].toFixed(2)}</div>
          <div style={{ width: 84 * s, textAlign: 'left', fontFamily: FONT.mono }}>{lineTotal(r).toFixed(2)}</div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 * s, fontWeight: 800, fontSize: 19 * s }}>
        <div>{labels.total}</div>
        <bdi dir="rtl" style={{ fontFamily: FONT.mono }}>{money(total)}</bdi>
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
  const pileX = vertical ? width / 2 : isRtl ? width * 0.27 : width * 0.73;
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
          const rx = (random(`x${i}`) - 0.5) * (vertical ? 520 : 520);
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
                <Paper i={i} w={paperW} labels={tHe} />
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
          width: vertical ? undefined : 800,
          zIndex: 50,
          fontFamily: FONT.sans,
          color: C.ink,
          opacity: 1 - out,
        }}
      >
        <RiseLine at={10} style={{ fontSize: vertical ? 74 : 68, fontWeight: 800, lineHeight: 1.1 }}>
          {t.t1}
        </RiseLine>
        <RiseLine at={40} style={{ fontSize: vertical ? 74 : 68, fontWeight: 800, lineHeight: 1.1, color: C.muted }}>
          {t.t2}
        </RiseLine>
        <RiseLine at={80} style={{ fontSize: vertical ? 56 : 48, fontWeight: 700, lineHeight: 1.2, marginTop: 26, color: C.danger }}>
          {t.t3}
        </RiseLine>
      </div>
    </AbsoluteFill>
  );
};
