import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { invoiceScans } from '../index';

/**
 * Guards parity between the Drizzle definition and the live Supabase table /
 * the columns the web app queries (apps/web/lib/supabase/{server,client}.ts).
 * Pure structural test — no database connection required.
 */
describe('invoice_scans schema parity', () => {
  const cols = getTableColumns(invoiceScans);

  it('exposes exactly the expected columns', () => {
    expect(Object.keys(cols).sort()).toEqual(
      [
        'bucket',
        'createdAt',
        'id',
        'invoiceId',
        'mimeType',
        'pageCount',
        'restaurantId',
        'storagePath',
        'supplierName',
      ].sort(),
    );
  });

  it('invoice_id is required; restaurant_id is nullable (current-row parity)', () => {
    expect(cols.invoiceId.notNull).toBe(true);
    expect(cols.restaurantId.notNull).toBe(false);
  });

  it('maps camelCase fields to the snake_case columns the client reads', () => {
    expect(cols.storagePath.name).toBe('storage_path');
    expect(cols.supplierName.name).toBe('supplier_name');
    expect(cols.pageCount.name).toBe('page_count');
    expect(cols.mimeType.name).toBe('mime_type');
  });
});
