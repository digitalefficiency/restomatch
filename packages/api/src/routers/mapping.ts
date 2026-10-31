import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  eq,
  inArray,
  invoiceLines,
  invoices,
  isNull,
  poLines,
  productAliases,
  products,
  purchaseOrders,
  sql,
  suppliers,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import {
  MACHINE_MAX_CONFIDENCE,
  matchProductTopN,
  normNameSql,
  normalizeLinkName,
  recordConfirmedMatch,
} from '@restomatch/catalog';
import { signAnswerUndo, verifyAnswerUndo } from '../catalog/answerUndo';
import { enqueue, isQueueUnavailableError, MATCH_INVOICE_QUEUE, type MatchInvoiceQueueJob } from '@restomatch/queue';
import { chefProcedure, managerProcedure, memberProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';
import { readConsolidatedRaw } from '../match/consolidated';

/**
 * A re-match job waits this long before it may be claimed: the job row commits
 * on the queue's own connection at once, the backfill only when this request's
 * transaction does — a worker that claimed it sooner would match the old lines.
 */
const REMATCH_DELAY_MS = 3_000;

export interface RematchReport {
  /** Invoices sent to the match-invoice job (their leak figure is recomputed). */
  requeued: number;
  /** Skipped: a credit claim exists on one of its findings (₪-back tracker) — re-match by hand. */
  blockedByClaims: number;
  /** Skipped: a consolidated invoice (חשבונית ריכוז) is cross-matched to its delivery notes instead. */
  consolidated: number;
  /** Skipped: already approved or paid — a person signed it off. */
  settled: number;
  /** The queue database did not answer; the lines are linked, the re-check did not start. */
  failed: number;
}

/**
 * Re-match the invoices whose lines a link just changed (catalog-03): a line
 * that gains (or loses) its product changes MISSING / EXTRA / price findings,
 * so the leak and approvals must be recomputed — no engine change, the
 * existing match-invoice job does it. Restaurant-scoped; best effort (a queue
 * failure never fails the link).
 */
export async function requeueInvoicesForRematch(
  db: Database,
  restaurantId: string,
  invoiceIds: Iterable<string>,
): Promise<RematchReport> {
  const ids = [...new Set(invoiceIds)];
  const report: RematchReport = { requeued: 0, blockedByClaims: 0, consolidated: 0, settled: 0, failed: 0 };
  if (ids.length === 0) return report;
  const rows = await db
    .select({ id: invoices.id, status: invoices.status, ocrPayload: invoices.ocrPayload })
    .from(invoices)
    .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, ids)));
  const claimed = await db.execute(sql`
    SELECT DISTINCT mr.invoice_id AS id
    FROM recovery_claims c
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND mr.invoice_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  const claimedRows = (Array.isArray(claimed) ? claimed : (claimed as { rows?: unknown[] }).rows ?? []) as Array<{
    id: string;
  }>;
  const blocked = new Set(claimedRows.map((r) => String(r.id)));
  for (const inv of rows) {
    if (readConsolidatedRaw(inv.ocrPayload)) {
      report.consolidated += 1;
      continue;
    }
    if (inv.status === 'approved' || inv.status === 'paid') {
      report.settled += 1;
      continue;
    }
    if (blocked.has(inv.id)) {
      report.blockedByClaims += 1;
      continue;
    }
    const job: MatchInvoiceQueueJob = { restaurantId, invoiceId: inv.id, rematch: true };
    try {
      // Per job: each enqueue can take up to its own timeout, so a runAt fixed
      // before the loop could expire before this request commits.
      await enqueue(MATCH_INVOICE_QUEUE, job, { runAt: new Date(Date.now() + REMATCH_DELAY_MS) });
      report.requeued += 1;
    } catch (err) {
      report.failed += 1;
      console.error(
        `[mapping.confirm] failed to enqueue the re-match for invoice=${inv.id}` +
          (isQueueUnavailableError(err) ? ' (queue.unavailable)' : ''),
        err,
      );
    }
  }
  return report;
}

/** Exactly what a confirm changed, handed back so "בטל" can put it back. */
const RevertSchema = z
  .object({
    productId: z.string().uuid(),
    poLineIds: z.array(z.string().uuid()).max(5000),
    invoiceLineIds: z.array(z.string().uuid()).max(5000),
    catalogItemIds: z.array(z.string().uuid()).max(5000),
    /** G-08: an existing alias this link raised (e.g. a legacy 0.95 → 0.999): undo restores its confidence. */
    aliasRestore: z
      .object({ id: z.string().uuid(), confidence: z.string().regex(/^[01]\.\d{3}$/) })
      .nullable()
      .optional(),
    /** The alias this confirm created (null when it only refreshed an existing one). */
    aliasId: z.string().uuid().nullable(),
    /** The confirm created productId ("מוצר חדש"): undo removes it too when nothing else uses it. */
    createdProduct: z.boolean().optional(),
  })
  .strict();

/** A product the link policy suggests for a name-keyed question (no ₪, ever). */
export interface LinkSuggestion {
  productId: string;
  canonicalName: string;
  confidence: number;
}

export interface UnmappedSku {
  /** G-08: 'sku' = keyed by (supplier, מק״ט); 'name' = no SKU, keyed by (supplier, normalized name). */
  kind: 'sku' | 'name';
  supplierId: string;
  supplierName: string;
  /** The SKU for a 'sku' row; null for a 'name' row. */
  supplierSku: string | null;
  /** The normalized name for a 'name' row (normalizeLinkName); null for a 'sku' row. */
  nameKey: string | null;
  sampleDescription: string;
  /** How many po_lines + invoice_lines + unlinked price-list rows carry this key unmapped. */
  occurrences: number;
  /** G-08: the top 1–3 products the policy suggests for a 'name' row ("זה אותו מוצר?"). */
  suggestions: LinkSuggestion[];
}

/** Name-keyed questions are capped per read (suggestions cost two queries each). */
export const NAME_QUESTIONS_MAX = 50;


/**
 * Name-keyed open questions (G-08): unlinked invoice / order / price-list lines
 * with NO SKU, grouped by (supplier, normalized name). Every branch is
 * restaurant-scoped on its own table AND through the supplier join.
 */
async function nameKeyedRows(
  db: Database,
  rid: string,
  supplierFilter?: string,
): Promise<Array<{ supplierId: string; supplierName: string; nameKey: string; sample: string; occurrences: number }>> {
  const sup = supplierFilter ? sql`and s.id = ${supplierFilter}` : sql``;
  const rows = (await db.execute(sql`
    with lines as (
      select i.supplier_id, il.raw_description as raw
        from invoice_lines il
        join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
       where il.product_id is null and il.supplier_sku is null
      union all
      select po.supplier_id, pl.raw_description
        from po_lines pl
        join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
       where pl.product_id is null and pl.supplier_sku is null
      union all
      select sci.supplier_id, sci.supplier_name_raw
        from supplier_catalog_items sci
       where sci.restaurant_id = ${rid} and sci.product_id is null and sci.supplier_sku is null
    )
    select s.id as supplier_id, s.name as supplier_name, ${normNameSql(sql`l.raw`)} as name_key,
           min(btrim(l.raw)) as sample, count(*)::int as occurrences
      from lines l
      join suppliers s on s.id = l.supplier_id and s.restaurant_id = ${rid} ${sup}
     where coalesce(btrim(l.raw), '') <> ''
     group by s.id, s.name, name_key
     order by occurrences desc, sample
     limit ${NAME_QUESTIONS_MAX}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    supplierId: String(r.supplier_id),
    supplierName: String(r.supplier_name),
    nameKey: String(r.name_key),
    sample: String(r.sample),
    occurrences: Number(r.occurrences),
  }));
}

