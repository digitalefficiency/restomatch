import { describe, expect, it } from 'vitest';
import { formatJobFailure } from '../queue';

describe('formatJobFailure', () => {
  it('names the queue, job id, attempt and error message', () => {
    expect(formatJobFailure('ocr-invoice', { id: '42', attemptsMade: 2 }, new Error('boom'))).toBe(
      '[ocr-invoice] job=42 attempt=2 failed: boom',
    );
  });

  it('tolerates a missing job and non-Error throwables', () => {
    expect(formatJobFailure('match-invoice', undefined, 'nope')).toBe(
      '[match-invoice] job=? attempt=? failed: nope',
    );
  });
});
