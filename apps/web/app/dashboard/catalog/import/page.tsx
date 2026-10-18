import { ImportWizard } from './wizard';

/** Catalog import. `?supplierId=` (from a supplier's catalog tab) pre-selects the supplier. */
export default async function CatalogImportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string }>;
}) {
  const { supplierId } = await searchParams;
  return <ImportWizard initialSupplierId={supplierId ?? ''} />;
}
