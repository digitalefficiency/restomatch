import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

/* ──────────────────────────────────────────────────────────────────────────
 * Enums
 * ────────────────────────────────────────────────────────────────────────── */

export const userRole = pgEnum('user_role', [
  'owner',
  'manager',
  'receiver',
  'bookkeeper',
  'chef',
]);

export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

export const poStatus = pgEnum('po_status', [
  'draft',
  'sent',
  'confirmed',
  'partial',
  'closed',
  'cancelled',
]);

export const poSource = pgEnum('po_source', [
  'platform',
  'email',
  'manual',
  'whatsapp',
  'recurring',
]);

/** Channel a manual/outbound PO was transmitted on when placed (null = not transmitted). */
export const poSentChannel = pgEnum('po_sent_channel', ['email', 'whatsapp']);

export const grStatus = pgEnum('gr_status', ['pending', 'partial', 'completed', 'rejected']);

export const invoiceStatus = pgEnum('invoice_status', [
  'ocr_pending',
  'parsed',
  'matched',
  'disputed',
  'approved',
  'paid',
]);

export const invoiceSource = pgEnum('invoice_source', ['photo', 'email', 'platform', 'manual']);

export const matchStatus = pgEnum('match_status', ['clean', 'minor', 'major', 'blocked']);

export const discrepancyType = pgEnum('discrepancy_type', [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
]);

export const severity = pgEnum('severity', ['info', 'warn', 'block']);

export const resolutionStatus = pgEnum('resolution_status', [
  'open',
  'accepted',
  'rejected',
  'escalated',
  'resolved',
]);

export const procurementPlatform = pgEnum('procurement_platform', [
  'marketman',
  'zester',
  'zestt',
  'tabit',
  'yarpa',
  'nash',
  'restigo',
  'restomatch',
]);

export const integrationKind = pgEnum('integration_kind', ['api_rest', 'sftp_csv', 'ftp', 'edi']);

export const approvalAction = pgEnum('approval_action', [
  'auto_approve',
  'queue_review',
  'block',
  'notify',
]);

export const planKey = pgEnum('plan_key', ['trial', 'basic', 'pro', 'chain']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);
export const usageMetric = pgEnum('usage_metric', ['ocr_scans', 'whatsapp_sends']);
export const billingProvider = pgEnum('billing_provider', ['noop', 'grow', 'cardcom']);

/* ──────────────────────────────────────────────────────────────────────────
 * Organization
 * ────────────────────────────────────────────────────────────────────────── */

