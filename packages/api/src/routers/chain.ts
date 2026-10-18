import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  aggregateChain,
  computeBranchPriceLines,
  computeBranchSnapshot,
  computePriceDisparities,
  type ChainOverview,
  type PriceDisparityRow,
} from '@restomatch/charts';
import {
  and,
  billingAccounts,
  eq,
  memberships,
  products,
  restaurants,
  sql,
  storageNamespaces,
  supplierCatalogItems,
  suppliers,
  withRestaurant,
  withUser,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { recordAudit } from '../audit';
import type { AuthedContext } from '../context';
import { getEntitlements, type Entitlements } from '../entitlements';
import { featureEnabled } from '../lib/features';
import { authedProcedure, router } from '../trpc';

/**
 * Chain ("רשת") + branches (סניפים). See docs/client-ready/chain-design.md.
 *
 *  • Branch = a restaurant. Chain = the restaurants on the ACTIVE branch's
 *    billing account where the caller is an OWNER (DB membership).
 *  • The caller's memberships are read under RLS (`withUser`: memberships_self
 *    + restaurants_member_select) — only the caller's own rows are visible.
 *  • Every number is computed per branch inside that branch's own
 *    `withRestaurant` transaction with the existing charts SQL; summing happens
 *    in TS (`aggregateChain`). No cross-tenant SQL.
 *  • A restaurant id from input is only ever used after it is found in that
 *    RLS-derived membership set; otherwise NOT_FOUND (no existence oracle).
 *
 * These procedures are deliberately NOT member procedures: a member procedure
 * runs inside ONE tenant transaction, and the chain view needs one transaction
 * per branch.
 */

/** Hard cap on branches computed per request (the chain plan allows 5). */
export const MAX_CHAIN_BRANCHES = 25;
/** Branch transactions in flight at once (the web pool has max 10 connections). */
const BRANCH_CONCURRENCY = 3;

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const BRANCH_NAME = z.string().trim().min(2).max(120);

export interface MembershipRow {
  restaurantId: string;
  name: string;
  role: UserRole;
  billingAccountId: string | null;
}

export interface ChainBranch {
  restaurantId: string;
  name: string;
  isActive: boolean;
}

export interface ChainScope {
  active: MembershipRow;
  /** Owner branches on the active branch's billing account (always includes the active one). */
  branches: MembershipRow[];
}

/** The caller's memberships, read under the user-scoped RLS policies. */
export async function myMembershipRows(db: Database, userId: string): Promise<MembershipRow[]> {
  return withUser(db, userId, (tx) =>
    tx
      .select({
        restaurantId: memberships.restaurantId,
        name: restaurants.name,
        role: memberships.role,
        billingAccountId: restaurants.billingAccountId,
      })
      .from(memberships)
      .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
      .where(eq(memberships.userId, userId)),
  );
}

/**
 * The chain rule, pure: owner of the active branch, then every OWNER membership
 * on the same (non-null) billing account. Throws FORBIDDEN otherwise.
 */
export function chainScopeOf(rows: MembershipRow[], activeRestaurantId: string | null): ChainScope {
  const active = rows.find((r) => r.restaurantId === activeRestaurantId);
  if (!active || active.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'chain view is owner-only' });
  }
  const branches = active.billingAccountId
    ? rows.filter((r) => r.role === 'owner' && r.billingAccountId === active.billingAccountId)
    : [active];
  branches.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { active, branches };
}

async function resolveScope(ctx: AuthedContext): Promise<ChainScope> {
  const rows = await myMembershipRows(ctx.db, ctx.session.userId);
  return chainScopeOf(rows, ctx.session.restaurantId);
}

/** Run `fn` in the branch's own RLS transaction (restaurant + user GUCs). */
function inBranch<T>(
  db: Database,
  userId: string,
  restaurantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withRestaurant(db, restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Current 'YYYY-MM' in a timezone. */
export function currentMonth(timezone = 'Asia/Jerusalem', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? String(now.getUTCFullYear());
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

function chainRequired(planKey: string | null): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: 'ENTITLEMENT_REQUIRED:chain',
    cause: { code: 'ENTITLEMENT_REQUIRED', feature: 'chain', planKey },
  });
}

