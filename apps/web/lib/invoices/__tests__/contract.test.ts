import { describe, expect, it } from 'vitest';
import { PLACE_IDS, PLACE_STATES } from '../places';
import type { DecidedRow, Holding, InvoiceListRow, QueueRow } from '../types';

/**
 * INV-00 · the contract the area's screens build on, checked at compile time (web typecheck)
 * and at run time. A decided row is drawn by the desk's own row model, so it must be a queue
 * row; the row the views and the walk read must carry the old `noAllocation` set's facts.
 */
const decidedIsAQueueRow = (d: DecidedRow): QueueRow => d;
const leadingIsNotTheLink = (h: Holding): [string, string | null] => [h.leadingGapId, h.decideGapId];
const rowHasAllocationFacts = (r: InvoiceListRow): [boolean, boolean] => [r.hasAllocation, r.allocationMissing];

describe('INV-00 contract', () => {
  it('compiles: a decided row is a queue row; holding names its leading gap apart from the link', () => {
    expect(typeof decidedIsAQueueRow).toBe('function');
    expect(typeof leadingIsNotTheLink).toBe('function');
    expect(typeof rowHasAllocationFacts).toBe('function');
  });

  it('every place says which states it may hold, and a role place may hold any state but paid and waiting', () => {
    expect(Object.keys(PLACE_STATES).sort()).toEqual([...PLACE_IDS].sort());
    for (const id of ['r-owner', 'r-manager', 'r-bookkeeper'] as const) {
      expect(PLACE_STATES[id]).not.toContain('paid');
      expect(PLACE_STATES[id]).not.toContain('in_ocr');
      expect(PLACE_STATES[id]).toEqual(expect.arrayContaining(['flagged_open', 'held_duplicate', 'clean', 'claim_open', 'approved']));
    }
  });
});
