import { describe, expect, it } from 'vitest';
import { loadCredentials } from '../jobs/syncPlatforms';

describe('procurement credential refs', () => {
  it('fixture: refs select the offline provider outside production', () => {
    expect(loadCredentials('fixture:demo', { NODE_ENV: 'development' })).toEqual({ mode: 'fixture' });
  });
  it('fixture: refs are refused in production (synthetic orders must never reach a real tenant)', () => {
    expect(() => loadCredentials('fixture:demo', { NODE_ENV: 'production' })).toThrow(/production/);
  });
  it('env: refs still read the API key from the named variable', () => {
    expect(loadCredentials('env:MM_KEY', { MM_KEY: 'k-1' })).toEqual({ apiKey: 'k-1' });
    expect(() => loadCredentials('env:MISSING', {})).toThrow(/not set/);
    expect(() => loadCredentials('vault:x', {})).toThrow(/Unsupported/);
  });
});
