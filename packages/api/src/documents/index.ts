/** G-09 · multi-page documents. Services only; procedures live in W2-02 / W2-05 routers. */
export * from './types';
export { DocumentError, isDocumentError } from './errors';
export { composeDocument, MAX_DOCUMENT_PAGES } from './compose';
export { toObjectRef, signObjectRef } from './objectRef';
// Round 8 (L1): attachAsPage is test-only now (no router uses it) — not part of the package surface.
export { splitDocument } from './attach';
export { composedPathFor } from './compose';
export { createIntakeInvoice } from './intake';
export { settleDocumentPages, windowCloseGate, WINDOW_MAX_ATTEMPTS, pageMismatch, decidePages, samePage, PAGE_FLAGS, type PageFlag, type SettleResult } from './settle';
export { multiPageEnabled } from '../ingest/grouping';
export { PAGE_ABSORBED_ACTION } from './reocr';
export { STORE_OBJECT_PATH } from './objectRef';
export { resolvePageFlag, PAGE_SEPARATE, type PageFlagAction } from './resolve';
