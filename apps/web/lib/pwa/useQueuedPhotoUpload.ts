'use client';

import { useCallback } from 'react';
import { trpc } from '@/lib/trpc/client';
import { uploadScanFile } from '../scanPrep';
import { ScopeChangedError, SessionGoneError, announceSynced, type QueuedPhoto } from './offlineQueue';

export { blobToBase64 } from '../scanPrep';

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
      // switched branch since this page rendered (or the session ended), never
      // upload this branch's photo there. A colleague's photo of THIS branch is
      // fine (decision 22: uploaded, attributed to whoever took it).
      const scope = await sessionScope();
      // No session at all is an EXPIRED session (sign in to upload), not a branch switch.
      if (!scope) throw new SessionGoneError();
      if (scope.restaurantId !== item.restaurantId) throw new ScopeChangedError();
      // A photo queued by an older version (or a gallery pick) may be too big /
      // undecodable: shrink it now, or fail before any request (parked, kept).
      const picked = new File([item.blob], 'invoice', { type: item.mimeType });
      const scan = await uploadScanFile(picked, (ready, contentBase64) =>
        utils.client.scans.upload.mutate({
          contentBase64,
          mimeType: ready.type,
          supplierName: item.supplierName,
          clientUploadId: item.clientUploadId,
        }),
      );
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
