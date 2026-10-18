import { notFound } from 'next/navigation';
import { getWave1Access } from '../access';
import { ContractImportWizard } from './wizard';

export const dynamic = 'force-dynamic';

/**
 * Contract price-list import. `?supplierId=` (from the contracts tab or a
 * supplier's contract tab) pre-selects the supplier. Manager-tier + the
 * `contracts` flag — anyone else gets a 404 (the route is finance-tier in
 * lib/roles.ts, so receiver/chef are already redirected by the middleware).
 */
export default async function ContractImportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string }>;
}) {
  const access = await getWave1Access();
  if (!access.contracts || !access.canManage) notFound();
  const { supplierId } = await searchParams;
  return <ContractImportWizard initialSupplierId={supplierId ?? ''} />;
}
