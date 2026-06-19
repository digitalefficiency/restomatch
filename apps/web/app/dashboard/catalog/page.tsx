import Link from 'next/link';
import { Upload } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Button, SectionHeader } from '@/lib/components';
import { CatalogBrowser } from './browser';

export default async function CatalogPage() {
  const caller = await createServerCaller();
  const [suppliers, initial] = await Promise.all([
    caller.suppliers.list({}),
    caller.catalog.items({ limit: 50 }),
  ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          level={1}
          title="קטלוג"
          subtitle="מחירוני הספקים שלכם — הבסיס לבניית הזמנות ולהצלבת חשבוניות."
        />
        <Link href="/dashboard/catalog/import">
          <Button variant="primary" size="sm">
            <Upload className="h-4 w-4" /> ייבוא קטלוג (Excel/CSV)
          </Button>
        </Link>
      </div>
      <CatalogBrowser suppliers={suppliers} initial={initial} />
    </div>
  );
}
