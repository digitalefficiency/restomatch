import { auth } from '@/auth';
import { NewOrderWizard } from './wizard';

/**
 * New-order wizard. `?supplierId=` (supplier hub, reminder e-mails) pre-selects the
 * supplier; `?supplier=` is the alias the order-reminder e-mails used to send, so
 * links already in inboxes keep working. `?from=<poId>` is "order again".
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string | string[]; supplier?: string | string[]; from?: string | string[] }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || '';
  const supplierId = one(sp.supplierId) || one(sp.supplier);
  const from = one(sp.from);
  const session = await auth();
  return (
    <NewOrderWizard
      initialSupplierId={supplierId}
      fromPoId={from || undefined}
      restaurantId={session?.user?.restaurantId ?? 'none'}
    />
  );
}
