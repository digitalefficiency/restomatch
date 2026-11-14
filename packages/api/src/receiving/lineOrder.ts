import { asc, sql } from '@restomatch/db';
import type { AnyColumn, SQL } from 'drizzle-orm';

/**
 * receiving-12 · ONE stable line order for the PO, receipt and invoice views,
 * until H-03's `line_no`: the product's category (uncategorised last), then the
 * line's name, then its id (a tie never reshuffles between screens or reloads).
 */
export function lineOrder(category: AnyColumn, name: SQL | AnyColumn, id: AnyColumn): SQL[] {
  return [sql`${category} asc nulls last`, sql`${name} asc nulls last`, asc(id)];
}
