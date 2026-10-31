/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  RestoMatch — pilot tenant provisioning (v2: dry-run by default)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Creates (or tops up) ONE real, empty restaurant tenant in the shared
 * production database, next to the demo tenant, from a JSON config. Usage and
 * the owner's runbook: docs/PILOT-SETUP.md.
 *
 *   # 1. dry-run (the default): runs the whole plan in ONE transaction, prints it,
 *   #    then ROLLS BACK. Last line: PLAN-HASH=<sha256>.
 *   PILOT_CONFIG=~/restomatch-pilot/tziki.json DATABASE_URL=… \
 *     pnpm --filter @restomatch/db pilot:setup -- --expect-project <ref>
 *
 *   # 2. apply exactly the plan you reviewed (same config, same database):
 *   … pilot:setup -- --expect-project <ref> --apply --plan-hash <hash> --confirm <business id>
 *
 * Keep real configs OUT of the repo (e.g. ~/restomatch-pilot/). Inside it,
 * packages/db/scripts/pilot.local.json and *.pilot.json are gitignored.
 *
 * Guards (all before any write; any failure exits non-zero):
 *   • PILOT_CONFIG is required (no built-in example tenant).
 *   • --expect-project <ref>: a local DB needs `local`; a remote DB needs the exact
 *     host in SEED_ALLOW_REMOTE_HOST AND its Supabase ref (pooler user
 *     postgres.<ref> or host db.<ref>.supabase.co) equal to <ref>. The third
 *     identifier is --confirm <business id> on --apply.
 *   • Never the demo tenant: not its business id or names, not an existing demo
 *     restaurant, and no member email at the demo domain or a .test TLD.
 *   • A business id already used by a restaurant with another name needs
 *     --update-existing.
 *   • features must be an explicit map of known keys; "all" is refused.
 *   • --with-pos on --apply also needs --allow-pos.
 *
 * Idempotent: restaurant by business id; users by email; memberships by
 * (user, restaurant, role); suppliers by (restaurant, business id) then by
 * normalised name; products by normalised name. Settings are MERGED (never
 * replaced): defaults are written only where absent and features are merged key
 * by key. It never deletes anything.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { DEMO_BRANCH_NAMES, DEMO_EMAIL_DOMAIN, DEMO_MAIN_BUSINESS_ID, DEMO_MAIN_NAME, findDemoTenants } from '../src/demoTenants';
import { PLAN_SEED } from '../src/plans';
import { isLocalDbUrl, seedTargetProblem, supabaseProjectRef } from '../src/seedGuard';

/* ──────────────────────────────────────────────────────────────────────────
 * Config
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Mirror of FEATURE_KEYS in packages/api/src/lib/features.ts (@restomatch/db
 * cannot depend on @restomatch/api). scripts/__tests__/pilot-setup.test.ts
 * fails when the two lists drift.
 */
export const PILOT_FEATURE_KEYS = [
  'chain',
  'dashViews',
  'priceDisparity',
  'chainAlerts',
  'contracts',
  'priceAlerts',
  'recovery',
  'monthlyReport',
  'ingestWhatsapp',
  'ingestEmail',
  'receiverPwa',
  'receiverLanguages',
  'aiAssistant',
  'leakCheck',
  'recipes',
  'integrations',
  'payRun',
  'dockSlip',
  'consolidatedMatch',
  'monthlyDigestPreview',
  'growth',
  'dishPriceAlert',
  'orderPricesOut',
  'supplierConfirm',
  'dockPriceContext',
  'orderCapture',
  'leakProof',
  'vatAtRisk',
  'supplierLeakCard',
  'supplierLedger',
  'inventoryCount',
] as const;
export type PilotFeatureKey = (typeof PILOT_FEATURE_KEYS)[number];

export const PILOT_ROLES = ['owner', 'manager', 'receiver', 'chef', 'bookkeeper'] as const;
export type PilotRole = (typeof PILOT_ROLES)[number];
export const PILOT_LOCALES = ['he', 'en', 'ar', 'ru', 'ti', 'th'] as const;
export type PilotLocale = (typeof PILOT_LOCALES)[number];

export interface PilotMember {
  email: string;
  name?: string;
  role: PilotRole;
  phone?: string;
  locale?: PilotLocale;
}

/** suppliers.order_schedule — same shape the suppliers router accepts (@restomatch/types OrderSchedule). */
export interface PilotOrderSchedule {
  windows: Array<{
    orderDays: number[];
    cutoff: string;
    fulfillment: { kind: 'lead_days'; leadDays: number } | { kind: 'next_named_day'; deliversOnDay: number };
  }>;
  tz?: string;
}

