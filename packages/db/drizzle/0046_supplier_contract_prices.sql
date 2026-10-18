-- 0046_supplier_contract_prices (S11 wave-1 `contracts`)
--
-- supplier_contract_prices — the price the owner/manager AGREED with a supplier
-- for one product, valid on a date range. The match-input builder
-- (packages/api/src/match/buildMatchInput.ts) feeds the contract price in force
-- on the invoice date to the engine as the PO line's expected unit price, so an
-- over-contract line becomes a PRICE_HIGHER whose expected value is the contract
-- price (contract takes precedence over the PO price). No engine change.
--
--   unit            the unit the contract price is quoted in (NULL = the product's
--                   unit; converted kg↔g / l↔ml like the engine, else not applied)
--   valid_from/to   calendar dates (restaurant-local), inclusive; valid_to NULL =
--                   open-ended. When several rows cover a date, the LATEST
--                   valid_from wins (a renegotiated price supersedes the old one).
--   source          'manual' | 'import' (CSV/XLSX upload)
--
-- Same-tenant: composite FKs (supplier_id, restaurant_id) → suppliers and
-- (product_id, restaurant_id) → products, so a row can never point at another
-- tenant's supplier/product (RLS-independent). RLS: added to the tenant list in
-- drizzle/rls/0002_core_tenant_rls.sql. Additive only; rollback = DROP TABLE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_id_restaurant_id_key') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_id_restaurant_id_key" UNIQUE ("id","restaurant_id");
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_contract_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "supplier_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "unit" varchar(32),
  "contract_price" numeric(12,4) NOT NULL,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "source" varchar(16) DEFAULT 'manual' NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_contract_prices_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id","restaurant_id")
    REFERENCES "suppliers"("id","restaurant_id") ON DELETE cascade,
  CONSTRAINT "supplier_contract_prices_product_same_tenant_fk" FOREIGN KEY ("product_id","restaurant_id")
    REFERENCES "products"("id","restaurant_id") ON DELETE cascade,
  CONSTRAINT "supplier_contract_prices_price_nonneg" CHECK ("contract_price" >= 0),
  CONSTRAINT "supplier_contract_prices_valid_range" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "supplier_contract_prices_source_check" CHECK ("source" IN ('manual','import'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_contract_prices_key" ON "supplier_contract_prices" ("supplier_id","product_id","valid_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_contract_prices_lookup_idx" ON "supplier_contract_prices" ("restaurant_id","supplier_id","product_id","valid_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_contract_prices_product_idx" ON "supplier_contract_prices" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_contract_prices_created_by_idx" ON "supplier_contract_prices" ("created_by");
--> statement-breakpoint
DROP TRIGGER IF EXISTS "supplier_contract_prices_set_updated_at" ON "supplier_contract_prices";--> statement-breakpoint
CREATE TRIGGER "supplier_contract_prices_set_updated_at" BEFORE UPDATE ON "supplier_contract_prices" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
