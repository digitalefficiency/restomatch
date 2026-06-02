/**
 * Standalone "scanned invoice" page. This URL is what the database row
 * (invoices.raw_image_url) points to — the rest of the UI loads it via
 * an <iframe> so it behaves exactly like fetching a JPG/PDF from object
 * storage in production.
 *
 * Resolution order:
 *   1. Supabase invoice_scans table — a real photo / PDF uploaded by the
 *      receiver, embedded from the bucket's public URL. This is the
 *      production path.
 *   2. (non-production only) showcase demo papers — rendered from mock
 *      fixtures. These are DYNAMICALLY imported so they never ship in the
 *      production bundle, and are disabled in production: prod /scans serves
 *      a real scan or 404s. Set NEXT_PUBLIC_ENABLE_SCAN_MOCKS=1 to force-enable.
 */

import { notFound } from 'next/navigation';
import { InvoicePaper } from '@/app/showcase/dashboard/_components/InvoicePaperShared';
import { resolveUploadedScan } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

type ScanData = React.ComponentProps<typeof InvoicePaper>['data'];

function scanMocksEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_SCAN_MOCKS === '1'
  );
}

export default async function ScanPage({ params }: PageProps) {
  const { invoiceId } = await params;

  // 1. Real uploaded scan in Supabase storage — the production path.
  const uploaded = await resolveUploadedScan(invoiceId);
  if (uploaded) {
    return <UploadedScanCanvas {...uploaded} />;
  }

  // 2. Demo fixtures — never in production.
  if (scanMocksEnabled()) {
    const demo = await loadDemoScan(invoiceId);
    if (demo) {
      return <MockScanCanvas scanData={demo} />;
    }
  }

  notFound();
}

/** Showcase fixtures are imported lazily so they stay out of the prod bundle. */
async function loadDemoScan(invoiceId: string): Promise<ScanData | null> {
  const [{ fromAuditRecord, fromSupplierInvoiceListItem }, { MOCK_INVOICE_AUDITS }, { SUPPLIER_PROFILES }] =
    await Promise.all([
      import('@/app/showcase/dashboard/_components/scanDataAdapters'),
      import('@/app/showcase/dashboard/invoices/_mock'),
      import('@/app/showcase/dashboard/suppliers/[supplierId]/_mock'),
    ]);

  const auditRecord = MOCK_INVOICE_AUDITS.find((r) => r.id === invoiceId);
  if (auditRecord) {
    return fromAuditRecord(auditRecord);
  }
  for (const profile of Object.values(SUPPLIER_PROFILES)) {
    const inv = profile.recentInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      return fromSupplierInvoiceListItem(inv, profile);
    }
  }
  return null;
}

function MockScanCanvas({ scanData }: { scanData: ScanData }) {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center p-8"
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
  const isPdf = mimeType === 'application/pdf';
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8"
      dir="rtl"
      style={{
        background:
          'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0) 0 0 / 24px 24px, linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)',
      }}
    >
      <div className="mb-3 flex w-full max-w-3xl items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 shadow-sm">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate font-mono text-xs text-slate-600">{publicUrl}</span>
        <span className="mr-auto shrink-0 text-[10px] font-semibold text-emerald-700">
          ✓ נטען מ-Supabase Storage
          {pageCount ? ` · ${pageCount} עמודים` : ''}
          {supplierName ? ` · ${supplierName}` : ''}
        </span>
      </div>

      <div className="w-full max-w-3xl overflow-hidden rounded-md bg-white shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45)]">
        {isPdf ? (
          <iframe
            src={`${publicUrl}#toolbar=1&navpanes=0&view=FitH`}
            title="חשבונית סרוקה"
            className="w-full border-0 bg-slate-100"
            style={{ height: '80vh' }}
          />
        ) : (
          <img
            src={publicUrl}
            alt="חשבונית סרוקה"
            className="h-auto w-full"
            style={{ maxHeight: '90vh', objectFit: 'contain' }}
          />
        )}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
          <span className="text-slate-500">לא נטען? יכול להיות חוסם פופאפים או דפדפן ללא תוסף PDF.</span>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:text-primary-hover"
          >
            פתח בטאב נפרד
          </a>
        </div>
      </div>
    </div>
  );
}
