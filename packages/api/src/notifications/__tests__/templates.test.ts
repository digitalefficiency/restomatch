import { describe, expect, it } from 'vitest';
import {
  approvalNeededEmail,
  endOfDayReportEmail,
  inviteEmail,
  magicLinkEmail,
  orderNotPlacedEmail,
  renderEmail,
  supplierDelayEmail,
  weeklyLeakReportEmail,
} from '../templates';

describe('email templates', () => {
  it('renderEmail produces an RTL Hebrew document with the heading and CTA', () => {
    const html = renderEmail({
      preview: 'preview',
      heading: 'כותרת',
      bodyHtml: '<p>גוף</p>',
      cta: { label: 'לחץ כאן', url: 'https://example.com/x' },
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('כותרת');
    expect(html).toContain('https://example.com/x');
    expect(html).toContain('לחץ כאן');
  });

  it('escapes interpolated HTML to prevent injection', () => {
    const html = renderEmail({
      preview: 'p',
      heading: '<script>alert(1)</script>',
      bodyHtml: 'ok',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('magicLinkEmail carries the login url in html + text', () => {
    const { subject, html, text } = magicLinkEmail({ url: 'https://app/login?t=abc' });
    expect(subject).toContain('התחברות');
    expect(html).toContain('https://app/login?t=abc');
    expect(text).toContain('https://app/login?t=abc');
  });

  it('inviteEmail names the restaurant and role', () => {
    const { subject, html } = inviteEmail({
      url: 'https://app/invite',
      restaurantName: 'כפר הזיתים',
      roleLabel: 'מנהל',
    });
    expect(subject).toContain('כפר הזיתים');
    expect(html).toContain('מנהל');
  });

  it('supplierDelayEmail states the lateness and supplier', () => {
    const { subject, html, text } = supplierDelayEmail({
      supplierName: 'תנובה',
      expectedAtLabel: '20.6.2026',
      daysLate: 2,
      lineCount: 5,
      poUrl: 'https://app/po/1',
    });
    expect(subject).toContain('תנובה');
    expect(html).toContain('2 ימים');
    expect(text).toContain('תנובה');
  });

  it('orderNotPlacedEmail names the order day and cutoff', () => {
    const { html } = orderNotPlacedEmail({
      supplierName: 'שופרסל',
      orderDayLabel: 'יום ראשון',
      cutoffLabel: '12:00',
    });
    expect(html).toContain('יום ראשון');
    expect(html).toContain('12:00');
  });

  it('approvalNeededEmail surfaces the count and at-risk amount', () => {
    const { subject, html } = approvalNeededEmail({
      supplierName: 'תנובה',
      discrepancyCount: 3,
      atRiskIls: '₪1,240',
    });
    expect(subject).toContain('3');
    expect(html).toContain('₪1,240');
  });

  it('weeklyLeakReportEmail shows saved and leaked figures', () => {
    const { html } = weeklyLeakReportEmail({
      weekLabel: '13–19 ביוני',
      savedIls: '₪3,500',
      leakedIls: '₪820',
    });
    expect(html).toContain('₪3,500');
    expect(html).toContain('₪820');
  });

  it('endOfDayReportEmail leads with open credits in subject + body', () => {
    const { subject, html } = endOfDayReportEmail({
      dateLabel: '21.6.2026',
      openCreditsCount: 4,
      openCreditsIls: '₪2,100',
      todayCaughtCount: 2,
      todayCaughtIls: '₪640',
      pendingApprovals: 3,
      approvalsUrl: 'https://app/dashboard/approvals',
    });
    expect(subject).toContain('זיכויים פתוחים');
    expect(subject).toContain('₪2,100');
    expect(html).toContain('₪2,100');
    expect(html).toContain('₪640');
    expect(html).toContain('https://app/dashboard/approvals');
  });

  it('endOfDayReportEmail celebrates a clean day when no open credits', () => {
    const { html } = endOfDayReportEmail({
      dateLabel: '21.6.2026',
      openCreditsCount: 0,
      openCreditsIls: '₪0',
      todayCaughtCount: 1,
      todayCaughtIls: '₪120',
    });
    expect(html).toContain('אין זיכויים פתוחים');
  });
});
