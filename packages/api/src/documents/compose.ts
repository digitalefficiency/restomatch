import { TRPCError } from '@trpc/server';
import type { ComposeDocumentInput, ComposedDocument } from './types';

export const MAX_DOCUMENT_PAGES = 20;

export async function composeDocument(_input: ComposeDocumentInput): Promise<ComposedDocument> {
  throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'composeDocument: G-09 in progress' });
}
