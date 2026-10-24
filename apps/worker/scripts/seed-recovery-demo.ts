/**
 * Demo data for the ₪-back tracker (wave 1 · S12, flag `recovery`).
 *
 * Puts recovery states on the demo tenant's CLAIMED discrepancies so the
 * tracker, the hero's "returned this month" and the monthly report have a
 * believable story: some claims are already back in the bank, some credited,
 * some acknowledged, a few overdue (letter sent 3 weeks ago, no credit note),
 * the newest still just claimed, and one disputed.
 *
 * - Runs AFTER seed-demo.ts (which recreates the discrepancies).
 * - Idempotent: if the tenant's claims already carry states, it prints the
 *   summary and changes nothing. Re-running seed-demo resets everything.
 * - Touches only recovery_claims / recovery_events / credit_notes (manual
 *   notes): invoices and discrepancies are untouched, so the leak hero is
 *   byte-for-byte the same — asserted before/after.
 *
 * Run: DATABASE_URL=... pnpm --filter @restomatch/worker exec tsx scripts/seed-recovery-demo.ts
 * Restaurant: DEMO_RESTAURANT_ID, else the main demo restaurant by its business
 * id + name — never any other tenant — and only with the `recovery` flag on (the
 * seeded demo tenant has features.all). Dates are anchored to DEMO_TODAY. Local DBs only (seed guard;
 * SEED_ALLOW_REMOTE_HOST=<host> for a disposable demo DB).
 */
import {
  computeRecoverySummary,
  isFeatureOn,
  recordCreditNote,
  returnedInMonth,
  syncClaims,
  transitionClaim,
} from '@restomatch/api';
import { computeLeakHero } from '@restomatch/charts';
import { and, asc, assertSeedTarget, createDb, DEMO_MAIN_BUSINESS_ID, DEMO_MAIN_NAME, eq, recoveryClaims, restaurants } from '@restomatch/db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
assertSeedTarget(url, 'seed-recovery-demo');
const db = createDb(url);

const DAY = 24 * 60 * 60 * 1000;
const ils = (agorot: number) => `₪${(agorot / 100).toFixed(2)}`;

/**
 * "Now" for the staged dates: DEMO_TODAY (YYYY-MM-DD) like the other seeds, so a
 * reseed the night before lands claim ages relative to the demo day; else the clock.
 */
function demoNow(): Date {
  const day = process.env.DEMO_TODAY?.trim();
  if (!day) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`DEMO_TODAY must be YYYY-MM-DD, got "${day}"`);
  return new Date(`${day}T10:00:00Z`); // midday in Israel
}

