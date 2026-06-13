import { z } from 'zod';
import { leads } from '@restomatch/db';
import { publicProcedure, router } from '../trpc';

/**
 * Public landing lead-capture (Phase 6 marketing). Spam defense: a honeypot
 * field (`hp`) a human never fills — if a bot fills it we silently succeed
 * without inserting, so the bot can't distinguish a drop from a save — plus
 * bounded strings so a single request can't write unbounded text.
 * TODO (hardening): add a per-IP Redis rate limit at the web edge (the
 * enforceRateLimit infra from apps/web/lib/rateLimit.ts) for defense in depth.
 */
const LeadInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(320).email().optional(),
  restaurantName: z.string().trim().max(200).optional(),
  monthlyProcurementAgorot: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  source: z.string().trim().max(120).optional(),
  /** Honeypot: must stay empty. A non-empty value silently no-ops. */
  hp: z.string().max(200).optional(),
});

export const leadsRouter = router({
  create: publicProcedure.input(LeadInput).mutation(async ({ ctx, input }) => {
    // Honeypot tripped → pretend success, persist nothing.
    if (input.hp && input.hp.trim().length > 0) {
      return { ok: true as const };
    }
    await ctx.db.insert(leads).values({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      restaurantName: input.restaurantName ?? null,
      monthlyProcurementAgorot: input.monthlyProcurementAgorot ?? null,
      source: input.source ?? null,
    });
    return { ok: true as const };
  }),
});
