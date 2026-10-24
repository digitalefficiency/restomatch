import {
  and,
  createDb,
  eq,
  memberships,
  poLines,
  restaurants,
  testDbUrl,
  translationCache,
} from '@restomatch/db';
import { TargetClaudeTranslator, TargetTranslator, type MessagesClientLike } from '@restomatch/translate';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../index';
import { __resetClaudeBudget } from '../receiving/english';
import { __setReceiverTranslator, renderSizeSuffix } from '../receiving/localize';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Receiver languages (S14, flag `receiverLanguages`): localNames goes cache →
 * glossary → Claude (mocked) and writes the per-restaurant cache; the flag gates
 * every procedure; foreign ids are NOT_FOUND.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner', userId = t.ownerUserId) {
  const ctx: AppContext = { db, session: { userId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

function fakeClaude(map: Record<string, string>) {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    const msg = (body.messages as Array<{ content: string }>)[0]!.content;
    const payload = JSON.parse(msg.slice(msg.indexOf('['))) as Array<{ id: number; he: string }>;
    const items = payload.filter((p) => map[p.he]).map((p) => ({ id: p.id, text: map[p.he]! }));
    return { content: [{ type: 'text', text: JSON.stringify({ items }) }] };
  });
  return { client: { messages: { create } } as MessagesClientLike, create };
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(() => __setReceiverTranslator(null));
beforeEach(async () => {
  __resetClaudeBudget();
  __setReceiverTranslator(new TargetTranslator());
  await db.update(restaurants).set({ settings: { features: { receiverLanguages: true } } as never }).where(eq(restaurants.id, A.restaurantId));
  await db.update(restaurants).set({ settings: { features: { receiverLanguages: true } } as never }).where(eq(restaurants.id, B.restaurantId));
  await db.delete(translationCache);
});

describe('receiverLangs: flag', () => {
  it('status reflects the flag; procedures are FEATURE_DISABLED when off', async () => {
    expect(await caller(A).receiverLangs.status()).toEqual({ enabled: true, locales: ['ar', 'ru', 'th', 'ti'] });
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, A.restaurantId));
    expect(await caller(A).receiverLangs.status()).toEqual({ enabled: false, locales: [] });
    for (const call of [
      () => caller(A).receiverLangs.localNames({ locale: 'ar', poId: A.poId }),
      () => caller(A).receiverLangs.setMyLocale({ locale: 'th' }),
      () => caller(A).receiverLangs.setMemberLocale({ userId: A.ownerUserId, locale: 'ru' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'FEATURE_DISABLED' } });
    }
  });
});