export interface PilotSupplier {
  name: string;
  nameEn?: string;
  businessId?: string;
  /** 0 (e.g. fresh produce) or 0.18. Required: a wrong rate shows up as fake VAT leak. */
  vatRate: number;
  contactEmail?: string;
  contactWhatsapp?: string;
  /** Info only (no column): the person to talk to. */
  contactName?: string;
  paymentTerms?: string;
  orderSchedule?: PilotOrderSchedule;
  deliverySchedule?: Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', string[]>>;
  /** Info only (no column yet): the supplier bills a monthly חשבונית מרכזת. */
  consolidatedInvoice?: boolean;
}

export interface PilotProduct {
  name: string;
  nameEn?: string;
  category?: string;
  unit?: string;
  barcodeEan?: string;
  /** Name of a supplier in this config: sets products.supplier_id. */
  supplier?: string;
}

export interface PilotPurchaseOrder {
  supplier: string;
  expectedDeliveryAt?: string;
  status?: 'draft' | 'sent' | 'confirmed';
  notes?: string;
  lines: Array<{ product: string; qty: number; unit?: string; unitPrice?: number }>;
}

export interface PilotConfig {
  restaurant: {
    name: string;
    businessId: string;
    vatRate: number;
    timezone?: string;
    /** Info only (no column). */
    address?: string;
    /** Extra settings merged into restaurants.settings (never "features" — use the top-level map). */
    settings?: Record<string, unknown>;
  };
  /** Explicit flag map, e.g. { "contracts": true }. "all" is refused. */
  features: Partial<Record<PilotFeatureKey, boolean>>;
  members: PilotMember[];
  suppliers: PilotSupplier[];
  products?: PilotProduct[];
  /** Only with --with-pos (and --allow-pos on --apply). */
  purchaseOrders?: PilotPurchaseOrder[];
}

export class PilotError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

