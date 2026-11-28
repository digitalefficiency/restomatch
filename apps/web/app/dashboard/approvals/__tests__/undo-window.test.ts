import { describe, expect, it } from 'vitest';
// The server constant, by relative path (the bulk-cap.test.ts pattern): a test may read the router module,
// a 'use client' file never value-imports @restomatch/api (G-16 client-api-value-import).
import { REOPEN_WINDOW_MS as SERVER } from '../../../../../../packages/api/src/routers/approvals';
import {
  DOUBLE_ACTIVATION_MS,
  REOPEN_WINDOW_MS,
  UNDO_CAP_MS,
  UNDO_FAILED_MS,
  UNDO_SAFETY_MARGIN_MS,
  UNDO_VISIBLE_MS,
} from '../undo-window';

/** DS3-04 §2.2, §5.5: the client's undo window mirrors the server's reopen window and stays inside it. */
describe('the undo window', () => {
  it('mirrors the server reopen window (15 s)', () => {
    expect(SERVER).toBe(15_000);
    expect(REOPEN_WINDOW_MS).toBe(SERVER);
  });

  it('shows 10 s and caps at the server window minus the safety margin (12 s)', () => {
    expect(UNDO_VISIBLE_MS).toBe(10_000);
    expect(UNDO_SAFETY_MARGIN_MS).toBe(3_000);
    expect(UNDO_CAP_MS).toBe(SERVER - UNDO_SAFETY_MARGIN_MS);
    expect(UNDO_CAP_MS).toBe(12_000);
  });

  it('the visible window is shorter than the cap, the cap shorter than the server window', () => {
    expect(UNDO_VISIBLE_MS).toBeLessThan(UNDO_CAP_MS);
    expect(UNDO_CAP_MS).toBeLessThan(SERVER);
  });

  it('keeps the failed note 5 s and ignores a second activation within 350 ms', () => {
    expect(UNDO_FAILED_MS).toBe(5_000);
    expect(DOUBLE_ACTIVATION_MS).toBe(350);
  });
});