/** The top ≤3 products the link policy suggests for a (supplier, raw name). Names only, no ₪. */
async function suggestionsFor(db: Database, rid: string, supplierId: string, raw: string): Promise<LinkSuggestion[]> {
  const cands = await matchProductTopN(db, { restaurantId: rid, supplierId, rawDescription: raw }, 3);
  return cands.map((c) => ({ productId: c.productId, canonicalName: c.canonicalName, confidence: c.confidence }));
}

/**
 * The open name-keyed question for (supplier, normalized name) in this
 * restaurant, with its server-side sample spelling — or null when none is open.
 */
async function openQuestion(
  db: Database,
  rid: string,
  supplierId: string,
  nameKey: string,
): Promise<{ sample: string } | null> {
  const [r] = (await db.execute(sql`
    with lines as (
      select il.raw_description as raw from invoice_lines il
        join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid} and i.supplier_id = ${supplierId}
       where il.product_id is null and il.supplier_sku is null
      union all
      select pl.raw_description from po_lines pl
        join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid} and po.supplier_id = ${supplierId}
       where pl.product_id is null and pl.supplier_sku is null
      union all
      select sci.supplier_name_raw from supplier_catalog_items sci
       where sci.restaurant_id = ${rid} and sci.supplier_id = ${supplierId}
         and sci.product_id is null and sci.supplier_sku is null
    )
    select min(btrim(raw)) as sample from lines where ${normNameSql(sql`raw`)} = ${nameKey}
  `)) as unknown as Array<{ sample: string | null }>;
  return r?.sample ? { sample: r.sample } : null;
}

