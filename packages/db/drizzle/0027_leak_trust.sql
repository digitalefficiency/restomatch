-- 0027 — leak trust, wave 0/1 (plan v2): M4 VAT default 18% + M7 one goods receipt per PO.
--
-- M4: Israel's standard VAT rate has been 18% since 2025-01-01. The schema default
-- (and buildMatchInput's fallback) said 17%, so every restaurant onboarded without
-- touching settings got a VAT_MISMATCH warning on essentially every invoice
-- (~1% of the subtotal booked as "leak"). Rows still holding the untouched old
-- default are corrected; any other explicitly configured rate is left alone.
--
-- M7: startReceipt is documented idempotent but used select-then-insert; a
-- double-tap / two receivers created two goods receipts for one PO and
-- buildMatchInput then fed both gr_lines sets to the engine, doubling the
-- received quantity. A partial unique index makes the DB the arbiter. Walk-in /
-- invoice-first receipts (po_id NULL) stay unconstrained.
--
-- PRECONDITION (fails loudly, intended): no PO may already have two receipts.
-- Repair first, keeping the receipt that has lines / the earliest one:
--   select restaurant_id, po_id, array_agg(id order by received_at) as ids
--   from goods_receipts where po_id is not null
--   group by 1, 2 having count(*) > 1;
--   -- then delete the empty/newer duplicates (their gr_lines cascade).
--
-- Hand-written (drizzle-kit generate is broken in this repo).
ALTER TABLE "restaurants" ALTER COLUMN "vat_rate" SET DEFAULT '0.18';--> statement-breakpoint
UPDATE "restaurants" SET "vat_rate" = 0.18 WHERE "vat_rate" = 0.17;--> statement-breakpoint
DO $$
DECLARE dup bigint;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM goods_receipts WHERE po_id IS NOT NULL GROUP BY restaurant_id, po_id HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'goods_receipts: % purchase order(s) have more than one receipt — merge/delete the duplicates before applying goods_receipts_po_unique (see 0027 header)', dup;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goods_receipts_po_unique" ON "goods_receipts" USING btree ("restaurant_id","po_id") WHERE po_id IS NOT NULL;
