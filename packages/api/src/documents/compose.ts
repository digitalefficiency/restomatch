import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { INGEST_LIMITS, sniffMime } from '@restomatch/ingest';
import { deterministicScanId } from '../routers/scans';
import { DocumentError, documentNotFound } from './errors';
import { tenantPath } from './objectRef';
import { defaultDocumentStorage, type DocumentStorage } from './storage';
import type { ComposeDocumentInput, ComposedDocument } from './types';

/** A delivery note or a חשבונית מרכזת is 1–4 pages; 20 is a generous ceiling. */
export const MAX_DOCUMENT_PAGES = 20;
/** Composed PDFs use A4 width; the image keeps its aspect ratio. */
const PAGE_WIDTH_PT = 595.28;

export interface ComposeDeps {
  storage?: DocumentStorage | null;
}

/** The object a clientDocumentId composes to (deterministic: same id → same object). */
export function composedPathFor(restaurantId: string, clientDocumentId: string): string {
  return `${restaurantId}/${deterministicScanId(restaurantId, clientDocumentId)}.pdf`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Compose page objects (JPEG/PNG, by magic bytes) into ONE PDF at a
 * deterministic object, in array order. Idempotent: an existing object is
 * returned as is and the pages are never re-read. Pages are deleted only after
 * a successful write (best effort, logged).
 */
export async function composeDocument(input: ComposeDocumentInput, deps: ComposeDeps = {}): Promise<ComposedDocument> {
  const { restaurantId, clientDocumentId, pageObjects } = input;
  if (!clientDocumentId || clientDocumentId.length > 256) throw new DocumentError('no_pages');
  if (!Array.isArray(pageObjects) || pageObjects.length === 0) throw new DocumentError('no_pages');
  if (pageObjects.length > MAX_DOCUMENT_PAGES) throw new DocumentError('too_many_pages');
  // Every page must be this tenant's object. Foreign, traversal and missing look alike.
  const pages = pageObjects.map((p) => tenantPath(restaurantId, p));
  if (pages.some((p) => p === null)) throw documentNotFound();

  const storage = deps.storage === undefined ? defaultDocumentStorage() : deps.storage;
  if (!storage) throw new Error('storage not configured');
  const storagePath = composedPathFor(restaurantId, clientDocumentId);

  const existing = await storage.read(restaurantId, storagePath);
  if (existing) {
    const pdf = await PDFDocument.load(existing, { updateMetadata: false });
    return { storagePath, pageCount: pdf.getPageCount(), sha256: sha256Hex(existing), created: false };
  }

  const pdf = await PDFDocument.create();
  let inBytes = 0;
  for (const path of pages as string[]) {
    const bytes = await storage.read(restaurantId, path);
    if (!bytes) throw documentNotFound();
    inBytes += bytes.byteLength;
    if (inBytes > INGEST_LIMITS.attachmentBytes) throw new DocumentError('too_large');
    const mime = sniffMime(bytes);
    let image;
    try {
      if (mime === 'image/jpeg') image = await pdf.embedJpg(bytes);
      else if (mime === 'image/png') image = await pdf.embedPng(bytes);
    } catch {
      throw new DocumentError('unsupported_page_type');
    }
    if (!image) throw new DocumentError('unsupported_page_type');
    const height = (image.height / image.width) * PAGE_WIDTH_PT;
    const page = pdf.addPage([PAGE_WIDTH_PT, height]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH_PT, height });
  }
  // Deterministic bytes for the same pages (no wall-clock metadata).
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  pdf.setProducer('RestoMatch');
  pdf.setCreator('RestoMatch');
  const out = await pdf.save();
  if (out.byteLength > INGEST_LIMITS.attachmentBytes) throw new DocumentError('too_large');

  await storage.write(restaurantId, storagePath, out, 'application/pdf');

  if (input.deletePages !== false) {
    const toDelete = (pages as string[]).filter((p) => p !== storagePath);
    try {
      await storage.remove(restaurantId, toDelete);
    } catch (err) {
      console.warn(`[documents] page cleanup failed for ${storagePath}`, err);
    }
  }
  return { storagePath, pageCount: pages.length, sha256: sha256Hex(out), created: true };
}
