-- Wave 3 (outbox double-send safety): add an in-flight 'sending' status so the
-- dispatcher can atomically CLAIM a row (queued -> sending) under FOR UPDATE
-- SKIP LOCKED before dispatching. ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction on older Postgres and the new value cannot be used in the same
-- step that adds it — so it is kept ALONE in this migration (the column + index
-- that the dispatcher uses land in 0016_outbox_dedupe).
ALTER TYPE "public"."notification_status" ADD VALUE IF NOT EXISTS 'sending' BEFORE 'sent';
