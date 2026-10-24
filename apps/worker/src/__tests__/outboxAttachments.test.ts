import { describe, expect, it } from 'vitest';
import { readAttachments } from '../jobs/outboxDispatch';

describe('outbox payload.__attachments', () => {
  it('reads well-formed attachments and drops malformed ones', () => {
    const ok = { filename: 'order-1.pdf', contentBase64: 'JVBERi0=', contentType: 'application/pdf' };
    expect(readAttachments({ __attachments: [ok, { filename: 1 }, null] })).toEqual([ok]);
  });

  it('is undefined when there is nothing to attach', () => {
    expect(readAttachments(null)).toBeUndefined();
    expect(readAttachments({ __html: '<p/>' })).toBeUndefined();
    expect(readAttachments({ __attachments: [] })).toBeUndefined();
  });
});
