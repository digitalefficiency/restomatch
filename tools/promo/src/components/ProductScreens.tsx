import React from 'react';
import { ilsText, Locale, SAMPLE } from '../copy';
import { FONT } from '../theme';
import { SampleGoodNews, SampleHeroCard, SampleNeedsCard, SAMPLE_TONES as T } from './SampleCards';

/**
 * The film's product beats drawn from components on the site's sample month (copy.ts SAMPLE =
 * sampleMonth.ts) instead of demo-seed screenshots. Each screen is laid out on a virtual 1200×750
 * CSS canvas (the laptop's 16:10 screen) scaled by u = screenWidth / 1200, so the focus rect of
 * every beat is known exactly (focusRect) for the camera push and the spotlight.
 */
export type BeatKey = 'dashboard' | 'leaks' | 'approvals' | 'claims';
type Box = { x: number; y: number; w: number; h: number }; // CSS px, x from the inline-start edge

const VW = 1200;
const BOX: Record<BeatKey, Record<string, Box>> = {
  dashboard: { focus: { x: 40, y: 150, w: 520, h: 300 }, needs: { x: 600, y: 150, w: 560, h: 230 }, good: { x: 600, y: 400, w: 560, h: 50 } },
  leaks: { focus: { x: 40, y: 316, w: 600, h: 56 } },
  approvals: { focus: { x: 40, y: 222, w: 600, h: 150 } },
  claims: { focus: { x: 40, y: 222, w: 640, h: 262 } },
};

const S = {
  he: {
    brand: 'מסעדה לדוגמה',
    sample: 'דוגמה',
    nav: ['סקירה', 'קליטת סחורה', 'תור החלטות', 'בלש הדליפות', 'בקשות זיכוי'],
    navOf: { dashboard: 0, leaks: 3, approvals: 2, claims: 4 } as Record<BeatKey, number>,
    title: { dashboard: 'לוח הבעלים', leaks: 'בלש הדליפות', approvals: 'תור החלטות', claims: 'בקשות זיכוי' } as Record<BeatKey, string>,
    sub: {
      dashboard: 'איפה כסף בורח — ומה מחכה להחלטה שלך עכשיו.',
      leaks: 'המחיר האחרון מול החציון ההיסטורי, לפי ספק ומוצר.',
      approvals: 'פערים על חשבוניות שעוד לא שולמו — לפני התשלום.',
      claims: 'פערים על חשבוניות ששולמו — בקשת זיכוי מנומסת לכל ספק.',
    } as Record<BeatKey, string>,
    kpi: ['דליפה החודש', 'מהקניות שנבדקו', 'קניות שנבדקו', 'חשבוניות עם פער'],
    cols: ['מוצר', 'ספק', 'חציון', 'מחיר אחרון', 'שינוי'],
    rows: [
      ['בירה מהחבית — חבית 30 ל׳', 'משקאות שטיינברג', 520, 575, '+10.6%'],
      ['אנטריקוט', 'קצביית הכרם', 139, 149, '+7.2%'],
      ['פילה סלמון', 'דגי הים התיכון', 89, 96, '+7.9%'],
    ] as [string, string, number, number, string][],
    decide: 'ממתין להחלטה שלך',
    credit: 'בקשות זיכוי לשליחה',
    gaps: (n: number) => `${n} פערים`,
    priceHigh: 'מחיר גבוה מהמצופה',
    overBilled: 'חיוב על יותר ממה שהתקבל',
    kegLine: 'חבית 30 ל׳ · משקאות שטיינברג',
    loss: 'ההפסד המוערך',
    approve: 'אישור',
    reject: 'דחייה',
    askCredit: 'בקשת זיכוי',
    claims: [
      ['קצביית הכרם', 'אנטריקוט', 300],
      ['דגי הים התיכון', 'פילה סלמון', 240],
      ['ירקות השרון', 'עגבניות שרי', 180],
    ] as [string, string, number][],
    send: 'שליחת המכתב',
    total: 'סה״כ לבקשות זיכוי',
    letterTitle: 'בקשת זיכוי · קצביית הכרם',
    letter1: 'שלום רב, בחשבונית מ־21.10 חויב אנטריקוט מעל המחיר שסוכם.',
    letter2: 'נשמח לזיכוי על ההפרש. תודה על השירות הקבוע!',
    letter3: 'בברכה, מסעדה לדוגמה',
  },
  en: {
    brand: 'Sample restaurant',
    sample: 'Sample',
    nav: ['Overview', 'Receiving', 'Decisions', 'Leak detective', 'Credit requests'],
    navOf: { dashboard: 0, leaks: 3, approvals: 2, claims: 4 } as Record<BeatKey, number>,
    title: { dashboard: 'Owner dashboard', leaks: 'Leak detective', approvals: 'Decisions', claims: 'Credit requests' } as Record<BeatKey, string>,
    sub: {
      dashboard: 'Where money is leaking — and what needs your decision now.',
      leaks: 'Latest price vs. the historical median, by supplier and product.',
      approvals: 'Gaps on invoices not yet paid — before payment.',
      claims: 'Gaps on paid invoices — a polite credit request per supplier.',
    } as Record<BeatKey, string>,
    kpi: ['Leak this month', 'of purchases checked', 'Purchases checked', 'Invoices with a gap'],
    cols: ['Product', 'Supplier', 'Median', 'Latest price', 'Change'],
    rows: [
      ['Draft beer keg 30L', 'Steinberg Beverages', 520, 575, '+10.6%'],
      ['Entrecôte', 'HaKerem Butchery', 139, 149, '+7.2%'],
      ['Salmon fillet', 'Mediterranean Fish Co.', 89, 96, '+7.9%'],
    ] as [string, string, number, number, string][],
    decide: 'Awaiting your decision',
    credit: 'Credit requests to send',
    gaps: (n: number) => `${n} gaps`,
    priceHigh: 'Price above expected',
    overBilled: 'Billed more than received',
    kegLine: '30L keg · Steinberg Beverages',
    loss: 'Estimated loss',
    approve: 'Approve',
    reject: 'Reject',
    askCredit: 'Request a credit',
    claims: [
      ['HaKerem Butchery', 'Entrecôte', 300],
      ['Mediterranean Fish Co.', 'Salmon fillet', 240],
      ['HaSharon Produce', 'Cherry tomatoes', 180],
    ] as [string, string, number][],
    send: 'Send the letter',
    total: 'Total credit requests',
    letterTitle: 'Credit request · HaKerem Butchery',
    letter1: 'Hello, on the 21.10 invoice the entrecôte was billed above the agreed price.',
    letter2: 'We’d appreciate a credit for the difference. Thanks for the steady service!',
    letter3: 'Best regards, Sample restaurant',
  },
};

