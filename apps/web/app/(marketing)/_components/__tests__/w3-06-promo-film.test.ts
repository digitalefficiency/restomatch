/**
 * W3-06 · the 60 s promo film (#320 review, orchestrator 14.11): the film's SOURCE is gated here, the
 * rendered frames by tools/promo/scripts/frame-check.mjs (DOM probe every 2 s + the receiver beat).
 *
 *  1. one figure set: the receiver beat carries no ₪ and no demo-seed screenshot / restaurant
 *  2. the app's words: no retired glossary term, no target language, anywhere in the film's copy
 *  3. ₪ side: he amounts carry the RLM formatIls emits, so the glyph sits at the visual left
 *  4. text alternative: the transcript is generated from the film's copy + the sample month
 *  5. next step: no URL on the end card; the dialog carries the real CTA, a 44 px close and the
 *     transcript; the 16:9 film is sm+ only (phones keep /showcase)
 *  6. public/media: every served file is pinned — nothing unreviewed rides along
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPROVED_MEDIA_FILES } from '@/lib/heroMedia';
import { lint, stringLiterals, type Lang } from '@/lib/i18n/__tests__/copyGate';
import transcript from '../promoTranscript.json';
import { SAMPLE_LEAK_ILS, SAMPLE_NEEDS, SAMPLE_UNPAID_ILS } from '../sampleMonth';

const REPO = join(__dirname, '../../../../../..');
const PROMO = join(REPO, 'tools/promo/src');
const WEB = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(p, 'utf8');
/** Source without comments (a comment may name what the code must not do). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every file whose strings reach a frame of the film. */
const FILM_SOURCES = [
  'copy.ts',
  'components/ProductScreens.tsx',
  'components/ReceiverScreen.tsx',
  'components/SampleCards.tsx',
  'scenes/Receiver.tsx',
  'scenes/Cta.tsx',
  'scenes/Value.tsx',
  'scenes/Product.tsx',
  'scenes/Hook.tsx',
];
const isHe = (s: string) => /[א-ת]/.test(s);

