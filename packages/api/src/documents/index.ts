/** G-09 · multi-page documents. Services only; procedures live in W2-02 / W2-05 routers. */
export * from './types';
export { DocumentError, isDocumentError } from './errors';
export { composeDocument, MAX_DOCUMENT_PAGES } from './compose';
export { toObjectRef, signObjectRef } from './objectRef';
export { attachAsPage, splitDocument } from './attach';
export { composedPathFor } from './compose';
export { createIntakeInvoice } from './intake';
export { settleDocumentPages, pageMismatch, PAGE_FLAGS, type PageFlag, type SettleResult } from './settle';
export { multiPageEnabled } from '../ingest/grouping';
export { STORE_OBJECT_PATH } from './objectRef';
