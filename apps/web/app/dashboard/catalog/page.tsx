import Link from 'next/link';
import { Upload } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Button, SectionHeader } from '@/lib/components';
import { CatalogBrowser } from './browser';

export default async function CatalogPage() {
  const caller = await createServerCaller();
  const [suppliers, initial, memberships, session] = await Promise.all([
    caller.suppliers.list({}),
    caller.catalog.items({ limit: 50 }),
    caller.onboarding.myMemberships(),
    auth(),
  ]);

  // catalog mutations are managerProcedure (owner/manager) — gate the inline
  // add/edit/delete controls on the caller's role on the active restaurant.
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canEdit = active?.role === 'owner' || active?.role === 'manager';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          level={1}
          title="חיפוש מאוחד בקטלוג"
          subtitle="חיפוש אחד לרוחב כל הספקים — מצאו כל מוצר מכל מחירון במקום אחד, הבסיס לבניית הזמנות ולהצלבת חשבוניות."
        />
        <Link href="/dashboard/catalog/import">
          <Button variant="primary" size="sm">
            <Upload className="h-4 w-4" /> ייבוא קטלוג (Excel/CSV)
          </Button>
        </Link>
      </div>
      <CatalogBrowser suppliers={suppliers} initial={initial} canEdit={canEdit} />
    </div>
  );
}
