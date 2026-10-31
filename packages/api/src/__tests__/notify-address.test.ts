import { describe, expect, it } from 'vitest';
import {
  addressToTarget,
  assertDeliverableTarget,
  emailAddress,
  InvalidTargetError,
  pushSubscriptionId,
  supplierAddressOf,
  verifiedPhone,
  type Address,
} from '../notifications/address';
import {
  canSeeMoney,
  defaultRender,
  isQuietAt,
  localDayStart,
  MAX_ALERTS_PER_DAY,
  nextAllowedAt,
  planSchedule,
  redactVars,
} from '../notifications/notify';

// Israel is UTC+2 after 25.10.2026. Sat 31.10.2026 → Thu 5.11, Fri 6.11, Sat 7.11.
const TZ = 'Asia/Jerusalem';
const at = (iso: string) => new Date(iso);

describe('Address (G-06): only validated, typed addresses reach the outbox', () => {
  it('e-mail: valid syntax only; never a role string', () => {
    expect(emailAddress(' owner@resto.test ')?.value).toBe('owner@resto.test');
    expect(emailAddress('not-an-email')).toBeNull();
    expect(emailAddress('role:manager')).toBeNull();
    expect(emailAddress(null)).toBeNull();
  });

  it('phone: +972 E.164 only, and only once verified', () => {
    expect(verifiedPhone('+972 52-555-1234', null)).toBeNull();
    expect(verifiedPhone('052-555-1234', new Date())?.value).toBe('972525551234');
    expect(verifiedPhone('+1 212 555 0100', new Date())).toBeNull();
    expect(verifiedPhone('role:owner', new Date())).toBeNull();
  });

  it('push: none until H-03 brings the subscriptions table', () => {
    expect(pushSubscriptionId('sub_1')).toBeNull();
  });

  it('supplier addresses follow W2-06 supplierAddress() rules', () => {
    expect(supplierAddressOf({ email: null, whatsapp: '+972 52-555-1234' }, 'whatsapp')).toMatchObject({
      channel: 'whatsapp',
      value: '972525551234',
    });
    expect(supplierAddressOf({ email: 'role:manager', whatsapp: null }, 'email')).toBeNull();
    expect(supplierAddressOf({ email: null, whatsapp: 'role:owner' }, 'whatsapp')).toBeNull();
    expect(supplierAddressOf({ email: 'orders@supplier.test', whatsapp: null }, 'email')?.value).toBe('orders@supplier.test');
  });

  it('addressToTarget is the only path to a target; role: is a type error and a runtime throw', () => {
    const a = emailAddress('m@resto.test')!;
    expect(addressToTarget(a)).toBe('m@resto.test');
    // @ts-expect-error a plain string is not an Address
    const bad: Address = 'role:manager';
    // @ts-expect-error a hand-built object lacks the brand
    const forged: Address = { channel: 'email', value: 'role:manager' };
    expect(() => addressToTarget(forged)).toThrow(InvalidTargetError);
    expect(() => assertDeliverableTarget('role:manager')).toThrow(/INVALID_TARGET/);
    expect(() => assertDeliverableTarget('ROLE:owner')).toThrow(/INVALID_TARGET/);
    try {
      assertDeliverableTarget(bad as unknown as string);
    } catch (e) {
      expect((e as InvalidTargetError).code).toBe('INVALID_TARGET');
    }
  });
});

describe('owner alert rules: quiet hours, Shabbat, 6 a day (fixed clocks)', () => {
  it('Thu 23:30 → Fri 06:00', () => {
    const t = at('2026-11-05T21:30:00Z'); // Thu 23:30 local
    expect(isQuietAt(t, TZ)).toBe(true);
    expect(nextAllowedAt(t, TZ).toISOString()).toBe('2026-11-06T04:00:00.000Z');
  });

  it('early morning 05:59 → 06:00 the same day', () => {
    expect(nextAllowedAt(at('2026-11-04T03:59:00Z'), TZ).toISOString()).toBe('2026-11-04T04:00:00.000Z');
  });

  it('Fri 16:00 → Sat 21:00; Fri 23:30 too; Sat 22:00 is allowed', () => {
    expect(nextAllowedAt(at('2026-11-06T14:00:00Z'), TZ).toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(nextAllowedAt(at('2026-11-06T21:30:00Z'), TZ).toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(isQuietAt(at('2026-11-07T20:00:00Z'), TZ)).toBe(false);
  });

  it('a weekday 10:00 is allowed and goes now', () => {
    const t = at('2026-11-03T08:00:00Z');
    expect(planSchedule({ now: t, tz: TZ, sentToday: 0 })).toEqual({ scheduledAt: null, digest: false });
  });

  it('the 7th alert of the day → the next day slot + digest', () => {
    const t = at('2026-11-03T08:00:00Z'); // Tue 10:00
    expect(planSchedule({ now: t, tz: TZ, sentToday: MAX_ALERTS_PER_DAY - 1 }).digest).toBe(false);
    expect(planSchedule({ now: t, tz: TZ, sentToday: MAX_ALERTS_PER_DAY })).toEqual({
      scheduledAt: at('2026-11-04T04:00:00Z'),
      digest: true,
    });
    // On a Friday the next slot is after Shabbat.
    expect(planSchedule({ now: at('2026-11-06T08:00:00Z'), tz: TZ, sentToday: 6 }).scheduledAt?.toISOString()).toBe(
      '2026-11-07T19:00:00.000Z',
    );
  });

  it('the local day starts at local midnight; an unknown tz falls back to Jerusalem', () => {
    expect(localDayStart(at('2026-11-03T08:00:00Z'), TZ).toISOString()).toBe('2026-11-02T22:00:00.000Z');
    expect(nextAllowedAt(at('2026-11-05T21:30:00Z'), 'Mars/Olympus_Mons').toISOString()).toBe('2026-11-06T04:00:00.000Z');
  });
});

describe('₪ redaction by role (interim for G-07 canViewPrices)', () => {
  it('receiver never, chef only on orders/recipes, managers always', () => {
    expect(canSeeMoney('receiver')).toBe(false);
    expect(canSeeMoney('receiver', 'orders')).toBe(false);
    expect(canSeeMoney('chef')).toBe(false);
    expect(canSeeMoney('chef', 'orders')).toBe(true);
    expect(canSeeMoney('chef', 'recipes')).toBe(true);
    for (const r of ['owner', 'manager', 'bookkeeper'] as const) expect(canSeeMoney(r)).toBe(true);
  });

  it('strips money vars for a recipient without money view', () => {
    const vars = { supplierName: 'ספק', amountIls: '₪120.00' };
    expect(redactVars(vars, ['amountIls'], false)).toEqual({ supplierName: 'ספק' });
    expect(redactVars(vars, ['amountIls'], true)).toEqual(vars);
  });

  it('the interim OCR-failure copy carries no ₪ and stays short', () => {
    for (const locale of ['he', 'en'] as const) {
      for (const audience of ['uploader', 'managers']) {
        const r = defaultRender({
          template: 'invoiceOcrFailed',
          channel: 'email',
          locale,
          role: 'receiver',
          vars: { audience, reason: 'extraction_failed', fileName: 'a.jpg', supplierName: 'ספק' },
          canSeeMoney: false,
        })!;
        expect(r.body).not.toMatch(/₪|\d+\.\d{2}/);
        expect(r.body.length).toBeLessThan(200);
      }
    }
  });
});
