import { continueRender, delayRender, staticFile } from 'remotion';

// Self-hosted Heebo (variable 100–900, Hebrew/Latin/Latin-ext subsets) and
// JetBrains Mono — the same files the web app serves (apps/web/public/fonts).
const faces: { family: string; file: string; range: string; weight: string }[] = [
  {
    family: 'Heebo',
    file: 'fonts/heebo-hebrew-wght.woff2',
    range: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
    weight: '100 900',
  },
  {
    family: 'Heebo',
    file: 'fonts/heebo-latin-ext-wght.woff2',
    range:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    weight: '100 900',
  },
  {
    family: 'Heebo',
    file: 'fonts/heebo-latin-wght.woff2',
    range:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    weight: '100 900',
  },
  {
    family: 'JetBrains Mono',
    file: 'fonts/jetbrains-mono-latin-wght.woff2',
    range:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    weight: '100 800',
  },
];

let loaded = false;

export const loadFonts = () => {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const handle = delayRender('fonts');
  const all = faces.map((f) => {
    const face = new FontFace(f.family, `url(${staticFile(f.file)}) format('woff2')`, {
      unicodeRange: f.range,
      weight: f.weight,
    });
    document.fonts.add(face);
    return face.load();
  });
  Promise.all(all)
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
};
