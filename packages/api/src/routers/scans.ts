import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { memberProcedure, router } from '../trpc';
import { extFromMime, getServiceStorageClient } from '../lib/supabaseStorage';

const BUCKET = 'invoice-scans';
const SIGNED_URL_TTL_SEC = 60 * 30; // 30 minutes — enough for immediate OCR.

// ~10 MB raw file → base64 inflates ~33%, so cap the encoded input accordingly.
const MAX_BASE64_LEN = 14_000_000;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * A.3 — server-side invoice-scan upload with membership enforcement.
 *
 * SECURITY: this is the ONLY trusted write path for authenticated invoice
 * scans. memberProcedure guarantees the caller belongs to an active restaurant
 * (FORBIDDEN otherwise); the storage path and the invoice_scans.restaurant_id
 * are derived from `ctx.session.restaurantId` — NEVER from client input. The
 * client cannot choose its tenant, its prefix, or another tenant's namespace.
 *
 * The upload + mapping-row insert run via the service-role client (RLS bypass by
 * design — the tenant is already server-authoritative). The bucket is private;
 * we return a short-lived signed URL for the immediate OCR/register step. The
 * canonical viewer (/scans/[invoiceId]) re-signs per request from the session.
 */
export const scansRouter = router({
  upload: memberProcedure
    .input(
      z.object({
        contentBase64: z.string().min(1).max(MAX_BASE64_LEN),
        mimeType: z.string().min(1).max(255),
        supplierName: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ALLOWED_MIME.has(input.mimeType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `unsupported mime type: ${input.mimeType}`,
        });
      }

      const storage = getServiceStorageClient();
      if (!storage) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured (SUPABASE_SERVICE_ROLE_KEY missing)',
        });
      }

      // Tenant + path are SERVER-derived from the authenticated session.
      const restaurantId = ctx.session.restaurantId;
      const invoiceId = `scan-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const ext = extFromMime(input.mimeType);
      const storagePath = `${restaurantId}/${invoiceId}.${ext}`;

      const bytes = Buffer.from(input.contentBase64, 'base64');

      const { error: uploadError } = await storage.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: input.mimeType, upsert: false });
      if (uploadError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `upload failed: ${uploadError.message}`,
        });
      }

      // Mapping row via the service client (PostgREST) — matches the live
      // invoice_scans table whose invoice_id is opaque text. restaurant_id is
      // the session's, satisfying the NOT NULL (A.7) + tenant RLS (0002).
      const { error: insertError } = await storage.from('invoice_scans').insert({
        invoice_id: invoiceId,
        bucket: BUCKET,
        storage_path: storagePath,
        mime_type: input.mimeType,
        supplier_name: input.supplierName ?? null,
        restaurant_id: restaurantId,
        page_count: null,
      });
      if (insertError) {
        // Best-effort cleanup of the just-uploaded object.
        await storage.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `mapping insert failed: ${insertError.message}`,
        });
      }

      const { data: signed } = await storage.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);

      return {
        invoiceId,
        scanRouteUrl: `/scans/${invoiceId}`,
        storagePath,
        mimeType: input.mimeType,
        /** Short-lived signed URL for the immediate OCR/register step (private bucket). */
        signedUrl: signed?.signedUrl ?? null,
      };
    }),
});
