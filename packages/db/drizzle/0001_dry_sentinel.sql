ALTER TABLE "suppliers" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "source_platform" "procurement_platform";--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_external_ref_unique" ON "suppliers" USING btree ("source_platform","external_ref");