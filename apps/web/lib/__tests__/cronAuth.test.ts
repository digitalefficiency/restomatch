import { describe, expect, it } from 'vitest';
import { cronAuthorized } from '../cronAuth';

const req = (auth?: string) => new Request('http://x/api/cron/jobs', { headers: auth ? { authorization: auth } : {} });
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('cronAuthorized (both /api/cron routes)', () => {
  it('Bearer $CRON_SECRET only', () => {
    const e = env({ NODE_ENV: 'production', CRON_SECRET: 's3cret' });
    expect(cronAuthorized(req('Bearer s3cret'), e)).toBe(true);
    expect(cronAuthorized(req(), e)).toBe(false);
    expect(cronAuthorized(req('Bearer s3cre'), e)).toBe(false);
    expect(cronAuthorized(req('Bearer s3cretX'), e)).toBe(false);
    expect(cronAuthorized(req('s3cret'), e)).toBe(false);
  });

  it('no CRON_SECRET: production refuses, development/test skip the check', () => {
    expect(cronAuthorized(req('Bearer anything'), env({ NODE_ENV: 'production' }))).toBe(false);
    expect(cronAuthorized(req(), env({ NODE_ENV: 'development' }))).toBe(true);
    expect(cronAuthorized(req(), env({ NODE_ENV: 'test' }))).toBe(true);
  });
});