/** The beat's focus rect in screen px (left/top from the physical edges). */
export const focusRect = (beat: BeatKey, locale: Locale, sw: number) => {
  const u = sw / VW;
  const b = BOX[beat].focus;
  const x = locale === 'he' ? VW - b.x - b.w : b.x;
  return { x: x * u, y: b.y * u, w: b.w * u, h: b.h * u };
};

const Pill: React.FC<{ u: number; bg: string; fg: string; children: React.ReactNode }> = ({ u, bg, fg, children }) => (
  <span style={{ fontSize: 12 * u, fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: `${3 * u}px ${10 * u}px`, whiteSpace: 'nowrap' }}>{children}</span>
);

const Panel: React.FC<{ u: number; box: Box; children: React.ReactNode; rail?: string; style?: React.CSSProperties }> = ({ u, box, children, rail, style }) => (
  <div
    style={{
      position: 'absolute',
      insetInlineStart: box.x * u,
      top: box.y * u,
      width: box.w * u,
      height: box.h * u,
      boxSizing: 'border-box',
      background: T.surface,
      border: `${Math.max(1, u)}px solid ${rail ? `${rail}40` : T.line}`,
      borderRadius: 14 * u,
      boxShadow: `0 ${u}px ${2 * u}px rgba(15,31,23,0.05)`,
      overflow: 'hidden',
      ...style,
    }}
  >
    {rail ? <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: 0, width: 5 * u, background: rail }} /> : null}
    {children}
  </div>
);

