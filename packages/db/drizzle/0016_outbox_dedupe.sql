-- Wave 3 (outbox double-send safety):
--   * dedupe_key + PARTIAL unique index → a producer (e.g. placeOrder writing
--     'po:{poId}:placed') can enqueue a given logical send at most once, so a
--     retried/duplicated producer call cannot double-send a PO to a supplier.
--     The index is PARTIAL (WHERE dedupe_key IS NOT NULL) so legacy/unkeyed
--     rows are never constrained.
--   * claimed_at → stamped by the dispatcher when it atomically claims a row
--     (queued -> 'sending', added in 0015) under FOR UPDATE SKIP LOCKED.
ALTER TABLE "notifications_outbox" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notifications_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_unique" ON "notifications_outbox" USING btree ("dedupe_key") WHERE "notifications_outbox"."dedupe_key" IS NOT NULL;
