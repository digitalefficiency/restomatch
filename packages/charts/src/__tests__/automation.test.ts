import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEvents,
  auditLog,
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  notificationsOutbox,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  sql,
  testDbUrl,
  users,
} from '@restomatch/db';
import { automationKpis, computeTimeLedger, AUTOMATION_RATE_DEFAULTS, TOUCH_ACTIONS } from '../automation';

const db = createDb(testDbUrl());

async function resetDb() {
  await db.execute(sql`TRUNCATE restaurants, users CASCADE`);
}
beforeEach(resetDb);
afterAll(resetDb);

// Thursday 15.10.2026 12:00 in Israel. The current Israel week starts Sun 11.10 00:00 IDT = 10.10 21:00Z.
const NOW = new Date('2026-10-15T09:00:00Z');
const WEEK_START = new Date('2026-10-10T21:00:00Z');
const MON = new Date('2026-10-12T06:00:00Z');
const H = 3_600_000;
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * H);

async function tenant(name: string) {
  const [r] = await db.insert(restaurants).values({ name }).returning();
  const [u] = await db.insert(users).values({ email: `${name.replace(/\W/g, '')}-${Date.now()}@t.test` }).returning();
  const rid = r!.id;

  async function invoice(opts: {
    createdAt: Date;
    raw?: Record<string, unknown>;
    total?: string;
    invoiceDate?: Date;
  }) {
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: rid,
        createdAt: opts.createdAt,
        invoiceDate: opts.invoiceDate ?? opts.createdAt,
        totalExclVat: opts.total ?? '1000',
        vatAmount: '0',
        totalInclVat: opts.total ?? '1000',
        status: 'matched',
        source: 'photo',
        ...(opts.raw ? { ocrPayload: { provider: 'reconciled' as const, raw: opts.raw } } : {}),
      })
      .returning();
    return inv!.id;
  }

  /** One match run + its invoice_matched feed row, the way persistMatchRun leaves them. */
  async function matchRun(invoiceId: string, runAt: Date) {
    const [mr] = await db
      .insert(matchRuns)
      .values({ restaurantId: rid, invoiceId, runAt, overallStatus: 'minor', totalDiscrepancyAmount: '0' })
      .returning();
    await db.insert(activityEvents).values({
      restaurantId: rid,
      eventType: 'invoice_matched',
      entityType: 'match_run',
      entityId: mr!.id,
      title: 'חשבונית הותאמה',
      metadata: { invoiceId },
      createdAt: runAt,
    });
    return mr!.id;
  }

  /** A re-match: production deletes the invoice's previous runs (their findings cascade) and writes a new one. */
  async function rematch(invoiceId: string, runAt: Date) {
    await db.delete(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
    return matchRun(invoiceId, runAt);
  }

  async function finding(
    runId: string,
    opts: {
      type?: (typeof discrepancies.$inferInsert)['type'];
      severity?: 'info' | 'warn' | 'block';
      delta?: string;
      status?: 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
      createdAt?: Date;
      resolvedAt?: Date | null;
      human?: boolean;
    } = {},
  ) {
    const [d] = await db
      .insert(discrepancies)
      .values({
        restaurantId: rid,
        matchRunId: runId,
        type: opts.type ?? 'PRICE_HIGHER',
        severity: opts.severity ?? 'warn',
        deltaAmount: opts.delta ?? '10.00',
        resolutionStatus: opts.status ?? 'open',
        createdAt: opts.createdAt ?? MON,
        resolvedAt: opts.resolvedAt ?? null,
        resolvedBy: opts.human ? u!.id : null,
      })
      .returning();
    return d!.id;
  }

  return { rid, userId: u!.id, invoice, matchRun, rematch, finding };
}

const current = (k: Awaited<ReturnType<typeof automationKpis>>) => k.weeks[k.weeks.length - 1]!;

