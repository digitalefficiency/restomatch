import { cache } from 'react';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One detail read per request, shared by the page and its <title>. */
export const loadDetail = cache(async (invoiceId: string) => {
  if (!UUID.test(invoiceId)) return null;
  const caller = await createServerCaller();
  try {
    return await caller.invoices.detail({ invoiceId });
  } catch (err) {
    if (err instanceof TRPCError && ['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST'].includes(err.code)) return null;
    throw err;
  }
});

