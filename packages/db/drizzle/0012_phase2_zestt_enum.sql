-- Phase 2: register Zestt as its own procurement platform (tailored to us, not
-- conflated with the misspelled 'zester'). ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction on older Postgres and is irreversible — kept ALONE in
-- this migration so the new value is never used in the same step that adds it.
ALTER TYPE "public"."procurement_platform" ADD VALUE IF NOT EXISTS 'zestt';
