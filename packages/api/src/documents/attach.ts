import { TRPCError } from '@trpc/server';
import type { Database } from '@restomatch/db';
import type { AttachAsPageInput, AttachAsPageResult, SplitDocumentInput, SplitDocumentResult } from './types';

export async function attachAsPage(_db: Database, _input: AttachAsPageInput): Promise<AttachAsPageResult> {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'attachAsPage: G-09 in progress' });
}

export async function splitDocument(_db: Database, _input: SplitDocumentInput): Promise<SplitDocumentResult> {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'splitDocument: G-09 in progress' });
}
