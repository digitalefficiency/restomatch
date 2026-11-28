import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatIlsAgorot } from '../../reports/money';
import { HE } from '../copy/he';
import { goLink, goLinks } from '../links';
import { composeMessage, count, factsText, isolate, MAX_MESSAGE_CHARS, money, moneyAgorot, qty, toAgorot } from '../render';

const AGENT = join(dirname(fileURLToPath(import.meta.url)), '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === '__tests__' ? [] : files(p)) : /\.ts$/.test(n) ? [p] : [];
  });
}

describe('Hebrew renderer (WA-02 §5.5)', () => {
  it('no Intl.NumberFormat anywhere in agent/** (₪ only through the server twin)', () => {
    const offenders = files(AGENT).filter((f) => /Intl\.NumberFormat/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('money: NUMERIC string → integer agorot half-up → formatIlsAgorot, isolated', () => {
    expect(toAgorot('1240.505')).toBe(124051);
    expect(toAgorot(0.1 + 0.2)).toBe(30);
    expect(toAgorot('x')).toBeNull();
    expect(money('1240.50')).toBe(isolate(formatIlsAgorot(124050, { locale: 'he' })));
    expect(moneyAgorot(98000)).toBe(isolate(formatIlsAgorot(98000, { locale: 'he' })));
    const m = money(980);
    expect(m.startsWith('\u2068') && m.endsWith('\u2069')).toBe(true);
    expect(m).toContain('980');
    expect(m).toContain('₪');
  });

  it('counts and quantities', () => {
    expect(count(12345)).toBe(isolate('12,345'));
    expect(qty('12.500')).toBe(isolate('12.5'));
  });

  it('facts text and the 1,024-char cap with links kept whole', () => {
    expect(factsText([])).toBe(HE.noData);
    expect(factsText(['א', 'ב'])).toBe(`${HE.factsPrefix}\n• א\n• ב`);
    const link = goLink('11111111-1111-4111-8111-111111111111', '/dashboard/leaks')!;
    const long = Array.from({ length: 200 }, (_, i) => `שורה ${i}`).join('\n');
    const msg = composeMessage(long, [link]);
    expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(msg.endsWith(link)).toBe(true);
  });

  it('go-links: absolute, internal paths only', () => {
    const rid = '11111111-1111-4111-8111-111111111111';
    const env = { APP_URL: 'https://app.example.co.il/' } as NodeJS.ProcessEnv;
    expect(goLink(rid, '/dashboard/leaks', env)).toBe(
      'https://app.example.co.il/dashboard/go?r=11111111-1111-4111-8111-111111111111&to=%2Fdashboard%2Fleaks',
    );
    expect(goLink(rid, 'https://evil.example', env)).toBeNull();
    expect(goLink(rid, '//evil.example/dashboard', env)).toBeNull();
    expect(goLink('not-a-uuid', '/dashboard', env)).toBeNull();
    expect(goLinks(rid, ['https://evil.example', '/dashboard/approvals', '/dashboard'], 1, env)).toHaveLength(1);
    expect(goLink(rid, '/dashboard', { APP_URL: 'http://evil.example' } as NodeJS.ProcessEnv)).toMatch(/^https:\/\/app\.restomatch\.co\.il\//);
  });
});
