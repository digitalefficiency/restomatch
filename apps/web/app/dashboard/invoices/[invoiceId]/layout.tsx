import { notFound } from 'next/navigation';
import { loadDetail } from './load';

/**
 * The existence check runs here, ABOVE this segment's loading.tsx: once the
 * skeleton streams, the status is already 200, so an unknown or foreign invoice
 * must 404 before it (W1-04 perf-states-09). The page reuses the same cached read.
 */
export default async function InvoiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  if (!(await loadDetail(invoiceId))) notFound();
  return children;
}
