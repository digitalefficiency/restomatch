/**
 * Standalone "scanned invoice" page. This URL is what the database row
 * (invoices.raw_image_url) points to — the rest of the UI loads it via
 * an <iframe> so it behaves exactly like fetching a JPG/PDF from object
 * storage in production.
 *
 * Resolution order:
 *   1. Supabase invoice_scans table — if the receiver has uploaded a real
 *      photo / PDF for this invoice id, embed it from the bucket's public
 *      URL. This is the production-realistic path.
 *   2. MOCK_INVOICE_AUDITS — render the styled mock paper from the audit
 *      record's line data.
 *   3. SUPPLIER_PROFILES.recentInvoices — render the styled mock paper from
 *      synthesised line data.
 *   4. 404 otherwise.
 */

import { notFound } from 'next/navigation';
import { InvoicePaper } from '@/app/showcase/dashboard/_components/InvoicePaperShared';
import {
  fromAuditRecord,
  fromSupplierInvoiceListItem,
} from '@/app/showcase/dashboard/_components/scanDataAdapters';
import { MOCK_INVOICE_AUDITS } from '@/app/showcase/dashboard/invoices/_mock';
import { SUPPLIER_PROFILES } from '@/app/showcase/dashboard/suppliers/[supplierId]/_mock';
import { resolveUploadedScan } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function ScanPage({ params }: PageProps) {
  const { invoiceId } = await params;

  // 1. Real uploaded scan in Supabase storage takes precedence.
  const uploaded = await resolveUploadedScan(invoiceId);
  if (uploaded) {
    return <UploadedScanCanvas {...uploaded} />;
  }

  // 2. Audit records.
  const auditRecord = MOCK_INVOICE_AUDITS.find((r) => r.id === invoiceId);
  if (auditRecord) {
    return <MockScanCanvas scanData={fromAuditRecord(auditRecord)} />;
  }

  // 3. Supplier profile recent invoices.
  for (const profile of Object.values(SUPPLIER_PROFILES)) {
    const inv = profile.recentInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      return <MockScanCanvas scanData={fromSupplierInvoiceListItem(inv, profile)} />;
    }
  }

  notFound();
}

function MockScanCanvas({ scanData }: { scanData: ReturnType<typeof fromAuditRecord> }) {
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

function UploadedScanCanvas({
  publicUrl,
  mimeType,
  pageCount,
  supplierName,
}: {
  publicUrl: string;
  mimeType: string;
  pageCount: number | null;
  supplierName: string | null;
}) {
  // For PDFs use <object> with native viewer; for images use <img>.
  const isPdf = mimeType === 'application/pdf';
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start p-4 sm:p-8"
      dir="rtl"
      style={{
        background:
          'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0) 0 0 / 24px 24px, linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)',
      }}
    >
      {/* Provenance bar — shows this is a real stored document */}
      <div className="max-w-3xl w-full mb-3 flex items-center gap-2 bg-white border border-emerald-200 rounded-full px-4 py-2 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-xs font-mono text-slate-600 truncate">{publicUrl}</span>
        <span className="text-[10px] text-emerald-700 font-semibold mr-auto shrink-0">
          ✓ נטען מ-Supabase Storage
          {pageCount ? ` · ${pageCount} עמודים` : ''}
          {supplierName ? ` · ${supplierName}` : ''}
        </span>
      </div>

      <div className="max-w-3xl w-full bg-white rounded-md shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45)] overflow-hidden">
        {isPdf ? (
          <object
            data={publicUrl}
            type="application/pdf"
            className="w-full"
            style={{ height: '80vh' }}
          >
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-8 text-center text-blue-700 underline"
            >
              הדפדפן לא תומך בתצוגת PDF — לחץ להורדה
            </a>
          </object>
        ) : (
          <img
            src={publicUrl}
            alt="scanned invoice"
            className="w-full h-auto"
            style={{ maxHeight: '90vh', objectFit: 'contain' }}
          />
        )}
      </div>
    </div>
  );
}
