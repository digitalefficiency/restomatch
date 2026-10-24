import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, lerp, prog } from '../theme';
import { zones } from '../layout';
import { Phone, phoneScreen, Screen } from '../components/Devices';
import { CaptionZone, Callout, DeviceZone, Spotlight } from '../components/Stage';
import { FadeUp, RiseLine } from '../components/primitives';
import { emailStrip, rectFor } from '../rects';

export const PHONE_DASH_DURATION = 220;

// Leak hero card on the phone capture (units of the 390-px screen width).
const [hx0, hy0, hx1, hy1] = rectFor('dashboard-he-phone', 'hero', [0.05, 1.4, 0.95, 1.8]);
const HERO = { x0: hx0, y0: hy0, x1: hx1, y1: hy1 };
const TOP = 0.11;

/** Vertical cut: the owner's dashboard on a phone (real capture), spotlight on the ₪ hero. */
export const PhoneDash: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = COPY[locale].product;
  const { device } = zones(width, height, locale);
  const d = locale === 'he' ? 'rtl' : 'ltr';
  const PW = 560;
  const { w: sw, h: sh } = phoneScreen(PW);
  const enter = prog(f, 0, 36);
  const exit = prog(f, PHONE_DASH_DURATION - 20, PHONE_DASH_DURATION, EASE_IN);
  const spot = prog(f, 60, 72) * (1 - prog(f, 180, 192));
  const pin = prog(f, 40, 68, EASE_IN_OUT);
  const ry = lerp(20, 4, enter) * (1 - pin);
  const rect = { x: HERO.x0 * sw, y: (HERO.y0 + TOP) * sw, w: (HERO.x1 - HERO.x0) * sw, h: (HERO.y1 - HERO.y0) * sw };
  const phoneX = device.w / 2 - PW / 2;
  const phoneY = 40;
  const frame = Math.round(PW * 0.04);
  const cx = phoneX + frame + rect.x + rect.w / 2;
  const cy = phoneY + frame + rect.y + rect.h / 2;
  const zoom = 1 + 0.35 * pin;

  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <DeviceZone locale={locale} perspective={1800}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${(device.w / 2 - cx) * pin}px, ${(device.h * 0.4 - cy) * pin}px) scale(${zoom})`,
            transformOrigin: `${cx}px ${cy}px`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: phoneX,
              top: phoneY,
              transform: `translateY(${(1 - enter) * 700}px) rotateY(${ry}deg) rotateX(${lerp(26, 0, enter)}deg)`,
              opacity: enter,
            }}
          >
            <Phone width={PW} glare={ry / 30}>
              <Screen src={`shots/dashboard-he-phone.png`} width={sw} top={sw * TOP} redact={[emailStrip('dashboard-he-phone', { y: 0.105, h: 0.04, x: 0.16, w: 0.62 })]} />
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sw * TOP, background: C.bg }} />
              <Spotlight rect={rect} a={spot} src="shots/dashboard-he-phone.png" imgWidth={sw} imgTop={TOP * sw} screenW={sw} screenH={sh} accent={C.danger} />
            </Phone>
          </div>
        </div>
      </DeviceZone>
      <CaptionZone locale={locale} justify="flex-start">
        <div style={{ fontFamily: FONT.sans, color: C.ink }}>
          <RiseLine at={6} style={{ fontSize: 76, fontWeight: 800 }}>
            {t.heroTitle}
          </RiseLine>
          <FadeUp at={16}>
            <div style={{ fontSize: 36, color: C.muted, marginTop: 10 }}>{t.heroSub}</div>
          </FadeUp>
          <Callout locale={locale} a={prog(f, 66, 78)} accent={C.danger}>
            <span>{t.chipLeak}</span>
            <bdi dir={d} style={{ color: C.danger }}>{ilsText(FACTS.leak, locale)}</bdi>
            <span style={{ color: C.muted, fontWeight: 500 }}>
              · <bdi dir="ltr">{FACTS.leakPct}</bdi> {t.chipPct}
            </span>
          </Callout>
          <div style={{ display: 'flex', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
            <FadeUp at={92}>
              <Callout locale={locale} a={1} accent={C.gold}>
                <span>{t.chipCaught}</span>
                <bdi dir={d} style={{ color: C.gold }}>{ilsText(FACTS.caught, locale)}</bdi>
              </Callout>
            </FadeUp>
            <FadeUp at={108}>
              <Callout locale={locale} a={1} accent={C.primary}>
                <span>{t.chipClaimed}</span>
                <bdi dir={d} style={{ color: C.primary }}>{ilsText(FACTS.claimed, locale)}</bdi>
              </Callout>
            </FadeUp>
          </div>
        </div>
      </CaptionZone>
    </AbsoluteFill>
  );
};
