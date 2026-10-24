import { Printer } from 'lucide-react';
import { Card, LinkButton } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { loadSupplierLeakCard } from './leak-card-data';
import { LeakCardBody } from './leak-card-view';

/** "Leak" tab (flag `supplierLeakCard`): this supplier's last 90 days in ₪, with a printable negotiation card. */
export async function SupplierLeakTab({ supplierId }: { supplierId: string }) {
  const [card, t, ta, locale] = await Promise.all([
    loadSupplierLeakCard(supplierId),
    getT(suppliersNs),
    getT(approvalsNs),
    getLocale(),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{t('leakCard.title')}</h2>
        <LinkButton href={`/dashboard/suppliers/${supplierId}/leak-card`} size="sm" variant="secondary">
          <Printer className="h-4 w-4" aria-hidden="true" /> {t('leakCard.print')}
        </LinkButton>
      </div>
      <Card elevated padding="lg">
        <LeakCardBody card={card} supplierId={supplierId} locale={locale} t={t} ta={ta} />
      </Card>
    </div>
  );
}
