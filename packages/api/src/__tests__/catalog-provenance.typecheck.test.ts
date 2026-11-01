import { describe, expect, it } from 'vitest';
import { recordConfirmedMatch } from '@restomatch/catalog';

/**
 * G-08 · `recordConfirmedMatch` requires a provenance AT THE TYPE LEVEL: there is
 * no '1.000' default any more, so a guess can't be saved as certainty by
 * forgetting an argument. Enforced by `pnpm --filter @restomatch/api typecheck`
 * (the `@ts-expect-error` lines fail tsc if the call ever compiles).
 */
type Params = Parameters<typeof recordConfirmedMatch>[1];

// @ts-expect-error — provenance is required.
const missing: Params = { productId: 'p', rawName: 'r' };
// @ts-expect-error — a guess is not a confirmed provenance.
const guess: Params = { productId: 'p', rawName: 'r', provenance: 'guess' };
// @ts-expect-error — the old free-form confidence is gone.
const legacyConfidence: Params = { productId: 'p', rawName: 'r', provenance: 'human', confidence: 1 };
const ok: Params[] = [
  { productId: 'p', rawName: 'r', provenance: 'human' },
  { productId: 'p', rawName: 'r', provenance: 'exactKey' },
  { productId: 'p', rawName: 'r', provenance: 'newProduct' },
];

describe('G-08 recordConfirmedMatch provenance (type-level)', () => {
  it('is enforced by tsc', () => {
    expect([missing, guess, legacyConfidence, ...ok].length).toBe(6);
  });
});