interface Gate {
  entitlements: Entitlements;
  /** Chain dashboard available: the chain plan, or already more than one branch. */
  chainEnabled: boolean;
  /** Max branches on the account (null = unlimited). */
  branchLimit: number | null;
  canAddBranch: boolean;
  isBillingOwner: boolean;
  /** Per-restaurant feature flag (settings.features.priceDisparity) of the active branch. */
  priceDisparity: boolean;
}

function gateOf(
  ent: Entitlements,
  branchCount: number,
  isPayer: boolean,
  settings: unknown,
): Gate {
  const branchLimit = ent.limits.restaurants;
  return {
    entitlements: ent,
    chainEnabled:
      (ent.active && ent.planKey === 'chain') || branchCount > 1 || featureEnabled(settings, 'chain'),
    priceDisparity: featureEnabled(settings, 'priceDisparity'),
    branchLimit,
    canAddBranch:
      ent.active &&
      ent.billingAccountId !== null &&
      isPayer &&
      (branchLimit === null || branchCount < branchLimit),
    isBillingOwner: isPayer,
  };
}

async function gateFor(ctx: AuthedContext, scope: ChainScope): Promise<Gate> {
  const { ent, payer, settings } = await inBranch(ctx.db, ctx.session.userId, scope.active.restaurantId, async (tx) => {
    const e = await getEntitlements(tx, scope.active.restaurantId);
    const [acct] = e.billingAccountId
      ? await tx
          .select({ ownerUserId: billingAccounts.ownerUserId })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, e.billingAccountId))
          .limit(1)
      : [];
    const [r] = await tx
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, scope.active.restaurantId))
      .limit(1);
    return { ent: e, payer: acct?.ownerUserId ?? null, settings: r?.settings ?? {} };
  });
  return gateOf(ent, scope.branches.length, payer === ctx.session.userId, settings);
}

export interface ChainBranchesResult {
  activeRestaurantId: string;
  branches: ChainBranch[];
  planKey: Entitlements['planKey'];
  hasBillingAccount: boolean;
  chainEnabled: boolean;
  branchLimit: number | null;
  canAddBranch: boolean;
  /** The caller pays for this billing account (only the payer may add branches). */
  isBillingOwner: boolean;
}

export interface ChainOverviewResult extends ChainOverview {
  activeRestaurantId: string;
  /** True when the chain had more than MAX_CHAIN_BRANCHES owner branches. */
  truncated: boolean;
  currentMonth: string;
  /** Same supplier + product at different prices across branches; null when the feature is off. */
  priceDisparities: PriceDisparityRow[] | null;
}

