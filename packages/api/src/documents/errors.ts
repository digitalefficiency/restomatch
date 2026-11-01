import { TRPCError } from '@trpc/server';
import type { DocumentFailureReason } from './types';

/** A named refusal: BAD_REQUEST (or CONFLICT for a state refusal) with `reason`. */
export class DocumentError extends TRPCError {
  readonly reason: DocumentFailureReason;
  constructor(reason: DocumentFailureReason) {
    const conflict = reason === 'decided' || reason === 'has_claim' || reason === 'approved_or_paid' || reason === 'linked' || reason === 'multi_page' || reason === 'reocr_not_enabled';
    super({ code: conflict ? 'CONFLICT' : 'BAD_REQUEST', message: reason });
    this.reason = reason;
  }
}

export function isDocumentError(err: unknown): err is DocumentError {
  return err instanceof DocumentError;
}

/** One message for foreign, traversal and missing objects alike — no existence oracle. */
export function documentNotFound(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'document not found' });
}