async function stageRestaurant(restaurantId: string, name: string): Promise<void> {
  const heroBefore = await computeLeakHero(db, restaurantId);
  const lastBefore = await computeLeakHero(db, restaurantId, { monthOffset: -1 });

  await syncClaims(db, restaurantId);
  const claims = await db
    .select()
    .from(recoveryClaims)
    .where(eq(recoveryClaims.restaurantId, restaurantId))
    .orderBy(asc(recoveryClaims.claimedAt), asc(recoveryClaims.amountAgorot), asc(recoveryClaims.id));

  if (claims.length === 0) {
    console.log(`[seed-recovery-demo] ${name}: no claimed discrepancies — run seed-demo.ts first`);
    return;
  }
  if (claims.some((c) => c.status !== 'claimed')) {
    console.log(`[seed-recovery-demo] ${name}: already staged — nothing to do`);
  } else {
    const now = demoNow();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
    const recoveredAt = new Date(Math.max(monthStart.getTime(), now.getTime() - 2 * DAY));
    const n = claims.length;
    // Oldest first: 35% back in the bank, 15% credited, 15% acknowledged,
    // 20% letter sent 3 weeks ago (overdue → reminders), the rest just claimed;
    // the very newest one is disputed when there are enough claims.
    const cut = (f: number) => Math.round(n * f);
    const plan = claims.map((c, i) => ({
      claim: c,
      target:
        i < cut(0.35)
          ? 'recovered'
          : i < cut(0.5)
            ? 'credited'
            : i < cut(0.65)
              ? 'acknowledged'
              : i < cut(0.85)
                ? 'letter_sent'
                : i === n - 1 && n >= 6
                  ? 'disputed'
                  : 'claimed',
    }));

    // Letters went out a few days after each claim; overdue ones 21 days ago.
    for (const { claim, target } of plan) {
      if (target === 'claimed') continue;
      const letterAt =
        target === 'letter_sent'
          ? new Date(now.getTime() - 21 * DAY)
          : new Date(Math.min(claim.claimedAt.getTime() + 2 * DAY, now.getTime() - 5 * DAY));
      await transitionClaim(db, restaurantId, { claimId: claim.id, to: 'letter_sent', at: letterAt });
      if (target === 'acknowledged' || target === 'credited' || target === 'recovered') {
        await transitionClaim(db, restaurantId, {
          claimId: claim.id,
          to: 'acknowledged',
          at: new Date(letterAt.getTime() + 2 * DAY),
        });
      }
      if (target === 'disputed') {
        await transitionClaim(db, restaurantId, {
          claimId: claim.id,
          to: 'disputed',
          at: new Date(letterAt.getTime() + DAY),
          note: 'הספק טוען שהמחיר עודכן בהסכם',
        });
      }
    }

    // One manual credit note per supplier covering its credited/recovered claims (exact amount).
    const toCredit = plan.filter((p) => p.target === 'credited' || p.target === 'recovered');
    const bySupplier = new Map<string, typeof toCredit>();
    for (const p of toCredit) {
      if (!p.claim.supplierId) continue;
      bySupplier.set(p.claim.supplierId, [...(bySupplier.get(p.claim.supplierId) ?? []), p]);
    }
    let seq = 1;
    for (const [supplierId, group] of bySupplier) {
      const amount = group.reduce((s, p) => s + p.claim.amountAgorot, 0);
      const creditedAt = new Date(now.getTime() - 6 * DAY);
      await recordCreditNote(db, restaurantId, {
        claimIds: group.map((p) => p.claim.id),
        supplierId,
        number: `DEMO-ZK-${String(seq++).padStart(3, '0')}`,
        amountAgorot: amount,
        issuedOn: creditedAt.toISOString().slice(0, 10),
        at: creditedAt,
      });
      for (const p of group) {
        if (p.target === 'recovered') {
          await transitionClaim(db, restaurantId, { claimId: p.claim.id, to: 'recovered', at: recoveredAt });
        }
      }
    }
  }

  // The hero must not move: recovery never touches invoices or discrepancies.
  const heroAfter = await computeLeakHero(db, restaurantId);
  const lastAfter = await computeLeakHero(db, restaurantId, { monthOffset: -1 });
  if (JSON.stringify(heroBefore) !== JSON.stringify(heroAfter) || JSON.stringify(lastBefore) !== JSON.stringify(lastAfter)) {
    throw new Error(`[seed-recovery-demo] ${name}: the leak hero changed — refusing (this is a bug)`);
  }

  const s = await computeRecoverySummary(db, restaurantId);
  const r = await returnedInMonth(db, restaurantId);
  console.log(
    `[seed-recovery-demo] ${name}: claims=${s.claimCount} claimed=${ils(s.claimedAgorot)} credited=${ils(s.creditedAgorot)} ` +
      `returned=${ils(s.recoveredAgorot)} (this month ${ils(r.returnedAgorot)}) outstanding=${ils(s.outstandingAgorot)} ` +
      `overdue=${s.overdueCount} rate=${s.recoveryRate == null ? '—' : `${Math.round(s.recoveryRate * 100)}%`} · ` +
      `hero unchanged: leak ₪${heroAfter.leakIls} · ${((heroAfter.leakPct ?? 0) * 100).toFixed(1)}% of ₪${heroAfter.spendIls}`,
  );
}

async function main(): Promise<void> {
  // Only ever the demo tenant: DEMO_RESTAURANT_ID, else the main demo restaurant
  // by its fixed business id + name. Never "every restaurant with the flag" —
  // on a shared database that could include a real tenant.
  const only = process.env.DEMO_RESTAURANT_ID?.trim();
  const rows = only
    ? await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(eq(restaurants.id, only))
    : await db
        .select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants)
        .where(and(eq(restaurants.businessId, DEMO_MAIN_BUSINESS_ID), eq(restaurants.name, DEMO_MAIN_NAME)));
  if (rows.length !== 1) {
    console.error(
      `[seed-recovery-demo] refusing: ${only ? `DEMO_RESTAURANT_ID ${only}` : `the demo restaurant (${DEMO_MAIN_NAME}, ${DEMO_MAIN_BUSINESS_ID})`} matched ${rows.length} restaurants — set DEMO_RESTAURANT_ID`,
    );
    process.exit(2);
  }
  let staged = 0;
  for (const r of rows) {
    if (!(await isFeatureOn(db, r.id, 'recovery'))) continue;
    await stageRestaurant(r.id, r.name);
    staged += 1;
  }
  if (staged === 0) console.log('[seed-recovery-demo] no restaurant has the `recovery` flag on');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
