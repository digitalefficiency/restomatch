import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COPY, FACTS, ilsText, Locale } from '../copy';
import { C, EASE_IN, EASE_IN_OUT, FONT, lerp, prog } from '../theme';
import { Phone, phoneScreen, Screen } from '../components/Devices';
import { Chip, FadeUp, RiseLine } from '../components/primitives';

export const PHONE_DASH_DURATION = 220;

/** Vertical cut: the owner's dashboard on a phone, real screenshot, with callouts. */
export const PhoneDash: React.FC<{ locale: Locale }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const t = COPY[locale].product;
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const PW = 640;
  const { w: sw } = phoneScreen(PW);
  const enter = prog(f, 0, 36);
  const exit = prog(f, PHONE_DASH_DURATION - 20, PHONE_DASH_DURATION, EASE_IN);
  const scroll = lerp(0, 0.55, prog(f, 40, 200, EASE_IN_OUT)) * sw;
  const ry = lerp(25, 6, enter) + Math.sin(f / 30) * 2;
  return (
    <AbsoluteFill style={{ perspective: 1800, alignItems: 'center' }}>
      <div dir={dir} style={{ position: 'absolute', top: 120, left: 80, right: 80, fontFamily: FONT.sans, color: C.ink, textAlign: 'center' }}>
        <RiseLine at={6} out={PHONE_DASH_DURATION - 20} style={{ fontSize: 78, fontWeight: 800 }}>
          {t.heroTitle}
        </RiseLine>
        <FadeUp at={16} out={PHONE_DASH_DURATION - 20}>
          <div style={{ fontSize: 36, color: C.muted, marginTop: 12 }}>{t.heroSub}</div>
        </FadeUp>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 420,
          left: width / 2 - PW / 2,
          transform: `translateY(${(1 - enter) * 700 - exit * 60}px) rotateY(${ry}deg) rotateX(${lerp(30, 4, enter)}deg)`,
          opacity: 1 - exit,
        }}
      >
        <Phone width={PW} glare={ry / 30}>
          <Screen
            src={`shots/dashboard-${locale}-phone.png`}
            width={sw}
            scroll={scroll}
            top={sw * 0.11}
            redact={[{ y: 0.105, h: 0.04, x: 0.16, w: 0.62 }]}
          />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sw * 0.11, background: C.bg }} />
        </Phone>
      </div>
      <FadeUp at={60} out={PHONE_DASH_DURATION - 22} style={{ position: 'absolute', top: 700, [locale === 'he' ? 'right' : 'left']: 40 }}>
        <Chip accent={C.danger} big>
          <span>{t.chipLeak}</span>
          <span style={{ color: C.danger, fontWeight: 800 }}>
            <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.leak, locale)}</bdi>
          </span>
        </Chip>
      </FadeUp>
      <FadeUp at={80} out={PHONE_DASH_DURATION - 22} style={{ position: 'absolute', top: 1060, [locale === 'he' ? 'left' : 'right']: 40 }}>
        <Chip accent={C.gold} big>
          <span>{t.chipCaught}</span>
          <span style={{ color: C.gold, fontWeight: 800 }}>
            <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.caught, locale)}</bdi>
          </span>
        </Chip>
      </FadeUp>
      <FadeUp at={100} out={PHONE_DASH_DURATION - 22} style={{ position: 'absolute', top: 1420, [locale === 'he' ? 'right' : 'left']: 40 }}>
        <Chip accent={C.primary} big>
          <span>{t.chipClaim}</span>
          <span style={{ color: C.primary, fontWeight: 800 }}>
            <bdi dir={locale === "he" ? "rtl" : "ltr"}>{ilsText(FACTS.claimed, locale)}</bdi>
          </span>
        </Chip>
      </FadeUp>
    </AbsoluteFill>
  );
};
