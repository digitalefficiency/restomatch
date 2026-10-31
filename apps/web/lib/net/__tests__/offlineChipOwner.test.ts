import { describe, expect, it } from 'vitest';
import { claimOfflineChip, isOfflineChipClaimed } from '../offlineChipOwner';

/**
 * One offline chip per screen: on receiving routes W1-06's ReceiverPwa chip
 * (it carries the queued-photo count) claims the spot, and the shell's chip
 * yields (wave-1 seam review: the two stacked and the shell chip hid "N photos
 * waiting").
 */
describe('offline chip owner', () => {
  it('is unclaimed until a screen claims it, and released on cleanup', () => {
    expect(isOfflineChipClaimed()).toBe(false);
    const release = claimOfflineChip();
    expect(isOfflineChipClaimed()).toBe(true);
    release();
    expect(isOfflineChipClaimed()).toBe(false);
  });

  it('counts claims (StrictMode double-mount, two owners) and ignores a double release', () => {
    const a = claimOfflineChip();
    const b = claimOfflineChip();
    a();
    a();
    expect(isOfflineChipClaimed(), 'still claimed by b').toBe(true);
    b();
    expect(isOfflineChipClaimed()).toBe(false);
  });
});
