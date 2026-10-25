import { describe, expect, it } from 'vitest';
import {
  accessibilityCoordinator,
  contactChannels,
  hasAnyChannel,
  internationalDigits,
  whatsappHref,
} from '@/lib/contact';
import { isPublicPath } from '@/lib/publicPaths';
import { he as marketingHe } from '@/lib/i18n/messages/marketing/he';
import { en as marketingEn } from '@/lib/i18n/messages/marketing/en';
import { MARKETING_ROUTES } from '../seo';
import {
  SOURCE_MAX,
  attributionFromSearch,
  buildLeadSource,
  firstInvalidField,
  formatIlPhone,
  isValidEmail,
  isValidIlPhone,
  mergeAttribution,
  normalizeIlPhone,
  validateLead,
} from '../leadForm.logic';

describe('lib/contact — channels render only when configured (mkt-06)', () => {
  it('no env → no channel at all', () => {
    const c = contactChannels({});
    expect(c).toEqual({ whatsapp: null, phone: null, email: null });
    expect(hasAnyChannel(c)).toBe(false);
  });

  it('Israeli local numbers become international digits for wa.me / tel:', () => {
    expect(internationalDigits('050-123 4567')).toBe('972501234567');
    expect(internationalDigits('+972 50 123 4567')).toBe('972501234567');
    expect(internationalDigits('00972501234567')).toBe('972501234567');
    expect(internationalDigits('12')).toBeNull();
  });

  it('builds wa.me, tel: and mailto: links', () => {
    const c = contactChannels({
      NEXT_PUBLIC_CONTACT_WHATSAPP: '050-1234567',
      NEXT_PUBLIC_CONTACT_PHONE: '03-1234567',
      NEXT_PUBLIC_CONTACT_EMAIL: 'hello@example.co.il',
    });
    expect(c.whatsapp?.digits).toBe('972501234567');
    expect(c.phone?.href).toBe('tel:+97231234567');
    expect(c.email?.href).toBe('mailto:hello@example.co.il');
    expect(whatsappHref('972501234567', 'היי שם')).toBe(
      `https://wa.me/972501234567?text=${encodeURIComponent('היי שם')}`,
    );
    expect(whatsappHref('972501234567')).toBe('https://wa.me/972501234567');
  });

  it('a malformed value is treated as not configured (never a dead link)', () => {
    const c = contactChannels({
      NEXT_PUBLIC_CONTACT_WHATSAPP: 'TBD',
      NEXT_PUBLIC_CONTACT_EMAIL: 'not-an-email',
    });
    expect(c.whatsapp).toBeNull();
    expect(c.email).toBeNull();
  });

  it('the accessibility coordinator is null-per-field until the owner sets it', () => {
    expect(accessibilityCoordinator({})).toEqual({ name: null, phone: null, email: null });
    expect(accessibilityCoordinator({ NEXT_PUBLIC_A11Y_COORDINATOR_NAME: ' דנה ' }).name).toBe(
      'דנה',
    );
  });
});

