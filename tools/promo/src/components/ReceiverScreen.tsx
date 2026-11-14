import React from 'react';
import { FILM, LINES } from '../copy';
import { FONT } from '../theme';
import { SAMPLE_TONES as T } from './SampleCards';

/**
 * The receiver's phone, drawn (not captured): the app's English receiving flow on the sample
 * restaurant — names, quantities and states only. The receiver never sees ₪ (apps/web receiving
 * UI; the film's frame check asserts no ₪ in this beat). Strings mirror
 * apps/web/lib/i18n/messages/receiving/en.ts. Laid out on a virtual 390×844 screen (CSS px),
 * scaled by u = screenWidth / 390, so the focus card's rect is exact (RECEIVER_CARD).
 */
export type ReceiverView = 'result' | 'check';
const VW = 390;
export const RECEIVER_TOP = 46; // status bar / island inset, CSS px

/** The short line's card on the "Delivery check" screen, in CSS px of the 390-wide screen. */
export const RECEIVER_CARD = { x: 18, y: 318, w: 354, h: 262 };

const R = {
  brand: 'Sample restaurant',
  sample: 'Sample',
  supplier: 'HaSharon Produce',
  resultTitle: 'Check result',
  resultSub: 'Receive from HaSharon Produce',
  section: `On the order and the invoice · ${LINES.length}`,
  matched: 'Invoice = order',
  continue: 'Continue to the delivery check',
  checkTitle: 'Delivery check',
  checkSub: `1 line left · ${LINES.length - 1} checked · ${LINES.length - 1} as invoiced`,
  matchedSummary: `${LINES.length - 1} lines — invoice = order`,
  ordered: 'Ordered',
  invoiced: 'Invoiced',
  qtyLabel: 'Quantity received',
  missing: 'Missing',
  damaged: 'Damaged',
  close: 'Close the receipt',
};

const unit = (qtyEn: string) => qtyEn.replace(/^[\d.]+\s*/, '');

