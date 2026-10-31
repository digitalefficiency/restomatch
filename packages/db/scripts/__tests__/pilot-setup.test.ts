import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FEATURE_KEYS } from '../../../api/src/lib/features';
import { OrderSchedule } from '../../../types/src/index';
import { DEMO_EMAIL_DOMAIN, DEMO_MAIN_BUSINESS_ID, DEMO_MAIN_NAME } from '../../src/demoTenants';
import { applyCoreTenantRls } from '../../src/rls';
import { testDbUrl } from '../../src/test-env';
import { configFromCsv, PILOT_FEATURES } from '../pilot-config';
import {
  loadConfigFile,
  PILOT_FEATURE_KEYS,
  PilotError,
  runPilotSetup,
  targetProblem,
  validateConfig,
  type PilotConfig,
} from '../pilot-setup';
import { runPilotVerify } from '../pilot-verify';

/**
 * pilot:setup creates a REAL tenant in the shared production DB next to the demo
 * tenant, so these pin: a dry-run changes nothing, apply creates exactly the
 * tenant, a re-run merges (never wipes) settings, and every refusal. Local DB only.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
const BID = '516222221';
const QA_BID = '516111119';
const DOMAIN = 'pilot-test.example.invalid';

function config(over: Partial<PilotConfig> = {}): PilotConfig {
  return validateConfig(
    JSON.parse(
      JSON.stringify({
        restaurant: { name: 'ביסטרו פיילוט בדיקה', businessId: BID, vatRate: 0.18 },
        features: { contracts: true, recovery: true, dockSlip: true },
        members: [
          { email: `owner@${DOMAIN}`, name: 'Owner', role: 'owner' },
          { email: `receiver@${DOMAIN}`, name: 'Receiver', role: 'receiver', locale: 'ar' },
        ],
        suppliers: [
          {
            name: 'ירקן בדיקה',
            businessId: '301000006',
            vatRate: 0,
            orderSchedule: { windows: [{ orderDays: [0, 2], cutoff: '14:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] },
          },
          { name: 'קצב בדיקה', vatRate: 0.18 },
        ],
        products: [{ name: 'עגבניה', unit: 'ק״ג', supplier: 'ירקן בדיקה' }],
        ...over,
      }),
    ),
  );
}

const dry = (cfg: PilotConfig, extra: Partial<Parameters<typeof runPilotSetup>[0]> = {}) =>
  runPilotSetup({ url, cfg, expectProject: 'local', ...extra });
const apply = async (cfg: PilotConfig, extra: Partial<Parameters<typeof runPilotSetup>[0]> = {}) => {
  const d = await dry(cfg, extra);
  return runPilotSetup({ url, cfg, expectProject: 'local', apply: true, planHash: d.hash, confirm: cfg.restaurant.businessId, ...extra });
};

async function clean() {
  await sql`delete from restaurants where business_id in ${sql([BID, QA_BID, DEMO_MAIN_BUSINESS_ID])} or name = ${DEMO_MAIN_NAME}`;
  await sql`delete from users where lower(email) like ${'%@' + DOMAIN} or lower(email) like ${'%@' + DEMO_EMAIL_DOMAIN} or lower(email) like '%@example.invalid'`;
}

async function rowCounts(): Promise<Record<string, number>> {
  const tables = (await sql`select tablename from pg_tables where schemaname = 'public' order by 1`) as unknown as Array<{ tablename: string }>;
  const out: Record<string, number> = {};
  for (const { tablename } of tables) out[tablename] = Number((await sql`select count(*)::int as n from ${sql(tablename)}`)[0]!.n);
  return out;
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PilotError);
    return (e as PilotError).problems.join('\n');
  }
  throw new Error('expected a refusal');
};

beforeAll(async () => {
  await applyCoreTenantRls(url);
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end();
});

describe('pilot:setup — dry-run and apply', () => {
  it('a dry-run leaves every table unchanged and prints a stable plan hash', async () => {
    const before = await rowCounts();
    const a = await dry(config());
    const b = await dry(config());
    expect(await rowCounts()).toEqual(before);
    expect(a.applied).toBe(false);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    expect(a.plan.filter((r) => r.op === 'create').map((r) => r.table)).toEqual([
      'restaurants', 'storage_namespaces', 'users', 'memberships', 'users', 'memberships', 'suppliers', 'suppliers', 'products',
    ]);
  });

  it('apply creates the restaurant, namespace, members, suppliers with vat_rate, product links and flags', async () => {
    const res = await apply(config());
    expect(res.applied).toBe(true);
    const [r] = await sql`select id, settings from restaurants where business_id = ${BID}`;
    expect(r!.id).toBe(res.restaurantId);
    expect(r!.settings.features).toEqual({ contracts: true, recovery: true, dockSlip: true });
    expect(r!.settings.tolerances).toEqual({ pricePercent: 0.02, priceAbsolute: 5, qtyPercent: 0.03, qtyAbsolute: 1 });
    expect(r!.settings.baselineWindowDays).toBe(90);
    expect((await sql`select prefix from storage_namespaces where restaurant_id = ${res.restaurantId}`)[0]!.prefix).toBe(`${res.restaurantId}/`);
    const members = await sql`select u.email, m.role, m.preferred_locale from memberships m join users u on u.id = m.user_id where m.restaurant_id = ${res.restaurantId} order by u.email`;
    expect(members.map((m) => [m.email, m.role, m.preferred_locale])).toEqual([
      [`owner@${DOMAIN}`, 'owner', null],
      [`receiver@${DOMAIN}`, 'receiver', 'ar'],
    ]);
    expect((await sql`select count(*)::int as n from user_credentials uc join users u on u.id = uc.user_id where u.email like ${'%@' + DOMAIN}`)[0]!.n).toBe(0);
    const sup = await sql`select name, vat_rate::text as vat, order_schedule from suppliers where restaurant_id = ${res.restaurantId} order by name`;
    expect(sup.map((s) => [s.name, Number(s.vat)])).toEqual([['ירקן בדיקה', 0], ['קצב בדיקה', 0.18]]);
    expect(sup.find((s) => s.name === 'ירקן בדיקה')!.order_schedule.windows[0].orderDays).toEqual([0, 2]);
    const [p] = await sql`select s.name from products p join suppliers s on s.id = p.supplier_id where p.restaurant_id = ${res.restaurantId}`;
    expect(p!.name).toBe('ירקן בדיקה');
  });

  it('a second identical run changes nothing (every row skips)', async () => {
    await apply(config());
    const again = await dry(config());
    expect(again.plan.every((r) => r.op === 'skip')).toBe(true);
  });

  it('a re-run with one changed flag keeps tolerances and the other flags (settings are merged, never replaced)', async () => {
    const first = await apply(config());
    // The owner tuned a tolerance and turned a flag on in the app since.
    await sql`update restaurants set settings = jsonb_set(jsonb_set(settings, '{tolerances,pricePercent}', '0.05'), '{features,payRun}', 'true') where id = ${first.restaurantId}`;
    const next = await apply(config({ features: { contracts: true, recovery: false, dockSlip: true } }));
    expect(next.plan.find((r) => r.table === 'restaurants')!.op).toBe('update');
    const [r] = await sql`select settings from restaurants where id = ${first.restaurantId}`;
    expect(r!.settings.tolerances.pricePercent).toBe(0.05);
    expect(r!.settings.features).toEqual({ contracts: true, recovery: false, dockSlip: true, payRun: true });
  });

  it('a supplier is matched by business id first, then by normalised name', async () => {
    const first = await apply(config());
    const renamed = config();
    renamed.suppliers[0]!.name = 'ירקן בדיקה בע״מ';
    renamed.suppliers[1]!.name = '  קצב   בדיקה ';
    renamed.products![0]!.supplier = 'ירקן בדיקה בע״מ';
    const res = await apply(renamed);
    expect(res.plan.filter((r) => r.table === 'suppliers').map((r) => r.op)).toEqual(['update', 'update']);
    expect((await sql`select count(*)::int as n from suppliers where restaurant_id = ${first.restaurantId}`)[0]!.n).toBe(2);
  });
});

describe('pilot:setup — refusals (all before any write)', () => {
  it('needs PILOT_CONFIG — there is no built-in example tenant', () => {
    expect(() => loadConfigFile(undefined)).toThrow(/PILOT_CONFIG is required/);
  });

  it('refuses the demo business id, demo names, demo and .test emails', async () => {
    // The demo id fails the check digit, so it never even validates as a config file:
    expect(() => config({ restaurant: { name: 'x y', businessId: DEMO_MAIN_BUSINESS_ID, vatRate: 0.18 } })).toThrow(/businessId/);
    const demoName = config();
    demoName.restaurant.name = DEMO_MAIN_NAME;
    expect(await refusal(dry(demoName))).toMatch(/demo tenant name/);
    const demoEmail = config();
    demoEmail.members.push({ email: `chef@${DEMO_EMAIL_DOMAIN}`, role: 'chef' });
    expect(await refusal(dry(demoEmail))).toMatch(/demo account/);
    const testTld = config();
    testTld.members.push({ email: 'x@restaurant.test', role: 'chef' });
    expect(await refusal(dry(testTld))).toMatch(/\.test domain/);
  });

  it('refuses a demo business id handed straight to the runner (bypassing the file validator)', async () => {
    const raw = config();
    raw.restaurant.businessId = DEMO_MAIN_BUSINESS_ID;
    expect(await refusal(dry(raw))).toMatch(/demo tenant's business id/);
  });

  it('refuses a wrong or missing --expect-project', async () => {
    expect(await refusal(dry(config(), { expectProject: 'rutbnmvkwirqtixvuhdq' }))).toMatch(/local database/);
    expect(await refusal(dry(config(), { expectProject: undefined }))).toMatch(/--expect-project <ref> is required/);
    const pooler = 'postgresql://postgres.abcdefghijabcdefghij:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';
    const env = { SEED_ALLOW_REMOTE_HOST: 'aws-0-ap-northeast-1.pooler.supabase.com' };
    expect(targetProblem(pooler, 'abcdefghijabcdefghij', env)).toBeNull();
    expect(targetProblem(pooler, 'zzzzzzzzzzzzzzzzzzzz', env)).toMatch(/points at project abcdefghijabcdefghij/);
    expect(targetProblem(pooler, 'abcdefghijabcdefghij', {})).toMatch(/not a local database/);
  });

  it('refuses features.all and unknown flags', () => {
    expect(() => config({ features: { all: true } as never })).toThrow(/features\.all is refused/);
    expect(() => config({ features: { nope: true } as never })).toThrow(/not a known feature key/);
  });

  it('refuses a plan-hash or confirm mismatch, and commits nothing', async () => {
    const before = await rowCounts();
    expect(await refusal(runPilotSetup({ url, cfg: config(), expectProject: 'local', apply: true, planHash: 'f'.repeat(64), confirm: BID })))
      .toMatch(/plan hash mismatch/);
    const d = await dry(config());
    expect(await refusal(runPilotSetup({ url, cfg: config(), expectProject: 'local', apply: true, planHash: d.hash, confirm: '000000000' })))
      .toMatch(/--confirm must equal/);
    expect(await rowCounts()).toEqual(before);
  });

  it('refuses a business id that exists under another name unless --update-existing', async () => {
    await apply(config());
    const other = config();
    other.restaurant.name = 'שם אחר לגמרי';
    expect(await refusal(dry(other))).toMatch(/already exists as/);
    const ok = await dry(other, { updateExisting: true });
    expect(ok.plan[0]).toMatchObject({ table: 'restaurants', op: 'update' });
  });

  it('refuses --with-pos on --apply without --allow-pos', async () => {
    expect(await refusal(runPilotSetup({ url, cfg: config(), expectProject: 'local', apply: true, planHash: 'x', confirm: BID, withPos: true })))
      .toMatch(/--allow-pos/);
  });
});

describe('pilot:verify', () => {
  it('is all PASS on a fresh tenant', async () => {
    const res = await apply(config());
    const checks = await runPilotVerify({ url, restaurantId: res.restaurantId, expectProject: 'local', expectFlags: ['contracts', 'recovery', 'dockSlip'] });
    const failed = checks.filter((c) => c.status === 'FAIL');
    expect(failed).toEqual([]);
    expect(checks.find((c) => c.name === 'suppliers.vat_rate')!.detail).toBe('ירקן בדיקה → 0%, קצב בדיקה → 18%');
  });

  it('FAILs when a user is a member of the demo AND a real tenant, and on a missing flag', async () => {
    const res = await apply(config());
    const [demo] = await sql`insert into restaurants (name, business_id) values (${DEMO_MAIN_NAME}, ${DEMO_MAIN_BUSINESS_ID}) returning id`;
    const [u] = await sql`select id from users where email = ${`owner@${DOMAIN}`}`;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${u!.id}, ${demo!.id}, 'manager')`;
    const checks = await runPilotVerify({ url, restaurantId: res.restaurantId, expectProject: 'local', expectFlags: ['contracts', 'payRun'] });
    expect(checks.find((c) => c.name === 'no_demo_cross_membership')).toMatchObject({ status: 'FAIL' });
    expect(checks.find((c) => c.name === 'settings.features')).toMatchObject({ status: 'FAIL', detail: 'missing: payRun' });
  });

  it('refuses without --expect-project or a restaurant uuid', async () => {
    expect(await refusal(runPilotVerify({ url, restaurantId: 'nope', expectProject: undefined }))).toMatch(/expect-project[\s\S]*--restaurant/);
  });
});

describe('pilot:config — intake CSVs → config', () => {
  const write = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-config-'));
    for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), `﻿${body}`);
    return dir;
  };
  const csv = {
    'restaurant.csv': 'שם,ח״פ,כתובת\nRestoMatch QA (פנימי),516111119,רחוב הבדיקה 1\n',
    'staff.csv': 'שם מלא,תפקיד,מייל,נייד,שפה,הערות\nQA Owner,בעלים,qa-owner@example.invalid,,he,x\nQA Receiver,מקבל סחורה,qa-receiver@example.invalid,0500000000,en,\n',
    'suppliers.csv':
      'שם הספק,ח״פ,איש קשר,נייד,מייל להזמנות,ימי הזמנה,שעת סגירה,ימי אספקה,מע״מ,חשבונית מרכזת\n' +
      'QA ירקות,301000022,,,,"א,ג,ה",14:00,"ב,ד,ו",0%,לא\n' +
      'QA חלב,,,,,"ב׳, ד׳",12:00,"ג,ה",18%,כן\n',
  };
  const handWritten = {
    restaurant: { name: 'RestoMatch QA (פנימי)', businessId: QA_BID, vatRate: 0.18, timezone: 'Asia/Jerusalem', address: 'רחוב הבדיקה 1' },
    features: Object.fromEntries(PILOT_FEATURES.map((f) => [f, true])),
    members: [
      { email: 'qa-owner@example.invalid', name: 'QA Owner', role: 'owner', locale: 'he' },
      { email: 'qa-receiver@example.invalid', name: 'QA Receiver', role: 'receiver', phone: '0500000000', locale: 'en' },
    ],
    suppliers: [
      {
        name: 'QA ירקות',
        businessId: '301000022',
        vatRate: 0,
        orderSchedule: {
          windows: [
            { orderDays: [0], cutoff: '14:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 1 } },
            { orderDays: [2], cutoff: '14:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 3 } },
            { orderDays: [4], cutoff: '14:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 5 } },
          ],
        },
        consolidatedInvoice: false,
      },
      {
        name: 'QA חלב',
        vatRate: 0.18,
        orderSchedule: {
          windows: [
            { orderDays: [1], cutoff: '12:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 2 } },
            { orderDays: [3], cutoff: '12:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 4 } },
          ],
        },
        consolidatedInvoice: true,
      },
    ],
    products: [],
  };

  it('turns the intake CSVs into the same config — and the same dry-run plan — as a hand-written one', async () => {
    const cfg = configFromCsv(write(csv));
    expect(cfg).toEqual(handWritten);
    const a = await dry(cfg);
    const b = await dry(validateConfig(JSON.parse(JSON.stringify(handWritten))));
    expect(a.hash).toBe(b.hash);
  });

  it('rejects an unknown role, VAT value or weekday, naming file, row and column', () => {
    const bad = (patch: Record<string, string>) => () => configFromCsv(write({ ...csv, ...patch }));
    expect(bad({ 'staff.csv': 'שם מלא,תפקיד,מייל\nX,מלצר,x@example.invalid\n' })).toThrow(/staff\.csv row 2, column "תפקיד": unknown role "מלצר"/);
    expect(bad({ 'suppliers.csv': csv['suppliers.csv'].replace('0%,לא', '17%,לא') })).toThrow(/suppliers\.csv row 2, column "מע״מ": unknown VAT "17%"/);
    expect(bad({ 'suppliers.csv': csv['suppliers.csv'].replace('"א,ג,ה"', '"א,ג,ז"') })).toThrow(/suppliers\.csv row 2, column "ימי הזמנה": unknown weekday/);
  });
});

describe('pilot:setup — lists that must not drift', () => {
  it('PILOT_FEATURE_KEYS matches FEATURE_KEYS in @restomatch/api', () => {
    expect([...PILOT_FEATURE_KEYS].sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it('the config validator accepts and rejects orderSchedule exactly like @restomatch/types', () => {
    const cases: unknown[] = [
      { windows: [{ orderDays: [0, 2], cutoff: '14:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] },
      { windows: [{ orderDays: [6], cutoff: '23:59', fulfillment: { kind: 'next_named_day', deliversOnDay: 0 } }], tz: 'Asia/Jerusalem' },
      { windows: [] },
      { windows: [{ orderDays: [7], cutoff: '14:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] },
      { windows: [{ orderDays: [1], cutoff: '24:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }] },
      { windows: [{ orderDays: [1], cutoff: '10:00', fulfillment: { kind: 'lead_days', leadDays: 31 } }] },
      { windows: [{ orderDays: [1], cutoff: '10:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 9 } }] },
    ];
    for (const s of cases) {
      const ours = (() => {
        try {
          config({ suppliers: [{ name: 's', vatRate: 0.18, orderSchedule: s as never }], products: [] });
          return true;
        } catch {
          return false;
        }
      })();
      expect(ours, JSON.stringify(s)).toBe(OrderSchedule.safeParse(s).success);
    }
  });
});

describe('pilot:setup — CLI', () => {
  it('dry-runs from a config file and ends with PLAN-HASH; refuses without PILOT_CONFIG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-'));
    const file = join(dir, 'tenant.pilot.json');
    writeFileSync(file, JSON.stringify(config()));
    const run = (env: Record<string, string>) =>
      spawnSync('pnpm', ['exec', 'tsx', 'scripts/pilot-setup.ts', '--expect-project', 'local'], {
        cwd: join(__dirname, '..', '..'),
        env: { ...process.env, DATABASE_URL: url, ...env },
        encoding: 'utf8',
      });
    const ok = run({ PILOT_CONFIG: file });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/DRY-RUN \(rolled back, nothing changed\)/);
    expect(ok.stdout.trim().split('\n').at(-1)).toMatch(/^PLAN-HASH=[0-9a-f]{64}$/);
    const none = run({ PILOT_CONFIG: '' });
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/PILOT_CONFIG is required/);
  });
});
