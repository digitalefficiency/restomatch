import { auditLog, type Database } from '@restomatch/db';

/**
 * Anything that can INSERT — the tenant `ctx.db`, the owner `adminDb`, or a
 * transaction handle (`tx`) from `db.transaction(...)`. A bare PgTransaction is
 * not assignable to `Database` (no `$client`), so we depend only on `insert`.
 */
type AuditDb = Pick<Database, 'insert'>;

/**
 * Append-only security/PII audit trail (Epic D2.2 + 0.4).
 *
 * Every sensitive action — plan/billing changes, role changes, invites, member
 * changes — emits exactly one immutable audit_log row recording WHO did WHAT to
 * WHICH entity, with optional before/after images. The row is append-only at the
 * DB level (drizzle/rls/0003_audit_immutable.sql): the tenant app role may
 * INSERT + SELECT but never UPDATE/DELETE.
 *
 * Writes go through whatever connection the caller already holds:
 *   - member/owner procedures pass ctx.db (the RLS-scoped tenant tx). The
 *     audit_log_insert policy requires restaurant_id = the active GUC, so the
 *     restaurantId here MUST be the caller's own restaurant.
 *   - admin / userScoped paths pass the owner connection (bypasses RLS).
 *
 * Amendment-13 access logging duty: this is the canonical, taxonomy-stable entry
 * point — do not hand-roll audit_log inserts in new code.
 */

/**
 * Stable action taxonomy. `<domain>.<event>` — extend deliberately; existing
 * values are part of the audit contract and must not be renamed.
 */
export type AuditAction =
  // Platform admin (cross-tenant, owner connection)
  | 'admin.plan_assigned'
  | 'admin.overrides_set'
  | 'admin.role_set'
  // Team & membership (tenant connection)
  | 'team.member_invited'
  | 'team.invite_resent'
  | 'team.invite_revoked'
  | 'team.invite_accepted'
  | 'team.member_role_changed'
  | 'team.member_removed'
  | 'team.member_locale_changed'
  | 'settings.my_locale_changed'
  // Approvals (already emitted by the approvals router)
  | 'discrepancy.approved'
  | 'discrepancy.rejected'
  | 'discrepancy.escalated'
  // Chain / branches (chain router)
  | 'chain.branch_added'
  | 'chain.branch_renamed'
  // Inventory counts (inventory router, flag inventoryCount)
  | 'inventory.count_closed'
  | 'inventory.count_discarded'
  | 'inventory.line_amended'
  // ── Wave 2 (G-05): pre-added for the lifecycle kernel's adopters, so no
  // adopter edits this file. Values are emitted only once a package adopts
  // the transition. Request new ones through the orchestrator.
  // Invoice lifecycle (lifecycle/machines.ts `invoiceMachine`)
  | 'invoice.approved_for_payment'
  | 'invoice.marked_paid'
  | 'invoice.unmarked_paid'
  | 'invoice.rematch_locked'
  | 'invoice.external_sync'
  | 'invoice.corrected'
  | 'invoice.ocr_parsed'
  | 'invoice.match_completed'
  // Replay records (lib/idempotency.ts interim, until G-03's idempotency_keys)
  | 'idempotency.recorded'
  // Intake, discrepancy decisions, recovery claims
  | 'intake.approved'
  | 'discrepancy.decided'
  | 'discrepancy.reopened'
  | 'recovery.transitioned'
  // Receiving
  | 'receipt.walk_in_confirmed'
  // Settings and team (W2-14)
  | 'settings.updated'
  | 'settings.profile_updated'
  | 'team.ownership_transferred'
  // Integrations (W2-14)
  | 'integrations.accounting_config_changed'
  | 'integrations.pos_import_replaced'
  // Orders (W2-06)
  | 'order.sent'
  | 'order.sent_manually'
  | 'order.amended'
  // Inventory (W2-07)
  | 'inventory.sales_set'
  | 'inventory.count_submitted'
  // Contracts and price alerts (W2-12)
  | 'contracts.price_set'
  | 'contracts.prices_locked'
  | 'price_alert.dismissed'
  | 'price_alert.reopened';

export interface AuditEntry {
  /** Tenant the action belongs to. On a tenant connection this must equal the GUC. */
  restaurantId: string;
  /** Acting user (null for system/automated actions). */
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Prior state, for change events (omit for pure creations). */
  before?: unknown;
  /** New state. */
  after?: unknown;
}

/**
 * Insert one audit row. Pass the SAME db/tx the surrounding mutation uses so the
 * record commits or rolls back atomically with the action it describes.
 */
export async function recordAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    restaurantId: entry.restaurantId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
  });
}
