// Renders the promo with the container's preinstalled Chromium (no download).
//   node render.mjs stills [he|en] [frame,frame,...]   → out/frames/*.png
//   node render.mjs he | en | vertical | loop | all
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'out');
const browserExecutable =
  process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const chromiumOptions = { gl: 'swangle' };
mkdirSync(resolve(OUT, 'frames'), { recursive: true });

const [mode = 'all', a, b] = process.argv.slice(2);
// FACTS='{"leak":572,"spend":28389,...}' overrides the demo numbers (see src/copy.ts FACTS)
const facts = process.env.FACTS ? JSON.parse(process.env.FACTS) : undefined;
const serveUrl = await bundle({ entryPoint: resolve(ROOT, 'src/index.ts'), publicDir: resolve(ROOT, 'public') });

async function comp(id, locale) {
  return selectComposition({ serveUrl, id, inputProps: { locale, facts }, browserExecutable, chromiumOptions });
}

async function video(id, locale, file, extra = {}) {
  const composition = await comp(id, locale);
  const t0 = Date.now();
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: resolve(OUT, file),
    inputProps: { locale, facts },
    browserExecutable,
    chromiumOptions,
    crf: 18,
    x264Preset: 'slow',
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    jpegQuality: 95,
    concurrency: Number(process.env.CONCURRENCY ?? 3),
    muted: true,
    onProgress: ({ renderedFrames, encodedFrames }) => {
      if (renderedFrames % 150 === 0) console.log(`${file}: rendered ${renderedFrames}, encoded ${encodedFrames}`);
    },
    ...extra,
  });
  console.log(`\n✓ ${file} in ${Math.round((Date.now() - t0) / 1000)}s`);
}

if (mode === 'stills') {
  const locale = a ?? 'he';
  const id = process.env.COMP ?? 'Promo';
  const frames = (b ?? '120,300,540,700,1100,1500,1720').split(',').map(Number);
  const composition = await comp(id, locale);
  for (const frame of frames) {
    const output = resolve(OUT, 'frames', `${id}-${locale}-${String(frame).padStart(4, '0')}.png`);
    await renderStill({ composition, serveUrl, frame, output, inputProps: { locale, facts }, browserExecutable, chromiumOptions });
    console.log('✓', output);
  }
} else {
  if (mode === 'he' || mode === 'all') await video('Promo', 'he', 'restomatch-promo-he.mp4');
  if (mode === 'en' || mode === 'all') await video('Promo', 'en', 'restomatch-promo-en.mp4');
  if (mode === 'vertical' || mode === 'all') await video('PromoVertical', 'he', 'restomatch-promo-he-vertical.mp4');
  if (mode === 'loop' || mode === 'all') await video('HeroLoop', 'he', 'hero-loop-master.mp4', { crf: 12 });
}
