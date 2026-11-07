'use server';

import { headers } from 'next/headers';
import { isOriginAllowed } from '@restomatch/api';
import { publicClientIp } from '@/lib/publicGuard';
import { enforceRateLimit } from '@/lib/rateLimit';
import { createServerCaller } from '@/lib/trpc/server';
import { LEADS_RATE_LIMIT, submitLead, type LeadActionState } from './leadAction.core';

/**
 * W3-06 · the lead form as a progressively enhanced Server Action (works with
 * JS off). Same front door as `POST /api/trpc/leads.create`: origin check, the
 * `leads` per-IP bucket, bounded fields, then the immutable `leads.create`.
 */
export async function leadAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const h = await headers();
  const originOk = isOriginAllowed({
    method: 'POST',
    origin: h.get('origin'),
    host: h.get('host'),
    allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
  });
  const ip = publicClientIp(h);
  return submitLead(formData, {
    originOk,
    rateLimit: () => enforceRateLimit(ip, LEADS_RATE_LIMIT),
    create: async (input) => (await createServerCaller()).leads.create(input),
  });
}