describe('automationKpis · weeks', () => {
  it('returns Israel weeks oldest first, Sunday 00:00 local bounds, weeks clamped 1..12', async () => {
    const t = await tenant('Week Bistro');
    const k = await automationKpis(db, t.rid, { weeks: 3, now: NOW });
    expect(k.weeks).toHaveLength(3);
    expect(current(k).weekStart).toBe(WEEK_START.toISOString());
    expect(current(k).weekEnd).toBe('2026-10-17T21:00:00.000Z');
    expect(k.weeks[0]!.weekStart).toBe('2026-09-26T21:00:00.000Z');
    expect((await automationKpis(db, t.rid, { weeks: 40, now: NOW })).weeks).toHaveLength(12);
    expect((await automationKpis(db, t.rid, { weeks: 0, now: NOW })).weeks).toHaveLength(1);
  });

  it('Saturday 23:59 belongs to the previous week, Sunday 00:00 to the new one', async () => {
    const t = await tenant('Boundary');
    await t.invoice({ createdAt: new Date('2026-10-10T20:59:00Z') }); // Sat 23:59 IDT
    await t.invoice({ createdAt: new Date('2026-10-10T21:00:00Z') }); // Sun 00:00 IDT
    const k = await automationKpis(db, t.rid, { weeks: 2, now: NOW });
    expect(k.weeks[0]!.docsIn).toBe(1);
    expect(k.weeks[1]!.docsIn).toBe(1);
  });

  it('weeks before the first data say "no data yet", never a measured 0', async () => {
    const t = await tenant('New');
    await t.invoice({ createdAt: MON });
    const k = await automationKpis(db, t.rid, { weeks: 3, now: NOW });
    expect(k.weeks.map((w) => w.hasData)).toEqual([false, false, true]);
    expect(k.dataSince).toBe(MON.toISOString());
    expect(k.weeks[0]!.zeroTouchPct).toBeNull();
  });
});

describe('automationKpis · zero-touch, arrival → matched, exceptions', () => {
  it('5 invoices (consolidated, duplicate copy, re-matched twice, 2 clean) → docsIn 5, 2/3 zero-touch (proxy)', async () => {
    expect(TOUCH_ACTIONS).toEqual([]);
    const t = await tenant('Zero Touch');
    const consolidated = await t.invoice({ createdAt: MON, raw: { kind: 'consolidated' } });
    const original = await t.invoice({ createdAt: at(MON, -100) }); // last week: out of this week's set
    const dup = await t.invoice({ createdAt: MON, raw: { duplicateOf: { invoiceId: original } } });
    const rematched = await t.invoice({ createdAt: MON });
    const cleanA = await t.invoice({ createdAt: MON });
    const cleanB = await t.invoice({ createdAt: MON });

    await t.matchRun(consolidated, at(MON, 1));
    await t.matchRun(dup, at(MON, 8));
    await t.matchRun(cleanA, at(MON, 2));
    await t.matchRun(cleanB, at(MON, 4));
    // Re-matched twice: three feed rows, ONE surviving match_runs row.
    await t.matchRun(rematched, at(MON, 6));
    await t.rematch(rematched, at(MON, 30));
    const lastRun = await t.rematch(rematched, at(MON, 40));
    await t.finding(lastRun, { type: 'QTY_SHORT', severity: 'warn' });

    const runs = await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, rematched));
    expect(runs).toHaveLength(1);

    const wk = current(await automationKpis(db, t.rid, { weeks: 2, now: NOW }));
    expect(wk.docsIn).toBe(5);
    expect(wk.docsBySource).toEqual({ photo: 5 });
    expect(wk.duplicateCopies).toBe(1);
    expect(wk.zeroTouchDenominator).toBe(3);
    expect(wk.zeroTouchTouched).toBe(1);
    expect(wk.zeroTouchPct).toBe(66.7);
    expect(wk.zeroTouchBasis).toBe('proxy');
    expect(wk.zeroTouchExcluded).toEqual({ consolidated: 1, pendingLink: 0, duplicate: 1 });
    // Hours to the FIRST feed row: [1, 2, 4, 6, 8] → p50 4, p90 7.2. The re-match at +30/+40 h does not move it.
    expect(wk.arrivalToMatchedHoursP50).toBe(4);
    expect(wk.arrivalToMatchedHoursP90).toBe(7.2);
    // 1 of the 3 has a warn/block finding on its latest run.
    expect(wk.exceptionPct).toBe(33.3);
  });

  it('a human-resolved finding touches the invoice; an open UNORDERED_ARRIVAL is pending link (T4), not counted', async () => {
    const t = await tenant('Touch');
    const a = await t.invoice({ createdAt: MON });
    const b = await t.invoice({ createdAt: MON });
    const ra = await t.matchRun(a, at(MON, 1));
    await t.finding(ra, { status: 'accepted', resolvedAt: at(MON, 3), human: true });
    const rb = await t.matchRun(b, at(MON, 1));
    await t.finding(rb, { type: 'UNORDERED_ARRIVAL', severity: 'warn' });
    const wk = current(await automationKpis(db, t.rid, { weeks: 1, now: NOW }));
    expect(wk.zeroTouchDenominator).toBe(1);
    expect(wk.zeroTouchPct).toBe(0);
    expect(wk.zeroTouchExcluded.pendingLink).toBe(1);
  });

  it('decision age p50 for findings decided this week; open > 24 h counted now', async () => {
    const t = await tenant('Decisions');
    const inv = await t.invoice({ createdAt: MON });
    const run = await t.matchRun(inv, at(MON, 1));
    await t.finding(run, { status: 'accepted', createdAt: MON, resolvedAt: at(MON, 10), human: true });
    await t.finding(run, { status: 'rejected', createdAt: MON, resolvedAt: at(MON, 20), human: true });
    await t.finding(run, { status: 'open', createdAt: at(NOW, -30) });
    await t.finding(run, { status: 'open', createdAt: at(NOW, -2) });
    const k = await automationKpis(db, t.rid, { weeks: 1, now: NOW });
    expect(current(k).decisionAgeHoursP50).toBe(15);
    expect(current(k).decisionsResolved).toBe(2);
    expect(k.openDecisionsOver24h).toBe(1);
  });
});

