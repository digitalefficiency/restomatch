CREATE TABLE "invoice_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"restaurant_id" uuid,
	"bucket" text DEFAULT 'invoice-scans' NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"page_count" integer,
	"supplier_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_scans" ADD CONSTRAINT "invoice_scans_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_scans" ADD CONSTRAINT "invoice_scans_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_scans_invoice_idx" ON "invoice_scans" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_scans_restaurant_idx" ON "invoice_scans" USING btree ("restaurant_id");