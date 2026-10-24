import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Social share cards, one per language: /og/he.png (default) and /og/en.png
 * (`?lang=en` pages). Pages pick theirs via socialFor() in _components/seo.ts.
 * Public without a session: the path ends in a file extension (publicPaths).
 * The ₪ figure is the same illustrative example the landing hero animates.
 */
const SIZE = { width: 1200, height: 630 };

const COPY = {
  he: {
    badge: 'הזמנה · קבלת סחורה · חשבונית',
    line1: 'תופסים חיובי יתר של ספקים',
    line2: 'עוד לפני התשלום.',
    sub: 'מחירים שעלו · משלוחים חסרים · פריטים שלא הוזמנו',
    chips: ['תואם', 'מחיר עלה', 'חוסר', 'לא הוזמן'],
    caught: 'נתפס לפני תשלום · דוגמה',
  },
  en: {
    badge: 'PO · Delivery · Invoice',
    line1: 'Catch supplier overcharges',
    line2: 'before you pay.',
    sub: 'Price creep · short deliveries · unordered items — in Hebrew and English',
    chips: ['Match', 'Price up', 'Short', 'Not ordered'],
    caught: 'Caught before payment · example',
  },
} as const;

type Lang = keyof typeof COPY;

/**
 * The OG renderer (Satori) lays text out left-to-right only. Hebrew has no
 * contextual shaping, so a line renders correctly in visual order: reverse the
 * runs, and the characters inside each Hebrew/neutral run (Latin and number
 * runs keep their order).
 */
function visual(text: string, lang: Lang): string {
  if (lang !== 'he') return text;
  const runs = text.match(/[A-Za-z0-9₪][A-Za-z0-9₪.,%+-]*|[^A-Za-z0-9₪]+/g) ?? [];
  return runs
    .reverse()
    .map((r) => (/^[A-Za-z0-9₪]/.test(r) ? r : [...r].reverse().join('')))
    .join('');
}

async function font(weight: 500 | 800) {
  return readFile(path.join(process.cwd(), 'public', 'fonts', `Heebo-${weight}.ttf`));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const lang = file === 'he.png' ? 'he' : file === 'en.png' ? 'en' : null;
  if (!lang) return new Response('Not found', { status: 404 });
  const c = COPY[lang];
  const rtl = lang === 'he';
  const v = (s: string) => visual(s, lang);
  const [bold, medium] = await Promise.all([font(800), font(500)]);
  const row = rtl ? 'row-reverse' : 'row';
  const align = rtl ? 'flex-end' : 'flex-start';

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
          background: 'radial-gradient(ellipse 80% 70% at 50% -10%, rgba(6,107,74,0.12), #F6F8F7 62%)',
          backgroundColor: '#F6F8F7',
          color: '#0F1F17',
          fontFamily: 'Heebo',
        }}
      >
        <div style={{ display: 'flex', flexDirection: row, alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: '#066B4A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>RestoMatch</div>
          <div
            style={{
              [rtl ? 'marginRight' : 'marginLeft']: 'auto',
              display: 'flex',
              fontSize: 22,
              color: '#066B4A',
              border: '2px solid rgba(6,107,74,0.4)',
              borderRadius: 999,
              padding: '6px 18px',
              fontWeight: 500,
            }}
          >
            {v(c.badge)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 16 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.04, letterSpacing: rtl ? 0 : -2, display: 'flex' }}>
            {v(c.line1)}
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: rtl ? 0 : -2,
              display: 'flex',
              backgroundImage: `linear-gradient(${rtl ? 270 : 90}deg, #0E8F63, #3FB58A 55%, #C08A1E)`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {v(c.line2)}
          </div>
          <div style={{ fontSize: 30, color: '#4A5D53', fontWeight: 500, display: 'flex' }}>{v(c.sub)}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: row, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: row, gap: 14 }}>
            {c.chips.map((l, i) => (
              <div
                key={l}
                style={{
                  display: 'flex',
                  fontSize: 22,
                  fontWeight: 500,
                  padding: '8px 16px',
                  borderRadius: 12,
                  color: i === 0 ? '#066B4A' : '#B80F2A',
                  background: i === 0 ? 'rgba(6,107,74,0.1)' : 'rgba(184,15,42,0.08)',
                }}
              >
                {v(l)}
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: rtl ? 'flex-start' : 'flex-end',
              padding: '14px 26px',
              borderRadius: 20,
              border: '2px solid rgba(184,15,42,0.4)',
              background: 'rgba(184,15,42,0.06)',
            }}
          >
            <div style={{ fontSize: 20, color: '#B80F2A', fontWeight: 500, display: 'flex' }}>{v(c.caught)}</div>
            <div style={{ fontSize: 58, fontWeight: 800, color: '#B80F2A', display: 'flex' }}>
              {rtl ? '₪ 412' : '₪412'}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [
        { name: 'Heebo', data: bold, weight: 800, style: 'normal' },
        { name: 'Heebo', data: medium, weight: 500, style: 'normal' },
      ],
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    },
  );
}