describe('automationKpis · alerts', () => {
  async function outbox(
    rid: string,
    o: {
      status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
      sentAt?: Date;
      lastError?: string;
      payload?: Record<string, unknown> | null;
      dedupeKey?: string;
      relatedType?: string;
      relatedId?: string;
    },
  ) {
    await db.insert(notificationsOutbox).values({
      restaurantId: rid,
      channel: 'whatsapp',
      target: '+972500000000',
      body: 'x',
      status: o.status,
      sentAt: o.sentAt ?? null,
      lastError: o.lastError ?? null,
      payload: o.payload ?? null,
      dedupeKey: o.dedupeKey ?? null,
      relatedEntityType: o.relatedType ?? null,
      relatedEntityId: o.relatedId ?? null,
      createdAt: MON,
    });
  }

  it('skipped_no_provider is failedNoProvider, never sent; mock ids are sentMock; opened is null', async () => {
    const t = await tenant('Alerts');
    await outbox(t.rid, { status: 'failed', lastError: 'skipped_no_provider', dedupeKey: 'match:abc' });
    await outbox(t.rid, { status: 'failed', lastError: 'boom', dedupeKey: 'match:def' });
    await outbox(t.rid, { status: 'sent', sentAt: MON, payload: { externalId: 'wa-mock-1' }, dedupeKey: 'match:ghi' });
    await outbox(t.rid, { status: 'sent', sentAt: MON, payload: { externalId: 'wamid.HBgM' }, dedupeKey: 'match:jkl' });
    await outbox(t.rid, { status: 'queued', payload: { event: 'claim.overdue' } });
    const wk = current(await automationKpis(db, t.rid, { weeks: 1, now: NOW }));
    const match = wk.alerts.find((a) => a.event === 'match')!;
    expect(match).toEqual({
      event: 'match',
      queued: 0,
      sent: 1,
      sentMock: 1,
      failedNoProvider: 1,
      failed: 1,
      cancelled: 0,
      opened: null,
      actedWithin48h: 0,
    });
    expect(wk.alerts.find((a) => a.event === 'claim.overdue')!.queued).toBe(1);
  });

  it('acted within 48 h: 47 h yes, 49 h no; joined through the invoice even after a re-match deleted the alerted run', async () => {
    const t = await tenant('Acted');
    const sentAt = at(MON, 1);

    const inv47 = await t.invoice({ createdAt: MON });
    const run47 = await t.matchRun(inv47, MON);
    await t.finding(run47, { status: 'accepted', resolvedAt: at(sentAt, 47), human: true });
    await outbox(t.rid, { status: 'sent', sentAt, dedupeKey: 'm47:x', relatedType: 'match_run', relatedId: run47 });

    const inv49 = await t.invoice({ createdAt: MON });
    const run49 = await t.matchRun(inv49, MON);
    await t.finding(run49, { status: 'accepted', resolvedAt: at(sentAt, 49), human: true });
    await outbox(t.rid, { status: 'sent', sentAt, dedupeKey: 'm49:x', relatedType: 'match_run', relatedId: run49 });

    const invRe = await t.invoice({ createdAt: MON });
    const alerted = await t.matchRun(invRe, MON);
    await outbox(t.rid, { status: 'sent', sentAt, dedupeKey: 'mre:x', relatedType: 'match_run', relatedId: alerted });
    const newer = await t.rematch(invRe, at(sentAt, 2));
    await t.finding(newer, { status: 'accepted', resolvedAt: at(sentAt, 10), human: true });

    const wk = current(await automationKpis(db, t.rid, { weeks: 1, now: NOW }));
    const by = Object.fromEntries(wk.alerts.map((a) => [a.event, a.actedWithin48h]));
    expect(by).toEqual({ m47: 1, m49: 0, mre: 1 });
  });

  it('acted via a claim transition by a person (recovery_events.actor_id)', async () => {
    const t = await tenant('ClaimActed');
    const inv = await t.invoice({ createdAt: MON });
    const run = await t.matchRun(inv, MON);
    const d = await t.finding(run, { status: 'accepted', resolvedAt: MON, human: false });
    const [c] = await db
      .insert(recoveryClaims)
      .values({ restaurantId: t.rid, discrepancyId: d, invoiceId: inv, amountAgorot: 1000, claimedAt: MON })
      .returning();
    const sentAt = at(MON, 2);
    await outbox(t.rid, { status: 'sent', sentAt, dedupeKey: 'claim:x', relatedType: 'recovery_claim', relatedId: c!.id });
    await db.insert(recoveryEvents).values({
      restaurantId: t.rid,
      claimId: c!.id,
      fromStatus: 'claimed',
      toStatus: 'letter_sent',
      actorId: t.userId,
      createdAt: at(sentAt, 5),
    });
    const wk = current(await automationKpis(db, t.rid, { weeks: 1, now: NOW }));
    expect(wk.alerts.find((a) => a.event === 'claim')!.actedWithin48h).toBe(1);
  });
});

