export { splitSqlStatements, stripSqlComments } from '../sqlStatements';

/**
 * Statements that need an explicit transaction block, or change transaction state.
 * In the Supabase CLI pipeline (no BEGIN) they fail (LOCK: 25P01) or misbehave
 * (SET LOCAL: a WARNING and no effect; BEGIN/COMMIT/SAVEPOINT: break atomicity).
 */
export const NEEDS_TRANSACTION_BLOCK =
  /^\s*(LOCK\b|SAVEPOINT\b|RELEASE\b|ROLLBACK\b|COMMIT\b|END\b|ABORT\b|BEGIN\b|START\s+TRANSACTION\b|SET\s+LOCAL\b|SET\s+TRANSACTION\b|SET\s+CONSTRAINTS\b|DECLARE\b|PREPARE\s+TRANSACTION\b)/i;

/** Statements Postgres refuses inside an implicit (pipeline) transaction. */
export const NOT_IN_PIPELINE =
  /^\s*(VACUUM\b|CREATE\s+DATABASE\b|DROP\s+DATABASE\b|ALTER\s+SYSTEM\b|CREATE\s+TABLESPACE\b|DROP\s+TABLESPACE\b|CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|DROP\s+INDEX\s+CONCURRENTLY\b|REINDEX\b[^;]*\bCONCURRENTLY\b|ALTER\s+TABLE\b[^;]*\bDETACH\s+PARTITION\b[^;]*\bCONCURRENTLY\b)/i;
