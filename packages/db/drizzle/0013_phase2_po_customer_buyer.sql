-- Phase 2: dedicated, queryable homes for the buyer-side identifiers on an
-- imported PO (Zestt "מספר הזמנה (לקוח)" 80234-2239 and "מאת" buyer/branch).
-- Nullable text — only set by document import, never required.
ALTER TABLE "purchase_orders" ADD COLUMN "customer_ref" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "buyer_name" text;