/** Israeli ID / company number check digit (ת.ז / ח.פ). */
export function validIsraeliId(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

export const normaliseName = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isWeekday = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6;

function orderScheduleProblems(where: string, s: unknown): string[] {
  const out: string[] = [];
  if (!isObj(s) || !Array.isArray(s.windows) || s.windows.length < 1 || s.windows.length > 14) {
    return [`${where}: orderSchedule.windows must be 1–14 windows`];
  }
  if (s.tz !== undefined && (typeof s.tz !== 'string' || !s.tz || s.tz.length > 64)) out.push(`${where}: orderSchedule.tz must be an IANA zone`);
  s.windows.forEach((w, i) => {
    const at = `${where}: orderSchedule.windows[${i}]`;
    if (!isObj(w)) return out.push(`${at} must be an object`);
    if (!Array.isArray(w.orderDays) || w.orderDays.length < 1 || w.orderDays.length > 7 || !w.orderDays.every(isWeekday)) {
      out.push(`${at}.orderDays must be 1–7 weekdays (0 = Sunday … 6 = Saturday)`);
    }
    if (typeof w.cutoff !== 'string' || !HHMM.test(w.cutoff)) out.push(`${at}.cutoff must be HH:MM`);
    const f = w.fulfillment;
    const ok =
      isObj(f) &&
      ((f.kind === 'lead_days' && Number.isInteger(f.leadDays) && (f.leadDays as number) >= 0 && (f.leadDays as number) <= 30) ||
        (f.kind === 'next_named_day' && isWeekday(f.deliversOnDay)));
    if (!ok) out.push(`${at}.fulfillment must be {kind:'lead_days',leadDays:0–30} or {kind:'next_named_day',deliversOnDay:0–6}`);
    return undefined;
  });
  return out;
}

/** Validates the shape and values of a config. Throws PilotError listing every problem. */
export function validateConfig(raw: unknown): PilotConfig {
  const p: string[] = [];
  if (!isObj(raw)) throw new PilotError(['config must be a JSON object']);
  const r = raw.restaurant;
  if (!isObj(r)) p.push('restaurant is required');
  else {
    if (typeof r.name !== 'string' || r.name.trim().length < 2) p.push('restaurant.name is required');
    if (typeof r.businessId !== 'string' || !validIsraeliId(r.businessId)) p.push('restaurant.businessId must be a valid 9-digit ח.פ (check digit)');
    if (r.vatRate !== 0.18) p.push('restaurant.vatRate must be 0.18');
    if (r.settings !== undefined && (!isObj(r.settings) || 'features' in r.settings)) {
      p.push('restaurant.settings must be an object without "features" (use the top-level features map)');
    }
  }
  if (!isObj(raw.features)) p.push('features is required: an explicit map such as { "contracts": true }');
  else {
    for (const [k, v] of Object.entries(raw.features)) {
      if (k === 'all') p.push('features.all is refused: list each flag the pilot gets');
      else if (!(PILOT_FEATURE_KEYS as readonly string[]).includes(k)) p.push(`features.${k} is not a known feature key`);
      else if (typeof v !== 'boolean') p.push(`features.${k} must be true or false`);
    }
  }
  if (!Array.isArray(raw.members) || raw.members.length === 0) p.push('members must list at least the owner');
  else {
    const seen = new Set<string>();
    raw.members.forEach((m, i) => {
      if (!isObj(m) || typeof m.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) return p.push(`members[${i}].email is invalid`);
      if (!(PILOT_ROLES as readonly string[]).includes(m.role as string)) p.push(`members[${i}] (${m.email}) role must be one of ${PILOT_ROLES.join('|')}`);
      if (m.locale !== undefined && !(PILOT_LOCALES as readonly string[]).includes(m.locale as string)) p.push(`members[${i}] (${m.email}) locale must be one of ${PILOT_LOCALES.join('|')}`);
      const key = `${m.email.toLowerCase()}|${m.role}`;
      if (seen.has(key)) p.push(`members[${i}] (${m.email}) is listed twice with role ${m.role}`);
      seen.add(key);
      return undefined;
    });
    if (!raw.members.some((m) => isObj(m) && m.role === 'owner')) p.push('members must include an owner');
  }
  const supplierNames = new Set<string>();
  if (!Array.isArray(raw.suppliers)) p.push('suppliers must be a list (it may be empty)');
  else {
    raw.suppliers.forEach((s, i) => {
      if (!isObj(s) || typeof s.name !== 'string' || !s.name.trim()) return p.push(`suppliers[${i}].name is required`);
      const at = `suppliers[${i}] (${s.name})`;
      if (supplierNames.has(normaliseName(s.name))) p.push(`${at} is listed twice`);
      supplierNames.add(normaliseName(s.name));
      if (s.vatRate !== 0 && s.vatRate !== 0.18) p.push(`${at}.vatRate must be 0 or 0.18`);
      if (s.businessId !== undefined && (typeof s.businessId !== 'string' || !validIsraeliId(s.businessId))) p.push(`${at}.businessId must be a valid 9-digit ח.פ / ע.מ`);
      if (s.contactEmail !== undefined && (typeof s.contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail))) p.push(`${at}.contactEmail is invalid`);
      if (s.orderSchedule !== undefined) p.push(...orderScheduleProblems(at, s.orderSchedule));
      return undefined;
    });
  }
  if (raw.products !== undefined && !Array.isArray(raw.products)) p.push('products must be a list');
  else
    (raw.products ?? []).forEach((pr: unknown, i: number) => {
      if (!isObj(pr) || typeof pr.name !== 'string' || !pr.name.trim()) return p.push(`products[${i}].name is required`);
      if (pr.supplier !== undefined && (typeof pr.supplier !== 'string' || !supplierNames.has(normaliseName(pr.supplier)))) {
        p.push(`products[${i}] (${pr.name}).supplier "${String(pr.supplier)}" is not a supplier in this config`);
      }
      return undefined;
    });
  if (p.length) throw new PilotError(p);
  return raw as unknown as PilotConfig;
}

/** Demo-identity refusals that need no database. */
export function identityProblems(cfg: PilotConfig): string[] {
  const p: string[] = [];
  if (cfg.restaurant.businessId === DEMO_MAIN_BUSINESS_ID) p.push(`refusing: ${DEMO_MAIN_BUSINESS_ID} is the demo tenant's business id`);
  const name = normaliseName(cfg.restaurant.name);
  if ([DEMO_MAIN_NAME, ...DEMO_BRANCH_NAMES].some((n) => normaliseName(n) === name)) p.push(`refusing: "${cfg.restaurant.name}" is a demo tenant name`);
  for (const m of cfg.members) {
    const domain = m.email.toLowerCase().split('@')[1] ?? '';
    if (domain === DEMO_EMAIL_DOMAIN || domain.endsWith(`.${DEMO_EMAIL_DOMAIN}`)) p.push(`refusing: ${m.email} is a demo account`);
    else if (domain === 'test' || domain.endsWith('.test')) p.push(`refusing: ${m.email} is on a .test domain`);
  }
  return p;
}

