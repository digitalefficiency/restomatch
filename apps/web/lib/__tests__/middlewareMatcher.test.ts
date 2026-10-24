import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// middleware.ts can't be imported here (next-auth edge bundle), and Next needs
// the matcher as a static literal there — so read the literal from the source
// and compile it the way Next does: a `/(<regex>)` pattern anchored on both ends.
function middlewareMatcher(): RegExp {
  const src = readFileSync(join(__dirname, '..', '..', 'middleware.ts'), 'utf8');
  const m = /matcher:\s*\[\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('matcher literal not found in middleware.ts');
  return new RegExp(`^${m[1]}$`);
}

const runsMiddleware = (path: string) => middlewareMatcher().test(path);

describe('middleware matcher', () => {
  it.each(['/og/he.png', '/og/en.png', '/opengraph-image', '/icon.svg', '/robots.txt', '/sitemap.xml'])(
    'anonymous crawler surface %s skips the middleware (no Auth.js Set-Cookie)',
    (p) => expect(runsMiddleware(p)).toBe(false),
  );

  it.each(['/api/auth/session', '/_next/static/chunks/a.js', '/_next/image', '/favicon.ico'])(
    'framework/auth route %s skips the middleware',
    (p) => expect(runsMiddleware(p)).toBe(false),
  );

  it.each([
    '/',
    '/dashboard',
    '/dashboard/leaks',
    '/admin',
    '/scans/abc',
    '/login',
    '/settings',
    '/api/trpc/leads.create',
    '/api/cron/worker-heartbeat',
    // Look-alikes of the excluded prefixes stay gated.
    '/ogx',
    '/dashboard/og/he.png',
  ])('protected or app route %s still runs the middleware', (p) => expect(runsMiddleware(p)).toBe(true));
});
