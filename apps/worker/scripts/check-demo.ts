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

/**
 * The one deliberate discrepancy across the demo's consolidated invoices (seed-demo's
 * STANDING_OVERCHARGE): on one delivery note, 24 L of milk billed at ₪7.90 against
 * the PO's ₪6.40, i.e. ₪36.00 excl. VAT (₪42.48 at 18%). The consolidated
 * cross-match must reproduce exactly this.
 */
export const EXPECTED_CONSOLIDATED_OVERCHARGE_ILS = 36;

/** The one invoice above ₪5,000 without an allocation number: ₪6,240 + 18% VAT. */
export const EXPECTED_VAT_AT_RISK_ILS = 1123.2;

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

    // 1b. Month compares (last month vs the month before): both months fully seeded,
    //     comparable spend and a believable leak — a thin base reads as "+2,926%".
    const now = new Date(`${today}T12:00:00+03:00`);
    const prev = await computeLeakHero(createDb(url), main.id, { now, monthOffset: -1 });
    const prev2 = await computeLeakHero(createDb(url), main.id, { now, monthOffset: -2 });
    facts.push(`last month ₪${Math.round(prev.leakIls)} of ₪${Math.round(prev.spendIls)} (${(prev.leakPct * 100).toFixed(1)}%) · month before ₪${Math.round(prev2.leakIls)} of ₪${Math.round(prev2.spendIls)} (${(prev2.leakPct * 100).toFixed(1)}%)`);
    for (const [label, m] of [['last month', prev], ['the month before', prev2]] as const) {
      if (!(m.leakPct >= 0.01 && m.leakPct <= 0.03)) problems.push(`${label}: leak ${(m.leakPct * 100).toFixed(2)}% is outside 1–3%`);
    }
    if (!(prev2.spendIls > 0 && Math.abs(prev.spendIls / prev2.spendIls - 1) <= 0.25)) {
      problems.push(`last month's spend ₪${Math.round(prev.spendIls)} vs the month before ₪${Math.round(prev2.spendIls)} — not comparable (thin history?)`);
    }

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

    // 3b. Nothing is dated in the future: every created / sent / received / invoice
    //     timestamp is before the end of DEMO_TODAY on the Israel wall clock.
    const future = (await sql`
      with lim as (select ((${today}::date + 1)::timestamp at time zone 'Asia/Jerusalem') as t)
      select 'purchase_orders.created_at' as col, count(*)::int as n from purchase_orders, lim where restaurant_id in ${sql(rids)} and created_at >= lim.t
      union all select 'purchase_orders.sent_at', count(*)::int from purchase_orders, lim where restaurant_id in ${sql(rids)} and sent_at >= lim.t
      union all select 'invoices.created_at', count(*)::int from invoices, lim where restaurant_id in ${sql(rids)} and created_at >= lim.t
      union all select 'invoices.invoice_date', count(*)::int from invoices, lim where restaurant_id in ${sql(rids)} and invoice_date >= lim.t
      union all select 'goods_receipts.received_at', count(*)::int from goods_receipts, lim where restaurant_id in ${sql(rids)} and received_at >= lim.t
      union all select 'goods_receipts.created_at', count(*)::int from goods_receipts, lim where restaurant_id in ${sql(rids)} and created_at >= lim.t
      union all select 'discrepancies.created_at', count(*)::int from discrepancies, lim where restaurant_id in ${sql(rids)} and created_at >= lim.t
    `) as unknown as Array<{ col: string; n: number }>;
    for (const f of future) if (f.n > 0) problems.push(`${f.n} demo row(s) with ${f.col} after ${today} (future date on screen)`);

    // 3c. Fresh produce is VAT-exempt: produce suppliers are VAT 0 (so a real "פטור
    //     ממע״מ" invoice matches) and never carry a VAT_MISMATCH.
    const produce = (await sql`
      select s.name, s.name_en, s.vat_rate,
        (select count(*)::int from discrepancies d join match_runs m on m.id = d.match_run_id join invoices i on i.id = m.invoice_id
          where i.supplier_id = s.id and d.type = 'VAT_MISMATCH') as vat_findings
      from suppliers s where s.restaurant_id in ${sql(rids)} and s.name_en in ('HaSharon Produce', 'Carmel Greens')
    `) as unknown as Array<{ name: string; name_en: string; vat_rate: string | null; vat_findings: number }>;
    facts.push(`produce VAT: ${produce.map((p) => `${p.name_en} ${p.vat_rate == null ? 'unset' : `${Number(p.vat_rate) * 100}%`}`).join(', ') || 'no produce suppliers'} · VAT_MISMATCH on produce: ${produce.reduce((n, p) => n + p.vat_findings, 0)}`);
    for (const p of produce) {
      if (p.vat_rate == null || Number(p.vat_rate) !== 0) problems.push(`${p.name_en}: vat_rate ${p.vat_rate ?? 'unset (→ 18%)'} — fresh produce must be 0`);
      if (p.vat_findings > 0) problems.push(`${p.name_en}: ${p.vat_findings} VAT_MISMATCH finding(s) on a VAT-exempt produce supplier`);
    }

    // 3d. Consolidated invoices (חשבונית ריכוז / מרכזת): each lists delivery notes that
    //     are real goods receipts of the same supplier (`ת.מ. <n>` in goods_receipts.notes),
    //     none is matched (all stay pendingLink, so the hero never counts them), and the
    //     only overcharge across them is the one seed-demo plants.
    const cons = (await sql`
      select i.id, i.invoice_number, i.status, i.ocr_payload->'raw'->'deliveryNotes' as dns,
        (select count(*)::int from match_runs m where m.invoice_id = i.id) as runs,
        (select count(*)::int from jsonb_array_elements(i.ocr_payload->'raw'->'deliveryNotes') dn
          join goods_receipts g on g.restaurant_id = i.restaurant_id and g.notes = 'ת.מ. ' || (dn->>'number')
          join purchase_orders po on po.id = g.po_id and po.supplier_id = i.supplier_id) as covered,
        (select coalesce(sum(greatest(il.unit_price_billed - pl.unit_price_expected, 0) * il.qty_billed), 0)
          from invoice_lines il
          join goods_receipts g on g.restaurant_id = i.restaurant_id and g.notes = 'ת.מ. ' || substring(il.raw_description from '^ת\\.מ\\. (\\d+)')
          join purchase_orders po on po.id = g.po_id and po.supplier_id = i.supplier_id
          join po_lines pl on pl.po_id = po.id and pl.product_id = il.product_id
          where il.invoice_id = i.id) as overcharge
      from invoices i
      where i.restaurant_id in ${sql(rids)} and i.ocr_payload->'raw'->>'kind' = 'consolidated'
      order by i.invoice_date
    `) as unknown as Array<{ invoice_number: string; status: string; dns: Array<{ number: string }> | null; runs: number; covered: number; overcharge: string }>;
    facts.push(`consolidated: ${cons.map((c) => `${c.invoice_number} ${c.status} ${c.covered}/${c.dns?.length ?? 0} notes${Number(c.overcharge) > 0 ? ` · overcharge ₪${Number(c.overcharge).toFixed(2)}` : ''}`).join(', ') || 'none'}`);
    if (cons.length < 2) problems.push(`expected ≥2 consolidated invoices, found ${cons.length}`);
    for (const c of cons) {
      const listed = c.dns?.length ?? 0;
      if (listed === 0) problems.push(`${c.invoice_number}: lists no delivery notes`);
      if (c.covered !== listed) problems.push(`${c.invoice_number}: ${listed - c.covered} of ${listed} delivery notes are not goods receipts of its supplier`);
      if (c.runs > 0) problems.push(`${c.invoice_number}: consolidated invoice was matched (${c.runs} run(s)) — it must stay pending, outside the hero`);
    }
    const overcharge = Math.round(cons.reduce((a, c) => a + Number(c.overcharge), 0) * 100) / 100;
    if (overcharge !== EXPECTED_CONSOLIDATED_OVERCHARGE_ILS) {
      problems.push(`consolidated overcharge ₪${overcharge.toFixed(2)} ≠ the seeded ₪${EXPECTED_CONSOLIDATED_OVERCHARGE_ILS.toFixed(2)} (excl. VAT)`);
    }

    // 3e. VAT at risk: invoices above ₪5,000 excl. VAT without an allocation number in
    //     the last 6 months (the input-VAT deduction window). Exactly the one seeded
    //     case: the main restaurant's MF-24950, ₪1,123.20 VAT.
    const atRisk = (await sql`
      select i.invoice_number, i.vat_amount from invoices i
      where i.restaurant_id in ${sql(rids)} and i.total_excl_vat > 5000 and i.allocation_number is null
        and i.status <> 'ocr_pending'
        and i.invoice_date >= ((${today}::date - interval '6 months')::timestamp at time zone 'Asia/Jerusalem')
    `) as unknown as Array<{ invoice_number: string; vat_amount: string }>;
    const atRiskVat = Math.round(atRisk.reduce((a, r) => a + Number(r.vat_amount), 0) * 100) / 100;
    facts.push(`VAT at risk (no allocation number, > ₪5,000): ${atRisk.map((r) => r.invoice_number).join(', ') || 'none'} · ₪${atRiskVat.toFixed(2)}`);
    if (atRisk.length !== 1 || atRiskVat !== EXPECTED_VAT_AT_RISK_ILS) {
      problems.push(`VAT at risk: ${atRisk.length} invoice(s), ₪${atRiskVat.toFixed(2)} — expected exactly 1 (MF-24950), ₪${EXPECTED_VAT_AT_RISK_ILS.toFixed(2)}`);
    }

    // 4. Approvals queue: open, routed findings in the main restaurant.
    const [open] = await sql`
      select count(*)::int as n from discrepancies where restaurant_id = ${main.id} and resolution_status = 'open' and requires_role is not null`;
    facts.push(`approvals queue (main): ${open!.n} open`);
    if (open!.n < 1) problems.push('the approvals queue of the main restaurant is empty');

    // 5. The chain: each branch has matched invoices.
    for (const r of t.restaurants.filter((x) => x.id !== main.id)) {
      const [inv] = await sql`select count(*)::int as n from invoices where restaurant_id = ${r.id}`;
      const bh = await computeLeakHero(createDb(url), r.id, { now });
      facts.push(`${r.name}: ${inv!.n} invoices · leak ₪${Math.round(bh.leakIls)} of ₪${Math.round(bh.spendIls)} (${(bh.leakPct * 100).toFixed(1)}%)`);
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
