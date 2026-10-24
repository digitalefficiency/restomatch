/**
 * Demo-data coherence check: the invariants the client demo relies on, asserted
 * on a seeded database. `reseed:demo` runs it last (so the owner sees it pass on
 * production); run it alone after any local seed:
 *
 *   DATABASE_URL=... DEMO_TODAY=2026-10-25 pnpm --filter @restomatch/worker exec tsx scripts/check-demo.ts
 *
 * Read-only. Exit 1 with the list of broken invariants.
 */
import { computeLeakHero } from '@restomatch/charts';
import { createDb, DEMO_MAIN_BUSINESS_ID, findDemoTenants } from '@restomatch/db';
import postgres from 'postgres';

export interface DemoCheck {
  ok: boolean;
  problems: string[];
  facts: string[];
}

export async function checkDemo(url: string, today: string): Promise<DemoCheck> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  const problems: string[] = [];
  const facts: string[] = [];
  try {
    const t = await findDemoTenants(sql);
    const main = t.restaurants.find((r) => r.businessId === DEMO_MAIN_BUSINESS_ID);
    if (!main) return { ok: false, problems: ['no demo restaurant — seed first'], facts };
    const rids = t.restaurants.map((r) => r.id);
    if (rids.length !== 3) problems.push(`expected 3 demo restaurants (main + Haifa + Jerusalem), found ${rids.length}`);

    // 1. The hero: the North Star band.
    const h = await computeLeakHero(createDb(url), main.id);
    facts.push(`hero: ₪${Math.round(h.leakIls)} of ₪${Math.round(h.spendIls)} (${(h.leakPct * 100).toFixed(1)}%)`);
    if (!(h.leakPct >= 0.015 && h.leakPct <= 0.03)) problems.push(`hero leak ${(h.leakPct * 100).toFixed(2)}% is outside the 1.5–3% demo band`);

    // 2. Today's deliveries on Receiving (Israel wall clock), untouched by any receipt.
    const todays = (await sql`
      select s.name, s.name_en, po.status, po.total_estimated,
        (select count(*)::int from po_lines l where l.po_id = po.id) as lines,
        (select count(*)::int from po_lines l where l.po_id = po.id and coalesce(l.raw_description_en, '') = '') as lines_no_en,
        (select count(*)::int from goods_receipts g where g.po_id = po.id) as grs
      from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.restaurant_id = ${main.id} and (po.expected_delivery_at at time zone 'Asia/Jerusalem')::date = ${today}::date
      order by po.expected_delivery_at
    `) as unknown as Array<{ name: string; name_en: string | null; status: string; total_estimated: string | null; lines: number; lines_no_en: number; grs: number }>;
    facts.push(`today ${today}: ${todays.map((p) => `${p.name_en ?? p.name} (${p.lines} lines, ${p.status})`).join(', ') || 'no POs'}`);
    if (todays.length < 3) problems.push(`expected ≥3 POs due ${today} on Receiving, found ${todays.length}`);
    const hasharon = todays.find((p) => p.name_en === 'HaSharon Produce');
    if (!hasharon) problems.push(`no HaSharon Produce PO due ${today} for the live receiving demo`);
    else {
      if (hasharon.grs > 0) problems.push('the HaSharon Produce PO due today already has a goods receipt — it must be OPEN for the live demo');
      if (!['sent', 'draft', 'confirmed'].includes(hasharon.status)) problems.push(`the HaSharon Produce PO due today is "${hasharon.status}", not open`);
      if (hasharon.lines < 5) problems.push(`the HaSharon Produce PO due today has only ${hasharon.lines} lines`);
    }
    for (const p of todays) {
      if (p.lines_no_en > 0) problems.push(`${p.name}: ${p.lines_no_en} line(s) without an English name (the receiver works in English)`);
      if (p.grs > 0) problems.push(`${p.name}: today's PO already received`);
    }

    // 3. Every demo PO has a total (the orders tables show it).
    const [noTotal] = await sql`select count(*)::int as n from purchase_orders where restaurant_id in ${sql(rids)} and total_estimated is null`;
    if (noTotal!.n > 0) problems.push(`${noTotal!.n} demo PO(s) without total_estimated (orders table shows "—")`);

    // 4. Approvals queue: open, routed findings in the main restaurant.
    const [open] = await sql`
      select count(*)::int as n from discrepancies where restaurant_id = ${main.id} and resolution_status = 'open' and requires_role is not null`;
    facts.push(`approvals queue (main): ${open!.n} open`);
    if (open!.n < 1) problems.push('the approvals queue of the main restaurant is empty');

    // 5. The chain: each branch has matched invoices.
    for (const r of t.restaurants.filter((x) => x.id !== main.id)) {
      const [inv] = await sql`select count(*)::int as n from invoices where restaurant_id = ${r.id}`;
      facts.push(`${r.name}: ${inv!.n} invoices`);
      if (inv!.n < 1) problems.push(`branch ${r.name} has no invoices`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return { ok: problems.length === 0, problems, facts };
}

// CLI
if (process.argv[1]?.endsWith('check-demo.ts')) {
  const url = process.env.DATABASE_URL;
  const today = process.env.DEMO_TODAY?.trim();
  if (!url || !today) {
    console.error('[check-demo] DATABASE_URL and DEMO_TODAY=YYYY-MM-DD are required');
    process.exit(1);
  }
  checkDemo(url, today).then(
    (r) => {
      for (const f of r.facts) console.log(`[check-demo]   ${f}`);
      if (r.ok) console.log('[check-demo] ✔ demo data coherent');
      else for (const p of r.problems) console.error(`[check-demo] ✘ ${p}`);
      process.exit(r.ok ? 0 : 1);
    },
    (e: unknown) => {
      console.error(`[check-demo] ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