/**
 * Invoices whose latest match run is against the orders owning these PO lines
 * (rid-scoped): a PO line that gains or loses its product changes their MISSING
 * findings, so they are re-matched too (G-08, HIGH-3).
 */
async function invoicesForPoLines(db: Database, rid: string, poLineIds: string[]): Promise<string[]> {
  if (poLineIds.length === 0) return [];
  const rows = (await db.execute(sql`
    select distinct mr.invoice_id as id
      from match_runs mr
     where mr.restaurant_id = ${rid}
       and mr.po_id in (
         select pl.po_id from po_lines pl
           join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
          where pl.id in (${sql.join(poLineIds.map((id) => sql`${id}::uuid`), sql`, `)})
       )
       and mr.run_at = (select max(m2.run_at) from match_runs m2
                         where m2.invoice_id = mr.invoice_id and m2.restaurant_id = ${rid})
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

/**
 * G-08 (CRITICAL-1): OCR holds an invoice ('parsed') while any line has no
 * product, because the engine pairs only by product / SKU and would report a
 * false MISSING + UNORDERED pair. Once an answer links the LAST unlinked line of
 * an invoice held ONLY for that reason (raw.reviewReasons = ['unlinked'], not a
 * duplicate), release it to 'matched' so the re-match runs. Returns the ids.
 */
async function releaseLinkHolds(db: Database, rid: string, invoiceIds: string[]): Promise<string[]> {
  if (invoiceIds.length === 0) return [];
  const rows = (await db.execute(sql`
    update invoices i
       set status = 'matched',
           ocr_payload = jsonb_set(i.ocr_payload, '{linkReleasedAt}', to_jsonb(now()::text))
     where i.restaurant_id = ${rid}
       and i.id in (${sql.join([...new Set(invoiceIds)].map((id) => sql`${id}::uuid`), sql`, `)})
       and i.status = 'parsed'
       and i.ocr_payload -> 'raw' -> 'reviewReasons' = '["unlinked"]'::jsonb
       and (i.ocr_payload -> 'raw' -> 'duplicateOf') is null
       and not exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null)
       and not exists (select 1 from match_runs mr where mr.invoice_id = i.id and mr.restaurant_id = ${rid})
    returning i.id
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

/**
 * The undo of an answer that released an invoice: once a line is unlinked
 * again, put the invoice back on hold ('parsed') and drop the run made in the
 * meantime, instead of re-matching it into a false leak. A run a claim already
 * hangs on is left alone (the savepoint refuses). Returns the re-held ids.
 */
async function reholdLinkHolds(db: Database, rid: string, invoiceIds: string[]): Promise<string[]> {
  const held: string[] = [];
  for (const id of [...new Set(invoiceIds)]) {
    try {
      await db.transaction(async (sp) => {
        const t = sp as unknown as Database;
        const rows = (await t.execute(sql`
          update invoices i
             set status = 'parsed', ocr_payload = i.ocr_payload - 'linkReleasedAt'
           where i.restaurant_id = ${rid} and i.id = ${id}::uuid
             and i.status in ('matched', 'disputed')
             and i.ocr_payload ? 'linkReleasedAt'
             and exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.product_id is null)
          returning i.id
        `)) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await t.execute(sql`delete from match_runs where invoice_id = ${id}::uuid and restaurant_id = ${rid}`);
        held.push(id);
      });
    } catch {
      // A claim hangs on that run: leave it to the people.
    }
  }
  return held;
}

/** How many name-keyed questions are open (the home "זה אותו מוצר?" line). Restaurant-scoped. */
export async function countNameQuestions(db: Database, rid: string): Promise<number> {
  const [r] = (await db.execute(sql`
    with lines as (
      select i.supplier_id, il.raw_description as raw
        from invoice_lines il
        join invoices i on i.id = il.invoice_id and i.restaurant_id = ${rid}
       where il.product_id is null and il.supplier_sku is null
      union all
      select po.supplier_id, pl.raw_description
        from po_lines pl
        join purchase_orders po on po.id = pl.po_id and po.restaurant_id = ${rid}
       where pl.product_id is null and pl.supplier_sku is null
      union all
      select sci.supplier_id, sci.supplier_name_raw
        from supplier_catalog_items sci
       where sci.restaurant_id = ${rid} and sci.product_id is null and sci.supplier_sku is null
    )
    select count(distinct (l.supplier_id, ${normNameSql(sql`l.raw`)}))::int as n
      from lines l
      join suppliers s on s.id = l.supplier_id and s.restaurant_id = ${rid}
     where coalesce(btrim(l.raw), '') <> ''
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}


/** The link/backfill input shared by mapping.confirm and mapping.answerLink (G-08). */
export interface LinkInput {
  supplierId: string;
  supplierSku?: string;
  rawName: string;
  productId?: string;
  newProductName?: string;
  revert?: z.infer<typeof RevertSchema>;
}

/**
 * Link (or undo a link of) a line key to a product: verify the supplier, resolve
 * or create the product, learn the alias, backfill the unlinked lines in place
 * and re-match their invoices. Restaurant-scoped on every statement.
 */
async function applyLink(db: Database, rid: string, input: LinkInput) {
  await assertSupplierOwned(db, input.supplierId, rid);

  // The line key: (supplier, SKU), or for a G-08 name question (supplier,
  // normalized name) on lines that carry NO SKU.
  const sku = input.supplierSku;
  const nameKey = normalizeLinkName(input.rawName);
  const poKey = sku
    ? eq(poLines.supplierSku, sku)
    : and(isNull(poLines.supplierSku), sql`${normNameSql(poLines.rawDescription)} = ${nameKey}`);
  const invKey = sku
    ? eq(invoiceLines.supplierSku, sku)
    : and(isNull(invoiceLines.supplierSku), sql`${normNameSql(invoiceLines.rawDescription)} = ${nameKey}`);
  const itemKey = sku
    ? eq(supplierCatalogItems.supplierSku, sku)
    : and(
        isNull(supplierCatalogItems.supplierSku),
        sql`${normNameSql(supplierCatalogItems.supplierNameRaw)} = ${nameKey}`,
      );

  // An alias belongs to this key: its SKU, or (name path) its normalized name.
  const aliasKey = sku
    ? eq(productAliases.supplierSku, sku)
    : sql`${normNameSql(productAliases.supplierNameRaw)} = ${nameKey}`;

  const poIds = db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, rid), eq(purchaseOrders.supplierId, input.supplierId)));
  const invIds = db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.restaurantId, rid), eq(invoices.supplierId, input.supplierId)));

  if (input.revert) {
    const r = input.revert;
    const undonePo = r.poLineIds.length
      ? await db
          .update(poLines)
          .set({ productId: null })
          .where(
            and(
              inArray(poLines.id, r.poLineIds),
              eq(poLines.productId, r.productId),
              poKey,
              inArray(poLines.poId, poIds),
            ),
          )
          .returning({ id: poLines.id })
      : [];
    const undoneInv = r.invoiceLineIds.length
      ? await db
          .update(invoiceLines)
          .set({ productId: null })
          .where(
            and(
              inArray(invoiceLines.id, r.invoiceLineIds),
              eq(invoiceLines.productId, r.productId),
              invKey,
              inArray(invoiceLines.invoiceId, invIds),
            ),
          )
          .returning({ id: invoiceLines.id, invoiceId: invoiceLines.invoiceId })
      : [];
    if (r.catalogItemIds.length) {
      await db
        .update(supplierCatalogItems)
        .set({ productId: null, updatedAt: new Date() })
        .where(
          and(
            inArray(supplierCatalogItems.id, r.catalogItemIds),
            eq(supplierCatalogItems.restaurantId, rid),
            eq(supplierCatalogItems.supplierId, input.supplierId),
            eq(supplierCatalogItems.productId, r.productId),
            // G-08: only rows of THIS key (never a SKU row from a name answer).
            itemKey,
          ),
        );
    }
    if (r.aliasId) {
      // Only the alias this confirm created, and only through a product of this restaurant.
      const own = db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, r.productId), eq(products.restaurantId, rid)));
      await db
        .delete(productAliases)
        .where(
          and(
            eq(productAliases.id, r.aliasId),
            eq(productAliases.productId, r.productId),
            eq(productAliases.supplierId, input.supplierId),
            inArray(productAliases.productId, own),
            aliasKey,
          ),
        );
    }
    if (r.aliasRestore) {
      // G-08 (MEDIUM-2): the link raised an existing alias (e.g. a legacy 0.95 to
      // 0.999); put its confidence back, through a product of this restaurant.
      const own = db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, r.productId), eq(products.restaurantId, rid)));
      await db
        .update(productAliases)
        .set({ confidence: r.aliasRestore.confidence })
        .where(
          and(
            eq(productAliases.id, r.aliasRestore.id),
            eq(productAliases.productId, r.productId),
            eq(productAliases.supplierId, input.supplierId),
            inArray(productAliases.productId, own),
            aliasKey,
          ),
        );
    }
    if (r.createdProduct) {
      // Remove the product this confirm made — only while no order, invoice or
      // price-list line still points at it (those are ON DELETE SET NULL and
      // would be silently unlinked). Recipes / counts are RESTRICT: the
      // savepoint catches that refusal and the product stays.
      const used = sql`EXISTS (SELECT 1 FROM invoice_lines WHERE product_id = ${r.productId})
        OR EXISTS (SELECT 1 FROM po_lines WHERE product_id = ${r.productId})
        OR EXISTS (SELECT 1 FROM supplier_catalog_items WHERE product_id = ${r.productId})`;
      try {
        await db.transaction(async (sp) => {
          await (sp as unknown as Database)
            .delete(products)
            .where(and(eq(products.id, r.productId), eq(products.restaurantId, rid), sql`NOT (${used})`));
        });
      } catch {
        // Still used elsewhere: leave it.
      }
    }
    // An invoice an answer released goes back on hold rather than re-matching
    // into a false leak; the rest re-match (incl. invoices of undone PO lines).
    const reheld = new Set(await reholdLinkHolds(db, rid, undoneInv.map((l) => l.invoiceId)));
    const toRematch = [
      ...undoneInv.map((l) => l.invoiceId),
      ...(await invoicesForPoLines(db, rid, undonePo.map((l) => l.id))),
    ].filter((id) => !reheld.has(id));
    const rematch = await requeueInvoicesForRematch(db, rid, toRematch);
    return {
      productId: r.productId,
      createdProduct: false,
      poLinesUpdated: undonePo.length,
      invoiceLinesUpdated: undoneInv.length,
      rematch,
      undo: null,
    };
  }

  // Resolve the target product (verify ownership / create new).
  let productId: string;
  let createdProduct = false;
  if (input.productId) {
    const [owned] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.restaurantId, rid)))
      .limit(1);
    if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
    productId = owned.id;
  } else {
    const [created] = await db
      .insert(products)
      // Stamp the exclusivity owner (input.supplierId is already asserted
      // same-tenant above) so OCR/mapping-created products don't accumulate
      // NULL-owner rows that leave exclusivity inert + un-backfillable.
      .values({ restaurantId: rid, canonicalName: input.newProductName!, supplierId: input.supplierId })
      .returning({ id: products.id });
    if (!created) throw new Error('failed to create product');
    productId = created.id;
    createdProduct = true;
  }

  if (!sku) {
    // G-08 (MEDIUM-3): serialize answers on one (supplier, name key), require an
    // open question, and refuse a second, different product for a key that a
    // confirmed alias already resolves.
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`g08:${rid}:${input.supplierId}:${nameKey}`}))`);
    if (!(await openQuestion(db, rid, input.supplierId, nameKey))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'no open question' });
    }
    const [other] = await db
      .select({ id: productAliases.id })
      .from(productAliases)
      .innerJoin(products, and(eq(products.id, productAliases.productId), eq(products.restaurantId, rid)))
      .where(
        and(
          eq(productAliases.supplierId, input.supplierId),
          aliasKey,
          sql`${productAliases.confidence} >= ${MACHINE_MAX_CONFIDENCE.toFixed(3)}`,
          sql`${productAliases.productId} <> ${productId}`,
        ),
      )
      .limit(1);
    if (other) {
      throw new TRPCError({ code: 'CONFLICT', message: 'this name is already linked to another product' });
    }
  }

  // Learn the alias (name + SKU) so future imports/OCR auto-resolve. A SKU
  // link is a person's (1.000); a G-08 name answer learns the exact-key
  // alias (0.999) for this supplier's exact name (orchestrator 31.10).
  const alias = await recordConfirmedMatch(db, {
    productId,
    rawName: input.rawName,
    supplierId: input.supplierId,
    supplierSku: sku ?? null,
    provenance: sku ? 'human' : 'exactKey',
  });

  // Backfill already-imported lines, scoped to this restaurant + supplier.
  const updatedPo = await db
    .update(poLines)
    .set({ productId })
    .where(
      and(
        isNull(poLines.productId),
        poKey,
        inArray(poLines.poId, poIds),
      ),
    )
    .returning({ id: poLines.id });

  const updatedInv = await db
    .update(invoiceLines)
    .set({ productId })
    .where(
      and(
        isNull(invoiceLines.productId),
        invKey,
        inArray(invoiceLines.invoiceId, invIds),
      ),
    )
    .returning({ id: invoiceLines.id, invoiceId: invoiceLines.invoiceId });

  // Link the priced catalog row too, when one exists for this SKU.
  const linkedItems = await db
    .update(supplierCatalogItems)
    .set({ productId, updatedAt: new Date() })
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, rid),
        eq(supplierCatalogItems.supplierId, input.supplierId),
        itemKey,
        isNull(supplierCatalogItems.productId),
      ),
    )
    .returning({ id: supplierCatalogItems.id });

  // An invoice OCR held only for unlinked lines is released once none is left;
  // then every touched invoice re-matches — incl. those of linked PO lines.
  await releaseLinkHolds(db, rid, updatedInv.map((l) => l.invoiceId));
  const rematch = await requeueInvoicesForRematch(db, rid, [
    ...updatedInv.map((l) => l.invoiceId),
    ...(await invoicesForPoLines(db, rid, updatedPo.map((l) => l.id))),
  ]);
  const newConfidence = sku ? '1.000' : MACHINE_MAX_CONFIDENCE.toFixed(3);
  const aliasRestore =
    !alias.created && alias.previousConfidence !== null && Number(alias.previousConfidence) < Number(newConfidence)
      ? { id: alias.aliasId, confidence: alias.previousConfidence }
      : null;

  return {
    productId,
    createdProduct,
    poLinesUpdated: updatedPo.length,
    invoiceLinesUpdated: updatedInv.length,
    rematch,
    undo: {
      productId,
      poLineIds: updatedPo.map((l) => l.id),
      invoiceLineIds: updatedInv.map((l) => l.id),
      catalogItemIds: linkedItems.map((l) => l.id),
      aliasId: alias.created ? alias.aliasId : null,
      aliasRestore,
      createdProduct,
    },
  };
}

