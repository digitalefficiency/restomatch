import { BookOpen } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { SupplierLedgerTable } from '../ledger-ui';

/** "כרטסת" tab (flag `supplierLedger`): this supplier's delivery notes vs invoices, month by month. */
export async function SupplierLedgerTab({ supplierId }: { supplierId: string }) {
  const caller = await createServerCaller();
  const [data, t] = await Promise.all([caller.suppliers.ledger({ supplierId, months: 6 }), getT(suppliersNs)]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{t('ledger.title')}</h2>
        <LinkButton href="/dashboard/suppliers/ledger" size="sm" variant="secondary">
          <BookOpen className="h-4 w-4" aria-hidden="true" /> {t('ledger.allSuppliers')}
        </LinkButton>
      </div>
      <SupplierLedgerTable data={data} />
      <p className="text-xs text-subtle">{t('ledger.note')}</p>
    </div>
  );
}
