import { ImportWizard } from './wizard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catalog import. `?supplierId=` (from a supplier's catalog tab) pre-selects the
 * supplier; `?review=<importId>` (from the import history) reopens that import's
 * "בדיקה" — its unlinked rows, which live on the server.
 */
export default async function CatalogImportPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; review?: string }>;
}) {
  const { supplierId, review } = await searchParams;
  return (
    <ImportWizard
      initialSupplierId={supplierId ?? ''}
      reviewImportId={review && UUID.test(review) ? review : undefined}
    />
  );
}
