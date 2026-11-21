import { describe, expect, it } from 'vitest';
import { releaseNotice } from './releaseNotice';

describe('G-08 kill switch: the features panel release notice', () => {
  const rid = '11111111-1111-4111-8111-111111111111';
  it('says nothing for no release or a clean one', () => {
    expect(releaseNotice(undefined, rid)).toBeNull();
    expect(releaseNotice({ ok: true, released: 2, requeued: 2, failed: 0 }, rid)).toBeNull();
  });
  it('shows a failed release, and failed > 0 with the ops command', () => {
    expect(releaseNotice({ ok: false, error: 'saved; release failed — run …' }, rid)).toBe('saved; release failed — run …');
    const n = releaseNotice({ ok: true, released: 3, requeued: 2, failed: 1 }, rid);
    expect(n).toContain('1 re-match(es) not queued');
    expect(n).toContain(`release-order-holds --restaurant ${rid}`);
  });
});
