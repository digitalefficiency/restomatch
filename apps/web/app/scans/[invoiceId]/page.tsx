/**
 * Standalone "scanned invoice" page. This URL is what the database row
 * (invoices.raw_image_url) points to — the rest of the UI loads it via
 * an <iframe> so it behaves exactly like fetching a JPG/PDF from
 * Object Storage in production.
 *
 * Resolves the invoice id from either:
 *   - MOCK_INVOICE_AUDITS (audit records — full line data available)
 *   - SUPPLIER_PROFILES recentInvoices (header-only; lines synthesised
 *     from the supplier's top products via fromSupplierInvoiceListItem)
 *
 * Returns 404 if neither source contains the id.
 */

import { notFound } from 'next/navigation';
import { InvoicePaper } from '@/app/showcase/dashboard/_components/InvoicePaperShared';
import {
  fromAuditRecord,
  fromSupplierInvoiceListItem,
} from '@/app/showcase/dashboard/_components/scanDataAdapters';
import { MOCK_INVOICE_AUDITS } from '@/app/showcase/dashboard/invoices/_mock';
import { SUPPLIER_PROFILES } from '@/app/showcase/dashboard/suppliers/[supplierId]/_mock';

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function ScanPage({ params }: PageProps) {
  const { invoiceId } = await params;

  // 1. Try the audit records first (richest data).
  const auditRecord = MOCK_INVOICE_AUDITS.find((r) => r.id === invoiceId);
  if (auditRecord) {
    return <ScanCanvas scanData={fromAuditRecord(auditRecord)} />;
  }

  // 2. Fall back to supplier-profile recent invoices.
  for (const profile of Object.values(SUPPLIER_PROFILES)) {
    const inv = profile.recentInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      return <ScanCanvas scanData={fromSupplierInvoiceListItem(inv, profile)} />;
    }
  }

  notFound();
}

function ScanCanvas({
  scanData,
}: {
  scanData: ReturnType<typeof fromAuditRecord>;
}) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-8"
      style={{
        background:
          'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0) 0 0 / 24px 24px, linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)',
      }}
    >
      <InvoicePaper data={scanData} />
    </div>
  );
}
