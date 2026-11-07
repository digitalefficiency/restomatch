import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_AWAITING_CREDIT_ILS,
  SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS,
  SAMPLE_GOOD_NEWS_ILS,
  SAMPLE_INVOICES_CHECKED,
  SAMPLE_INVOICES_WITH_GAP,
  SAMPLE_LEAK_ILS,
  SAMPLE_LEAK_PCT,
  SAMPLE_NEEDS,
  SAMPLE_PURCHASING_ILS,
} from '../sampleMonth';
import { LEAD_FIELD_MAX, LEADS_RATE_LIMIT, monthlyAgorotOf, submitLead, type LeadCreateInput } from '../leadAction.core';
import { planCtaHref, planDisplayOrder } from '../../pricing/pricing.logic';
import { SAMPLE_CAUGHT_THIS_MONTH_ILS } from '../../../showcase/_components/ShowcaseEndCard';

const agorot = (ils: number) => Math.round(ils * 100);
const WEB = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

describe('W3-06 · one sample month across the public site', () => {
  it('the leak is purchases × rate, and its parts sum to it to the agora', () => {
    expect(agorot(SAMPLE_LEAK_ILS)).toBe(Math.round(SAMPLE_PURCHASING_ILS * SAMPLE_LEAK_PCT));
    expect(agorot(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS) + agorot(SAMPLE_AWAITING_CREDIT_ILS)).toBe(agorot(SAMPLE_LEAK_ILS));
    expect(SAMPLE_AWAITING_CREDIT_ILS).toBeGreaterThan(0);
    expect(SAMPLE_INVOICES_WITH_GAP).toBeLessThanOrEqual(SAMPLE_INVOICES_CHECKED);
  });

  it('the North Star floor: the sample never claims more than 1.5%', () => {
    expect(SAMPLE_LEAK_PCT).toBe(1.5);
  });

  it('Needs-you ₪ never exceeds the leak; approvals sit inside "caught before payment"', () => {
    const approve = SAMPLE_NEEDS.find((n) => n.key === 'approve')!;
    const credit = SAMPLE_NEEDS.find((n) => n.key === 'credit')!;
    expect(approve.amountIls!).toBeLessThanOrEqual(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS);
    expect(credit.amountIls!).toBeLessThanOrEqual(SAMPLE_AWAITING_CREDIT_ILS);
    expect(approve.tone).toBe('danger');
    expect(SAMPLE_NEEDS.find((n) => n.key === 'pending')!.tone).toBe('neutral');
  });

  it('the showcase end card and good-news row quote the same "caught before payment"', () => {
    expect(SAMPLE_CAUGHT_THIS_MONTH_ILS).toBe(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS);
    expect(SAMPLE_GOOD_NEWS_ILS).toBe(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS);
  });

  it('landing, calculator and the problem math read the module, not literals', () => {
    expect(read('app/page.tsx')).toMatch(/SAMPLE_LEAK_ILS/);
    expect(read('app/page.tsx')).not.toMatch(/EXAMPLE_LEAK_RATE|150_000/);
    expect(read('app/(marketing)/_components/RoiCalculator.tsx')).toMatch(/useState\(SAMPLE_PURCHASING_ILS\)/);
    expect(read('app/(marketing)/_components/RoiCalculator.tsx')).toMatch(/useState\(SAMPLE_LEAK_PCT\)/);
    expect(read('app/(marketing)/_components/detail-sections.tsx')).not.toMatch(/150_000/);
  });
});

describe('W3-06 · pricing', () => {
  it('plan-aware CTA lands on the lead form with the plan', () => {
    expect(planCtaHref('pro')).toBe('/?plan=pro#lead');
    expect(planCtaHref('a b')).toBe('/?plan=a%20b#lead');
  });

  it('phone order puts the recommended plan first and keeps the rest in ladder order', () => {
    expect(planDisplayOrder(['trial', 'basic', 'pro', 'chain'], 'pro')).toEqual(['pro', 'trial', 'basic', 'chain']);
    expect(planDisplayOrder(['trial', 'basic'], 'pro')).toEqual(['trial', 'basic']);
    expect(planDisplayOrder(['trial', 'basic'], undefined)).toEqual(['trial', 'basic']);
  });

  it('every paid price says "+ מע״מ", renders through <Money>, and no price is mono', () => {
    const page = read('app/(marketing)/pricing/page.tsx');
    expect(page).toMatch(/<Money agorot=\{plan\.priceAgorotMonthly\}/);
    expect(page).toMatch(/pricing\.plusVat/);
    expect(page).not.toMatch(/(?<!ltr:)font-mono/); // the English-only eyebrow may stay mono
    expect(page).not.toMatch(/Intl\.NumberFormat/);
  });
});

