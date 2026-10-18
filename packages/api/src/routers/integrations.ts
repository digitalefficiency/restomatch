import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, restaurants, suppliers, type RestaurantSettings } from '@restomatch/db';
import { bookkeeperProcedure, memberProcedure, ownerProcedure, requireFeature, router } from '../trpc';
import { featureEnabled } from '../lib/features';
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

async function loadSettings(db: import('@restomatch/db').Database, restaurantId: string) {
  const [row] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return (row?.settings ?? {}) as IntegrationSettings;
}

/** FORBIDDEN unless the restaurant has the `integrations` flag (and FEATURES_OFF doesn't kill it). */
async function assertIntegrations(db: import('@restomatch/db').Database, restaurantId: string) {
  if (!featureEnabled(await loadSettings(db, restaurantId), 'integrations')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'FEATURE_DISABLED:integrations' });
  }
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
export { assertIntegrations };

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
      const current = await loadSettings(ctx.db, ctx.session.restaurantId);
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
      const invoices: AccountingInvoice[] = [];
      let skipped = 0;
      for (const r of rows) {
        const excl = numericToAgorot(r.totalExclVat);
        const vat = numericToAgorot(r.vatAmount);
        const incl = numericToAgorot(r.totalInclVat);
        if (!r.invoiceNumber || !r.invoiceDate || incl === null) {
          skipped++;
          continue;
        }
        // A missing split is derived so the movement still balances to the agora.
        const vatA = vat ?? (excl !== null ? incl - excl : 0);
        invoices.push({
          invoiceNumber: r.invoiceNumber,
          invoiceDate: localIsoDate(r.invoiceDate, tz),
          supplierId: r.supplierId ?? null,
          supplierName: r.supplierName ?? '',
          supplierBusinessId: r.supplierBusinessId ?? '',
          totalExclAgorot: excl ?? incl - vatA,
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
        undatedCount,
      };
    }),
});