describe('automationKpis · ₪ funnel (agorot) and automation runs', () => {
  it('found = capped leak; decided = accepted claimable only; claim stages by their own stamps; cohort by claimed_at', async () => {
    const t = await tenant('Funnel');
    const inv = await t.invoice({ createdAt: MON, total: '100.00' });
    const run = await t.matchRun(inv, MON);
    const d1 = await t.finding(run, { delta: '60.50', status: 'accepted', resolvedAt: MON, human: true });
    // Capped: 60.50 + 70.25 = 130.75 > invoice total 100 → found 100.00.
    await t.finding(run, { type: 'QTY_SHORT', delta: '70.25', status: 'open' });
    // Never claimable / not leak: out of "decided".
    await t.finding(run, { type: 'MISSING_ON_INVOICE', delta: '5.00', status: 'accepted', resolvedAt: MON, human: true });
    await t.finding(run, { type: 'PRICE_LOWER', delta: '3.00', status: 'accepted', resolvedAt: MON, human: true });

    await db.insert(recoveryClaims).values({
      restaurantId: t.rid,
      discrepancyId: d1,
      invoiceId: inv,
      status: 'recovered',
      amountAgorot: 6050,
      creditedAgorot: 6000,
      claimedAt: at(MON, 1),
      letterSentAt: at(MON, 2),
      creditedAt: at(MON, 3),
      recoveredAt: at(NOW, 24 * 7 + 1), // next week: not in this week's flow, but in the cohort
    });

    const k = await automationKpis(db, t.rid, { weeks: 2, now: at(NOW, 24 * 7) });
    const [prev, cur] = k.weeks;
    expect(prev!.funnelAgorot).toEqual({ found: 10000, decided: 6050, claimed: 6050, sent: 6050, credited: 6000, recovered: 0 });
    expect(cur!.funnelAgorot.recovered).toBe(6000);
    expect(prev!.cohortAgorot).toEqual({ claimed: 6050, sent: 6050, credited: 6000, recovered: 6000 });
    for (const v of Object.values(prev!.funnelAgorot)) expect(Number.isInteger(v)).toBe(true);
  });

  it('counts automationRuns from audit_log.after and activity_events.metadata', async () => {
    const t = await tenant('Runs');
    await db.insert(auditLog).values([
      { restaurantId: t.rid, action: 'x', entityType: 'invoice', after: { automationId: 'A12' }, at: MON },
      { restaurantId: t.rid, action: 'x', entityType: 'invoice', after: { automationId: 'A12' }, at: MON },
      { restaurantId: t.rid, action: 'x', entityType: 'invoice', after: { automationId: 'not-an-id' }, at: MON },
    ]);
    await db.insert(activityEvents).values({
      restaurantId: t.rid,
      eventType: 'sync_completed',
      title: 't',
      metadata: { automationId: 'A3' },
      createdAt: MON,
    });
    const wk = current(await automationKpis(db, t.rid, { weeks: 1, now: NOW }));
    expect(wk.automationRuns).toEqual({ A12: 2, A3: 1 });
  });
});

