// The promo frame gate — run after every re-render.
//   node scripts/frame-check.mjs            (from tools/promo)
//
// 1. DOM, both locales: renders a still every 2 s, plus every 0.2 s through the receiver beat and
//    the poster frame, with the `probe` input prop, so each frame logs the text of everything
//    mounted on it (src/Root.tsx Probe). Asserts:
//      · the "דוגמה · מספרים להמחשה / Sample · illustrative figures" tag is on EVERY frame
//      · NO ₪ anywhere on a receiver-beat frame (WINDOWS.receiverOnly)
//      · no URL / domain on any frame
// 2. Pixels, the shipped files: grabs a frame every 2 s from apps/web/public/media/promo-{he,en}-720.mp4
//    and checks the tag pill is drawn on each (same pixels as the reference grab), checks the posters
//    carry it too, and writes contact sheets to out/review-{he,en}/ for a human look.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(ROOT, '../../apps/web/public/media');
const pwShell = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((n) => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell']) {
      if (existsSync(`${base}/${d}/${rel}`)) return `${base}/${d}/${rel}`;
    }
  }
  return undefined;
};
const browserExecutable = process.env.REMOTION_BROWSER ?? pwShell();
const chromiumOptions = { gl: 'swangle' };
const TAG = { he: 'דוגמה · מספרים להמחשה', en: 'Sample · illustrative figures' };
const POSTER_S = 18.7; // scripts/encode-web.sh
const FPS = 30;
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  fail = 1;
};

// ── 1. DOM ────────────────────────────────────────────────────────────────────────────────────────
const serveUrl = await bundle({ entryPoint: resolve(ROOT, 'src/index.ts'), publicDir: resolve(ROOT, 'public') });
// keep in step with src/Root.tsx (TIMELINE): Product 440..996, Receiver 986..1236, Value from 1228
const RECEIVER_ONLY = [996, 1227];
const LAST = 1799;
const tmp = mkdtempSync(join(tmpdir(), 'frame-check-'));

for (const locale of ['he', 'en']) {
  console.log(`== DOM probe · ${locale}`);
  const inputProps = { locale, probe: true };
  const composition = await selectComposition({ serveUrl, id: 'Promo', inputProps, browserExecutable, chromiumOptions });
  const frames = new Set();
  for (let f = 0; f <= LAST; f += 2 * FPS) frames.add(f);
  frames.add(LAST);
  frames.add(Math.round(POSTER_S * FPS));
  for (let f = RECEIVER_ONLY[0]; f <= RECEIVER_ONLY[1]; f += 6) frames.add(f);
  frames.add(RECEIVER_ONLY[1]);
  let tagMiss = 0;
  let ilsInReceiver = 0;
  let urls = 0;
  for (const frame of [...frames].sort((a, b) => a - b)) {
    let text = null;
    await renderStill({
      composition,
      serveUrl,
      frame,
      output: join(tmp, `${locale}.png`),
      inputProps,
      browserExecutable,
      chromiumOptions,
      onBrowserLog: ({ text: t }) => {
        const m = /^PROBE (\d+) (.*)$/s.exec(t);
        if (m && Number(m[1]) === frame) text = JSON.parse(m[2]);
      },
    });
    if (text === null) {
      bad(`${locale} frame ${frame}: no probe output`);
      continue;
    }
    if (!text.includes(TAG[locale])) {
      tagMiss++;
      bad(`${locale} frame ${frame} (${(frame / FPS).toFixed(1)} s): Sample tag missing`);
    }
    if (frame >= RECEIVER_ONLY[0] && frame <= RECEIVER_ONLY[1] && text.includes('₪')) {
      ilsInReceiver++;
      bad(`${locale} frame ${frame} (${(frame / FPS).toFixed(1)} s): ₪ in the receiver beat: ${JSON.stringify(text.slice(0, 200))}`);
    }
    if (/restomatch\.co|https?:\/\/|www\./i.test(text)) {
      urls++;
      bad(`${locale} frame ${frame}: a URL is on screen`);
    }
  }
  const nRecv = [...frames].filter((f) => f >= RECEIVER_ONLY[0] && f <= RECEIVER_ONLY[1]).length;
  if (!tagMiss) ok(`${locale}: Sample tag on all ${frames.size} probed frames (every 2 s + receiver beat + poster)`);
  if (!ilsInReceiver) ok(`${locale}: no ₪ on ${nRecv} receiver-beat frames (${(RECEIVER_ONLY[0] / FPS).toFixed(1)}–${(RECEIVER_ONLY[1] / FPS).toFixed(1)} s, every 0.2 s)`);
  if (!urls) ok(`${locale}: no URL on any probed frame`);
}

// ── 2. Pixels of the shipped files ────────────────────────────────────────────────────────────────
// The tag pill in the 1280×720 web file: he at the left, en at the right (Root.tsx SampleTag, ×2/3).
const PILL = { he: { x: 70, y: 44, w: 150, h: 22 }, en: { x: 1280 - 70 - 150, y: 44, w: 150, h: 22 } };
const crop = (file, r) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=${r.w}:${r.h}:${r.x}:${r.y},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
const mad = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
for (const locale of ['he', 'en']) {
  const film = join(WEB, `promo-${locale}-720.mp4`);
  const poster = join(WEB, `promo-poster-${locale}.jpg`);
  if (!existsSync(film)) {
    bad(`${film} missing`);
    continue;
  }
  console.log(`== pixels · ${locale}`);
  const dir = join(tmp, `grabs-${locale}`); // the grabs are scratch; only the contact sheet is kept
  const review = resolve(ROOT, `out/review-${locale}`);
  rmSync(review, { recursive: true, force: true });
  mkdirSync(review, { recursive: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-i', film, '-vf', 'fps=1/2', join(dir, `${locale}-%02d.png`)]);
  const grabs = readdirSync(dir).filter((n) => n.endsWith('.png')).sort();
  const ref = crop(join(dir, grabs[1]), PILL[locale]);
  let worst = 0;
  for (const g of grabs) {
    const d = mad(crop(join(dir, g), PILL[locale]), ref);
    worst = Math.max(worst, d);
    if (d > 6) bad(`${locale} ${g}: the Sample tag pill differs from the reference (MAD ${d.toFixed(1)})`);
  }
  ok(`${locale}: tag pill drawn on all ${grabs.length} frames (every 2 s; worst MAD ${worst.toFixed(2)} ≤ 6)`);
  if (existsSync(poster)) {
    const d = mad(crop(poster, PILL[locale]), ref);
    d <= 8 ? ok(`${locale}: poster carries the tag (MAD ${d.toFixed(2)})`) : bad(`${locale}: poster tag MAD ${d.toFixed(1)}`);
  } else bad(`${poster} missing`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', join(dir, '*.png'), '-vf', 'scale=480:-1,tile=5x6:padding=4', '-frames:v', '1', join(review, `contact-${locale}.jpg`)]);
  ok(`${locale}: contact sheet → out/review-${locale}/contact-${locale}.jpg`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(fail ? 'FRAME CHECK: FAILURES' : 'FRAME CHECK: ALL PASS');
process.exit(fail);
