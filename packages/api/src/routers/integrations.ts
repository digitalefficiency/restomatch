import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  posSales,
  posSalesImports,
  procurementConnections,
  restaurants,
  sql,
  suppliers,
  type RestaurantSettings,
} from '@restomatch/db';
import { getAdapter, listSupportedPlatforms, type PlatformId } from '@restomatch/procurement';
import { bookkeeperProcedure, chefProcedure, managerProcedure, memberProcedure, ownerProcedure, requireFeature, router } from '../trpc';
import { featureEnabled } from '../lib/features';
import { assertFeatureOn } from '../lib/featureGate';
import { localIsoDate } from '../exports/period';
import { fetchInvoices } from './exports';
import {
  ACCOUNTING_FORMATS,
  DEFAULT_ACCOUNTING_CONFIG,
  numericToAgorot,
  renderAccountingFile,
  type AccountingConfig,
  type AccountingInvoice,
} from '../integrations/accounting';
import { agorotToPlain } from '../integrations/accounting/common';
import { MAX_POS_BYTES, POS_PROVIDER_IDS, POS_PROVIDERS, PosFileError, type PosParseResult } from '../integrations/pos';

/**
 * Wave-1 integrations (MASTER-PLAN §3 #9), behind the per-restaurant
 * `integrations` flag: accounting-package exports (Hashavshevet / Priority /
 * Rivhit), procurement adapters, POS sales import. No credentials: every
 * provider here is file-based or an offline fixture until the owner activates
 * a real account (docs/client-ready/reports/wave1-integrations.md).
 */

type IntegrationSettings = RestaurantSettings & {
  integrations?: { accounting?: Partial<AccountingConfig> };
};

async function loadSettings(
  db: import('@restomatch/db').Database,
  restaurantId: string,
  /** Read-modify-write: lock the row so a concurrent settings writer (e.g. G-08's learned charge keys) is not lost. */
  forUpdate = false,
) {
  const q = db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  return (row?.settings ?? {}) as IntegrationSettings;
}

/** FORBIDDEN / appCode FEATURE_DISABLED unless the `integrations` flag is on (FEATURES_OFF honoured). */
function assertIntegrations(db: import('@restomatch/db').Database, restaurantId: string) {
  return assertFeatureOn(db, restaurantId, 'integrations');
}

/** Accounting exports: bookkeeper/owner, the accounting_export plan feature, and the flag. */
const accountingProcedure = bookkeeperProcedure
  .use(requireFeature('accounting_export'))
  .use(async ({ ctx, next }) => {
    await assertIntegrations(ctx.db, ctx.session.restaurantId);
    return next();
  });
/** Owner-only integration settings. */
const ownerIntegrationsProcedure = ownerProcedure.use(async ({ ctx, next }) => {
  await assertIntegrations(ctx.db, ctx.session.restaurantId);
  return next();
});
/** POS import + procurement preview: owner / manager. */
const managerIntegrationsProcedure = managerProcedure.use(async ({ ctx, next }) => {
  await assertIntegrations(ctx.db, ctx.session.restaurantId);
  return next();
});
/** Sold-items summary (food cost per dish reads it): owner / manager / chef. */
const kitchenIntegrationsProcedure = chefProcedure.use(async ({ ctx, next }) => {
  await assertIntegrations(ctx.db, ctx.session.restaurantId);
  return next();
});

const PosFileInput = z.object({
  provider: z.enum(POS_PROVIDER_IDS).default('csv'),
  filename: z.string().trim().min(1).max(200),
  // ~5 MB of bytes as base64.
  base64: z.string().min(1).max(Math.ceil((MAX_POS_BYTES * 4) / 3) + 8),
});

function parsePosFile(input: z.infer<typeof PosFileInput>): PosParseResult {
  try {
    return POS_PROVIDERS[input.provider]!.parse({
      filename: input.filename,
      bytes: new Uint8Array(Buffer.from(input.base64, 'base64')),
    });
  } catch (e) {
    if (e instanceof PosFileError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: e.missing.length ? `${e.message}:${e.missing.join(',')}` : e.message,
      });
    }
    throw e;
  }
}

function posSummaryOf(parsed: PosParseResult) {
  const days = parsed.rows.map((r) => r.soldOn).sort();
  const totalNet = parsed.rows.reduce((a, r) => a + r.netAgorot, 0);
  return {
    rowCount: parsed.rows.length,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    totalNetAgorot: totalNet,
    columns: parsed.columns,
    issues: parsed.issues.slice(0, 50).map(({ line, code }) => ({ line, code })),
    issueCount: parsed.issues.length,
    /** Days whose every row was rejected: an import keeps their previous data. */
    rejectedDays: parsed.rejectedDays,
    sample: parsed.rows.slice(0, 20),
  };
}