export const ReceiverScreen: React.FC<{ view: ReceiverView; sw: number; sh: number }> = ({ view, sw, sh }) => {
  const u = sw / VW;
  const px = (n: number) => n * u;
  const short = LINES.find((l) => l.flag === 'qty') ?? LINES[0];
  const kg = unit(short.qtyEn);
  const abs = (x: number, y: number, w: number, h: number, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    left: px(x),
    top: px(y),
    width: px(w),
    height: px(h),
    boxSizing: 'border-box',
    ...extra,
  });
  const chip = (text: string, fg: string, bg: string) => (
    <span style={{ fontSize: px(11.5), fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: `${px(3)}px ${px(9)}px`, whiteSpace: 'nowrap' }}>{text}</span>
  );
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: T.surface,
    border: `${Math.max(1, px(1))}px solid ${T.line}`,
    borderRadius: px(14),
    ...extra,
  });

  return (
    <div dir="ltr" style={{ position: 'relative', width: sw, height: sh, background: T.bg, fontFamily: FONT.sans, color: T.ink, overflow: 'hidden', fontVariantNumeric: 'tabular-nums' }}>
      {/* app bar */}
      <div style={abs(0, RECEIVER_TOP, VW, 52, { background: T.surface, borderBottom: `${Math.max(1, px(1))}px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: px(10), padding: `0 ${px(18)}px` })}>
        <span style={{ fontSize: px(16), fontWeight: 800 }}>{R.brand}</span>
        {chip(R.sample, T.gold, `${T.gold}1f`)}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: px(12.5), fontWeight: 600, color: T.muted }}>{R.supplier}</span>
      </div>

      {view === 'result' ? (
        <>
          <div style={abs(18, 116, 354, 34, { fontSize: px(24), fontWeight: 800 })}>{R.resultTitle}</div>
          <div style={abs(18, 152, 354, 22, { fontSize: px(13.5), color: T.muted })}>{R.resultSub}</div>
          <div style={abs(18, 192, 354, 20, { fontSize: px(12.5), fontWeight: 700, color: T.muted })}>{R.section}</div>
          {LINES.map((l, i) => (
            <div key={l.en} style={abs(18, 218 + i * 92, 354, 80, card({ padding: `${px(12)}px ${px(14)}px`, display: 'flex', flexDirection: 'column', gap: px(4) }))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: px(8) }}>
                <span style={{ fontSize: px(16), fontWeight: 700, flex: 1 }}>{l.en}</span>
                {chip(R.matched, T.primary, `${T.primary}14`)}
              </div>
              <span dir="rtl" style={{ fontSize: px(12), color: T.muted, textAlign: 'left' }}>{l.he}</span>
              <span style={{ fontSize: px(12.5), color: T.muted }}>{`${R.ordered} ${l.qtyEn} · ${R.invoiced} ${l.qtyEn}`}</span>
            </div>
          ))}
          <div style={abs(18, 600, 354, 48, { background: T.primary, color: '#FFFFFF', borderRadius: px(12), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(15), fontWeight: 800 })}>
            {R.continue}
          </div>
        </>
      ) : (
        <>
          <div style={abs(18, 116, 354, 34, { fontSize: px(24), fontWeight: 800 })}>{R.checkTitle}</div>
          <div style={abs(18, 152, 354, 22, { fontSize: px(13.5), color: T.muted })}>{R.checkSub}</div>
          <div style={abs(18, 196, 354, 52, card({ display: 'flex', alignItems: 'center', gap: px(10), padding: `0 ${px(14)}px`, background: T.surface2 }))}>
            <span style={{ width: px(9), height: px(9), borderRadius: 99, background: T.primary }} />
            <span style={{ fontSize: px(14), fontWeight: 700, flex: 1 }}>{R.matchedSummary}</span>
            <span style={{ fontSize: px(14), color: T.muted }}>▾</span>
          </div>
          <div style={abs(18, 262, 354, 40, { display: 'flex', flexWrap: 'wrap', gap: px(6), alignContent: 'center' })}>
            {LINES.filter((l) => l !== short).map((l) => (
              <span key={l.en} style={{ fontSize: px(11.5), color: T.muted, border: `${Math.max(1, px(1))}px solid ${T.line}`, borderRadius: 999, padding: `${px(2)}px ${px(8)}px` }}>{`${l.en} ✓`}</span>
            ))}
          </div>
          {/* the short line — the beat's focus */}
          <div
            style={abs(RECEIVER_CARD.x, RECEIVER_CARD.y, RECEIVER_CARD.w, RECEIVER_CARD.h, card({
              border: `${Math.max(1.5, px(1.5))}px solid ${T.warn}66`,
              padding: `${px(14)}px ${px(16)}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: px(8),
            }))}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: px(8) }}>
              <span style={{ fontSize: px(18), fontWeight: 800, flex: 1 }}>{short.en}</span>
              {chip(`Short ${FILM.delivery.ordered - FILM.delivery.received} ${kg}`, '#FFFFFF', T.warn)}
            </div>
            <span dir="rtl" style={{ fontSize: px(13), color: T.muted, textAlign: 'left' }}>{short.he}</span>
            <span style={{ fontSize: px(13.5), color: T.muted }}>{`${R.ordered}: ${FILM.delivery.ordered} ${kg} · ${R.invoiced}: ${FILM.delivery.ordered} ${kg}`}</span>
            <span style={{ fontSize: px(12.5), fontWeight: 700, color: T.muted, marginTop: px(4) }}>{R.qtyLabel}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: px(12) }}>
              {['−', `${FILM.delivery.received} ${kg}`, '+'].map((x, i) => (
                <span
                  key={x}
                  style={{
                    flex: i === 1 ? 1 : 'none',
                    width: i === 1 ? undefined : px(44),
                    height: px(44),
                    borderRadius: px(12),
                    border: `${Math.max(1, px(1))}px solid ${i === 1 ? T.warn : T.line}`,
                    background: i === 1 ? `${T.warn}0f` : T.surface2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: px(i === 1 ? 20 : 22),
                    fontWeight: 800,
                    color: i === 1 ? T.warn : T.ink,
                  }}
                >
                  {x}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: px(8), marginTop: px(2) }}>
              {[R.missing, R.damaged].map((x) => (
                <span key={x} style={{ flex: 1, textAlign: 'center', fontSize: px(13), fontWeight: 700, color: T.ink, background: T.surface2, borderRadius: px(10), padding: `${px(8)}px 0` }}>
                  {x}
                </span>
              ))}
            </div>
          </div>
          <div style={abs(18, 600, 354, 48, { background: T.primary, color: '#FFFFFF', borderRadius: px(12), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(15), fontWeight: 800 })}>
            {R.close}
          </div>
        </>
      )}
    </div>
  );
};
