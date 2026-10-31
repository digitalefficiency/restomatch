import { describe, expect, it } from 'vitest';
import {
  deliveryState,
  localDaysBetween,
  type DeliveryState,
  type DeliveryStateInput,
} from '../lib/deliveryState';

/**
 * G-01: the late-delivery e-mail went out for POs that were already received,
 * because "open" was read from purchase_orders.status (receiving never moves it
 * out of 'sent'). deliveryState() decides from the latest goods receipt.
 */
const TZ = 'Asia/Jerusalem';
const at = (iso: string) => new Date(iso);

type Row = [
  label: string,
  po: DeliveryStateInput['po'],
  receipt: DeliveryStateInput['latestReceipt'],
  now: string,
  want: DeliveryState,
];

const sent = (expected: string | null): DeliveryStateInput['po'] => ({
  status: 'sent',
  expectedDeliveryAt: expected ? at(expected) : null,
});

// 2026-10-25 is the Israel DST fall-back day (02:00 IDT → 01:00 IST; UTC+3 → UTC+2).
const TABLE: Row[] = [
  // ── PO status wins first ──────────────────────────────────────────────
  ['cancelled PO, even if overdue', { status: 'cancelled', expectedDeliveryAt: at('2026-10-20T06:00:00Z') }, null, '2026-10-27T08:00:00Z', 'cancelled'],
  ['closed PO (platform sync) with no receipt', { status: 'closed', expectedDeliveryAt: at('2026-10-20T06:00:00Z') }, null, '2026-10-27T08:00:00Z', 'received'],
  // ── any goods receipt decides it ──────────────────────────────────────
  ['completed GR, overdue by days', sent('2026-10-20T06:00:00Z'), { status: 'completed' }, '2026-10-27T08:00:00Z', 'received'],
  ['partial GR is terminal (backorder = new PO)', sent('2026-10-20T06:00:00Z'), { status: 'partial' }, '2026-10-27T08:00:00Z', 'received'],
  ['rejected GR: the delivery came', sent('2026-10-20T06:00:00Z'), { status: 'rejected' }, '2026-10-27T08:00:00Z', 'received'],
  ['pending GR: receiving in progress', sent('2026-10-20T06:00:00Z'), { status: 'pending' }, '2026-10-27T08:00:00Z', 'in_progress'],
  ['confirmed PO with a completed GR', { status: 'confirmed', expectedDeliveryAt: at('2026-10-26T06:00:00Z') }, { status: 'completed' }, '2026-10-26T08:00:00Z', 'received'],
  // ── no receipt: by the clock, in Israel time ──────────────────────────
  ['no expected date', sent(null), null, '2026-10-27T08:00:00Z', 'upcoming'],
  ['tomorrow (IL)', sent('2026-10-28T06:00:00Z'), null, '2026-10-27T08:00:00Z', 'upcoming'],
  ['later today, not yet due', sent('2026-10-27T12:00:00Z'), null, '2026-10-27T08:00:00Z', 'due_today'],
  ['59 min past the expected time: still due_today', sent('2026-10-27T07:01:00Z'), null, '2026-10-27T08:00:00Z', 'due_today'],
  ['exactly 60 min past: late', sent('2026-10-27T07:00:00Z'), null, '2026-10-27T08:00:00Z', 'late'],
  ['yesterday, never received', sent('2026-10-26T06:00:00Z'), null, '2026-10-27T08:00:00Z', 'late'],
  // ── DST weekend (Fri 23 – Sun 25 Oct 2026) ────────────────────────────
  ['Sat 24 Oct 23:30 IDT seen at Sat 23:50 IDT: same IL day', sent('2026-10-24T20:30:00Z'), null, '2026-10-24T20:50:00Z', 'due_today'],
  ['expected Sun 25 Oct 08:00 IST, seen Sat 23:50 IDT: tomorrow', sent('2026-10-25T06:00:00Z'), null, '2026-10-24T20:50:00Z', 'upcoming'],
  ['expected Sun 25 Oct 08:00 IST, seen Sun 00:30 IDT (UTC still Sat): due today', sent('2026-10-25T06:00:00Z'), null, '2026-10-24T21:30:00Z', 'due_today'],
  ['expected Sun 01:30 IDT (first pass), seen 01:20 IST (second pass, +50 min real time)', sent('2026-10-24T22:30:00Z'), null, '2026-10-24T23:20:00Z', 'due_today'],
  ['expected Sun 01:30 IDT, seen 01:30 IST (60 min of real time later): late', sent('2026-10-24T22:30:00Z'), null, '2026-10-24T23:30:00Z', 'late'],
];

describe('deliveryState (Asia/Jerusalem)', () => {
  it.each(TABLE)('%s', (_label, po, latestReceipt, now, want) => {
    expect(deliveryState({ po, latestReceipt, now: at(now), tz: TZ })).toBe(want);
  });

  it('is pure: same input, same answer, inputs untouched', () => {
    const input: DeliveryStateInput = { po: sent('2026-10-26T06:00:00Z'), latestReceipt: null, now: at('2026-10-27T08:00:00Z'), tz: TZ };
    const snapshot = JSON.stringify(input);
    expect(deliveryState(input)).toBe(deliveryState(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("uses the restaurant's zone for 'today' (22:30 UTC is tomorrow in Israel, still today in London)", () => {
    const input = { po: sent('2026-11-10T06:00:00Z'), latestReceipt: null, now: at('2026-11-09T22:30:00Z') } as const;
    expect(deliveryState({ ...input, tz: TZ })).toBe('due_today');
    expect(deliveryState({ ...input, tz: 'Europe/London' })).toBe('upcoming');
  });
});

describe('localDaysBetween', () => {
  it('counts Israel calendar days, across the 25 h DST day', () => {
    expect(localDaysBetween(at('2026-10-24T06:00:00Z'), at('2026-10-25T08:00:00Z'), TZ)).toBe(1);
    expect(localDaysBetween(at('2026-10-24T06:00:00Z'), at('2026-10-26T08:00:00Z'), TZ)).toBe(2);
    expect(localDaysBetween(at('2026-10-24T20:30:00Z'), at('2026-10-24T21:30:00Z'), TZ)).toBe(1); // 23:30 IDT → 00:30 IDT
    expect(localDaysBetween(at('2026-10-27T08:00:00Z'), at('2026-10-27T08:00:00Z'), TZ)).toBe(0);
  });
});