export const ProductScreen: React.FC<{ beat: BeatKey; locale: Locale; sw: number; sh: number }> = ({ beat, locale, sw, sh }) => {
  const u = sw / VW;
  const s = S[locale];
  const money = (n: number, dec = 0) => <bdi>{ilsText(n, locale, dec)}</bdi>;
  const row = (y: number, h: number, children: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: y * u, height: h * u, display: 'flex', alignItems: 'center', padding: `0 ${20 * u}px`, gap: 14 * u, ...extra }}>{children}</div>
  );

  return (
    <div
      dir={locale === 'he' ? 'rtl' : 'ltr'}
      style={{ position: 'relative', width: sw, height: sh, background: T.bg, fontFamily: FONT.sans, color: T.ink, overflow: 'hidden', fontVariantNumeric: 'tabular-nums' }}
    >
      {/* top bar */}
      <div style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: 52 * u, background: T.surface, borderBottom: `${Math.max(1, u)}px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 22 * u, padding: `0 ${40 * u}px` }}>
        <span style={{ fontSize: 16 * u, fontWeight: 800 }}>{s.brand}</span>
        <Pill u={u} bg={`${T.gold}1f`} fg={T.gold}>{s.sample}</Pill>
        <span style={{ flex: 1 }} />
        {s.nav.map((n, i) => (
          <span key={n} style={{ fontSize: 13 * u, fontWeight: i === s.navOf[beat] ? 700 : 500, color: i === s.navOf[beat] ? T.primary : T.muted, borderBottom: i === s.navOf[beat] ? `${2 * u}px solid ${T.primary}` : undefined, paddingBottom: 4 * u }}>
            {n}
          </span>
        ))}
      </div>
      {/* page title */}
      <div style={{ position: 'absolute', insetInlineStart: 40 * u, top: 74 * u, fontSize: 26 * u, fontWeight: 800 }}>{s.title[beat]}</div>
      <div style={{ position: 'absolute', insetInlineStart: 40 * u, top: 112 * u, fontSize: 14 * u, color: T.muted }}>{s.sub[beat]}</div>

      {beat === 'dashboard' ? (
        <>
          <div style={{ position: 'absolute', insetInlineStart: BOX.dashboard.focus.x * u, top: BOX.dashboard.focus.y * u }}>
            <SampleHeroCard u={u * 1.3} width={BOX.dashboard.focus.w * u} locale={locale} style={{ height: BOX.dashboard.focus.h * u, boxShadow: 'none' }} />
          </div>
          <div style={{ position: 'absolute', insetInlineStart: BOX.dashboard.needs.x * u, top: BOX.dashboard.needs.y * u }}>
            <SampleNeedsCard u={u * 1.2} width={BOX.dashboard.needs.w * u} locale={locale} style={{ height: BOX.dashboard.needs.h * u, boxShadow: 'none' }} />
          </div>
          <div style={{ position: 'absolute', insetInlineStart: BOX.dashboard.good.x * u, top: BOX.dashboard.good.y * u }}>
            <SampleGoodNews u={u * 1.2} width={BOX.dashboard.good.w * u} locale={locale} />
          </div>
        </>
      ) : null}

      {beat === 'leaks' ? (
        <>
          {[
            [money(SAMPLE.leak), s.kpi[0], T.danger],
            [<bdi key="p">{`${SAMPLE.leakPct}%`}</bdi>, s.kpi[1], T.ink],
            [money(SAMPLE.purchasing), s.kpi[2], T.ink],
            [<bdi key="g">{`${SAMPLE.withGap} / ${SAMPLE.checked}`}</bdi>, s.kpi[3], T.ink],
          ].map(([v, l, c], i) => (
            <Panel key={i} u={u} box={{ x: 40 + i * 285, y: 150, w: 265, h: 96 }} rail={i === 0 ? T.danger : undefined}>
              <div style={{ padding: `${14 * u}px ${20 * u}px` }}>
                <div style={{ fontSize: 13 * u, color: T.muted, fontWeight: 600 }}>{l as string}</div>
                <div style={{ fontSize: 30 * u, fontWeight: 800, color: c as string, marginTop: 6 * u }}>{v as React.ReactNode}</div>
              </div>
            </Panel>
          ))}
          <Panel u={u} box={{ x: 40, y: 276, w: 600, h: 208 }}>
            {row(0, 40, [s.cols[0], s.cols[2], s.cols[3], s.cols[4]].map((c, i) => (
              <span key={c} style={{ width: [250, 100, 110, 70][i] * u, fontSize: 12.5 * u, fontWeight: 700, color: T.muted }}>{c}</span>
            )), { borderBottom: `${Math.max(1, u)}px solid ${T.line}` })}
            {s.rows.map((r, j) =>
              row(40 + j * 56, 56, (
                <>
                  <span style={{ width: 250 * u, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                    <span style={{ fontSize: 15 * u, fontWeight: 700 }}>{r[0]}</span>
                    <span style={{ fontSize: 12 * u, color: T.muted }}>{r[1]}</span>
                  </span>
                  <span style={{ width: 100 * u, fontSize: 14 * u }}>{money(r[2], 2)}</span>
                  <span style={{ width: 110 * u, fontSize: 14 * u, fontWeight: 700 }}>{money(r[3], 2)}</span>
                  <span style={{ width: 70 * u, fontSize: 14 * u, fontWeight: 800, color: T.warn }}><bdi dir="ltr">{r[4]}</bdi></span>
                </>
              ), j ? { borderTop: `${Math.max(1, u)}px solid ${T.line}` } : undefined),
            )}
          </Panel>
        </>
      ) : null}

      {beat === 'approvals' ? (
        <>
          {row(150, 56, (
            <>
              <span style={{ width: 12 * u, height: 12 * u, borderRadius: 99, background: T.danger }} />
              <span style={{ fontSize: 18 * u, fontWeight: 800 }}>{s.decide}</span>
              <span style={{ fontSize: 14 * u, color: T.muted }}>{s.gaps(SAMPLE.decide.count)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 22 * u, fontWeight: 800, color: T.danger }}>{money(SAMPLE.decide.amount)}</span>
            </>
          ), { padding: `0 ${40 * u}px` })}
          <Panel u={u} box={BOX.approvals.focus} rail={T.danger}>
            <div style={{ padding: `${18 * u}px ${28 * u}px`, display: 'flex', flexDirection: 'column', gap: 8 * u }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u }}>
                <Pill u={u} bg={T.danger} fg="#FFFFFF">{s.priceHigh}</Pill>
                <span style={{ fontSize: 17 * u, fontWeight: 800 }}>{SAMPLE.decide.example[locale]}</span>
              </div>
              <div style={{ fontSize: 14 * u, color: T.muted }}>{s.kegLine}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u }}>
                <span style={{ fontSize: 14 * u, color: T.muted }}>{s.loss}</span>
                <span style={{ fontSize: 20 * u, fontWeight: 800, color: T.danger }}>{money(SAMPLE.decide.example.amount, 2)}</span>
                <span style={{ flex: 1 }} />
                <Pill u={u} bg={T.primary} fg="#FFFFFF">{s.approve}</Pill>
                <Pill u={u} bg={T.surface2} fg={T.ink}>{s.reject}</Pill>
              </div>
            </div>
          </Panel>
          <Panel u={u} box={{ x: 40, y: 392, w: 600, h: 92 }} rail={T.danger}>
            <div style={{ padding: `${18 * u}px ${28 * u}px`, display: 'flex', flexDirection: 'column', gap: 8 * u }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u }}>
                <Pill u={u} bg={`${T.danger}1a`} fg={T.danger}>{s.overBilled}</Pill>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u }}>
                <span style={{ fontSize: 14 * u, color: T.muted }}>{s.loss}</span>
                <span style={{ fontSize: 18 * u, fontWeight: 800, color: T.danger }}>{money(SAMPLE.decide.amount - SAMPLE.decide.example.amount, 2)}</span>
              </div>
            </div>
          </Panel>
          <div style={{ position: 'absolute', insetInlineStart: 680 * u, top: 222 * u }}>
            <SampleNeedsCard u={u * 1.15} width={480 * u} locale={locale} example={false} style={{ boxShadow: 'none' }} />
          </div>
        </>
      ) : null}

      {beat === 'claims' ? (
        <>
          {row(150, 56, (
            <>
              <span style={{ width: 12 * u, height: 12 * u, borderRadius: 99, background: T.warn }} />
              <span style={{ fontSize: 18 * u, fontWeight: 800 }}>{s.credit}</span>
              <span style={{ fontSize: 14 * u, color: T.muted }}>{s.gaps(SAMPLE.credit.count)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 22 * u, fontWeight: 800, color: T.warn }}>{money(SAMPLE.credit.amount)}</span>
            </>
          ), { padding: `0 ${40 * u}px` })}
          <Panel u={u} box={BOX.claims.focus} rail={T.warn}>
            {s.claims.map((c, j) =>
              row(8 + j * 62, 62, (
                <>
                  <span style={{ fontSize: 15 * u, fontWeight: 700, width: 190 * u }}>{c[0]}</span>
                  <span style={{ fontSize: 14 * u, color: T.muted, flex: 1 }}>{c[1]}</span>
                  <span style={{ fontSize: 16 * u, fontWeight: 800, width: 100 * u }}>{money(c[2], 2)}</span>
                  <Pill u={u} bg={T.primary} fg="#FFFFFF">{s.send}</Pill>
                </>
              ), { padding: `0 ${28 * u}px`, borderBottom: `${Math.max(1, u)}px solid ${T.line}` }),
            )}
            {row(8 + 3 * 62 + 4, 62, (
              <>
                <span style={{ fontSize: 16 * u, fontWeight: 800, flex: 1 }}>{s.total}</span>
                <span style={{ fontSize: 22 * u, fontWeight: 800, color: T.warn }}>{money(SAMPLE.credit.amount, 2)}</span>
              </>
            ), { padding: `0 ${28 * u}px` })}
          </Panel>
          <Panel u={u} box={{ x: 720, y: 222, w: 440, h: 262 }} style={{ background: '#FFFFFF' }}>
            <div style={{ padding: `${20 * u}px ${26 * u}px`, display: 'flex', flexDirection: 'column', gap: 10 * u, fontSize: 13.5 * u, color: T.ink, lineHeight: 1.45 }}>
              <span style={{ fontSize: 15 * u, fontWeight: 800 }}>{s.letterTitle}</span>
              <span>{s.letter1}</span>
              <span>{s.letter2}</span>
              <span style={{ color: T.muted }}>{s.letter3}</span>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
};
