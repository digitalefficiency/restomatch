/** G-09 · multi-page documents. Services only; procedures live in W2-02 / W2-05 routers. */
export * from './types';
export { DocumentError, isDocumentError } from './errors';
export { composeDocument, MAX_DOCUMENT_PAGES } from './compose';
export { toObjectRef, signObjectRef } from './objectRef';
export { attachAsPage, splitDocument } from './attach';
