import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Social share card (Open Graph + Twitter) — generated, no binary asset.
 * Bilingual on purpose: crawlers don't carry the locale cookie, so one card
 * serves both the Hebrew and the English (`?lang=en`) URLs. The ₪ figure is
 * the same illustrative example the landing hero animates (labelled as such).
 */
export const alt = 'RestoMatch — invoice, order and delivery matching for restaurants';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function font(weight: 500 | 800) {
  return readFile(path.join(process.cwd(), 'public', 'fonts', `Heebo-${weight}.ttf`));
}

export default async function OpengraphImage() {
  const [bold, medium] = await Promise.all([font(800), font(500)]);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'radial-gradient(ellipse 80% 70% at 50% -10%, rgba(34,211,154,0.22), #0E1512 62%)',
          backgroundColor: '#0E1512',
          color: '#ECF5EF',
          fontFamily: 'Heebo',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: '#22D39A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#07120D',
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>RestoMatch</div>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              fontSize: 22,
              color: '#22D39A',
              border: '2px solid rgba(34,211,154,0.4)',
              borderRadius: 999,
              padding: '6px 18px',
              fontWeight: 500,
            }}
          >
            PO · Delivery · Invoice
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2, display: 'flex' }}>
            Catch supplier overcharges
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: -2,
              display: 'flex',
              backgroundImage: 'linear-gradient(90deg, #22D39A, #6FE0BD 55%, #E0B341)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            before you pay.
          </div>
          <div style={{ fontSize: 30, color: '#9DB2A6', fontWeight: 500, display: 'flex' }}>
            Price creep · short deliveries · unordered items — in Hebrew and English
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Match', 'Price up', 'Short', 'Not ordered'].map((l, i) => (
              <div
                key={l}
                style={{
                  display: 'flex',
                  fontSize: 22,
                  fontWeight: 500,
                  padding: '8px 16px',
                  borderRadius: 12,
                  color: i === 0 ? '#22D39A' : '#FF5C7A',
                  background: i === 0 ? 'rgba(34,211,154,0.12)' : 'rgba(255,92,122,0.12)',
                }}
              >
                {l}
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              padding: '14px 26px',
              borderRadius: 20,
              border: '2px solid rgba(255,92,122,0.4)',
              background: 'rgba(255,92,122,0.10)',
            }}
          >
            <div style={{ fontSize: 20, color: '#FF5C7A', fontWeight: 500, display: 'flex' }}>
              Caught before payment · example
            </div>
            <div style={{ fontSize: 58, fontWeight: 800, color: '#FF5C7A', display: 'flex' }}>₪412</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Heebo', data: bold, weight: 800, style: 'normal' },
        { name: 'Heebo', data: medium, weight: 500, style: 'normal' },
      ],
    },
  );
}
