import React from 'react';
import { COPY, ilsText, Locale, SAMPLE } from '../copy';
import { FONT, LIGHT } from '../theme';

/**
 * The site's sample month drawn as product-style cards (light tokens, Heebo — the site's font for
 * Hebrew, display and money), not screenshots: the leak hero (T1) and the "מחכה לך" card with its
 * two T2 rows. `u` = output px per CSS px of the product, so a card can be drawn at any scale.
 */
const T = { ...LIGHT, warn: '#A63D00', surface2: '#F2F6F4', line: '#D3DDD7' };
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

const Card: React.FC<{ u: number; rail?: string; locale: Locale; width: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ u, rail, locale, width, children, style }) => (
  <div
    dir={locale === 'he' ? 'rtl' : 'ltr'}
    style={{
      position: 'relative',
      width,
      boxSizing: 'border-box',
      padding: `${18 * u}px ${20 * u}px`,
      background: T.surface,
      border: `${Math.max(1, u)}px solid ${rail ? `${rail}40` : T.line}`,
      borderRadius: 16 * u,
      boxShadow: `0 ${1 * u}px ${2 * u}px rgba(15,31,23,0.06), 0 ${12 * u}px ${28 * u}px rgba(15,31,23,0.10)`,
      overflow: 'hidden',
      fontFamily: FONT.sans,
      color: T.ink,
      fontVariantNumeric: 'tabular-nums',
      ...style,
    }}
  >
    {/* T1/T2 tone rail on the inline-start edge, as in the product */}
    {rail ? <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: 0, width: 5 * u, background: rail }} /> : null}
    {children}
  </div>
);

/** T1: the leak hero of the sample month. */
export const SampleHeroCard: React.FC<{ u: number; width: number; locale: Locale; numberGlow?: number }> = ({ u, width, locale, numberGlow = 0 }) => {
  const t = COPY[locale].sample;
  return (
    <Card u={u} width={width} rail={T.danger} locale={locale}>
      <div style={{ fontSize: 12.5 * u, fontWeight: 600, color: T.muted, letterSpacing: '0.01em' }}>{t.eyebrow}</div>
      <div style={{ fontSize: 15 * u, fontWeight: 600, color: T.muted, marginTop: 10 * u }}>{t.label}</div>
      <div
        style={{
          fontSize: 52 * u,
          fontWeight: 800,
          lineHeight: 1.05,
          marginTop: 2 * u,
          color: T.ink,
          textShadow: numberGlow ? `0 0 ${24 * u * numberGlow}px ${T.danger}${Math.round(0x30 + 0x40 * numberGlow).toString(16)}` : undefined,
        }}
      >
        <bdi>{ilsText(SAMPLE.leak, locale)}</bdi>
      </div>
      <div style={{ fontSize: 15 * u, fontWeight: 700, marginTop: 8 * u }}>
        <bdi>{fill(t.pct, { pct: `${SAMPLE.leakPct}%` })}</bdi>
      </div>
      <div style={{ fontSize: 13.5 * u, color: T.muted, marginTop: 2 * u }}>
        <bdi>{fill(t.base, { amount: ilsText(SAMPLE.purchasing, locale) })}</bdi>
      </div>
      <div style={{ fontSize: 12.5 * u, color: T.muted, marginTop: 10 * u, paddingTop: 10 * u, borderTop: `${Math.max(1, u * 0.75)}px solid ${T.line}` }}>
        {fill(t.completeness, { checked: SAMPLE.checked, withGap: SAMPLE.withGap })}
      </div>
    </Card>
  );
};

const NeedRow: React.FC<{ u: number; locale: Locale; tone: string; label: string; sub: string; amount: number; verb: string; example?: string; first?: boolean }> = ({
  u,
  locale,
  tone,
  label,
  sub,
  amount,
  verb,
  example,
  first,
}) => (
  <div style={{ paddingTop: first ? 0 : 12 * u, marginTop: first ? 0 : 12 * u, borderTop: first ? undefined : `${Math.max(1, u * 0.75)}px solid ${T.line}` }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u }}>
      <span style={{ width: 10 * u, height: 10 * u, borderRadius: 99, background: tone, flex: 'none' }} />
      <span style={{ fontSize: 15 * u, fontWeight: 700, flex: 1 }}>{label}</span>
      <bdi style={{ fontSize: 17 * u, fontWeight: 800, color: tone }}>{ilsText(amount, locale)}</bdi>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u, marginTop: 6 * u, paddingInlineStart: 20 * u }}>
      <span style={{ fontSize: 13 * u, color: T.muted, flex: 1 }}>{sub}</span>
      <span
        style={{
          fontSize: 12.5 * u,
          fontWeight: 700,
          color: '#FFFFFF',
          background: T.primary,
          borderRadius: 999,
          padding: `${4 * u}px ${12 * u}px`,
        }}
      >
        {verb}
      </span>
    </div>
    {example ? <div style={{ fontSize: 12.5 * u, color: T.muted, marginTop: 6 * u, paddingInlineStart: 20 * u }}>{example}</div> : null}
  </div>
);

/** T2: "מחכה לך" with the sample month's two rows (decide ₪910 · credit ₪720). */
export const SampleNeedsCard: React.FC<{ u: number; width: number; locale: Locale; example?: boolean }> = ({ u, width, locale, example = true }) => {
  const t = COPY[locale].sample;
  return (
    <Card u={u} width={width} locale={locale}>
      <div style={{ fontSize: 15 * u, fontWeight: 800, marginBottom: 12 * u }}>{t.needsTitle}</div>
      <NeedRow
        first
        u={u}
        locale={locale}
        tone={T.danger}
        label={t.decide}
        sub={fill(t.gaps, { count: SAMPLE.decide.count })}
        amount={SAMPLE.decide.amount}
        verb={t.decideVerb}
        example={example ? `${t.example} · ${ilsText(SAMPLE.example.amount, locale, 2)}` : undefined}
      />
      <NeedRow u={u} locale={locale} tone={T.warn} label={t.credit} sub={fill(t.gaps, { count: SAMPLE.credit.count })} amount={SAMPLE.credit.amount} verb={t.creditVerb} />
    </Card>
  );
};

/** T3: the one calm good-news line. */
export const SampleGoodNews: React.FC<{ u: number; locale: Locale; width: number }> = ({ u, locale, width }) => (
  <Card u={u} width={width} locale={locale} style={{ padding: `${12 * u}px ${20 * u}px`, background: T.surface2, boxShadow: 'none' }}>
    <span style={{ fontSize: 12 * u, color: T.gold, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <bdi>{fill(COPY[locale].sample.goodNews, { amount: ilsText(SAMPLE.goodNews, locale) })}</bdi>
    </span>
  </Card>
);

export const SAMPLE_TONES = T;