describe('W3-06 · the lead Server Action (same front door as the tRPC route)', () => {
  const fd = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const deps = (over: Partial<{ originOk: boolean; allowed: boolean; fail: boolean }> = {}) => {
    const create = vi.fn(async (input: LeadCreateInput) => {
      void input;
      if (over.fail) throw new Error('db down');
      return { ok: true };
    });
    const rateLimit = vi.fn(async () => ({ allowed: over.allowed ?? true }));
    return { originOk: over.originOk ?? true, rateLimit, create };
  };

  it('pins the leads bucket to the immutable tRPC route', () => {
    const route = read('app/api/trpc/[trpc]/route.ts');
    expect(route).toContain(
      `{ procedure: 'leads.create', opts: { limit: ${LEADS_RATE_LIMIT.limit}, windowSec: 60 * 60, prefix: '${LEADS_RATE_LIMIT.prefix}' } }`,
    );
    expect(LEADS_RATE_LIMIT.windowSec).toBe(3600);
  });

  it('pins the field bounds to the immutable leads router', () => {
    const router = read('../../packages/api/src/routers/leads.ts');
    for (const [k, max] of [
      ['name', LEAD_FIELD_MAX.name],
      ['phone', LEAD_FIELD_MAX.phone],
      ['email', LEAD_FIELD_MAX.email],
      ['restaurantName', LEAD_FIELD_MAX.restaurantName],
      ['source', LEAD_FIELD_MAX.source],
      ['consentText', LEAD_FIELD_MAX.consentText],
      ['hp', LEAD_FIELD_MAX.hp],
    ] as const) {
      expect(router, k).toMatch(new RegExp(`${k}: z\\.string\\(\\)[^\\n]*\\.max\\(${max}\\)`));
    }
  });

  it('a foreign origin is refused before the limiter or the insert', async () => {
    const d = deps({ originOk: false });
    expect(await submitLead(fd({ name: 'א', phone: '0501234567' }), d)).toEqual({ status: 'error' });
    expect(d.rateLimit).not.toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
  });

  it('over the limit → "rate", nothing inserted', async () => {
    const d = deps({ allowed: false });
    expect(await submitLead(fd({ name: 'א', phone: '0501234567' }), d)).toEqual({ status: 'rate' });
    expect(d.create).not.toHaveBeenCalled();
  });

  it('re-validates server-side: name only is refused with the contact error', async () => {
    const d = deps();
    expect(await submitLead(fd({ name: 'רק שם' }), d)).toEqual({ status: 'invalid', errors: { contact: 'errorContact' } });
    expect(await submitLead(fd({ name: '', email: 'x@y.co' }), d)).toEqual({ status: 'invalid', errors: { name: 'errorName' } });
    expect(await submitLead(fd({ name: 'א', phone: '12' }), d)).toMatchObject({ status: 'invalid', errors: { phone: 'errorPhone' } });
    expect(d.create).not.toHaveBeenCalled();
  });

  it('a valid lead goes to leads.create normalised and bounded', async () => {
    const d = deps();
    const res = await submitLead(
      fd({
        name: '  דנה  ',
        phone: '+972 50 123 4567',
        restaurantName: 'x'.repeat(500),
        monthly: '₪ 120,000',
        source: '/|lead|pricing:pro',
        marketingConsent: 'on',
        consentText: 'אני מסכים/ה',
        hp: '',
      }),
      d,
    );
    expect(res).toEqual({ status: 'ok', name: 'דנה', phone: '050-1234567', email: '' });
    const input = d.create.mock.calls[0]![0];
    expect(input).toMatchObject({
      name: 'דנה',
      phone: '050-1234567',
      monthlyProcurementAgorot: 12_000_000,
      source: '/|lead|pricing:pro',
      marketingConsent: true,
      consentText: 'אני מסכים/ה',
    });
    expect(input.restaurantName).toHaveLength(LEAD_FIELD_MAX.restaurantName);
    expect(input.hp).toBeUndefined();
  });

  it('no opt-in → no consent text; the honeypot is passed through for the router to drop', async () => {
    const d = deps();
    await submitLead(fd({ name: 'בוט', email: 'b@o.t', consentText: 'x', hp: 'filled' }), d);
    expect(d.create.mock.calls[0]![0]).toMatchObject({ marketingConsent: false, consentText: undefined, hp: 'filled' });
  });

  it('a failing insert is a generic error, never a leak of the message', async () => {
    expect(await submitLead(fd({ name: 'א', email: 'a@b.co' }), deps({ fail: true }))).toEqual({ status: 'error' });
  });

  it('monthly ₪ → integer agorot, bounded', () => {
    expect(monthlyAgorotOf('150,000')).toBe(15_000_000);
    expect(monthlyAgorotOf('0')).toBeUndefined();
    expect(monthlyAgorotOf('abc')).toBeUndefined();
    expect(monthlyAgorotOf('99999999999999')).toBeUndefined();
  });

  it('a file posted in a text field reads as empty', async () => {
    const f = new FormData();
    f.set('name', new Blob(['x']), 'x.txt');
    f.set('email', 'a@b.co');
    expect(await submitLead(f, deps())).toEqual({ status: 'invalid', errors: { name: 'errorName' } });
  });
});