/**
 * Target guard (3 identifiers, like reseed:demo): the host (local, or exactly
 * SEED_ALLOW_REMOTE_HOST), the project ref (--expect-project), and on --apply the
 * business id (--confirm). Returns a problem or null.
 */
export function targetProblem(url: string, expectProject: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!expectProject?.trim()) return '--expect-project <ref> is required (use "local" for a local database)';
  const want = expectProject.trim().toLowerCase();
  if (isLocalDbUrl(url)) return want === 'local' ? null : `--expect-project ${want} but DATABASE_URL is a local database (use "local")`;
  const hostProblem = seedTargetProblem(url, env);
  if (hostProblem) return hostProblem.replace('only for a disposable demo DB', 'for the database you mean to provision');
  const ref = supabaseProjectRef(url) ?? (() => {
    try {
      return new URL(url).hostname.toLowerCase().includes(want) ? want : null;
    } catch {
      return null;
    }
  })();
  if (ref !== want) return `--expect-project ${want} but DATABASE_URL points at project ${ref ?? '(unknown)'} — refusing`;
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Plan
 * ────────────────────────────────────────────────────────────────────────── */

export type PlanOp = 'create' | 'update' | 'skip';
export interface PlanRow {
  table: string;
  op: PlanOp;
  key: string;
  /** The values this row writes (no ids, no timestamps): part of the plan hash. */
  set?: Record<string, unknown>;
}

export const DEFAULT_TOLERANCES = { pricePercent: 0.02, priceAbsolute: 5, qtyPercent: 0.03, qtyAbsolute: 1 };
export const DEFAULT_BASELINE_WINDOW_DAYS = 90;

const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;

/** sha256 of the normalised plan (stable key order, no ids or timestamps). */
export function planHash(plan: PlanRow[]): string {
  return createHash('sha256').update(JSON.stringify(stable(plan))).digest('hex');
}

export interface PlanResult {
  plan: PlanRow[];
  restaurantId: string;
  warnings: string[];
}

export interface SetupOptions {
  updateExisting?: boolean;
  withPos?: boolean;
}

type Tx = postgres.TransactionSql;
const json = (tx: Tx, v: unknown) => tx.json(v as postgres.JSONValue);
const num = (v: number) => v.toString();

/**
 * Executes the whole provisioning inside `tx` and returns what it did. The caller
 * decides to COMMIT (apply) or ROLL BACK (dry-run). Throws PilotError on a refusal,
 * always before the first write.
 */
