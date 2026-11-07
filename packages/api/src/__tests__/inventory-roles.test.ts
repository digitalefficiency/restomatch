import { beforeAll, describe, expect, it } from 'vitest';
import { callerAs, count, freshLab, price, product, ymdAgo, type Lab } from './inventory-w207-helpers';

/**
 * W2-07 · role = owner minus. The chef's JSON carries no ₪ key at all (current /
 * get / start / complete / history / periodPercent); the bookkeeper reads closed
 * counts, history, the period and the CSV, and writes nothing; discard is the
 * starter's or a manager+'s.
 */
const MONEY_KEYS = /"(unitCost|prevValueAgorot|valueAgorot|priceSource|totalValueAgorot|foodValueAgorot|foodSalesExVat|salesAgorot|purchasesAgorot|actualAgorot)"/;
let A: Lab;
let closed: string;
let draft: string;
let beef: string;

beforeAll(async () => {
  [A] = (await freshLab(['RA'])) as [Lab];
  beef = await product(A!.t, 'אנטריקוט', 'ק״ג', 'בשר');
  await price(A!.t, beef, 40, '100.0000');
  await count(A!, 30, { [beef]: '5' });
  closed = await count(A!, 10, { [beef]: '4' });
  draft = await count(A!, 1, { [beef]: '3' }, false, 'chef');
});

describe('no ₪ in the chef JSON', () => {
  it('current / get / start / history / periodPercent carry no ₪ key', async () => {
    const chef = callerAs(A, 'chef');
    const payloads = [
      await chef.inventory.current(),
      await chef.inventory.get({ countId: draft }),
      await chef.inventory.get({ countId: closed }),
      await chef.inventory.start(),
      await chef.inventory.history(),
      await chef.inventory.periodPercent(),
    ];
    for (const p of payloads) expect(JSON.stringify(p)).not.toMatch(MONEY_KEYS);
    // …while the count itself still reads, and the % is there.
    expect((await chef.inventory.get({ countId: closed })).lines[0]).toMatchObject({ qty: '4.0000' });
    expect(await chef.inventory.periodPercent()).toMatchObject({ available: true, showMoney: false });
    await expect(chef.inventory.period()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner and manager keep every ₪ key (the food figure next to the total)', async () => {
    const v = await callerAs(A, 'manager').inventory.get({ countId: closed });
    expect(v).toMatchObject({ showMoney: true, totalValueAgorot: 40_000, foodValueAgorot: 40_000 });
    expect((await callerAs(A, 'owner').inventory.history())[0]).toMatchObject({ totalValueAgorot: 40_000, foodValueAgorot: 40_000 });
  });
});

describe('the bookkeeper reads, never writes', () => {
  it('reads history, a closed count, the period and the CSV', async () => {
    const bk = callerAs(A, 'bookkeeper');
    expect((await bk.inventory.history()).length).toBe(2);
    expect(await bk.inventory.get({ countId: closed })).toMatchObject({ status: 'completed', showMoney: true, canClose: false, canAmend: false });
    expect(await bk.inventory.period()).toMatchObject({ available: true });
    expect((await bk.inventory.exportCsv({ countId: closed })).csv).toContain('TOTAL');
  });

  it('a draft and every write are FORBIDDEN', async () => {
    const bk = callerAs(A, 'bookkeeper');
    await expect(bk.inventory.get({ countId: draft })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.inventory.current()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const writes = [
      () => bk.inventory.start({ countDate: ymdAgo(0) }),
      () => bk.inventory.saveLines({ countId: draft, lines: [{ productId: beef, qty: '1' }] }),
      () => bk.inventory.setMeta({ countId: draft, notes: 'x' }),
      () => bk.inventory.complete({ countId: draft, acceptUncounted: true }),
      () => bk.inventory.discard({ countId: draft }),
      () => bk.inventory.amendLine({ countId: closed, productId: beef, qty: '1', reason: 'טעות הקלדה' }),
      () => bk.inventory.setSales({ countId: closed, foodSalesExVat: '1.00' }),
      () => bk.inventory.submitForClose({ countId: draft }),
    ];
    for (const w of writes) await expect(w()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the receiver reads nothing', async () => {
    await expect(callerAs(A, 'receiver').inventory.history()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerAs(A, 'receiver').inventory.get({ countId: closed })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('discard: the starter or a manager+', () => {
  it('another chef-tier member who did not start it is FORBIDDEN; the starter may', async () => {
    // The draft was started by the chef. A second chef (the owner's id acting as chef here is not the starter) is refused.
    const other = { ...A, users: { ...A.users, chef: A.users.manager } };
    await expect(callerAs(other, 'chef').inventory.discard({ countId: draft })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await callerAs(A, 'chef').inventory.get({ countId: draft })).canDiscard).toBe(true);
    expect((await callerAs(other, 'chef').inventory.get({ countId: draft })).canDiscard).toBe(false);
    await callerAs(A, 'chef').inventory.discard({ countId: draft });
    expect(await callerAs(A, 'owner').inventory.current()).toBeNull();
  });

  it('a manager discards a count someone else started', async () => {
    const d = await count(A, 1, { [beef]: '2' }, false, 'chef');
    await callerAs(A, 'manager').inventory.discard({ countId: d });
    expect(await callerAs(A, 'owner').inventory.current()).toBeNull();
  });
});
