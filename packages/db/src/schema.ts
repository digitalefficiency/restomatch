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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface RestaurantSettings {
  tolerances?: {
    pricePercent?: number;
    priceAbsolute?: number;
    qtyPercent?: number;
    qtyAbsolute?: number;
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
    externalRef: text('external_ref'),
    sourcePlatform: procurementPlatform('source_platform'),
    deliverySchedule: jsonb('delivery_schedule')
      .$type<DeliverySchedule | null>()
      .default(sql`NULL`),
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
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
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
 * Relations
 * ────────────────────────────────────────────────────────────────────────── */

export const restaurantsRelations = relations(restaurants, ({ many }) => ({
  memberships: many(memberships),
  suppliers: many(suppliers),
  products: many(products),
  purchaseOrders: many(purchaseOrders),
  goodsReceipts: many(goodsReceipts),
  invoices: many(invoices),
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
  purchaseOrders: many(purchaseOrders),
  invoices: many(invoices),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [products.restaurantId],
    references: [restaurants.id],
  }),
  aliases: many(productAliases),
  priceHistory: many(priceHistory),
}));

export const productAliasesRelations = relations(productAliases, ({ one }) => ({
  product: one(products, { fields: [productAliases.productId], references: [products.id] }),
  supplier: one(suppliers, { fields: [productAliases.supplierId], references: [suppliers.id] }),
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
export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PoLine = typeof poLines.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type GrLine = typeof grLines.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type MatchRun = typeof matchRuns.$inferSelect;
export type Discrepancy = typeof discrepancies.$inferSelect;
export type ProcurementConnection = typeof procurementConnections.$inferSelect;