export const restaurants = pgTable('restaurants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  businessId: varchar('business_id', { length: 32 }),
  vatRate: numeric('vat_rate', { precision: 5, scale: 4 }).notNull().default('0.17'),
  timezone: text('timezone').notNull().default('Asia/Jerusalem'),
  settings: jsonb('settings').$type<RestaurantSettings>().notNull().default({}),
  /** Billing account this restaurant belongs to (a chain shares one). */
  billingAccountId: uuid('billing_account_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface RestaurantSettings {
  tolerances?: {
    pricePercent?: number;
    priceAbsolute?: number;
    qtyPercent?: number;
    qtyAbsolute?: number;
    blockPricePercent?: number;
  };
  /** Per-restaurant approval-routing thresholds (see approvals engine). */
  approvalThresholds?: {
    largeInvoiceWithoutPo?: number;
    unorderedItemSignificant?: number;
    cumulativeLargeAmount?: number;
    cumulativeLargePct?: number;
    cumulativeMediumAmountMin?: number;
    cumulativeMediumPctMin?: number;
  };
  baselineWindowDays?: number;
  /** Confidence below which OCR results are flagged for human review (0-1). */
  ocrReviewThreshold?: number;
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
    name: text('name'),
    image: text('image'),
    phone: varchar('phone', { length: 32 }),
    /** Platform operator (internal ops console). NOT a tenant role. */
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Auth.js (NextAuth v5) tables — required by @auth/drizzle-adapter
 * ────────────────────────────────────────────────────────────────────────── */

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const authenticators = pgTable(
  'authenticators',
  {
    credentialID: text('credential_id').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('provider_account_id').notNull(),
    credentialPublicKey: text('credential_public_key').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credential_device_type').notNull(),
    credentialBackedUp: boolean('credential_backed_up').notNull(),
    transports: text('transports'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.credentialID] })],
);

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.restaurantId, t.role] })],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Team invitations — self-serve email invite → accept-on-login → membership.
 * ────────────────────────────────────────────────────────────────────────── */

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** Destination mailbox, stored canonicalized (lower-cased) for match/dedupe. */
    email: text('email').notNull(),
    /** Role granted on accept. NEVER taken from client input at accept time. */
    role: userRole('role').notNull(),
    /**
     * sha256(raw token) as hex. The raw token lives only in the invite email
     * link, never persisted — a DB/log leak therefore cannot replay an invite.
     */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_unique').on(t.tokenHash),
    // At most one PENDING invite per (restaurant, email). Partial so an
    // accepted/revoked/expired row never blocks re-inviting the same address.
    uniqueIndex('invitations_pending_unique')
      .on(t.restaurantId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('invitations_restaurant_idx').on(t.restaurantId, t.status),
    index('invitations_email_idx').on(t.email),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Credential auth (Epic B/C) — password (argon2id), reset tokens, 2FA.
 *
 * These are an IDENTITY trust zone, NOT tenant data: they carry no
 * restaurant_id and are REVOKE'd in full from the tenant app role
 * (restomatch_app) in packages/db/src/rls.ts. Every read/write goes through the
 * OWNER auth connection (authDb / ctx.adminDb) via server actions / route
 * handlers — never the tenant db / memberProcedure. Password hashing
 * (@restomatch/crypto argon2id) and TOTP secret encryption (AUTH_ENC_KEY) live
 * node-runtime only; the columns here only ever store ciphertext / argon2 PHC
 * strings, never plaintext.
 * ────────────────────────────────────────────────────────────────────────── */

export const userCredentials = pgTable('user_credentials', {
  /** 1:1 with users; the row is created lazily on first set-password / failed login. */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** argon2id PHC string. NULL = no password yet (magic-link-only user). Never plaintext. */
  passwordHash: text('password_hash'),
  passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true }),
  /**
   * Session-revocation epoch. Stamped into the JWT at sign-in and re-compared on
   * every revalidation; bumping it (reset / change-password / "log out
   * everywhere") invalidates every live session for the user.
   */
  tokenVersion: integer('token_version').notNull().default(0),
  /** DB lockout backstop — survives a Redis outage (the Redis limiter fails open). */
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  /** AES-256-GCM ciphertext of the TOTP secret (AUTH_ENC_KEY). NULL = 2FA not enrolled. */
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  /**
   * Last successfully-consumed TOTP time-step (floor(epoch/30) + matched delta).
   * RFC 6238 §5.2 one-time-use: a code whose step is <= this is rejected as a
   * replay, so a TOTP captured in flight cannot be re-used inside its ±1-step
   * (~90s) validity window. Advanced atomically (WHERE totp_last_step < step) so
   * two concurrent submissions of the same code can't both succeed. NULL until
   * the first TOTP is consumed. Recovery codes (already one-time) don't touch it.
   */
  totpLastStep: integer('totp_last_step'),
  /**
   * One-time, short-lived second-factor "pass ticket" (Epic C). After the
   * /login/2fa step verifies a TOTP / recovery code SERVER-SIDE, it mints a
   * random nonce, stores only sha256(nonce) here, and hands the nonce to the
   * Auth.js session update — the jwt callback re-validates it against this hash
   * before clearing twoFactorPending. The client never sees the hash and cannot
   * forge the nonce, so a direct POST to the session-update endpoint cannot
   * bypass the second factor. NULL once consumed / expired.
   */
  twoFactorTicketHash: varchar('two_factor_ticket_hash', { length: 64 }),
  twoFactorTicketExpires: timestamp('two_factor_ticket_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * sha256(raw token) as hex — mirrors invitations.token_hash. The raw token
     * lives only in the reset email link, never persisted, so a DB/log leak
     * cannot replay a reset.
     */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** One-time: set when consumed so a replayed/leaked token is inert. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_token_hash_unique').on(t.tokenHash),
    index('password_reset_tokens_user_idx').on(t.userId),
  ],
);

