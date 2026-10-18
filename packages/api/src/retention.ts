import { and, count, eq, isNotNull, isNull, leads, lt, verificationTokens, type Database } from '@restomatch/db';

/**
 * Retention / data-minimization engine (E.8 — Amendment 13 minimization).
 *
 * A conservative, additive purge: it removes ONLY data that is provably dead or
 * stale, and it NEVER touches financial/tax artifacts. In particular it does
 * NOT delete `invoice_scans` or `invoices` — Israeli bookkeeping rules can
 * require retaining tax documents for years [לאימות עו"ד], so those windows are
 * documented in docs/legal/ROPA.md and enforced by exclusion here, not by code.
 *
 * The job is split into a pure-ish DB function (testable against the test DB)
 * and a worker wrapper (apps/worker). `dryRun` is the DEFAULT everywhere — a run
 * only deletes when explicitly told to, so enabling the cron without the purge
 * flag yields a visibility report and zero destruction.
 */

export interface RetentionConfig {
  /** Drop expired magic-link / verification tokens this many days past expiry. */
  verificationTokenGraceDays: number;
  /** Purge marketing leads older than this whose owner explicitly opted out. */
  unsubscribedLeadDays: number;
  /** Purge never-consented marketing leads older than this (stale prospects). */
  staleLeadDays: number;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  verificationTokenGraceDays: 1,
  unsubscribedLeadDays: 30,
  staleLeadDays: 730,
};

export interface RetentionReport {
  dryRun: boolean;
  at: string;
  /** What WOULD be (dryRun) or WAS (live) removed, per class. */
  expiredVerificationTokens: number;
  unsubscribedLeads: number;
  staleLeads: number;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Compute (and optionally execute) the retention purge. Returns the counts in
 * each class. With `dryRun: true` (default) it only COUNTS — nothing is deleted.
 */
export async function runRetention(
  db: Database,
  opts: { now?: Date; config?: Partial<RetentionConfig>; dryRun?: boolean } = {},
): Promise<RetentionReport> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? true;
  const cfg: RetentionConfig = { ...DEFAULT_RETENTION_CONFIG, ...opts.config };

  const tokenCutoff = daysAgo(now, cfg.verificationTokenGraceDays);
  const unsubCutoff = daysAgo(now, cfg.unsubscribedLeadDays);
  const staleCutoff = daysAgo(now, cfg.staleLeadDays);

  // Predicates kept identical between the count (dry-run) and delete paths.
  const expiredTokenPred = lt(verificationTokens.expires, tokenCutoff);
  const unsubLeadPred = and(
    isNotNull(leads.unsubscribedAt),
    lt(leads.unsubscribedAt, unsubCutoff),
  );
  const staleLeadPred = and(
    eq(leads.marketingConsent, false),
    isNull(leads.unsubscribedAt),
    lt(leads.createdAt, staleCutoff),
  );

  const [tokRow] = await db
    .select({ n: count() })
    .from(verificationTokens)
    .where(expiredTokenPred);
  const [unsubRow] = await db.select({ n: count() }).from(leads).where(unsubLeadPred);
  const [staleRow] = await db.select({ n: count() }).from(leads).where(staleLeadPred);

  const expiredVerificationTokens = Number(tokRow?.n ?? 0);
  const unsubscribedLeads = Number(unsubRow?.n ?? 0);
  const staleLeads = Number(staleRow?.n ?? 0);

  if (!dryRun) {
    if (expiredVerificationTokens > 0) {
      await db.delete(verificationTokens).where(expiredTokenPred);
    }
    if (unsubscribedLeads > 0) {
      await db.delete(leads).where(unsubLeadPred);
    }
    if (staleLeads > 0) {
      await db.delete(leads).where(staleLeadPred);
    }
  }

  return {
    dryRun,
    at: now.toISOString(),
    expiredVerificationTokens,
    unsubscribedLeads,
    staleLeads,
  };
}
