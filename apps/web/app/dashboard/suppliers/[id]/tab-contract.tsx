import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { getWave1Access } from '../../contracts/access';
import { ContractsPanel } from '../../contracts/contracts-panel';

/**
 * Contract tab (wave-1 `contracts`): this supplier's contract prices with the
 * add form + import link, via the shared ContractsPanel locked to the supplier.
 * 404 when the flag is off or the role is not finance-tier (the tab bar hides
 * the tab in that case, so only a hand-typed ?tab=contract lands here).
 */
export async function SupplierContractTab({ supplierId }: { supplierId: string }) {
  const access = await getWave1Access();
  if (!access.contracts) notFound();
  const caller = await createServerCaller();
  const supplier = await caller.suppliers.get({ supplierId });
  return (
    <ContractsPanel
      suppliers={[{ id: supplier.id, name: supplier.name, nameEn: supplier.nameEn }]}
      canManage={access.canManage}
      lockedSupplierId={supplierId}
    />
  );
}