/** One-time 2FA recovery codes (Epic C). Only sha256(code) is stored. */
export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_recovery_codes_user_code_unique').on(t.userId, t.codeHash),
    index('user_recovery_codes_user_idx').on(t.userId),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Suppliers
 * ────────────────────────────────────────────────────────────────────────── */

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    businessId: varchar('business_id', { length: 32 }),
    contactEmail: text('contact_email'),
    contactWhatsapp: varchar('contact_whatsapp', { length: 32 }),
    paymentTerms: text('payment_terms'),
    /**
     * Per-supplier VAT rate override (e.g. 0.18). Null falls back to the
     * restaurant default. Lets a supplier billing at a non-default rate avoid a
     * spurious VAT_MISMATCH in the engine. See buildMatchInputForInvoice.
     */
    vatRate: numeric('vat_rate', { precision: 5, scale: 4 }),
    externalRef: text('external_ref'),
    sourcePlatform: procurementPlatform('source_platform'),
    deliverySchedule: jsonb('delivery_schedule')
      .$type<DeliverySchedule | null>()
      .default(sql`NULL`),
    /**
     * ACTIONABLE order cadence (Wave 2): order weekdays + cutoff + fulfillment
     * mapping, used to DERIVE expectedDeliveryAt on new POs. Separate from the
     * info-only deliverySchedule above. Shape mirrors `OrderSchedule` in
     * @restomatch/types (validated there at the API edge).
     */
    orderSchedule: jsonb('order_schedule')
      .$type<OrderSchedule | null>()
      .default(sql`NULL`),
    /** Soft-deactivate: a supplier with POs can't be hard-deleted (po.supplierId is onDelete:restrict). */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('suppliers_restaurant_idx').on(t.restaurantId),
    uniqueIndex('suppliers_external_ref_unique').on(t.sourcePlatform, t.externalRef),
  ],
);

export type DeliverySchedule = Partial<
  Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', string[]>
>;

/**
 * ACTIONABLE order cadence persisted on suppliers.order_schedule. Structural
 * mirror of the canonical Zod `OrderSchedule` in @restomatch/types — kept local
 * (like DeliverySchedule) so @restomatch/db stays dependency-free of types.
 * Weekday convention: 0 = Sunday … 6 = Saturday.
 */
export type OrderFulfillment =
  | { kind: 'lead_days'; leadDays: number }
  | { kind: 'next_named_day'; deliversOnDay: number };

export interface OrderWindow {
  orderDays: number[];
  /** 'HH:MM' restaurant-local cutoff. */
  cutoff: string;
  fulfillment: OrderFulfillment;
}

export interface OrderSchedule {
  windows: OrderWindow[];
  tz?: string;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Catalog
 * ────────────────────────────────────────────────────────────────────────── */

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /**
     * Exclusivity FOUNDATION (Wave 4): the supplier that owns this product.
     *
     * NULLABLE in this wave-set — the NOT-NULL flip is DEFERRED post-pilot, so we
     * never block existing rows (legacy products have no owner yet; the backfill
     * script assigns owners or reports needs_owner). The FK is ON DELETE RESTRICT:
     * a supplier that owns products cannot be hard-deleted (mirrors
     * purchase_orders.supplier_id), forcing a soft-deactivate + re-point instead.
     *
     * WARNING: the FK alone does NOT enforce same-tenant — a row could reference a
     * supplier in another restaurant. commitCatalogRows asserts
     * supplier.restaurantId === product.restaurantId at write time.
     *
     * The matcher (matchProductTopN) treats a populated supplier_id as a direct
     * "this supplier sells this product" proof (additive to the existing
     * alias/catalog-item supplier-scope guard); when null it is inert.
     */
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    /**
     * INERT RESERVE (Wave 4): reserved for a future "product group" abstraction
     * (e.g. equivalent SKUs across suppliers collapsing to one logical product for
     * cross-supplier price comparison). NOT referenced by any code or FK this
     * wave — authored now so the later group migration is purely additive and does
     * not require a second column add on the hot products table. NULL until then.
     */
    productGroupId: uuid('product_group_id'),
    canonicalName: text('canonical_name').notNull(),
    category: text('category'),
    defaultUnit: varchar('default_unit', { length: 32 }),
    barcodeEan: varchar('barcode_ean', { length: 32 }),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_restaurant_idx').on(t.restaurantId),
    // Supports the matcher's supplier-scope predicate and per-supplier product
    // lookups once supplier_id is populated.
    index('products_restaurant_supplier_idx').on(t.restaurantId, t.supplierId),
    index('products_embedding_idx').using('ivfflat', t.embedding.op('vector_cosine_ops')),
  ],
);