/**
 * The catalog mapping queue + confirm flow. Imported orders / OCR'd invoices
 * leave lines with a supplier SKU (מק״ט) but no productId when the SKU isn't yet
 * linked. This router surfaces those lines, lets a manager link them to a
 * product (existing or new), learns the alias so FUTURE lines auto-resolve, and
 * backfills the already-imported lines in place. Never auto-links — the human
 * confirms — and is strictly restaurant-scoped.
 */
export const mappingRouter = router({
  /** Distinct unmapped (supplier, SKU) pairs across PO + invoice lines. */
  unmapped: memberProcedure
    .input(z.object({ supplierId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }): Promise<UnmappedSku[]> => {
      const rid = ctx.session.restaurantId;
      const supplierFilter = input?.supplierId;

      const poRows = await ctx.db
        .select({
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          supplierSku: poLines.supplierSku,
          rawDescription: poLines.rawDescription,
        })
        .from(poLines)
        .innerJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)),
        )
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(
          and(
            isNull(poLines.productId),
            sql`${poLines.supplierSku} is not null`,
            supplierFilter ? eq(purchaseOrders.supplierId, supplierFilter) : undefined,
          ),
        );

      const invRows = await ctx.db
        .select({
          supplierId: invoices.supplierId,
          supplierName: suppliers.name,
          supplierSku: invoiceLines.supplierSku,
          rawDescription: invoiceLines.rawDescription,
        })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, rid)),
        )
        .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
        .where(
          and(
            isNull(invoiceLines.productId),
            sql`${invoiceLines.supplierSku} is not null`,
            supplierFilter ? eq(invoices.supplierId, supplierFilter) : undefined,
          ),
        );

      // G-08: price-list rows the link policy sent to review (saved unlinked,
      // never guessed) join the SKU-keyed queue; mapping.confirm already links
      // them by (supplier, SKU). Name-keyed review rows (no SKU) are W3-10's
      // "לקשר" queue on decideLink.
      const catalogRows = await ctx.db
        .select({
          supplierId: supplierCatalogItems.supplierId,
          supplierName: suppliers.name,
          supplierSku: supplierCatalogItems.supplierSku,
          rawDescription: supplierCatalogItems.supplierNameRaw,
        })
        .from(supplierCatalogItems)
        .innerJoin(
          suppliers,
          and(eq(suppliers.id, supplierCatalogItems.supplierId), eq(suppliers.restaurantId, rid)),
        )
        .where(
          and(
            eq(supplierCatalogItems.restaurantId, rid),
            isNull(supplierCatalogItems.productId),
            sql`${supplierCatalogItems.supplierSku} is not null`,
            supplierFilter ? eq(supplierCatalogItems.supplierId, supplierFilter) : undefined,
          ),
        );

      const byKey = new Map<string, UnmappedSku>();
      for (const r of [...poRows, ...invRows, ...catalogRows]) {
        if (!r.supplierId || !r.supplierSku) continue;
        const key = `${r.supplierId}::${r.supplierSku}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.occurrences += 1;
          if (!existing.sampleDescription && r.rawDescription) {
            existing.sampleDescription = r.rawDescription;
          }
        } else {
          byKey.set(key, {
            kind: 'sku',
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            supplierSku: r.supplierSku,
            nameKey: null,
            sampleDescription: r.rawDescription ?? '',
            occurrences: 1,
            suggestions: [],
          });
        }
      }
      // G-08: name-keyed questions (no SKU). The policy sent these to review,
      // so a person is asked "זה אותו מוצר?" with the top 1–3 suggestions,
      // computed on read and never carrying ₪.
      const named: UnmappedSku[] = [];
      for (const r of await nameKeyedRows(ctx.db, rid, supplierFilter)) {
        const suggestions = await suggestionsFor(ctx.db, rid, r.supplierId, r.sample);
        named.push({
          kind: 'name',
          supplierId: r.supplierId,
          supplierName: r.supplierName,
          supplierSku: null,
          nameKey: r.nameKey,
          sampleDescription: r.sample,
          occurrences: r.occurrences,
          suggestions,
        });
      }
      // The chef answers only "זה אותו מוצר?" (G-08, orchestrator 31.10): no SKU rows.
      if (ctx.session.role === 'chef') return named;
      return [...byKey.values(), ...named].sort((a, b) => b.occurrences - a.occurrences);
    }),

  /** G-08: how many "זה אותו מוצר?" questions are open (the home line). No ₪. */
  questionCount: memberProcedure.query(async ({ ctx }) => ({
    count: await countNameQuestions(ctx.db, ctx.session.restaurantId),
  })),

  /** Product picker: fuzzy/ILIKE search over the restaurant's products. */
  searchProducts: memberProcedure
    .input(z.object({ q: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(25).default(10) }))
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const like = `%${input.q}%`;
      return ctx.db
        .select({ id: products.id, canonicalName: products.canonicalName, nameEn: products.nameEn })
        .from(products)
        .where(
          and(
            eq(products.restaurantId, rid),
            sql`(${products.canonicalName} % ${input.q} OR ${products.canonicalName} ILIKE ${like} OR ${products.nameEn} ILIKE ${like})`,
          ),
        )
        .orderBy(sql`similarity(${products.canonicalName}, ${input.q}) DESC`)
        .limit(input.limit);
    }),

  /**
   * Link a (supplier, SKU) to a product — existing or freshly created — then
   * learn the alias and backfill every already-imported PO/invoice line that
   * carries this SKU unmapped. Idempotent: re-confirming just re-applies.
   */
  confirm: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          /** Absent → a G-08 name-keyed question: the key is (supplier, normalized rawName). */
          supplierSku: z.string().trim().min(1).max(64).optional(),
          rawName: z.string().trim().min(1).max(400),
          productId: z.string().uuid().optional(),
          newProductName: z.string().trim().min(1).max(200).optional(),
          /**
           * Undo ("בטל") a confirm made moments ago: unlink exactly the lines it
           * linked (still on that product, this supplier and SKU), drop the alias
           * it created, and re-match those invoices again.
           */
          revert: RevertSchema.optional(),
        })
        .refine((v) => !!v.revert || !!v.productId || !!v.newProductName, {
          message: 'provide a productId or a newProductName',
        }),
    )
    .mutation(({ ctx, input }) => applyLink(ctx.db, ctx.session.restaurantId, input)),

  /**
   * G-08 · "זה אותו מוצר?" — the least-privilege answer for owner, manager AND
   * chef: link a NAME-keyed question to one of ITS OWN server-computed
   * suggestions. No new product, no SKU path, no ₪ in or out. The suggestion set
   * is recomputed here; any other productId is refused (FORBIDDEN). Same alias
   * learning (exact key, 0.999), backfill and undo as mapping.confirm.
   */
  answerLink: chefProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid(),
          rawName: z.string().trim().min(1).max(400),
          productId: z.string().uuid(),
          /** The opaque, server-signed undo token this user's answer returned (HIGH-1). */
          revert: z.string().min(1).max(200_000).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const who = { userId: ctx.session.userId, restaurantId: rid };
      await assertSupplierOwned(ctx.db, input.supplierId, rid);
      if (input.revert) {
        // Undo exactly what THIS user's answer changed (signed, expiring, bound
        // to the restaurant, supplier, name key and product) — never a client list.
        const undo = verifyAnswerUndo(input.revert, who);
        if (
          !undo ||
          undo.supplierId !== input.supplierId ||
          undo.change.productId !== input.productId ||
          undo.nameKey !== normalizeLinkName(input.rawName)
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not an answer to undo' });
        }
        const r = await applyLink(ctx.db, rid, {
          supplierId: undo.supplierId,
          rawName: undo.nameKey,
          revert: { ...undo.change, createdProduct: false },
        });
        return { ...r, undo: null, undoToken: null };
      }
      const [owned] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, rid)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      // LOW-1: the question's OWN server-side spelling drives the suggestions and
      // the learned alias, not the client's rawName.
      const nameKey = normalizeLinkName(input.rawName);
      const q = await openQuestion(ctx.db, rid, input.supplierId, nameKey);
      if (!q) throw new TRPCError({ code: 'NOT_FOUND', message: 'no open question' });
      const suggestions = await suggestionsFor(ctx.db, rid, input.supplierId, q.sample);
      if (!suggestions.some((sug) => sug.productId === input.productId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'not a suggested product' });
      }
      const r = await applyLink(ctx.db, rid, {
        supplierId: input.supplierId,
        rawName: q.sample,
        productId: input.productId,
      });
      const undoToken = r.undo
        ? signAnswerUndo(who, { supplierId: input.supplierId, nameKey }, {
            productId: r.undo.productId,
            poLineIds: r.undo.poLineIds,
            invoiceLineIds: r.undo.invoiceLineIds,
            catalogItemIds: r.undo.catalogItemIds,
            aliasId: r.undo.aliasId,
            aliasRestore: r.undo.aliasRestore,
          })
        : null;
      return { ...r, undo: null, undoToken };
    }),
});
