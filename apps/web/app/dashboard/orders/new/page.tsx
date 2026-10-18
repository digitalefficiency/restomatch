import { NewOrderWizard } from './wizard';

/**
 * New-order wizard. `?supplierId=` (from the supplier hub's "new order" button)
 * pre-selects the supplier so the manager lands straight on the item picker.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string }>;
}) {
  const { supplierId } = await searchParams;
  return <NewOrderWizard initialSupplierId={supplierId ?? ''} />;
}