export const productAliases = pgTable(
  'product_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    supplierSku: varchar('supplier_sku', { length: 64 }),
    supplierNameRaw: text('supplier_name_raw').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('product_aliases_supplier_sku_idx').on(t.supplierId, t.supplierSku),
    index('product_aliases_lookup_idx').on(t.supplierId, t.supplierNameRaw),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Supplier catalog (priced price-list) + bulk imports
 *
 * product_aliases links a supplier's raw name → a canonical product but carries
 * NO price. supplier_catalog_items is the priced price-list: the Excel/CSV import
 * target and the source of unit_price_expected when building a PO from catalog.
 * ────────────────────────────────────────────────────────────────────────── */

export const catalogImportStatus = pgEnum('catalog_import_status', [
  'pending',
  'mapped',
  'committed',
  'failed',
]);

/** Maps canonical catalog fields → the source spreadsheet's column headers. */
export interface CatalogColumnMapping {
  sku?: string;
  name?: string;
  unit?: string;
  price?: string;
  barcode?: string;
  packSize?: string;
}

export const catalogImports = pgTable(
  'catalog_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    status: catalogImportStatus('status').notNull().default('pending'),
    rowCount: integer('row_count').notNull().default(0),
    createdItems: integer('created_items').notNull().default(0),
    updatedItems: integer('updated_items').notNull().default(0),
    columnMapping: jsonb('column_mapping')
      .$type<CatalogColumnMapping>()
      .notNull()
      .default({}),
    error: text('error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('catalog_imports_restaurant_idx').on(t.restaurantId, t.createdAt)],
);

export const supplierCatalogItems = pgTable(
  'supplier_catalog_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    /** Linked canonical product once matched; null until a match is confirmed. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    supplierSku: varchar('supplier_sku', { length: 64 }),
    supplierNameRaw: text('supplier_name_raw').notNull(),
    unit: varchar('unit', { length: 32 }),
    packSize: numeric('pack_size', { precision: 12, scale: 3 }),
    /** Agorot-safe scale, matches po_lines.unit_price_expected / invoice_lines.unit_price_billed. */
    listPrice: numeric('list_price', { precision: 12, scale: 4 }),
    currency: varchar('currency', { length: 3 }).notNull().default('ILS'),
    barcodeEan: varchar('barcode_ean', { length: 32 }),
    active: boolean('active').notNull().default(true),
    sourceImportId: uuid('source_import_id').references(() => catalogImports.id, {
      onDelete: 'set null',
    }),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplier_catalog_items_restaurant_supplier_idx').on(t.restaurantId, t.supplierId),
    // Plain unique: Postgres treats NULL skus as distinct, so multiple no-SKU
    // rows per supplier are allowed (deduped by name/barcode in app logic),
    // while real (supplier, sku) pairs are unique. Mirrors suppliers_external_ref_unique.
    uniqueIndex('supplier_catalog_items_sku_unique').on(t.supplierId, t.supplierSku),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Purchase Orders
 * ────────────────────────────────────────────────────────────────────────── */

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    expectedDeliveryAt: timestamp('expected_delivery_at', { withTimezone: true }),
    status: poStatus('status').notNull().default('draft'),
    source: poSource('source').notNull().default('manual'),
    sourcePlatform: procurementPlatform('source_platform'),
    sourceRef: text('source_ref'),
    totalEstimated: numeric('total_estimated', { precision: 12, scale: 2 }),
    /**
     * Per-PO VAT rate as printed on the imported order (e.g. 0.18). Wins over the
     * supplier/restaurant default when reconciling this order's invoice.
     */
    vatRate: numeric('vat_rate', { precision: 5, scale: 4 }),
    /** Buyer-side order number on an imported PO (Zestt "מספר הזמנה (לקוח)"). */
    customerRef: text('customer_ref'),
    /** Buyer/branch name as printed on an imported PO (Zestt "מאת"). */
    buyerName: text('buyer_name'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    /** Outbound placement: set when a manual draft is placed (status → sent). */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentChannel: poSentChannel('sent_channel'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('po_restaurant_delivery_idx').on(t.restaurantId, t.expectedDeliveryAt),
    index('po_supplier_idx').on(t.supplierId),
    uniqueIndex('po_source_ref_unique').on(t.sourcePlatform, t.sourceRef),
  ],
);

export const poLines = pgTable(
  'po_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /**
     * Supplier catalog number (מק״ט) as printed on the order, when present.
     * The stable per-supplier key the engine pairs on before productId — see
     * matchBySku in @restomatch/catalog. Kept even when productId is unresolved
     * so the line can be mapped later without re-importing the PO.
     */
    supplierSku: varchar('supplier_sku', { length: 64 }),
    rawDescription: text('raw_description'),
    qtyOrdered: numeric('qty_ordered', { precision: 12, scale: 3 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    unitPriceExpected: numeric('unit_price_expected', { precision: 12, scale: 4 }),
    notes: text('notes'),
  },
  (t) => [index('po_lines_po_idx').on(t.poId)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Goods Receipts
 * ────────────────────────────────────────────────────────────────────────── */

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    status: grStatus('status').notNull().default('pending'),
    photos: jsonb('photos').$type<string[]>().notNull().default([]),
    signatureUrl: text('signature_url'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gr_restaurant_idx').on(t.restaurantId, t.receivedAt)],
);

export const grLines = pgTable(
  'gr_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grId: uuid('gr_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    poLineId: uuid('po_line_id').references(() => poLines.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    qtyReceived: numeric('qty_received', { precision: 12, scale: 3 }).notNull(),
    qtyRejected: numeric('qty_rejected', { precision: 12, scale: 3 }).notNull().default('0'),
    rejectReason: text('reject_reason'),
    conditionNotes: text('condition_notes'),
    photos: jsonb('photos').$type<string[]>().notNull().default([]),
  },
  (t) => [index('gr_lines_gr_idx').on(t.grId)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Invoices
 * ────────────────────────────────────────────────────────────────────────── */

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    invoiceNumber: text('invoice_number'),
    invoiceDate: timestamp('invoice_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    totalExclVat: numeric('total_excl_vat', { precision: 12, scale: 2 }),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }),
    totalInclVat: numeric('total_incl_vat', { precision: 12, scale: 2 }),
    allocationNumber: text('allocation_number'),
    currency: varchar('currency', { length: 3 }).notNull().default('ILS'),
    rawImageUrl: text('raw_image_url'),
    rawPdfUrl: text('raw_pdf_url'),
    rawHash: varchar('raw_hash', { length: 64 }),
    ocrPayload: jsonb('ocr_payload').$type<OcrPayload | null>().default(sql`NULL`),
    ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
    status: invoiceStatus('status').notNull().default('ocr_pending'),
    source: invoiceSource('source').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_restaurant_status_idx').on(t.restaurantId, t.status),
    uniqueIndex('invoices_dedupe_idx').on(t.supplierId, t.invoiceNumber),
  ],
);

export interface OcrPayload {
  provider: 'document_ai' | 'claude_vision' | 'reconciled';
  raw: unknown;
  reconciledAt?: string;
}

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /**
     * Supplier catalog number (מק״ט) as extracted from the invoice, when present.
     * Persisted from the OCR pipeline (previously dropped) so invoice lines pair
     * to PO/catalog rows by SKU even when name matching is ambiguous.
     */
    supplierSku: varchar('supplier_sku', { length: 64 }),
    rawDescription: text('raw_description').notNull(),
    qtyBilled: numeric('qty_billed', { precision: 12, scale: 3 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    unitPriceBilled: numeric('unit_price_billed', { precision: 12, scale: 4 }).notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric('vat_rate', { precision: 5, scale: 4 }),
    ocrConfidenceLine: numeric('ocr_confidence_line', { precision: 4, scale: 3 }),
  },
  (t) => [index('invoice_lines_invoice_product_idx').on(t.invoiceId, t.productId)],
);

/**
 * Uploaded invoice scans (photo / PDF) stored in Supabase Storage. The receiver
 * mobile flow inserts a row here after upload; the /scans/[invoiceId] page reads
 * it to embed the file from the bucket. Codifies the table that previously lived
 * only in the Supabase dashboard so it travels with migrations.
 *
 * NOTE: restaurantId is nullable for parity with current rows (the browser
 * uploader does not yet set it). The per-restaurant RLS migration
 * (drizzle/rls/0002_core_tenant_rls.sql) backfills + tightens it during the
 * Phase-3 Supabase consolidation.
 */
export const invoiceScans = pgTable(
  'invoice_scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    restaurantId: uuid('restaurant_id').references(() => restaurants.id, {
      onDelete: 'cascade',
    }),
    bucket: text('bucket').notNull().default('invoice-scans'),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    pageCount: integer('page_count'),
    supplierName: text('supplier_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoice_scans_invoice_idx').on(t.invoiceId),
    index('invoice_scans_restaurant_idx').on(t.restaurantId),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Matching engine
 * ────────────────────────────────────────────────────────────────────────── */

export const matchRuns = pgTable(
  'match_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    grId: uuid('gr_id').references(() => goodsReceipts.id, { onDelete: 'set null' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    overallStatus: matchStatus('overall_status').notNull(),
    totalDiscrepancyAmount: numeric('total_discrepancy_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
  },
  (t) => [index('match_runs_restaurant_idx').on(t.restaurantId, t.runAt)],
);

export const discrepancies = pgTable(
  'discrepancies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    matchRunId: uuid('match_run_id')
      .notNull()
      .references(() => matchRuns.id, { onDelete: 'cascade' }),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    type: discrepancyType('type').notNull(),
    severity: severity('severity').notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    poLineId: uuid('po_line_id').references(() => poLines.id, { onDelete: 'set null' }),
    grLineId: uuid('gr_line_id').references(() => grLines.id, { onDelete: 'set null' }),
    invoiceLineId: uuid('invoice_line_id').references(() => invoiceLines.id, {
      onDelete: 'set null',
    }),
    expectedValue: numeric('expected_value', { precision: 12, scale: 4 }),
    actualValue: numeric('actual_value', { precision: 12, scale: 4 }),
    deltaAmount: numeric('delta_amount', { precision: 12, scale: 2 }),
    toleranceUsed: text('tolerance_used'),
    requiresRole: userRole('requires_role'),
    /** Approval rule that routed this discrepancy (decision audit / explainability). */
    ruleId: text('rule_id'),
    ruleName: text('rule_name'),
    resolutionStatus: resolutionStatus('resolution_status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discrepancies_queue_idx').on(
      t.restaurantId,
      t.resolutionStatus,
      t.severity,
      t.createdAt,
    ),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Activity feed — denormalized timeline of what happened, per restaurant.
 * ────────────────────────────────────────────────────────────────────────── */

export const activityEventType = pgEnum('activity_event_type', [
  'invoice_received',
  'invoice_matched',
  'discrepancy_approved',
  'discrepancy_rejected',
  'alias_learned',
  'sync_completed',
]);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    eventType: activityEventType('event_type').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    detail: text('detail'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_events_restaurant_created_idx').on(t.restaurantId, t.createdAt)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Pricing analytics
 * ────────────────────────────────────────────────────────────────────────── */

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4 }).notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }),
    sourceInvoiceId: uuid('source_invoice_id').references(() => invoices.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('price_history_lookup_idx').on(t.productId, t.supplierId, t.observedAt)],
);

export const priceBaselines = pgTable(
  'price_baselines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'cascade' }),
    windowDays: integer('window_days').notNull(),
    p50: numeric('p50', { precision: 12, scale: 4 }),
    p90: numeric('p90', { precision: 12, scale: 4 }),
    mean: numeric('mean', { precision: 12, scale: 4 }),
    stddev: numeric('stddev', { precision: 12, scale: 4 }),
    sampleSize: integer('sample_size').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('price_baselines_unique_idx').on(
      t.productId,
      t.supplierId,
      t.windowDays,
    ),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Approvals + audit
 * ────────────────────────────────────────────────────────────────────────── */

export const approvalRules = pgTable('approval_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  conditionJsonlogic: jsonb('condition_jsonlogic').notNull(),
  requiredRole: userRole('required_role'),
  autoAction: approvalAction('auto_action').notNull(),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.at)],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Integrations
 * ────────────────────────────────────────────────────────────────────────── */

export const procurementConnections = pgTable(
  'procurement_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    platform: procurementPlatform('platform').notNull(),
    credentialsVaultRef: text('credentials_vault_ref').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    syncCursor: text('sync_cursor'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('procurement_connections_unique_idx').on(t.restaurantId, t.platform)],
);

export const emailInboxes = pgTable('email_inboxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  emailAddress: text('email_address').notNull(),
  oauthTokensVaultRef: text('oauth_tokens_vault_ref'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  parseRules: jsonb('parse_rules').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierIntegrations = pgTable('supplier_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  kind: integrationKind('kind').notNull(),
  credentialsVaultRef: text('credentials_vault_ref').notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * Notifications outbox
 * ────────────────────────────────────────────────────────────────────────── */

export const notificationChannel = pgEnum('notification_channel', [
  'whatsapp',
  'push',
  'email',
]);

export const notificationStatus = pgEnum('notification_status', [
  'queued',
  // In-flight: a worker has atomically claimed the row (FOR UPDATE SKIP
  // LOCKED) and is dispatching it. Prevents a second worker from re-claiming.
  'sending',
  'sent',
  'failed',
  'cancelled',
]);

export const notificationsOutbox = pgTable(
  'notifications_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    target: text('target').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>().default(sql`NULL`),
    status: notificationStatus('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    relatedEntityType: text('related_entity_type'),
    relatedEntityId: uuid('related_entity_id'),
    /**
     * Idempotency key for the producer. When set, a PARTIAL unique index
     * guarantees a given logical send (e.g. `po:{poId}:placed`) is enqueued at
     * most once — so a retried/duplicated producer call cannot double-send a PO
     * to a supplier. NULL rows are not deduped (the partial index ignores them).
     */
    dedupeKey: text('dedupe_key'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_status_scheduled_idx').on(t.status, t.scheduledAt),
    index('notifications_related_idx').on(t.relatedEntityType, t.relatedEntityId),
    uniqueIndex('notifications_dedupe_key_unique')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);

/* ──────────────────────────────────────────────────────────────────────────
 * Billing & entitlements
 * ────────────────────────────────────────────────────────────────────────── */

/** Per-plan hard limits. null = unlimited on that axis. */
export interface PlanLimits {
  invoicesPerMonth: number | null;
  restaurants: number | null;
  seatsPerRestaurant: number | null;
}

/** Feature flags gated by plan tier. */
export type FeatureKey =
  | 'integrations'
  | 'whatsapp_alerts'
  | 'advanced_analytics'
  | 'accounting_export';

/** Admin per-tenant overrides layered on top of the plan. */
export interface SubscriptionOverrides {
  limits?: Partial<PlanLimits>;
  features?: FeatureKey[];
}

export const billingAccounts = pgTable('billing_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  provider: billingProvider('provider').notNull().default('noop'),
  providerCustomerRef: text('provider_customer_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: planKey('key').notNull().unique(),
  nameHe: text('name_he').notNull(),
  priceAgorotMonthly: integer('price_agorot_monthly').notNull().default(0),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: text('features').array().$type<FeatureKey[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatus('status').notNull().default('trialing'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    providerSubscriptionRef: text('provider_subscription_ref'),
    overrides: jsonb('overrides').$type<SubscriptionOverrides>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('subscriptions_account_idx').on(t.billingAccountId)],
);

/** Time-windowed usage counters; incremented atomically per (account, period, metric). */
export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 7 }).notNull(), // YYYY-MM
    metric: usageMetric('metric').notNull(),
    used: integer('used').notNull().default(0),
  },
  (t) => [uniqueIndex('usage_counters_unique_idx').on(t.billingAccountId, t.period, t.metric)],
);

/** Idempotent log of billing-provider webhook events. */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingAccountId: uuid('billing_account_id').references(() => billingAccounts.id, {
      onDelete: 'set null',
    }),
    provider: billingProvider('provider').notNull(),
    eventType: text('event_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('billing_events_account_idx').on(t.billingAccountId)],
);

/** Marketing-landing lead capture. Not tenant-scoped (pre-customer). */
export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  restaurantName: text('restaurant_name'),
  monthlyProcurementAgorot: integer('monthly_procurement_agorot'),
  source: text('source'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * Relations
 * ────────────────────────────────────────────────────────────────────────── */

export const restaurantsRelations = relations(restaurants, ({ one, many }) => ({
  billingAccount: one(billingAccounts, {
    fields: [restaurants.billingAccountId],
    references: [billingAccounts.id],
  }),
  memberships: many(memberships),
  suppliers: many(suppliers),
  products: many(products),
  purchaseOrders: many(purchaseOrders),
  goodsReceipts: many(goodsReceipts),
  invoices: many(invoices),
}));

export const billingAccountsRelations = relations(billingAccounts, ({ one, many }) => ({
  owner: one(users, { fields: [billingAccounts.ownerUserId], references: [users.id] }),
  restaurants: many(restaurants),
  subscription: one(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  billingAccount: one(billingAccounts, {
    fields: [subscriptions.billingAccountId],
    references: [billingAccounts.id],
  }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export const usageCountersRelations = relations(usageCounters, ({ one }) => ({
  billingAccount: one(billingAccounts, {
    fields: [usageCounters.billingAccountId],
    references: [billingAccounts.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  restaurant: one(restaurants, {
    fields: [memberships.restaurantId],
    references: [restaurants.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [suppliers.restaurantId],
    references: [restaurants.id],
  }),
  aliases: many(productAliases),
  catalogItems: many(supplierCatalogItems),
  purchaseOrders: many(purchaseOrders),
  invoices: many(invoices),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [products.restaurantId],
    references: [restaurants.id],
  }),
  // Exclusivity owner (Wave 4); null until backfilled / assigned at import time.
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
  }),
  aliases: many(productAliases),
  catalogItems: many(supplierCatalogItems),
  priceHistory: many(priceHistory),
}));

export const productAliasesRelations = relations(productAliases, ({ one }) => ({
  product: one(products, { fields: [productAliases.productId], references: [products.id] }),
  supplier: one(suppliers, { fields: [productAliases.supplierId], references: [suppliers.id] }),
}));

export const supplierCatalogItemsRelations = relations(supplierCatalogItems, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [supplierCatalogItems.restaurantId],
    references: [restaurants.id],
  }),
  supplier: one(suppliers, {
    fields: [supplierCatalogItems.supplierId],
    references: [suppliers.id],
  }),
  product: one(products, {
    fields: [supplierCatalogItems.productId],
    references: [products.id],
  }),
  import: one(catalogImports, {
    fields: [supplierCatalogItems.sourceImportId],
    references: [catalogImports.id],
  }),
}));

export const catalogImportsRelations = relations(catalogImports, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [catalogImports.restaurantId],
    references: [restaurants.id],
  }),
  supplier: one(suppliers, {
    fields: [catalogImports.supplierId],
    references: [suppliers.id],
  }),
  items: many(supplierCatalogItems),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [purchaseOrders.restaurantId],
    references: [restaurants.id],
  }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  lines: many(poLines),
  goodsReceipts: many(goodsReceipts),
}));

export const poLinesRelations = relations(poLines, ({ one }) => ({
  po: one(purchaseOrders, { fields: [poLines.poId], references: [purchaseOrders.id] }),
  product: one(products, { fields: [poLines.productId], references: [products.id] }),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [goodsReceipts.restaurantId],
    references: [restaurants.id],
  }),
  po: one(purchaseOrders, { fields: [goodsReceipts.poId], references: [purchaseOrders.id] }),
  lines: many(grLines),
}));

export const grLinesRelations = relations(grLines, ({ one }) => ({
  gr: one(goodsReceipts, { fields: [grLines.grId], references: [goodsReceipts.id] }),
  poLine: one(poLines, { fields: [grLines.poLineId], references: [poLines.id] }),
  product: one(products, { fields: [grLines.productId], references: [products.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [invoices.restaurantId],
    references: [restaurants.id],
  }),
  supplier: one(suppliers, { fields: [invoices.supplierId], references: [suppliers.id] }),
  lines: many(invoiceLines),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  product: one(products, { fields: [invoiceLines.productId], references: [products.id] }),
}));

export const matchRunsRelations = relations(matchRuns, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [matchRuns.restaurantId],
    references: [restaurants.id],
  }),
  po: one(purchaseOrders, { fields: [matchRuns.poId], references: [purchaseOrders.id] }),
  gr: one(goodsReceipts, { fields: [matchRuns.grId], references: [goodsReceipts.id] }),
  invoice: one(invoices, { fields: [matchRuns.invoiceId], references: [invoices.id] }),
  discrepancies: many(discrepancies),
}));