export async function provision(tx: Tx, cfg: PilotConfig, opts: SetupOptions = {}): Promise<PlanResult> {
  const plan: PlanRow[] = [];
  const warnings: string[] = [];
  const r = cfg.restaurant;

  // ── refusals that need the database (before any write) ──
  const demo = await findDemoTenants(tx as unknown as postgres.Sql);
  const demoIds = new Set(demo.restaurants.map((x) => x.id));
  const [existing] = (await tx`
    select id, name, business_id, vat_rate::text as vat_rate, timezone, settings
    from restaurants where business_id = ${r.businessId} order by created_at limit 1
  `) as unknown as Array<{ id: string; name: string; vat_rate: string; timezone: string; settings: Record<string, unknown> }>;
  const problems: string[] = [];
  if (existing && demoIds.has(existing.id)) problems.push(`refusing: business id ${r.businessId} belongs to a demo tenant`);
  if (existing && normaliseName(existing.name) !== normaliseName(r.name) && !opts.updateExisting) {
    problems.push(`refusing: business id ${r.businessId} already exists as "${existing.name}" — pass --update-existing to rename it to "${r.name}"`);
  }
  if (demo.userIds.length) {
    const demoMembers = (await tx`select lower(email) as email from users where id in ${tx(demo.userIds)}`) as unknown as Array<{ email: string }>;
    const demoEmails = new Set(demoMembers.map((u) => u.email));
    for (const m of cfg.members) if (demoEmails.has(m.email.toLowerCase())) problems.push(`refusing: ${m.email} is a member of the demo tenant`);
  }
  if (problems.length) throw new PilotError(problems);

  // ── restaurant (settings MERGED: defaults only where absent, features key by key) ──
  const restaurantId = existing?.id ?? randomUUID();
  await tx`select set_config('app.current_restaurant_id', ${restaurantId}, true)`;
  const patch = r.settings ?? {};
  const features = cfg.features;
  const tz = r.timezone ?? 'Asia/Jerusalem';
  const merged = (col: postgres.PendingQuery<postgres.Row[]> | null) => tx`
    jsonb_set(
      ${col ?? tx`'{}'::jsonb`}
        || jsonb_strip_nulls(jsonb_build_object(
             'tolerances', case when ${col ?? tx`'{}'::jsonb`} ? 'tolerances' then null else ${tx.json(DEFAULT_TOLERANCES)}::jsonb end,
             'baselineWindowDays', case when ${col ?? tx`'{}'::jsonb`} ? 'baselineWindowDays' then null else ${DEFAULT_BASELINE_WINDOW_DAYS}::int end))
        || ${json(tx, patch)}::jsonb,
      '{features}',
      coalesce(${col ?? tx`'{}'::jsonb`} -> 'features', '{}'::jsonb) || ${json(tx, features)}::jsonb)`;
  const restaurantSet = { name: r.name, vatRate: num(r.vatRate), timezone: tz, features, settingsPatch: patch };
  if (!existing) {
    await tx`
      insert into restaurants (id, name, business_id, vat_rate, timezone, settings)
      values (${restaurantId}, ${r.name}, ${r.businessId}, ${num(r.vatRate)}, ${tz}, ${merged(null)})`;
    plan.push({ table: 'restaurants', op: 'create', key: r.businessId, set: restaurantSet });
  } else {
    const col = tx`coalesce(settings, '{}'::jsonb)`;
    const upd = await tx`
      update restaurants set name = ${r.name}, vat_rate = ${num(r.vatRate)}, timezone = ${tz}, settings = ${merged(col)}, updated_at = now()
      where id = ${restaurantId} and (
        name is distinct from ${r.name} or vat_rate is distinct from ${num(r.vatRate)}::numeric
        or timezone is distinct from ${tz} or settings is distinct from ${merged(col)})
      returning id`;
    plan.push({ table: 'restaurants', op: upd.length ? 'update' : 'skip', key: r.businessId, set: upd.length ? restaurantSet : undefined });
  }

  // ── storage namespace (exactly as onboarding.createRestaurant) ──
  const ns = await tx`
    insert into storage_namespaces (restaurant_id, bucket, prefix)
    values (${restaurantId}, 'invoice-scans', ${`${restaurantId}/`})
    on conflict (restaurant_id, bucket) do nothing returning id`;
  plan.push({ table: 'storage_namespaces', op: ns.length ? 'create' : 'skip', key: 'invoice-scans' });

  // ── members (users without a password; memberships by user+restaurant+role) ──
  for (const m of cfg.members) {
    const email = m.email.trim().toLowerCase();
    const [user] = (await tx`select id, name, phone from users where lower(email) = ${email} limit 1`) as unknown as Array<{ id: string; name: string | null; phone: string | null }>;
    let userId = user?.id;
    if (!user) {
      const [u] = (await tx`insert into users (email, name, phone) values (${email}, ${m.name ?? null}, ${m.phone ?? null}) returning id`) as unknown as Array<{ id: string }>;
      userId = u!.id;
      plan.push({ table: 'users', op: 'create', key: email, set: { name: m.name ?? null, phone: m.phone ?? null } });
    } else {
      const fill = (!user.name && m.name) || (!user.phone && m.phone);
      if (fill) await tx`update users set name = coalesce(name, ${m.name ?? null}), phone = coalesce(phone, ${m.phone ?? null}), updated_at = now() where id = ${user.id}`;
      plan.push({ table: 'users', op: fill ? 'update' : 'skip', key: email });
    }
    const link = await tx`
      insert into memberships (user_id, restaurant_id, role, preferred_locale)
      values (${userId!}, ${restaurantId}, ${m.role}, ${m.locale ?? null})
      on conflict (user_id, restaurant_id, role) do nothing returning user_id`;
    let op: PlanOp = link.length ? 'create' : 'skip';
    if (!link.length && m.locale) {
      const loc = await tx`
        update memberships set preferred_locale = ${m.locale}
        where user_id = ${userId!} and restaurant_id = ${restaurantId} and role = ${m.role} and preferred_locale is distinct from ${m.locale}
        returning user_id`;
      if (loc.length) op = 'update';
    }
    plan.push({ table: 'memberships', op, key: `${email} · ${m.role}`, set: op === 'skip' ? undefined : { locale: m.locale ?? null } });
  }

  // ── suppliers (by restaurant+business id, then normalised name) ──
  const supplierIds = new Map<string, string>();
  for (const s of cfg.suppliers) {
    const values = {
      name: s.name.trim(),
      name_en: s.nameEn ?? null,
      business_id: s.businessId ?? null,
      contact_email: s.contactEmail ?? null,
      contact_whatsapp: s.contactWhatsapp ?? null,
      payment_terms: s.paymentTerms ?? null,
      vat_rate: num(s.vatRate),
      order_schedule: s.orderSchedule ?? null,
      delivery_schedule: s.deliverySchedule ?? null,
    };
    const byBid = s.businessId
      ? ((await tx`select * from suppliers where restaurant_id = ${restaurantId} and business_id = ${s.businessId} order by created_at limit 1`) as unknown as Array<Record<string, unknown>>)
      : [];
    const found =
      byBid[0] ??
      ((await tx`
        select * from suppliers where restaurant_id = ${restaurantId}
          and lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ${normaliseName(s.name)}
        order by created_at limit 1`) as unknown as Array<Record<string, unknown>>)[0];
    const set = { ...values, consolidatedInvoice: s.consolidatedInvoice ?? null };
    if (!found) {
      const [row] = (await tx`
        insert into suppliers (restaurant_id, name, name_en, business_id, contact_email, contact_whatsapp, payment_terms, vat_rate, order_schedule, delivery_schedule)
        values (${restaurantId}, ${values.name}, ${values.name_en}, ${values.business_id}, ${values.contact_email}, ${values.contact_whatsapp},
                ${values.payment_terms}, ${values.vat_rate}, ${values.order_schedule ? json(tx, values.order_schedule) : null},
                ${values.delivery_schedule ? json(tx, values.delivery_schedule) : null})
        returning id`) as unknown as Array<{ id: string }>;
      supplierIds.set(normaliseName(s.name), row!.id);
      plan.push({ table: 'suppliers', op: 'create', key: s.name, set });
      continue;
    }
    supplierIds.set(normaliseName(s.name), found.id as string);
    // Absent optional fields keep what is there; listed ones are written.
    const keep = <T>(v: T | null, col: string) => (v === null ? (found[col] as T | null) : v);
    const os = keep(values.order_schedule, 'order_schedule');
    const ds = keep(values.delivery_schedule, 'delivery_schedule');
    const upd = await tx`
      update suppliers set
        name = ${values.name}, name_en = ${keep(values.name_en, 'name_en')}, business_id = ${keep(values.business_id, 'business_id')},
        contact_email = ${keep(values.contact_email, 'contact_email')}, contact_whatsapp = ${keep(values.contact_whatsapp, 'contact_whatsapp')},
        payment_terms = ${keep(values.payment_terms, 'payment_terms')}, vat_rate = ${values.vat_rate},
        order_schedule = ${os ? json(tx, os) : null}, delivery_schedule = ${ds ? json(tx, ds) : null},
        active = true, updated_at = now()
      where id = ${found.id as string} and (
        name is distinct from ${values.name} or name_en is distinct from ${keep(values.name_en, 'name_en')}
        or business_id is distinct from ${keep(values.business_id, 'business_id')}
        or contact_email is distinct from ${keep(values.contact_email, 'contact_email')}
        or contact_whatsapp is distinct from ${keep(values.contact_whatsapp, 'contact_whatsapp')}
        or payment_terms is distinct from ${keep(values.payment_terms, 'payment_terms')}
        or vat_rate is distinct from ${values.vat_rate}::numeric
        or order_schedule is distinct from ${os ? json(tx, os) : null}::jsonb
        or delivery_schedule is distinct from ${ds ? json(tx, ds) : null}::jsonb
        or not active)
      returning id`;
    plan.push({ table: 'suppliers', op: upd.length ? 'update' : 'skip', key: s.name, set: upd.length ? set : undefined });
  }

  // ── products (by normalised name; optional supplier link) ──
  const productIds = new Map<string, { id: string; unit: string | null }>();
  for (const pr of cfg.products ?? []) {
    const supplierId = pr.supplier ? (supplierIds.get(normaliseName(pr.supplier)) ?? null) : null;
    const set = { name: pr.name.trim(), nameEn: pr.nameEn ?? null, category: pr.category ?? null, unit: pr.unit ?? null, barcodeEan: pr.barcodeEan ?? null, supplier: pr.supplier ?? null };
    const [found] = (await tx`
      select id, name_en, category, default_unit, barcode_ean, supplier_id from products
      where restaurant_id = ${restaurantId} and lower(regexp_replace(btrim(canonical_name), '\\s+', ' ', 'g')) = ${normaliseName(pr.name)}
      order by created_at limit 1`) as unknown as Array<Record<string, string | null>>;
    if (!found) {
      const [row] = (await tx`
        insert into products (restaurant_id, supplier_id, canonical_name, name_en, category, default_unit, barcode_ean)
        values (${restaurantId}, ${supplierId}, ${set.name}, ${set.nameEn}, ${set.category}, ${set.unit}, ${set.barcodeEan})
        returning id, default_unit`) as unknown as Array<{ id: string; default_unit: string | null }>;
      productIds.set(normaliseName(pr.name), { id: row!.id, unit: row!.default_unit });
      plan.push({ table: 'products', op: 'create', key: pr.name, set });
      continue;
    }
    const v = {
      name_en: set.nameEn ?? found.name_en ?? null,
      category: set.category ?? found.category ?? null,
      default_unit: set.unit ?? found.default_unit ?? null,
      barcode_ean: set.barcodeEan ?? found.barcode_ean ?? null,
      supplier_id: supplierId ?? found.supplier_id ?? null,
    };
    const upd = await tx`
      update products set name_en = ${v.name_en}, category = ${v.category}, default_unit = ${v.default_unit},
        barcode_ean = ${v.barcode_ean}, supplier_id = ${v.supplier_id}, updated_at = now()
      where id = ${found.id!} and (name_en is distinct from ${v.name_en} or category is distinct from ${v.category}
        or default_unit is distinct from ${v.default_unit} or barcode_ean is distinct from ${v.barcode_ean}
        or supplier_id is distinct from ${v.supplier_id}::uuid)
      returning id`;
    productIds.set(normaliseName(pr.name), { id: found.id!, unit: v.default_unit });
    plan.push({ table: 'products', op: upd.length ? 'update' : 'skip', key: pr.name, set: upd.length ? set : undefined });
  }

  // ── optional initial POs: once, only while the restaurant has none ──
  if (opts.withPos && cfg.purchaseOrders?.length) {
    const [c] = (await tx`select count(*)::int as n from purchase_orders where restaurant_id = ${restaurantId}`) as unknown as Array<{ n: number }>;
    if (c!.n > 0) {
      plan.push({ table: 'purchase_orders', op: 'skip', key: `restaurant already has ${c!.n} PO(s)` });
    } else {
      for (const po of cfg.purchaseOrders) {
        const supplierId = supplierIds.get(normaliseName(po.supplier));
        if (!supplierId) throw new PilotError([`purchaseOrders: unknown supplier "${po.supplier}"`]);
        const [row] = (await tx`
          insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
          values (${restaurantId}, ${supplierId}, ${po.expectedDeliveryAt ? new Date(po.expectedDeliveryAt) : null}, ${po.status ?? 'sent'}, 'manual', ${po.notes ?? null})
          returning id`) as unknown as Array<{ id: string }>;
        for (const l of po.lines) {
          const prod = productIds.get(normaliseName(l.product));
          if (!prod) throw new PilotError([`purchaseOrders (${po.supplier}): unknown product "${l.product}"`]);
          await tx`
            insert into po_lines (po_id, product_id, qty_ordered, unit, unit_price_expected, raw_description)
            values (${row!.id}, ${prod.id}, ${l.qty.toString()}, ${l.unit ?? prod.unit ?? 'יח׳'}, ${l.unitPrice != null ? l.unitPrice.toFixed(4) : null}, ${l.product})`;
        }
        plan.push({ table: 'purchase_orders', op: 'create', key: po.supplier, set: { lines: po.lines, status: po.status ?? 'sent' } });
      }
    }
  }

  // ── seats ──
  const [sub] = (await tx`
    select p.key from restaurants r
    join subscriptions s on s.billing_account_id = r.billing_account_id
    join plans p on p.id = s.plan_id
    where r.id = ${restaurantId} order by s.created_at desc limit 1`) as unknown as Array<{ key: keyof typeof PLAN_SEED }>;
  const planKey = sub?.key ?? 'trial';
  const seats = (PLAN_SEED[planKey] ?? PLAN_SEED.trial).limits.seatsPerRestaurant;
  const [mc] = (await tx`select count(distinct user_id)::int as n from memberships where restaurant_id = ${restaurantId}`) as unknown as Array<{ n: number }>;
  if (seats != null && mc!.n > seats) {
    warnings.push(`${mc!.n} members but the ${sub ? planKey : 'implicit trial'} plan has ${seats} seats — invites past the limit are blocked in the app`);
  }
  return { plan, restaurantId, warnings };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Run (dry-run / apply)
 * ────────────────────────────────────────────────────────────────────────── */

export interface RunOptions extends SetupOptions {
  url: string;
  cfg: PilotConfig;
  expectProject?: string;
  apply?: boolean;
  planHash?: string;
  confirm?: string;
  allowPos?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult extends PlanResult {
  hash: string;
  applied: boolean;
}

class Rollback extends Error {}

/** Guards, then the plan in one transaction: rolled back (dry-run) or committed (apply). */
export async function runPilotSetup(o: RunOptions): Promise<RunResult> {
  const problems = [...identityProblems(o.cfg)];
  const target = targetProblem(o.url, o.expectProject, o.env);
  if (target) problems.push(target);
  if (o.apply) {
    if (!o.planHash) problems.push('--apply needs --plan-hash <hash> from the dry-run you reviewed');
    if (o.confirm !== o.cfg.restaurant.businessId) problems.push(`--confirm must equal the config's business id (${o.cfg.restaurant.businessId})`);
    if (o.withPos && !o.allowPos) problems.push('--with-pos on --apply also needs --allow-pos');
  }
  if (problems.length) throw new PilotError(problems);

  const sql = postgres(o.url, { max: 1, prepare: false, onnotice: () => undefined });
  let result: PlanResult | undefined;
  let hash = '';
  try {
    await sql.begin(async (tx) => {
      result = await provision(tx, o.cfg, o);
      hash = planHash(result.plan);
      if (!o.apply) throw new Rollback();
      if (hash !== o.planHash) {
        throw new PilotError([`plan hash mismatch: the database or the config changed since the dry-run (now ${hash}) — dry-run again and review`]);
      }
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end({ timeout: 5 });
  }
  return { ...result!, hash, applied: !!o.apply };
}

export function formatPlan(plan: PlanRow[]): string {
  const lines = plan.map((r) => `  ${r.op.padEnd(6)} ${r.table.padEnd(19)} ${r.key}`);
  const counts = new Map<string, number>();
  for (const r of plan) counts.set(`${r.table}:${r.op}`, (counts.get(`${r.table}:${r.op}`) ?? 0) + 1);
  const summary = [...counts].map(([k, n]) => `${k}=${n}`).join(' ');
  return [...lines, `  totals: ${summary}`].join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────
 * CLI
 * ────────────────────────────────────────────────────────────────────────── */

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function loadConfigFile(path: string | undefined): PilotConfig {
  if (!path?.trim()) throw new PilotError(['PILOT_CONFIG is required: the path of the tenant config (see scripts/pilot.example.json)']);
  const abs = resolve(process.cwd(), path.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new PilotError([`cannot read PILOT_CONFIG ${abs}: ${e instanceof Error ? e.message : String(e)}`]);
  }
  return validateConfig(raw);
}

async function main(argv: string[]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new PilotError(['DATABASE_URL is required']);
  const cfg = loadConfigFile(process.env.PILOT_CONFIG);
  const apply = argv.includes('--apply');
  const res = await runPilotSetup({
    url,
    cfg,
    expectProject: arg(argv, 'expect-project'),
    apply,
    planHash: arg(argv, 'plan-hash'),
    confirm: arg(argv, 'confirm'),
    updateExisting: argv.includes('--update-existing'),
    withPos: argv.includes('--with-pos'),
    allowPos: argv.includes('--allow-pos'),
  });
  console.log(`[pilot] ${apply ? 'APPLY' : 'DRY-RUN (rolled back, nothing changed)'} · ${cfg.restaurant.name} (${cfg.restaurant.businessId})`);
  console.log(formatPlan(res.plan));
  for (const w of res.warnings) console.log(`[pilot] warning: ${w}`);
  if (apply) {
    console.log(`[pilot] ✔ committed. restaurant id: ${res.restaurantId}`);
    console.log('[pilot] next: each member sets a password via /login → שכחתי סיסמה (no password was created).');
    console.log(`[pilot] then verify: pnpm --filter @restomatch/db pilot:verify -- --restaurant ${res.restaurantId} --expect-project <ref>`);
  } else {
    console.log(`[pilot] review the plan, then: … --apply --plan-hash ${res.hash} --confirm ${cfg.restaurant.businessId}`);
  }
  console.log(`PLAN-HASH=${res.hash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      if (err instanceof PilotError) {
        for (const p of err.problems) console.error(`[pilot] ✘ ${p}`);
        process.exit(2);
      }
      console.error('[pilot] failed', err);
      process.exit(1);
    });
}
