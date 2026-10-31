/**
 * Pilot lab helper (scripts/pilot-lab.sh) — LOCAL DATABASES ONLY.
 *
 *   tsx lab.ts config <out.json>   QA config for an EMPTY tenant: packages/db/scripts/pilot.qa.example.json
 *                                  with the five roles (chef + bookkeeper added) and no suppliers /
 *                                  products — the journey adds those through the UI.
 *   tsx lab.ts passwords <cfg.json> sets PILOT_LAB_PASSWORD (argon2id) on every member of the config.
 *   tsx lab.ts facts <cfg.json> <out.json>
 *                                  writes what the journey needs and cannot click to: the QA restaurant
 *                                  id, a demo PO id (isolation check) and the demo supplier names.
 *
 * Every command refuses a DATABASE_URL whose host is not localhost / 127.0.0.1: the password
 * write must never reach Supabase. Production users set their own password (/login → שכחתי סיסמה).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '@restomatch/crypto';
import postgres from 'postgres';

export const LAB_ROLES = ['owner', 'manager', 'receiver', 'chef', 'bookkeeper'] as const;

interface Member {
  email: string;
  name: string;
  role: (typeof LAB_ROLES)[number];
  locale?: string;
}
interface QaConfig {
  restaurant: { name: string; businessId: string; vatRate: number; timezone: string };
  features: Record<string, boolean>;
  members: Member[];
  suppliers: unknown[];
  products: unknown[];
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function localDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('[pilot-lab] DATABASE_URL is required');
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`[pilot-lab] refusing non-local database host "${host}" — the lab never writes anywhere else`);
  }
  return url;
}

function readConfig(path: string): QaConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as QaConfig;
}

/** The QA example, reduced to an empty tenant with one login per role. */
export function labConfig(example: QaConfig): QaConfig {
  const members = [...example.members];
  const local = (role: string) => `qa-${role}@example.invalid`;
  for (const role of LAB_ROLES) {
    if (!members.some((m) => m.role === role)) members.push({ email: local(role), name: `QA ${role}`, role });
  }
  return { ...example, members, suppliers: [], products: [] };
}

async function main(argv: string[]): Promise<void> {
  const [cmd, a, b] = argv;
  if (cmd === 'config') {
    if (!a) throw new Error('usage: lab.ts config <out.json>');
    const example = readConfig(resolve(repo, 'packages/db/scripts/pilot.qa.example.json'));
    writeFileSync(a, `${JSON.stringify(labConfig(example), null, 2)}\n`);
    console.log(`[pilot-lab] config → ${a}`);
    return;
  }

  const url = localDbUrl();
  if (cmd === 'backdate') {
    // The order wizard refuses past delivery dates; the journey needs one late PO on the board.
    const days = Number(b ?? '1');
    if (!a || !Number.isInteger(days) || days < 1) throw new Error('usage: lab.ts backdate <poId> <days>');
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        update purchase_orders
           set expected_delivery_at = expected_delivery_at - make_interval(days => ${days})
         where id = ${a}
        returning id`;
      if (rows.length !== 1) throw new Error(`[pilot-lab] no purchase order ${a}`);
      console.log(`[pilot-lab] PO ${a} moved ${days} day(s) into the past`);
    } finally {
      await sql.end();
    }
    return;
  }
  if (!a) throw new Error(`usage: lab.ts ${cmd ?? '<cmd>'} <cfg.json> …`);
  const cfg = readConfig(a);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (cmd === 'passwords') {
      const password = process.env.PILOT_LAB_PASSWORD;
      if (!password) throw new Error('[pilot-lab] PILOT_LAB_PASSWORD is required');
      const hash = await hashPassword(password);
      for (const m of cfg.members) {
        const [user] = await sql<{ id: string }[]>`select id from users where lower(email) = lower(${m.email})`;
        if (!user) throw new Error(`[pilot-lab] ${m.email} was not provisioned`);
        await sql`
          insert into user_credentials (user_id, password_hash, password_updated_at)
          values (${user.id}, ${hash}, now())
          on conflict (user_id) do update set password_hash = excluded.password_hash, password_updated_at = now()`;
        await sql`update users set email_verified = coalesce(email_verified, now()) where id = ${user.id}`;
      }
      console.log(`[pilot-lab] lab password set for ${cfg.members.length} members`);
      return;
    }
    if (cmd === 'facts') {
      if (!b) throw new Error('usage: lab.ts facts <cfg.json> <out.json>');
      const [qa] = await sql<{ id: string }[]>`select id from restaurants where business_id = ${cfg.restaurant.businessId}`;
      if (!qa) throw new Error('[pilot-lab] the QA restaurant is missing — pilot-setup did not apply');
      const [demoPo] = await sql<{ id: string }[]>`
        select id from purchase_orders where restaurant_id <> ${qa.id} order by created_at desc limit 1`;
      const demoSuppliers = await sql<{ name: string }[]>`
        select distinct name from suppliers where restaurant_id <> ${qa.id} order by name`;
      const facts = {
        restaurantId: qa.id,
        restaurantName: cfg.restaurant.name,
        demoPoId: demoPo?.id ?? null,
        demoSupplierNames: demoSuppliers.map((s) => s.name),
        members: cfg.members.map(({ email, role, locale }) => ({ email, role, locale: locale ?? 'he' })),
      };
      writeFileSync(b, `${JSON.stringify(facts, null, 2)}\n`);
      console.log(`[pilot-lab] facts → ${b} (QA restaurant ${qa.id})`);
      return;
    }
    throw new Error(`[pilot-lab] unknown command "${cmd}"`);
  } finally {
    await sql.end();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
