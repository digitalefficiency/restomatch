import { afterEach, describe, expect, it } from 'vitest';
import { createDb, dbPoolMax } from '../client';

/**
 * DB_POOL_MAX lets production shrink the per-instance pool (Supabase session pooler
 * pins one server connection per client); defaults stay what they always were.
 */
const saved = process.env.DB_POOL_MAX;
afterEach(() => {
  if (saved === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = saved;
});

const optionsOf = (db: ReturnType<typeof createDb>) =>
  (db as unknown as { $client: { options: { max: number; idle_timeout: number; prepare: boolean } } }).$client.options;

describe('db pool size', () => {
  it('defaults to 10 connections, prepare:false, idle connections released after 20 s', () => {
    delete process.env.DB_POOL_MAX;
    const o = optionsOf(createDb('postgres://u:p@localhost:5432/x'));
    expect(o.max).toBe(10);
    expect(o.prepare).toBe(false);
    expect(o.idle_timeout).toBe(20);
  });

  it('honours DB_POOL_MAX', () => {
    process.env.DB_POOL_MAX = '3';
    expect(optionsOf(createDb('postgres://u:p@localhost:5432/x')).max).toBe(3);
  });

  it('ignores an invalid DB_POOL_MAX (falls back to 10)', () => {
    for (const v of ['0', '-2', 'abc', '2.5', '']) expect(dbPoolMax({ DB_POOL_MAX: v }), v).toBe(10);
    expect(dbPoolMax({})).toBe(10);
  });
});
