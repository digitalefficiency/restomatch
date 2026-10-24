import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeResendDispatcher } from '../resend';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Resend dispatcher attachments', () => {
  it('passes base64 attachments through as Resend `attachments`', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const send = makeResendDispatcher({ apiKey: 'k', from: 'a@b.test' });
    await send({
      restaurantId: 'r',
      channel: 'email',
      target: 's@supplier.test',
      subject: 'הזמנה',
      body: 'text',
      attachments: [{ filename: 'order-1A2B3C4D.pdf', contentBase64: 'JVBERi0=', contentType: 'application/pdf' }],
    });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.attachments).toEqual([
      { filename: 'order-1A2B3C4D.pdf', content: 'JVBERi0=', contentType: 'application/pdf' },
    ]);
  });

  it('sends no attachments key when there are none', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await makeResendDispatcher({ apiKey: 'k' })({ restaurantId: 'r', channel: 'email', target: 't', body: 'b' });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent).not.toHaveProperty('attachments');
  });
});
