import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SendEmailArgs } from '@/lib/email';
import { deliverJoinCode, deliverJoinSignInLink } from '../_lib/codeEmail';

// The provider call is the only thing replaced: isEmailConfigured() stays real.
const sendEmail = vi.hoisted(() => vi.fn<(args: SendEmailArgs) => Promise<void>>(async () => {}));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail,
}));

/**
 * The /join code e-mail decides fail-loud from the RUNTIME environment. A
 * production build inlines the literal NODE_ENV read on process.env to
 * "production"; the lab serves that build with runtime NODE_ENV=development and
 * no provider, and must get the printed code + JOIN_CODE_FILE, not a 500. A real
 * production runtime without a provider must still throw and never log the code.
 */
const INPUT = { to: 'invitee@restaurant.example', code: '482913', restaurantName: 'מסעדת בדיקה', locale: 'he' as const };
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

const dir = mkdtempSync(join(tmpdir(), 'join-code-email-'));
let spies: MockInstance[] = [];

beforeEach(() => {
  sendEmail.mockClear();
  spies = consoleMethods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  vi.unstubAllEnvs();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function logged(): string {
  return spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
}

describe('deliverJoinCode — runtime environment decides', () => {
  it('development runtime + no provider: no throw, prints the code and writes JOIN_CODE_FILE', async () => {
    const file = join(dir, 'dev.json');
    await expect(deliverJoinCode(INPUT, { NODE_ENV: 'development', JOIN_CODE_FILE: file })).resolves.toBeUndefined();
    const written = JSON.parse(readFileSync(file, 'utf8')) as { to: string; code: string; at: number };
    expect(written).toMatchObject({ to: INPUT.to, code: INPUT.code });
    expect(typeof written.at).toBe('number');
    expect(logged()).toContain(INPUT.code);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('development runtime + no provider, default env (process.env): JOIN_CODE_FILE written', async () => {
    const file = join(dir, 'default-env.json');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('JOIN_CODE_FILE', file);
    await deliverJoinCode(INPUT);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ to: INPUT.to, code: INPUT.code });
  });

  it('development runtime falls back to the file beside MAGIC_LINK_FILE (the e2e wiring)', async () => {
    const magic = join(dir, 'magic-link.json');
    await deliverJoinCode(INPUT, { NODE_ENV: 'development', MAGIC_LINK_FILE: magic });
    expect(JSON.parse(readFileSync(join(dir, 'join-code.json'), 'utf8'))).toMatchObject({ code: INPUT.code });
  });

  it('production runtime + no provider: throws, logs nothing, writes nothing, sends nothing', async () => {
    const file = join(dir, 'prod.json');
    const magic = join(dir, 'prod-magic-link.json');
    await expect(
      deliverJoinCode(INPUT, { NODE_ENV: 'production', JOIN_CODE_FILE: file, MAGIC_LINK_FILE: magic }),
    ).rejects.toThrow('join code: e-mail provider not configured');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(dir, 'prod-join-code.json'))).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('production runtime + key the provider helper does not see: still throws (never logs the code)', async () => {
    // process.env (what isEmailConfigured reads) has no key; only the passed env does.
    vi.stubEnv('RESEND_API_KEY', '');
    const file = join(dir, 'prod-mismatch.json');
    await expect(
      deliverJoinCode(INPUT, { NODE_ENV: 'production', RESEND_API_KEY: 're_test_only', JOIN_CODE_FILE: file }),
    ).rejects.toThrow('join code: e-mail provider not configured');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('production runtime + provider configured: sends to the invited address, logs and writes nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_only');
    const file = join(dir, 'prod-configured.json');
    vi.stubEnv('JOIN_CODE_FILE', file);
    await deliverJoinCode(INPUT);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]![0];
    expect(sent.to).toBe(INPUT.to);
    expect(sent.text).toContain(INPUT.code);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });
});

describe('deliverJoinCode — each runtime guard is load-bearing (review low 6: a mutant must not survive)', () => {
  it('`production &&`: a development runtime never sends, even when the provider helper would say "configured"', async () => {
    // isEmailConfigured() reads process.env: make it true. The passed env is development + a key.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_only');
    const file = join(dir, 'guard-production.json');
    await deliverJoinCode(INPUT, { NODE_ENV: 'development', RESEND_API_KEY: 're_test_only', JOIN_CODE_FILE: file });
    expect(sendEmail).not.toHaveBeenCalled(); // without the guard this would send
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ code: INPUT.code });
  });

  it('`env.RESEND_API_KEY`: a production runtime with no key in env throws, even when the provider helper says "configured"', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_only');
    const file = join(dir, 'guard-key.json');
    await expect(deliverJoinCode(INPUT, { NODE_ENV: 'production', JOIN_CODE_FILE: file })).rejects.toThrow('join code: e-mail provider not configured');
    expect(sendEmail).not.toHaveBeenCalled(); // without the guard this would send
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });
});

describe('deliverJoinSignInLink — the existing-account e-mail (no code), same runtime rules', () => {
  const LINK = { to: 'has.account@restaurant.example', url: '/login?callbackUrl=%2Finvite%2Faccept', restaurantName: 'מסעדת בדיקה', locale: 'he' as const };

  it('development runtime + no provider: writes JOIN_SIGNIN_FILE (beside MAGIC_LINK_FILE), sends nothing', async () => {
    await deliverJoinSignInLink(LINK, { NODE_ENV: 'development', MAGIC_LINK_FILE: join(dir, 'magic-link-s.json') });
    expect(JSON.parse(readFileSync(join(dir, 'join-signin-s.json'), 'utf8'))).toMatchObject({ to: LINK.to, url: LINK.url });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('production runtime + no provider: throws, writes and sends nothing', async () => {
    const file = join(dir, 'signin-prod.json');
    await expect(deliverJoinSignInLink(LINK, { NODE_ENV: 'production', JOIN_SIGNIN_FILE: file })).rejects.toThrow(
      'join sign-in link: e-mail provider not configured',
    );
    expect(existsSync(file)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('`production &&` and `env.RESEND_API_KEY` are each load-bearing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_only');
    const devFile = join(dir, 'signin-guard-dev.json');
    await deliverJoinSignInLink(LINK, { NODE_ENV: 'development', RESEND_API_KEY: 're_test_only', JOIN_SIGNIN_FILE: devFile });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(existsSync(devFile)).toBe(true);
    await expect(deliverJoinSignInLink(LINK, { NODE_ENV: 'production' })).rejects.toThrow();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('production runtime + provider configured: sends a link (no 6-digit code) to the invited address', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_only');
    await deliverJoinSignInLink(LINK);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]![0];
    expect(sent.to).toBe(LINK.to);
    expect(sent.text).toContain(LINK.url);
    expect(sent.text).not.toMatch(/\b\d{6}\b/);
  });
});

describe('codeEmail.ts source', () => {
  it('has no literal process.env NODE_ENV read (next build would inline it)', () => {
    const src = readFileSync(fileURLToPath(new URL('../_lib/codeEmail.ts', import.meta.url)), 'utf8');
    expect(src).not.toContain('process.env.NODE_ENV');
    expect(src).not.toMatch(/process\s*\.\s*env\s*(\.\s*NODE_ENV\b|\[\s*['"`]NODE_ENV['"`]\s*\])/);
  });
});