export const discrepanciesRelations = relations(discrepancies, ({ one }) => ({
  matchRun: one(matchRuns, { fields: [discrepancies.matchRunId], references: [matchRuns.id] }),
  product: one(products, { fields: [discrepancies.productId], references: [products.id] }),
  invoiceLine: one(invoiceLines, {
    fields: [discrepancies.invoiceLineId],
    references: [invoiceLines.id],
  }),
}));

/* ──────────────────────────────────────────────────────────────────────────
 * Inferred types
 * ────────────────────────────────────────────────────────────────────────── */

export type UserRole = 'owner' | 'manager' | 'receiver' | 'bookkeeper' | 'chef';

export type Restaurant = typeof restaurants.$inferSelect;
export type NewRestaurant = typeof restaurants.$inferInsert;
export type User = typeof users.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type SupplierCatalogItem = typeof supplierCatalogItems.$inferSelect;
export type NewSupplierCatalogItem = typeof supplierCatalogItems.$inferInsert;
export type CatalogImport = typeof catalogImports.$inferSelect;
export type NewCatalogImport = typeof catalogImports.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type NewPoLine = typeof poLines.$inferInsert;
export type PoLine = typeof poLines.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type GrLine = typeof grLines.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type MatchRun = typeof matchRuns.$inferSelect;
export type Discrepancy = typeof discrepancies.$inferSelect;
export type ProcurementConnection = typeof procurementConnections.$inferSelect;
export type BillingAccount = typeof billingAccounts.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