describe('W3-06 · promo film: the receiver beat is one figure set, no ₪', () => {
  it('the receiver screens and scene never render money', () => {
    for (const f of ['components/ReceiverScreen.tsx', 'scenes/Receiver.tsx']) {
      const src = code(join(PROMO, f));
      expect(src, `${f} renders ₪`).not.toMatch(/₪|ilsText|formatIls|money\(|SAMPLE\b/);
      expect(src, `${f} uses a screenshot`).not.toMatch(/shots\/|staticFile|<Screen\b/);
    }
  });

  it('the receiver lines carry quantities only, and the demo restaurant / screenshots are gone', () => {
    const copy = read(join(PROMO, 'copy.ts'));
    const lines = copy.slice(copy.indexOf('export const LINES'));
    expect(lines).not.toContain('₪');
    expect(copy).not.toMatch(/receiver\.generated|FACTS|כפר הזיתים/);
    expect(() => readdirSync(join(REPO, 'tools/promo/public/shots'))).toThrow();
  });
});

describe('W3-06 · promo film: the app’s words (glossary.ts)', () => {
  it('no retired term and no target language in any string that reaches a frame', () => {
    const findings: string[] = [];
    for (const f of FILM_SOURCES) {
      for (const { line, text } of stringLiterals(read(join(PROMO, f)))) {
        const lang: Lang = isHe(text) ? 'he' : 'en';
        for (const x of lint(text, lang)) {
          if (x.rule === 'retired-term' || x.rule === 'leak-target') findings.push(`${f}:${line} ${x.rule} "${x.match}" in "${text}"`);
        }
      }
    }
    for (const l of [...transcript.he, ...transcript.en]) {
      for (const x of lint(l.text, isHe(l.text) ? 'he' : 'en')) {
        // 1.5% only as a labelled example ("דוגמה / Sample"), never as a target
        const labelled = x.rule === 'leak-target' && /דוגמה|Sample/.test(l.text) && !/יעד|target/i.test(l.text);
        if ((x.rule === 'retired-term' || x.rule === 'leak-target') && !labelled) findings.push(`transcript ${l.at} ${x.rule} "${x.match}"`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('an undecided ₪ is a "פער / Gap", and the screens use the app’s screen names', () => {
    const screens = read(join(PROMO, 'components/ProductScreens.tsx'));
    expect(screens).toContain("loss: 'פער'");
    expect(screens).toContain("loss: 'Gap'");
    expect(screens).toContain("['בית', 'קבלת סחורה', 'אישורים', 'דליפה', 'בקשות זיכוי לשליחה']");
    expect(screens).not.toMatch(/ההפסד המוערך|Estimated loss|חציון|Median|תור החלטות|בלש הדליפות|Leak detective/);
  });
});

describe('W3-06 · promo film: ₪ side, figures, end card', () => {
  it('he amounts carry the RLM (glyph at the visual left, like <Money>); en is "₪n"', () => {
    const copy = read(join(PROMO, 'copy.ts'));
    expect(copy).toMatch(/locale === 'he' \? `\\u200F\$\{v\} ₪` : `₪\$\{v\}`/);
    expect(transcript.he[0]!.text).toContain('‏2,250 ₪');
    expect(transcript.en[0]!.text).toContain('₪2,250');
  });

  it('every product-screen figure comes from SAMPLE / FILM (no ₪ literal on a screen)', () => {
    const screens = read(join(PROMO, 'components/ProductScreens.tsx'));
    expect(screens).not.toMatch(/money\(\s*\d/); // money(<literal>)
    expect(screens).not.toMatch(/'\+\d+(\.\d)?%'/); // a typed % change
    const sample = read(join(PROMO, 'sample.ts'));
    expect(sample).toMatch(/keg: \{ usual: 520, latest: 572\.4, qty: 2 \}/); // (572.40 − 520) × 2 = 104.80
    expect(Math.round((572.4 - 520) * 2 * 100)).toBe(Math.round(SAMPLE_NEEDS[0]!.example!.amountIls * 100));
  });

  it('the end card has no URL (the domain is not final)', () => {
    expect(code(join(PROMO, 'scenes/Cta.tsx'))).not.toMatch(/\.url|restomatch\.co/);
    expect(code(join(PROMO, 'copy.ts'))).not.toMatch(/restomatch\.co|SITE/);
  });

  it('the retired demo-seed vertical cut is gone from source, render script and media', () => {
    expect(code(join(PROMO, 'Root.tsx'))).not.toMatch(/PromoVertical|PhoneDash/);
    expect(read(join(REPO, 'tools/promo/render.mjs'))).not.toMatch(/vertical/);
    expect(readdirSync(join(REPO, 'tools/promo/out')).filter((n) => /vertical/.test(n))).toEqual([]);
  });
});

describe('W3-06 · promo film: text alternative + next step in the dialog', () => {
  it('promoTranscript.json is exactly transcript(COPY, SAMPLE) — copy drift fails here', async () => {
    const path = join(PROMO, 'transcript.ts'); // non-literal: the web typecheck doesn't pull tools/promo in
    const mod = (await import(/* @vite-ignore */ path)) as { transcript: (l: 'he' | 'en') => unknown };
    expect({ he: mod.transcript('he'), en: mod.transcript('en') }).toEqual(transcript);
  });

  it('a per-locale transcript, generated from the film’s copy + the sample month', () => {
    expect(transcript.he.length).toBe(transcript.en.length);
    expect(transcript.he.length).toBeGreaterThanOrEqual(8);
    const he = transcript.he.map((l) => l.text).join(' ');
    const en = transcript.en.map((l) => l.text).join(' ');
    const g = (n: number) => n.toLocaleString('en-US');
    for (const n of [SAMPLE_LEAK_ILS, SAMPLE_UNPAID_ILS, SAMPLE_NEEDS[0]!.amountIls, SAMPLE_NEEDS[1]!.amountIls]) {
      expect(he).toContain(g(n));
      expect(en).toContain(g(n));
    }
    expect(he).toContain('דוגמה');
    expect(en).toContain('Sample');
  });

  it('the dialog: video described by the transcript, real CTA in a footer, 44 px close', () => {
    const btn = read(join(WEB, 'app/(marketing)/_components/PromoVideoButton.tsx'));
    expect(btn).toMatch(/aria-describedby=\{transcriptId\}/);
    expect(btn).toMatch(/<ol\s+id=\{transcriptId\}/);
    expect(btn).toMatch(/aria-expanded=\{showTranscript\}/); // a visible, labelled toggle
    expect(btn).toMatch(/tabIndex=\{0\}\s*aria-label=\{transcriptLabel\}/); // keyboard-scrollable list
    expect(btn).toMatch(/<span key=\{i\} lang=\{other\}/); // other-language runs carry lang
    expect(btn).toMatch(/className="sticky bottom-0/); // the CTA stays visible on short screens
    expect(btn).toMatch(/href=\{ctaHref\}/);
    expect(btn).toMatch(/h-11 w-11/);
  });

  it('the 16:9 film is sm+ only; phones keep the /showcase link', () => {
    const page = read(join(WEB, 'app/page.tsx'));
    expect(page).toMatch(/cn\(btnSecondary, 'hidden sm:inline-flex'\)/);
    expect(page).toMatch(/promoSrc \? cn\(btnSecondary, 'sm:hidden'\) : btnSecondary/);
    expect(page).toMatch(/ctaLabel=\{t\('hero\.ctaPrimary'\)\}/);
  });
});

describe('W3-06 · public/media: nothing unreviewed is served', () => {
  /** Files that may sit in public/media without a SHA pin — none today; add one only with a reason. */
  const ALLOWED_UNPINNED: readonly string[] = [];
  it('every file in public/media is SHA-pinned in APPROVED_MEDIA_FILES (or explicitly allowed)', () => {
    const served = readdirSync(join(WEB, 'public/media')).map((n) => `/media/${n}`);
    const unpinned = served.filter((p) => !(p in APPROVED_MEDIA_FILES) && !ALLOWED_UNPINNED.includes(p));
    expect(unpinned).toEqual([]);
  });
});