const PROCUREMENT_PLATFORMS = ['marketman', 'zester'] as const satisfies readonly PlatformId[];

/**
 * VAT inside a VAT-inclusive total, in agorot, half-up (away from zero):
 * incl − round(incl / (1 + rate)). The rate is a NUMERIC(5,4) string ("0.18");
 * the division is done in integers (rate × 10 000) so nothing goes through floats.
 */
export function vatFromInclusive(inclAgorot: number, rate: string): number {
  const r = Math.round(Number(rate) * 10_000);
  if (!Number.isFinite(r) || r <= 0) return 0;
  // BigInt: incl × 20 000 can pass 2^53 for NUMERIC(12,2)-sized totals.
  const incl = BigInt(Math.abs(inclAgorot));
  const denom = 2n * BigInt(10_000 + r);
  const excl = Number((incl * 20_000n + BigInt(10_000 + r)) / denom);
  const vat = Math.abs(inclAgorot) - excl;
  return inclAgorot < 0 ? -vat : vat;
}

export function accountingConfigOf(settings: IntegrationSettings): AccountingConfig {
  const saved = settings.integrations?.accounting ?? {};
  return {
    expenseAccount: saved.expenseAccount?.trim() || DEFAULT_ACCOUNTING_CONFIG.expenseAccount,
    vatInputAccount: saved.vatInputAccount?.trim() || DEFAULT_ACCOUNTING_CONFIG.vatInputAccount,
    movementType: saved.movementType?.trim() || DEFAULT_ACCOUNTING_CONFIG.movementType,
    supplierAccounts: { ...(saved.supplierAccounts ?? {}) },
  };
}

const AccountCode = z
  .string()
  .trim()
  .max(15)
  .regex(/^[\p{L}\p{N}._-]*$/u, 'account codes are letters, digits, . _ -');

const ConfigInput = z.object({
  expenseAccount: AccountCode.min(1),
  vatInputAccount: AccountCode.min(1),
  movementType: z.string().trim().min(1).max(3),
  /** supplierId → code; an empty code removes the override. */
  supplierAccounts: z.record(z.string().uuid(), AccountCode).refine((m) => Object.keys(m).length <= 500, {
    message: 'too many supplier mappings',
  }),
});