export const chainRouter = router({
  /** The owner's branches on this billing account + what the plan allows. */
  branches: authedProcedure.query(async ({ ctx }): Promise<ChainBranchesResult> => {
    const scope = await resolveScope(ctx);
    const gate = await gateFor(ctx, scope);
    return {
      activeRestaurantId: scope.active.restaurantId,
      branches: scope.branches.map((b) => ({
        restaurantId: b.restaurantId,
        name: b.name,
        isActive: b.restaurantId === scope.active.restaurantId,
      })),
      planKey: gate.entitlements.planKey,
      hasBillingAccount: gate.entitlements.billingAccountId !== null,
      chainEnabled: gate.chainEnabled,
      branchLimit: gate.branchLimit,
      canAddBranch: gate.canAddBranch,
      isBillingOwner: gate.isBillingOwner,
    };
  }),

  /** The chain dashboard: per-branch numbers computed under each branch's RLS. */
  overview: authedProcedure
    .input(z.object({ month: MONTH.optional() }).optional())
    .query(async ({ ctx, input }): Promise<ChainOverviewResult> => {
      const scope = await resolveScope(ctx);
      const gate = await gateFor(ctx, scope);
      if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);

      const nowMonth = currentMonth();
      const month = input?.month && input.month <= nowMonth ? input.month : nowMonth;
      const branches = scope.branches.slice(0, MAX_CHAIN_BRANCHES);
      const perBranch = await mapLimit(branches, BRANCH_CONCURRENCY, (b) =>
        inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx) => {
          const snapshot = await computeBranchSnapshot(tx, b.restaurantId, b.name, { month, trendMonths: 6 });
          const prices = gate.priceDisparity
            ? await computeBranchPriceLines(tx, b.restaurantId, b.name, snapshot)
            : null;
          return { snapshot, prices };
        }),
      );
      const priceLines = perBranch.flatMap((p) => (p.prices ? [p.prices] : []));
      return {
        ...aggregateChain(
          perBranch.map((p) => p.snapshot),
          { month },
        ),
        activeRestaurantId: scope.active.restaurantId,
        truncated: scope.branches.length > MAX_CHAIN_BRANCHES,
        currentMonth: nowMonth,
        priceDisparities: gate.priceDisparity ? computePriceDisparities(priceLines, { limit: 10 }) : null,
      };
    }),

  /**
   * Validate a branch switch: the target must be one of the caller's own
   * memberships (any role). The web then refreshes the session JWT, whose
   * callback re-checks the same rule on the auth connection.
   */
  switchTarget: authedProcedure
    .input(z.object({ restaurantId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await myMembershipRows(ctx.db, ctx.session.userId);
      const target = rows.find((r) => r.restaurantId === input.restaurantId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'branch not found' });
      return { restaurantId: target.restaurantId, name: target.name, role: target.role };
    }),

  /** Rename one of the caller's owner branches on this chain. */
  renameBranch: authedProcedure
    .input(z.object({ restaurantId: z.string().uuid(), name: BRANCH_NAME }))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx);
      const target = scope.branches.find((b) => b.restaurantId === input.restaurantId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'branch not found' });
      await inBranch(ctx.db, ctx.session.userId, target.restaurantId, async (tx) => {
        await tx
          .update(restaurants)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(restaurants.id, target.restaurantId));
        await recordAudit(tx, {
          restaurantId: target.restaurantId,
          userId: ctx.session.userId,
          action: 'chain.branch_renamed',
          entityType: 'restaurant',
          entityId: target.restaurantId,
          before: { name: target.name },
          after: { name: input.name },
        });
      });
      return { restaurantId: target.restaurantId, name: input.name };
    }),

  /**
   * Open a new branch on the active branch's billing account, with the caller
   * as its owner — optionally copying suppliers, the catalog and the
   * tolerance/approval settings from the active branch.
   */
  addBranch: authedProcedure
    .input(
      z.object({
        name: BRANCH_NAME,
        copySuppliers: z.boolean().default(false),
        copyCatalog: z.boolean().default(false),
        copySettings: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx);
      const gate = await gateFor(ctx, scope);
      if (!gate.canAddBranch) throw chainRequired(gate.entitlements.planKey);
      const billingAccountId = scope.active.billingAccountId;
      if (!billingAccountId) throw chainRequired(gate.entitlements.planKey);
      // Only the billing account's payer may open (= be billed for) a branch —
      // a co-owner of one restaurant on someone else's account may not.
      const [account] = await inBranch(ctx.db, ctx.session.userId, scope.active.restaurantId, (tx) =>
        tx
          .select({ ownerUserId: billingAccounts.ownerUserId })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, billingAccountId))
          .limit(1),
      );
      if (!account || account.ownerUserId !== ctx.session.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only the billing account owner can add branches' });
      }

      const sourceId = scope.active.restaurantId;
      const userId = ctx.session.userId;
      const copyCatalog = input.copyCatalog;
      // Products point at their supplier: the catalog cannot travel without them.
      const copySuppliers = input.copySuppliers || copyCatalog;
      const newId = randomUUID();

      const setTenant = (tx: Database, rid: string) =>
        tx.execute(sql`select set_config('app.current_restaurant_id', ${rid}, true)`);

      const counts = await ctx.db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Database;
        await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);

        // 1) Read the source branch under ITS tenant scope.
        await setTenant(tx, sourceId);
        const [source] = await tx
          .select({
            vatRate: restaurants.vatRate,
            timezone: restaurants.timezone,
            settings: restaurants.settings,
            billingAccountId: restaurants.billingAccountId,
          })
          .from(restaurants)
          .where(eq(restaurants.id, sourceId))
          .limit(1);
        if (!source || source.billingAccountId !== billingAccountId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'source branch not found' });
        }
        // Serialize concurrent addBranch calls on this account, then re-check the
        // limit inside the transaction (every restaurant on the account the
        // caller is a member of, any role — the RLS-visible set).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'chain-add:' + billingAccountId}))`);
        const [{ n: onAccount } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(restaurants)
          .where(eq(restaurants.billingAccountId, billingAccountId));
        if (gate.branchLimit !== null && onAccount >= gate.branchLimit) {
          throw chainRequired(gate.entitlements.planKey);
        }
        const srcSuppliers = copySuppliers
          ? await tx
              .select()
              .from(suppliers)
              .where(and(eq(suppliers.restaurantId, sourceId), eq(suppliers.active, true)))
          : [];
        const srcProducts = copyCatalog
          ? await tx.select().from(products).where(eq(products.restaurantId, sourceId))
          : [];
        const srcItems = copyCatalog
          ? await tx
              .select()
              .from(supplierCatalogItems)
              .where(eq(supplierCatalogItems.restaurantId, sourceId))
          : [];

        // 2) Write the new branch under the NEW tenant scope.
        await setTenant(tx, newId);
        await tx.insert(restaurants).values({
          id: newId,
          name: input.name,
          billingAccountId,
          vatRate: source.vatRate,
          timezone: source.timezone,
          settings: input.copySettings ? source.settings : {},
        });
        await tx.insert(memberships).values({ userId, restaurantId: newId, role: 'owner' });
        await tx.insert(storageNamespaces).values({
          restaurantId: newId,
          bucket: 'invoice-scans',
          prefix: `${newId}/`,
        });

        const supplierMap = new Map<string, string>();
        if (srcSuppliers.length) {
          await tx.insert(suppliers).values(
            srcSuppliers.map((s) => {
              const id = randomUUID();
              supplierMap.set(s.id, id);
              return {
                id,
                restaurantId: newId,
                name: s.name,
                nameEn: s.nameEn,
                businessId: s.businessId,
                contactEmail: s.contactEmail,
                contactWhatsapp: s.contactWhatsapp,
                paymentTerms: s.paymentTerms,
                vatRate: s.vatRate,
                deliverySchedule: s.deliverySchedule,
                orderSchedule: s.orderSchedule,
                // Platform links (externalRef / sourcePlatform) are per-branch
                // integrations — never copied.
              };
            }),
          );
        }
        const productMap = new Map<string, string>();
        const productRows = srcProducts.filter((p) => !p.supplierId || supplierMap.has(p.supplierId));
        if (productRows.length) {
          await tx.insert(products).values(
            productRows.map((p) => {
              const id = randomUUID();
              productMap.set(p.id, id);
              return {
                id,
                restaurantId: newId,
                supplierId: p.supplierId ? supplierMap.get(p.supplierId)! : null,
                canonicalName: p.canonicalName,
                nameEn: p.nameEn,
                category: p.category,
                defaultUnit: p.defaultUnit,
                barcodeEan: p.barcodeEan,
                embedding: p.embedding,
              };
            }),
          );
        }
        const itemRows = srcItems.filter((i) => supplierMap.has(i.supplierId));
        if (itemRows.length) {
          await tx.insert(supplierCatalogItems).values(
            itemRows.map((i) => ({
              restaurantId: newId,
              supplierId: supplierMap.get(i.supplierId)!,
              productId: i.productId ? (productMap.get(i.productId) ?? null) : null,
              supplierSku: i.supplierSku,
              supplierNameRaw: i.supplierNameRaw,
              unit: i.unit,
              packSize: i.packSize,
              listPrice: i.listPrice,
              currency: i.currency,
              barcodeEan: i.barcodeEan,
              active: i.active,
              observedAt: i.observedAt,
            })),
          );
        }
        const result = {
          suppliers: supplierMap.size,
          products: productMap.size,
          catalogItems: itemRows.length,
        };
        await recordAudit(tx, {
          restaurantId: newId,
          userId,
          action: 'chain.branch_added',
          entityType: 'restaurant',
          entityId: newId,
          after: { name: input.name, copiedFrom: sourceId, settings: input.copySettings, ...result },
        });
        return result;
      });

      return { restaurantId: newId, name: input.name, copied: counts };
    }),
});