describe('lead form rules (mkt-01, mkt-09)', () => {
  it('accepts Israeli mobile, VoIP and landline numbers in common spellings', () => {
    for (const ok of [
      '0501234567',
      '050-1234567',
      '050 123 4567',
      '+972-50-123-4567',
      '972501234567',
      '077-1234567',
      '03-1234567',
      '(04) 123-4567',
    ]) {
      expect(isValidIlPhone(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '123',
      '05012345',
      '0501234567890',
      '01-1234567',
      'abc',
      '+1 555 123 4567',
    ]) {
      expect(isValidIlPhone(bad), bad).toBe(false);
    }
  });

  it('normalises to 0XX-XXXXXXX / 0X-XXXXXXX', () => {
    expect(normalizeIlPhone('+972 50 123 4567')).toBe('0501234567');
    expect(formatIlPhone('+972501234567')).toBe('050-1234567');
    expect(formatIlPhone('031234567')).toBe('03-1234567');
  });

  it('validates e-mail shape', () => {
    expect(isValidEmail('dana@bistro.co.il')).toBe(true);
    expect(isValidEmail('dana@bistro')).toBe(false);
    expect(isValidEmail('dana bistro@x.il')).toBe(false);
  });

  it('a name-only lead is refused on the client: phone OR e-mail is required', () => {
    const e = validateLead({ name: 'דנה', phone: '', email: '' });
    expect(e).toEqual({ contact: 'errorContact' });
    expect(firstInvalidField(e)).toBe('phone');
  });

  it('either channel alone is enough; the name stays required', () => {
    expect(validateLead({ name: 'דנה', phone: '050-1234567', email: '' })).toEqual({});
    expect(validateLead({ name: 'דנה', phone: '', email: 'd@x.co.il' })).toEqual({});
    expect(validateLead({ name: ' ', phone: '050-1234567', email: '' })).toEqual({
      name: 'errorName',
    });
  });

  it('a bad value is reported on its own field, in field order', () => {
    const e = validateLead({ name: 'דנה', phone: '123', email: 'nope' });
    expect(e).toEqual({ phone: 'errorPhone', email: 'errorEmail' });
    expect(firstInvalidField(e)).toBe('phone');
    expect(firstInvalidField(validateLead({ name: '', phone: '', email: '' }))).toBe('name');
  });

  it('every error key has copy in both languages', () => {
    for (const k of ['errorName', 'errorContact', 'errorPhone', 'errorEmail'] as const) {
      expect(marketingHe.lead[k]).toBeTruthy();
      expect(marketingEn.lead[k]).toBeTruthy();
    }
  });
});

describe('attribution → leads.create.source (mkt-28)', () => {
  it('reads UTM params and plan, bounded and sanitised', () => {
    const a = attributionFromSearch(
      '?utm_source=google&utm_medium=cpc&utm_campaign=oct<script>&plan=pro&x=1',
      '/pricing',
    );
    expect(a).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'octscript',
      plan: 'pro',
      entry: '/pricing',
    });
  });

  it('keeps the entry page, replaces the campaign on a new UTM landing, keeps the plan', () => {
    const first = mergeAttribution(null, attributionFromSearch('?utm_source=fb&plan=basic', '/'));
    const second = mergeAttribution(
      first,
      attributionFromSearch('?utm_source=google&utm_medium=cpc', '/about'),
    );
    expect(second).toEqual({ entry: '/', plan: 'basic', utm_source: 'google', utm_medium: 'cpc' });
    // A plain page view keeps everything.
    expect(mergeAttribution(second, attributionFromSearch('', '/pricing'))).toEqual(second);
  });

  it('builds a source string the router accepts (≤120 chars)', () => {
    expect(buildLeadSource('/', 'lead', null)).toBe('/|lead');
    expect(
      buildLeadSource('/', 'lead', {
        entry: '/pricing',
        plan: 'pro',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'oct',
      }),
    ).toBe('/|lead|plan=pro|src=google/cpc/oct|in=/pricing');
    const long = 'x'.repeat(40);
    const s = buildLeadSource(`/${long}`, long, {
      entry: `/${long}`,
      utm_source: long,
      utm_medium: long,
      utm_campaign: long,
    });
    expect(s.length).toBeLessThanOrEqual(SOURCE_MAX);
  });
});

describe('/accessibility is public and indexed (mkt-02, a11y-01)', () => {
  it('is reachable without a session', () => {
    expect(isPublicPath('/accessibility')).toBe(true);
  });

  it('is in the sitemap routes', () => {
    expect(MARKETING_ROUTES).toContain('/accessibility');
  });

  it('states partial conformance honestly and keeps owner facts as marked placeholders', () => {
    expect(marketingHe.a11y.levelBody).toContain('5568');
    expect(marketingHe.a11y.levelBody).toContain('WCAG 2.2');
    expect(marketingHe.a11y.levelStatus).toContain('באופן חלקי');
    expect(marketingEn.a11y.levelStatus).toContain('partially');
    expect(marketingHe.a11y.sla).toContain('5 ימי עסקים');
    for (const p of [
      marketingHe.a11y.placeholderName,
      marketingHe.a11y.placeholderPhone,
      marketingHe.a11y.placeholderEmail,
    ]) {
      expect(p).toMatch(/^\[.+\]$/);
    }
  });

  it('uses one primary CTA label everywhere (mkt-04)', () => {
    expect(marketingHe.shell.cta).toBe('בדיקת דליפה חינם');
    expect(marketingHe.about.cta).toBe(marketingHe.shell.cta);
    expect(marketingHe.shell.nav.leakCheck).toBe(marketingHe.shell.cta);
  });
});
