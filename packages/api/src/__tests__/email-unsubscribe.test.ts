import { describe, expect, it } from 'vitest';
import { renderEmail, magicLinkEmail } from '../index';

describe('email unsubscribe footer (E.7)', () => {
  it('renders an unsubscribe link for marketing emails (when unsubscribeUrl is set)', () => {
    const html = renderEmail({
      preview: 'p',
      heading: 'h',
      bodyHtml: '<p>שיווק</p>',
      unsubscribeUrl: 'https://app.example.com/u/abc-123',
    });
    expect(html).toContain('https://app.example.com/u/abc-123');
    expect(html).toContain('להסרה מרשימת הדיוור');
  });

  it('transactional templates carry NO unsubscribe link (exempt)', () => {
    const { html } = magicLinkEmail({ url: 'https://app.example.com/login?token=x' });
    expect(html).not.toContain('להסרה מרשימת הדיוור');
  });
});
