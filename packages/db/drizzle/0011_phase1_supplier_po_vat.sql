-- Phase 1 VAT correctness: per-supplier and per-PO VAT-rate overrides so a
-- supplier billing at a non-default rate (e.g. Zestt's 18% vs the 17% default)
-- does not false-fire VAT_MISMATCH. Nullable → fall back to restaurants.vat_rate.
-- Precedence threaded in buildMatchInputForInvoice: po → supplier → restaurant → 0.17.
ALTER TABLE "suppliers" ADD COLUMN "vat_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "vat_rate" numeric(5, 4);
