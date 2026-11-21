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
/**
 * Israeli phone rule — the same normaliser + regex as the landing form's
 * `normalizeIlPhone` / `isValidIlPhone` (leadForm.logic.ts). Mobile 05x/07x
 * (10 digits) or landline 02/03/04/08/09 (9 digits); +972 / 00972 / 972 are
 * folded to a leading 0 and spaces, dashes, dots and brackets are ignored.
 */
function normalizeIlPhone(raw: string): string {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+972')) d = `0${d.slice(4)}`;
  else if (d.startsWith('00972')) d = `0${d.slice(5)}`;
  else if (d.startsWith('972') && d.length >= 11) d = `0${d.slice(3)}`;
  return d;
}
function isValidIlPhone(raw: string): boolean {
  const d = normalizeIlPhone(raw);
  return /^0(5\d|7\d)\d{7}$/.test(d) || /^0[2-489]\d{7}$/.test(d);
}

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
}).superRefine((input, ctx) => {
  // SEC-1 (W3-06 review): a lead must be reachable, validated exactly as the
  // landing form does (apps/web/(marketing)/_components/leadForm.logic.ts →
  // validateLead): a phone, when given, must be a valid Israeli number; an
  // email, when given, must be valid (zod .email() above); and at least one of
  // them is required. A tripped honeypot is exempt so the bot still gets the
  // silent `{ ok: true }` and can't tell a drop from a save.
  if (input.hp && input.hp.trim().length > 0) return;
  const phone = input.phone ?? '';
  const email = input.email ?? '';
  if (phone.length > 0 && !isValidIlPhone(phone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'invalid Israeli phone number' });
  }
  if (phone.length === 0 && email.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'phone or email is required' });
  }
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