describe('receiverLangs.localNames', () => {
  it('glossary leg: Hebrew → ar/ru/th for PO + invoice lines, cached per restaurant + locale', async () => {
    await db.update(poLines).set({ rawDescription: 'חזה עוף' }).where(eq(poLines.id, A.poLineId));
    const r = await caller(A).receiverLangs.localNames({ locale: 'ru', poId: A.poId });
    expect(r.names['חזה עוף']).toBe('Куриная грудка');
    expect(r.cached).toBe(0);
    const rows = await db.select().from(translationCache).where(eq(translationCache.restaurantId, A.restaurantId));
    expect(rows.map((x) => [x.locale, x.sourceText, x.translatedText, x.source])).toContainEqual([
      'ru', 'חזה עוף', 'Куриная грудка', 'glossary',
    ]);
    const again = await caller(A).receiverLangs.localNames({ locale: 'ru', poId: A.poId });
    expect(again.cached).toBeGreaterThanOrEqual(1);
    expect(again.names['חזה עוף']).toBe('Куриная грудка');
    // Another tenant's cache is untouched.
    expect(await db.select().from(translationCache).where(eq(translationCache.restaurantId, B.restaurantId))).toEqual([]);
  });

  it('Claude leg (mocked) for glossary misses, within the hourly budget; unknown stays untranslated', async () => {
    const { client, create } = fakeClaude({ 'עגבניות A': 'طماطم A' });
    __setReceiverTranslator(new TargetTranslator({ claude: new TargetClaudeTranslator({ client }) }));
    await db.update(poLines).set({ rawDescription: 'עגבניות A' }).where(eq(poLines.id, A.poLineId));
    const r = await caller(A).receiverLangs.localNames({ locale: 'ar', invoiceId: A.invoiceId });
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.names['עגבניות A']).toBe('طماطم A');
    expect(r.claude).toBe(true);
    const [row] = await db
      .select()
      .from(translationCache)
      .where(and(eq(translationCache.restaurantId, A.restaurantId), eq(translationCache.sourceText, 'עגבניות A')));
    expect(row).toMatchObject({ locale: 'ar', source: 'claude' });
  });

  it('foreign PO / invoice ids are NOT_FOUND (A → B)', async () => {
    await expect(caller(A).receiverLangs.localNames({ locale: 'th', poId: B.poId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller(A).receiverLangs.localNames({ locale: 'th', poId: A.poId, invoiceId: B.invoiceId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('#56: a chef may localize a PO but never read an invoice through it (FORBIDDEN, no cache write)', async () => {
    await db.update(poLines).set({ rawDescription: 'חזה עוף' }).where(eq(poLines.id, A.poLineId));
    const chef = caller(A, 'chef');
    await expect(chef.receiverLangs.localNames({ locale: 'ru', invoiceId: A.invoiceId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      chef.receiverLangs.localNames({ locale: 'ru', poId: A.poId, invoiceId: A.invoiceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.select().from(translationCache).where(eq(translationCache.restaurantId, A.restaurantId))).toEqual(
      [],
    );
    // Same role list as receiving.getInvoice / ensureEnglish: chef is out there too.
    await expect(chef.receiving.getInvoice({ invoiceId: A.invoiceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The PO path stays open to the chef (no invoice lines in it).
    const po = await chef.receiverLangs.localNames({ locale: 'ru', poId: A.poId });
    expect(po.names['חזה עוף']).toBe('Куриная грудка');
    // Every invoice reader keeps the invoice path (the receiver wizard needs it).
    for (const role of ['owner', 'manager', 'receiver', 'bookkeeper'] as const) {
      await expect(
        caller(A, role).receiverLangs.localNames({ locale: 'ru', invoiceId: A.invoiceId }),
      ).resolves.toMatchObject({ locale: 'ru' });
    }
  });

  it('rejects a non-receiver locale', async () => {
    await expect(
      caller(A).receiverLangs.localNames({ locale: 'fr' as never, poId: A.poId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('renderSizeSuffix uses the English glossary + unit map', () => {
    expect(renderSizeSuffix('4 ל׳')).toBe('4 L');
    expect(renderSizeSuffix('3%')).toBe('3%');
    expect(renderSizeSuffix('בלבלבלה')).toBeNull();
  });
});

describe('receiverLangs: language preferences', () => {
  it('setMyLocale stores a receiver language on my own membership only', async () => {
    await caller(A).receiverLangs.setMyLocale({ locale: 'ti' });
    const [m] = await db
      .select({ l: memberships.preferredLocale })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, A.ownerUserId)));
    expect(m!.l).toBe('ti');
    expect((await caller(A).settings.myLocale()).locale).toBe('ti');
  });

  it("setMemberLocale is manager+, and a foreign member is NOT_FOUND", async () => {
    await expect(
      caller(A, 'receiver').receiverLangs.setMemberLocale({ userId: A.ownerUserId, locale: 'ar' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller(A).receiverLangs.setMemberLocale({ userId: B.ownerUserId, locale: 'ar' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [m] = await db
      .select({ l: memberships.preferredLocale })
      .from(memberships)
      .where(eq(memberships.userId, B.ownerUserId));
    expect(m!.l).not.toBe('ar');
  });
});

describe('renderSizeSuffix: linear on hostile input (CodeQL polynomial ReDoS)', () => {
  it('handles "9" + 50k spaces + newline quickly', async () => {
    const { renderSizeSuffix } = await import('../receiving/localize');
    const t0 = performance.now();
    renderSizeSuffix('9' + ' '.repeat(50_000) + '\n');
    renderSizeSuffix('9'.repeat(50_000) + '\n');
    renderSizeSuffix('9!' + '99'.repeat(25_000) + '\n');
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