export const integrationsRouter = router({
  /** Whether the integrations area is on for the active restaurant (nav / page visibility). */
  status: memberProcedure.query(async ({ ctx }) => {
    const settings = await loadSettings(ctx.db, ctx.session.restaurantId);
    return { enabled: featureEnabled(settings, 'integrations') };
  }),

  /** Chart-of-accounts mapping + each active supplier with the card code the export will use. */
  accountingConfig: accountingProcedure.query(async ({ ctx }) => {
    const config = accountingConfigOf(await loadSettings(ctx.db, ctx.session.restaurantId));
    const rows = await ctx.db
      .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn, businessId: suppliers.businessId })
      .from(suppliers)
      .where(and(eq(suppliers.restaurantId, ctx.session.restaurantId), eq(suppliers.active, true)))
      .orderBy(suppliers.name);
    return {
      config,
      suppliers: rows.map((s) => ({
        ...s,
        account: config.supplierAccounts[s.id] ?? null,
        defaultAccount: (s.businessId ?? '').replace(/\D/g, '') || `S${s.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      })),
    };
  }),

  /** Owner-only: save the mapping (merged into restaurants.settings.integrations.accounting). */
  setAccountingConfig: ownerIntegrationsProcedure
    .input(ConfigInput)
    .mutation(async ({ ctx, input }) => {
      const ids = Object.keys(input.supplierAccounts);
      if (ids.length > 0) {
        const own = await ctx.db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.restaurantId, ctx.session.restaurantId), inArray(suppliers.id, ids)));
        if (own.length !== ids.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'supplier not found' });
      }
      const supplierAccounts = Object.fromEntries(
        Object.entries(input.supplierAccounts).filter(([, code]) => code.length > 0),
      );
      const current = await loadSettings(ctx.db, ctx.session.restaurantId, true); // G-08: row lock
      const next: IntegrationSettings = {
        ...current,
        integrations: {
          ...current.integrations,
          accounting: {
            expenseAccount: input.expenseAccount,
            vatInputAccount: input.vatInputAccount,
            movementType: input.movementType,
            supplierAccounts,
          },
        },
      };
      await ctx.db
        .update(restaurants)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(restaurants.id, ctx.session.restaurantId));
      return accountingConfigOf(next);
    }),

  /**
   * One accounting-package file for a period: the same invoices as the CSV /
   * uniform-1000 exports (checked invoices, Israel calendar days, flagged
   * duplicates excluded). Bytes come back base64 in the package's encoding.
   */
  accountingExport: accountingProcedure
    .input(z.object({ format: z.enum(ACCOUNTING_FORMATS), from: z.string().date(), to: z.string().date() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const config = accountingConfigOf(await loadSettings(ctx.db, restaurantId));
      const { rows, tz, undatedCount } = await fetchInvoices(ctx.db, restaurantId, input.from, input.to);
      const [rest] = await ctx.db
        .select({ vatRate: restaurants.vatRate })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      const restaurantVatRate = rest?.vatRate ?? '0.18';
      const invoices: AccountingInvoice[] = [];
      let skipped = 0;
      let derivedVat = 0;
      for (const r of rows) {
        const excl = numericToAgorot(r.totalExclVat);
        const vat = numericToAgorot(r.vatAmount);
        const incl = numericToAgorot(r.totalInclVat);
        // A supplier-less invoice (e.g. an e-mail/WhatsApp ingest approved
        // without a supplier) has no supplier card to post to, and duplicate
        // detection needs a supplier, so it could be the same paper as an
        // already-exported photo: posting it under a fallback card could book
        // the purchase — and its input VAT — twice. Left out and counted.
        if (!r.invoiceNumber || !r.invoiceDate || incl === null || !r.supplierId) {
          skipped++;
          continue;
        }
        // A missing split is derived so the movement still balances to the agora.
        // Only the total stored (no excl., no VAT): split it with the supplier's
        // VAT rate (else the restaurant's) instead of posting VAT 0 and losing
        // the input VAT. Counted so the UI can say so.
        let vatA: number;
        if (vat !== null) vatA = vat;
        else if (excl !== null) vatA = incl - excl;
        else {
          vatA = vatFromInclusive(incl, r.supplierVatRate ?? restaurantVatRate);
          derivedVat++;
        }
        const exclA = excl ?? incl - vatA;
        // An invoice whose stored totals don't add up (OCR / a manual edit) would
        // post an unbalanced movement: leave it out and count it for the UI.
        if (exclA + vatA !== incl) {
          skipped++;
          continue;
        }
        invoices.push({
          invoiceNumber: r.invoiceNumber,
          invoiceDate: localIsoDate(r.invoiceDate, tz),
          supplierId: r.supplierId ?? null,
          supplierName: r.supplierName ?? '',
          supplierBusinessId: r.supplierBusinessId ?? '',
          totalExclAgorot: exclA,
          vatAgorot: vatA,
          totalInclAgorot: incl,
        });
      }
      const file = renderAccountingFile(input.format, invoices, config, input);
      return {
        filename: file.filename,
        mimeType: file.mimeType,
        encoding: file.encoding,
        base64: Buffer.from(file.bytes).toString('base64'),
        rowCount: file.rowCount,
        skippedCount: skipped,
        derivedVatCount: derivedVat,
        replacedChars: file.replacedChars,
        undatedCount,
      };
    }),
  /** Parse a POS sales export without saving: columns found, day range, totals, bad lines. */
  posPreview: managerIntegrationsProcedure.input(PosFileInput).mutation(({ input }) => posSummaryOf(parsePosFile(input))),

  /**
   * Save a POS sales export. Replaces the restaurant's rows for the days the
   * file covers (inside the member transaction), so re-importing a corrected
   * file never double-counts a day.
   */
  posImport: managerIntegrationsProcedure.input(PosFileInput).mutation(async ({ ctx, input }) => {
    const parsed = parsePosFile(input);
    const summary = posSummaryOf(parsed);
    if (summary.rowCount === 0 || !summary.from || !summary.to) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'POS_FILE_NO_ROWS' });
    }
    const restaurantId = ctx.session.restaurantId;
    const [imp] = await ctx.db
      .insert(posSalesImports)
      .values({
        restaurantId,
        provider: input.provider,
        filename: input.filename,
        periodFrom: summary.from,
        periodTo: summary.to,
        rowCount: summary.rowCount,
        totalNet: agorotToPlain(summary.totalNetAgorot),
        createdBy: ctx.session.userId,
      })
      .returning({ id: posSalesImports.id });
    // Replace exactly the days this file carries — never the gaps between them
    // (a corrected file with only the 1st and the 30th must not wipe the 2nd–29th).
    const days = [...new Set(parsed.rows.map((r) => r.soldOn))];
    const replaced = await ctx.db
      .delete(posSales)
      .where(and(eq(posSales.restaurantId, restaurantId), inArray(posSales.soldOn, days)))
      .returning({ id: posSales.id });
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await ctx.db.insert(posSales).values(
        parsed.rows.slice(i, i + 1000).map((r) => ({
          restaurantId,
          importId: imp!.id,
          soldOn: r.soldOn,
          itemRef: r.itemRef,
          itemName: r.itemName,
          qty: (r.qtyMilli / 1000).toFixed(3),
          netAmount: agorotToPlain(r.netAgorot),
        })),
      );
    }
    return { importId: imp!.id, ...summary, replacedRows: replaced.length, sample: undefined };
  }),

  /** Recent POS imports (newest first). */
  posImports: managerIntegrationsProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: posSalesImports.id,
        provider: posSalesImports.provider,
        filename: posSalesImports.filename,
        periodFrom: posSalesImports.periodFrom,
        periodTo: posSalesImports.periodTo,
        rowCount: posSalesImports.rowCount,
        totalNet: posSalesImports.totalNet,
        createdAt: posSalesImports.createdAt,
        // Rows still carried by this import (0 = a later import replaced its days).
        liveRows: sql<number>`(select count(*)::int from pos_sales ps where ps.import_id = "pos_sales_imports"."id")`,
      })
      .from(posSalesImports)
      .where(eq(posSalesImports.restaurantId, ctx.session.restaurantId))
      .orderBy(desc(posSalesImports.createdAt))
      .limit(20),
  ),

  /**
   * Sold quantity + net sales per POS item for a period — the hook food cost
   * per dish (S17) reads. Money comes back as NUMERIC strings (shekels).
   */
  posSummary: kitchenIntegrationsProcedure
    .input(z.object({ from: z.string().date(), to: z.string().date() }))
    .query(async ({ ctx, input }) =>
      ctx.db
        .select({
          itemRef: posSales.itemRef,
          itemName: sql<string>`max(${posSales.itemName})`,
          qty: sql<string>`sum(${posSales.qty})::numeric(14,3)::text`,
          netAmount: sql<string>`sum(${posSales.netAmount})::numeric(14,2)::text`,
          days: sql<number>`count(distinct ${posSales.soldOn})::int`,
        })
        .from(posSales)
        .where(
          and(
            eq(posSales.restaurantId, ctx.session.restaurantId),
            gte(posSales.soldOn, input.from),
            lte(posSales.soldOn, input.to),
          ),
        )
        .groupBy(posSales.itemRef)
        .orderBy(desc(sql`sum(${posSales.netAmount})`)),
    ),

  /** Procurement platforms: which have an adapter and whether this restaurant is connected. */
  procurementProviders: managerIntegrationsProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        platform: procurementConnections.platform,
        enabled: procurementConnections.enabled,
        lastSyncAt: procurementConnections.lastSyncAt,
        vaultRef: procurementConnections.credentialsVaultRef,
      })
      .from(procurementConnections)
      .where(eq(procurementConnections.restaurantId, ctx.session.restaurantId));
    const supported = new Set(listSupportedPlatforms());
    return PROCUREMENT_PLATFORMS.map((platform) => {
      const conn = rows.find((r) => r.platform === platform);
      return {
        platform,
        displayName: getAdapter(platform).displayName,
        adapter: supported.has(platform),
        connected: !!conn?.enabled,
        mode: conn ? (conn.vaultRef.startsWith('fixture:') ? ('sample' as const) : ('live' as const)) : null,
        lastSyncAt: conn?.lastSyncAt ?? null,
      };
    });
  }),

  /**
   * What a sync would bring in, on the platform's recorded sample data (no
   * account, no network, nothing saved). Real syncs run in the worker once the
   * owner connects an account (activation steps in the integrations report).
   */
  procurementPreview: managerIntegrationsProcedure
    .input(z.object({ platform: z.enum(PROCUREMENT_PLATFORMS) }))
    .query(async ({ ctx, input }) => {
      const adapter = getAdapter(input.platform);
      const actx = { restaurantId: ctx.session.restaurantId, credentials: { mode: 'fixture' as const } };
      const [supplierRows, products, orders] = await Promise.all([
        adapter.listSuppliers(actx),
        adapter.listProducts(actx),
        adapter.listOrders(actx, new Date(0)),
      ]);
      return {
        platform: input.platform,
        sample: true,
        suppliers: supplierRows.length,
        products: products.length,
        orders: orders.map((o) => ({
          externalId: o.externalId,
          supplierName: o.supplierName ?? '',
          status: o.status,
          expectedDeliveryAt: o.expectedDeliveryAt ?? null,
          lines: o.lines.length,
          totalEstimated: o.totalEstimated ?? null,
        })),
      };
    }),
});
