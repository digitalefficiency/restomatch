'use client';

import { useCallback } from 'react';
import { trpc } from '@/lib/trpc/client';
import { announceSynced, type QueuedPhoto } from './offlineQueue';

/** Encode a Blob to base64 (chunked — large photos overflow String.fromCharCode). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The signed-in user and active restaurant, read fresh (another tab may have switched branch). */
export async function sessionScope(): Promise<{ userId: string; restaurantId: string } | null> {
  const session = (await (await fetch('/api/auth/session', { cache: 'no-store' })).json()) as {
    user?: { id?: string; restaurantId?: string | null };
  };
  const userId = session.user?.id;
  const restaurantId = session.user?.restaurantId;
  return userId && restaurantId ? { userId, restaurantId } : null;
}

/**
 * Upload one queued invoice photo through the normal authenticated path —
 * scans.upload → receiving.startReceipt → receiving.registerInvoice — re-using
 * its clientUploadId (M8), so a retry never creates a second scan, invoice or
 * OCR job. Shared by the receiving PWA shell and the sign-out guard.
 */
export function useQueuedPhotoUpload(): (item: QueuedPhoto) => Promise<{ invoiceId: string }> {
  const utils = trpc.useUtils();
  return useCallback(
    async (item: QueuedPhoto) => {
      // scans.upload stores under the SESSION's active restaurant: if another tab
      // switched branch since this page rendered, never upload this branch's photo there.
      const scope = await sessionScope();
      if (scope?.restaurantId !== item.restaurantId || scope?.userId !== item.userId) {
        throw new Error('active restaurant changed — photo kept for its own branch');
      }
      const scan = await utils.client.scans.upload.mutate({
        contentBase64: await blobToBase64(item.blob),
        mimeType: item.mimeType,
        supplierName: item.supplierName,
        clientUploadId: item.clientUploadId,
      });
      const imageUrl = scan.signedUrl;
      if (!imageUrl) throw new Error('upload returned no URL');
      const receipt = await utils.client.receiving.startReceipt.mutate({ poId: item.poId });
      const reg = await utils.client.receiving.registerInvoice.mutate({
        grId: receipt.receiptId,
        imageUrl,
        supplierId: item.supplierId,
      });
      announceSynced({ clientUploadId: item.clientUploadId, poId: item.poId, grId: receipt.receiptId, invoiceId: reg.invoiceId });
      return reg;
    },
    [utils],
  );
}
