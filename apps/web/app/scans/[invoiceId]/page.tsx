/**
 * Standalone "scanned invoice" page — tenant-private invoice documents.
 *
 * SECURITY: invoice scans contain another business's supplier relationships and
 * pricing. This route requires an authenticated session (also enforced in
 * middleware) and resolves a scan ONLY when its restaurant matches the caller's
 * session, served via a short-lived signed URL. Cross-tenant or unauthenticated
 * requests 404.
 *
 * Resolution order:
 *   1. Supabase invoice_scans — the real uploaded photo/PDF, tenant-scoped and
 *      signed. This is the production path.
 *   2. (non-production only) showcase demo papers from mock fixtures, dynamically
 *      imported so they never ship in the production bundle.
 */

import { ExternalLink, Lock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
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
  const session = await auth();

  // 1. Real uploaded scan — requires auth + tenant ownership, served signed.
  if (session?.user?.id) {
    const uploaded = await resolveUploadedScan(invoiceId, session.user.restaurantId ?? null);
    if (uploaded) {
      return <UploadedScanCanvas {...uploaded} />;
    }
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

/** Dark "command center" stage: near-black canvas with a faint money-green dot
 *  grid + soft top aura, on which the scanned paper floats. */
const STAGE_BG =
  'radial-gradient(circle at 1px 1px, rgba(34,211,154,0.05) 1px, transparent 0) 0 0 / 24px 24px, radial-gradient(120% 60% at 50% 0%, rgba(34,211,154,0.06) 0%, transparent 60%), #0E1512';

function MockScanCanvas({ scanData }: { scanData: ScanData }) {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center p-8"
      style={{ background: STAGE_BG }}
    >
      <InvoicePaper data={scanData} />
    </div>
  );
}

function UploadedScanCanvas({
  signedUrl,
  mimeType,
  pageCount,
  supplierName,
}: {
  signedUrl: string;
  mimeType: string;
  pageCount: number | null;
  supplierName: string | null;
}) {
  const publicUrl = signedUrl;
  const isPdf = mimeType === 'application/pdf';
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8"
      dir="rtl"
      style={{ background: STAGE_BG }}
    >
      {/* Secure-link badge — kept prominent: a signed, tenant-scoped document. */}
      <div className="mb-3 flex w-full max-w-3xl items-center gap-2 rounded-full border border-line bg-surface/80 px-4 py-2 shadow-card backdrop-blur">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="truncate font-mono text-xs text-muted">
          חשבונית סרוקה{supplierName ? ` · ${supplierName}` : ''}
        </span>
        <span className="me-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/25">
          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
          קישור מאובטח
          {pageCount ? ` · ${pageCount} עמודים` : ''}
        </span>
      </div>

      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {isPdf ? (
          <iframe
            src={`${publicUrl}#toolbar=1&navpanes=0&view=FitH`}
            title="חשבונית סרוקה"
            className="w-full border-0 bg-stone-100"
            style={{ height: '80vh' }}
          />
        ) : (
          <img
            src={publicUrl}
            alt="חשבונית סרוקה"
            className="h-auto w-full bg-stone-100"
            style={{ maxHeight: '90vh', objectFit: 'contain' }}
          />
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3 text-xs">
          <span className="text-subtle">לא נטען? יכול להיות חוסם פופאפים או דפדפן ללא תוסף PDF.</span>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:brightness-110"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            פתח בטאב נפרד
          </a>
        </div>
      </div>
    </div>
  );
}
