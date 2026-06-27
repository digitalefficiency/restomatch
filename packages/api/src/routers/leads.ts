import { z } from 'zod';
import { leads } from '@restomatch/db';
import { publicProcedure, router } from '../trpc';

/**
 * Public landing lead-capture (Phase 6 marketing). Spam defense: a honeypot
 * field (`hp`) a human never fills — if a bot fills it we silently succeed
 * without inserting, so the bot can't distinguish a drop from a save — plus
 * bounded strings so a single request can't write unbounded text. A per-IP
 * rate limit is enforced at the web edge (the tRPC route handler wires
 * enforceRateLimit via trpcRequestTargets('leads.create', …)) for defense in
 * depth — AppContext carries no IP, so the limit lives at the edge, not here.
 */
const LeadInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(320).email().optional(),
  restaurantName: z.string().trim().max(200).optional(),
  monthlyProcurementAgorot: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  source: z.string().trim().max(120).optional(),
  /**
   * Marketing-consent capture (E.7 — Communications Law §30A). An explicit,
   * unchecked-by-default opt-in to receive marketing messages. `consentText` is
   * the exact wording the visitor saw, persisted as evidence of an informed
   * opt-in. Submitting the lead does NOT require consent — it only gates future
   * MARKETING sends; operational replies remain transactional.
   */
  marketingConsent: z.boolean().optional(),
  consentText: z.string().trim().max(2000).optional(),
  /** Honeypot: must stay empty. A non-empty value silently no-ops. */
  hp: z.string().max(200).optional(),
});

export const leadsRouter = router({
  create: publicProcedure.input(LeadInput).mutation(async ({ ctx, input }) => {
    // Honeypot tripped → pretend success, persist nothing.
    if (input.hp && input.hp.trim().length > 0) {
      return { ok: true as const };
    }
    const consented = input.marketingConsent === true;
    await ctx.db.insert(leads).values({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      restaurantName: input.restaurantName ?? null,
      monthlyProcurementAgorot: input.monthlyProcurementAgorot ?? null,
      source: input.source ?? null,
      // Only stamp consent evidence when the visitor actively opted in.
      marketingConsent: consented,
      consentText: consented ? input.consentText ?? null : null,
      consentAt: consented ? new Date() : null,
      // consentSourceIp is captured at the edge in a later pass — AppContext
      // intentionally carries no IP (see rate-limit note above); the column
      // exists so the edge can backfill it without a schema change.
    });
    return { ok: true as const };
  }),
});
