import Link from 'next/link';
import { Boxes, Upload } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Button, Card, EmptyState } from '@/lib/components';
import { CatalogBrowser } from '../../catalog/browser';

/**
 * Catalog tab — the supplier's price list, scoped via CatalogBrowser's
 * lockedSupplierId (filter dropdown hidden, items locked to this supplier).
 * Empty → a clear "ייבא מחירון" CTA.
 */
export async function SupplierCatalogTab({ supplierId }: { supplierId: string }) {
  const caller = await createServerCaller();
  const [suppliers, initial] = await Promise.all([
    caller.suppliers.list({}),
    caller.catalog.items({ supplierId, limit: 50 }),
  ]);

  const importHref = `/dashboard/catalog/import?supplierId=${supplierId}`;

  if (initial.length === 0) {
    return (
      <Card elevated>
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title="אין מחירון לספק הזה"
          description="ייבאו את מחירון הספק מקובץ Excel/CSV כדי לבנות הזמנות ולהצליב חשבוניות מולו."
          action={
            <Link href={importHref}>
              <Button variant="primary" size="sm">
                <Upload className="h-4 w-4" /> ייבא מחירון
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={importHref}>
          <Button variant="secondary" size="sm">
            <Upload className="h-4 w-4" /> ייבא מחירון
          </Button>
        </Link>
      </div>
      <CatalogBrowser suppliers={suppliers} initial={initial} lockedSupplierId={supplierId} />
    </div>
  );
}