describe('automationKpis · tenant isolation', () => {
  it("ignores a foreign tenant's (bigger) rows", async () => {
    const a = await tenant('Tenant A');
    const b = await tenant('Tenant B');
    const ia = await a.invoice({ createdAt: MON, total: '50' });
    const ra = await a.matchRun(ia, at(MON, 1));
    await a.finding(ra, { delta: '5.00' });
    for (let i = 0; i < 4; i++) {
      const ib = await b.invoice({ createdAt: MON, total: '900' });
      const rb = await b.matchRun(ib, at(MON, 1));
      await b.finding(rb, { delta: '400.00', status: 'accepted', resolvedAt: MON, human: true });
      await db.insert(auditLog).values({ restaurantId: b.rid, action: 'x', entityType: 'invoice', after: { automationId: 'A1' }, at: MON });
    }
    const wk = current(await automationKpis(db, a.rid, { weeks: 1, now: NOW }));
    expect(wk.docsIn).toBe(1);
    expect(wk.zeroTouchDenominator).toBe(1);
    expect(wk.funnelAgorot.found).toBe(500);
    expect(wk.funnelAgorot.decided).toBe(0);
    expect(wk.decisionsResolved).toBe(0);
    expect(wk.automationRuns).toEqual({});
  });
});

describe('time ledger', () => {
  const weeks = [{ docsIn: 100, zeroTouchDenominator: 80, zeroTouchTouched: 20, hasData: true }];

  it('is Σ role × docs × minutes × rate, the bookkeeper capped at her prorated fee', () => {
    const tl = computeTimeLedger(weeks);
    // receiver: 100 docs × 0.5..1 min × ₪63/h = 52.50..105.00
    expect(tl.byRole[0]).toEqual({ role: 'receiver', lowIls: 52.5, highIls: 105 });
    // bookkeeper: 60 zero-touch × 3..5 min × ₪89/h = 267..445, capped at ₪600 × 12/52 = 138.46
    expect(tl.byRole[1]).toEqual({ role: 'bookkeeper', lowIls: 138.46, highIls: 138.46 });
    expect(tl.bookkeeperCapped).toBe(true);
    expect(tl.lowIls).toBe(190.96);
    expect(tl.assumptions.find((a) => a.key === 'rate.manager')!.value).toBe(AUTOMATION_RATE_DEFAULTS.manager);
  });

  it('rates are overridable per request', () => {
    const tl = computeTimeLedger(weeks, { rates: { receiver: 120 }, bookkeeperFeeIls: 10_000 });
    expect(tl.byRole[0]!.highIls).toBe(200);
    expect(tl.bookkeeperCapped).toBe(false);
    expect(tl.byRole[1]!.highIls).toBe(445);
  });

  it('is never part of the ₪ funnel: disjoint keys, no field sums them', async () => {
    const t = await tenant('Ledger');
    const k = await automationKpis(db, t.rid, { weeks: 1, now: NOW });
    const funnelKeys = Object.keys(current(k).funnelAgorot);
    const ledgerKeys = Object.keys(k.timeLedger);
    expect(funnelKeys.filter((x) => ledgerKeys.includes(x))).toEqual([]);
    expect(Object.keys(current(k))).not.toContain('timeLedger');
    expect(JSON.stringify(current(k))).not.toMatch(/Ils/);
  });
});
