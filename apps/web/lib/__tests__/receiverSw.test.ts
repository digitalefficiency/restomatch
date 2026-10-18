import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '../../app/receiver-sw.js/route';

/**
 * The receiver service worker caches ONLY public static PWA files and never
 * stores authenticated HTML or API responses (documented in the route).
 */
describe('receiver service worker', () => {
  it('is served as uncached JavaScript', async () => {
    const res = GET();
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('precaches exactly the public PWA files and never calls cache.put', async () => {
    const src = await GET().text();
    const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)![1]!;
    const paths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(paths).toEqual([
      '/pwa/offline.html',
      '/pwa/manifest.webmanifest',
      '/pwa/icon-192.png',
      '/pwa/icon-512.png',
      '/pwa/icon-maskable-512.png',
    ]);
    expect(src).not.toMatch(/\.put\(/);
    expect(src).not.toMatch(/\/api/);
    expect(src).toMatch(/req\.method !== 'GET'/);
  });

  it('manifest scope + start_url stay inside the receiver flow', () => {
    const m = JSON.parse(readFileSync(join(__dirname, '../../public/pwa/manifest.webmanifest'), 'utf8')) as {
      scope: string;
      start_url: string;
      icons: Array<{ src: string }>;
    };
    expect(m.scope).toBe('/dashboard/receiving');
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.icons.every((i) => i.src.startsWith('/pwa/'))).toBe(true);
  });
});
