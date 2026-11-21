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

import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, Lock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { InvoicePaper } from '@/app/showcase/dashboard/_components/InvoicePaperShared';
import { resolveScan } from '@/lib/supabase/server';
import { createServerCaller } from '@/lib/trpc/server';
import { getLocale, getT } from '@/lib/i18n/server';
import { dirOf } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import { scans } from '@/lib/i18n/messages/scans';
import { invoices } from '@/lib/i18n/messages/invoices';
import type { Translator } from '@/lib/i18n/translate';

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
  // Role rule = invoices (approvals-51, ia-nav-23): owner, manager, receiver, bookkeeper.
  // The chef never opens a supplier document.
  if (session?.user?.role === 'chef') notFound();

  // 1. Real uploaded scan — requires auth + tenant ownership, served signed.
  //    Accepts a scan id OR an invoice UUID (the correction page links those).
  if (session?.user?.id) {
    const uploaded = await resolveScan(invoiceId, session.user.restaurantId ?? null, async (id) => {
      try {
        const caller = await createServerCaller();
        return (await caller.receiving.getInvoice({ invoiceId: id })).rawImageUrl ?? null;
      } catch {
        return null; // foreign / missing invoice → 404 below
      }
    });
    if (uploaded) {
      const [locale, t, ti] = await Promise.all([getLocale(), getT(scans), getT(invoices)]);
      return <UploadedScanCanvas {...uploaded} invoiceId={invoiceId} backLabel={ti('cockpit.backToInvoice')} t={t} locale={locale} />;
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
  const [{ fromAuditRecord, fromSupplierInvoiceListItem }, { invoiceAudits }, { supplierProfiles }] =
    await Promise.all([
      import('@/app/showcase/dashboard/_components/scanDataAdapters'),
      import('@/app/showcase/dashboard/invoices/_mock'),
      import('@/app/showcase/dashboard/suppliers/[supplierId]/_mock'),
    ]);

  const auditRecord = invoiceAudits().find((r) => r.id === invoiceId);
  if (auditRecord) {
    return fromAuditRecord(auditRecord);
  }
  for (const profile of Object.values(supplierProfiles())) {
    const inv = profile.recentInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      return fromSupplierInvoiceListItem(inv, profile);
    }
  }
  return null;
}

/** The stage: a token surface (no hex — W1-01 tokens only). */
const STAGE = 'bg-surface-2';

function MockScanCanvas({ scanData }: { scanData: ScanData }) {
  return (
    <div
      className={`flex min-h-screen w-full items-center justify-center p-8 ${STAGE}`}
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
  source,
  invoiceId,
  backLabel,
  t,
  locale,
}: {
  invoiceId: string;
  backLabel: string;
  signedUrl: string;
  mimeType: string;
  pageCount: number | null;
  supplierName: string | null;
  source?: 'supabase' | 'local';
  t: Translator<typeof scans.he>;
  locale: 'he' | 'en';
}) {
  const publicUrl = signedUrl;
  const isPdf = mimeType === 'application/pdf';
  const Back = locale === 'he' ? ArrowRight : ArrowLeft;
  return (
    <div
      className={`flex min-h-screen w-full flex-col items-center justify-start p-4 sm:p-8 ${STAGE}`}
      dir={dirOf(locale)}
    >
      <nav aria-label={backLabel} className="mb-3 w-full max-w-3xl">
        <Link
          href={`/dashboard/invoices/${invoiceId}`}
          data-testid="scan-back"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
        >
          <Back className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      </nav>
      <h1 className="sr-only">{t('scannedInvoice')}</h1>
      {/* Secure-link badge — kept prominent: a signed, tenant-scoped document. */}
      <div className="mb-3 flex w-full max-w-3xl items-center gap-2 rounded-full border border-line bg-surface/80 px-4 py-2 shadow-card backdrop-blur">
        <span className="relative inline-flex h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span className="truncate text-xs text-muted">
          {t('scannedInvoice')}
          {supplierName ? ` · ${supplierName}` : ''}
          {source === 'local' ? ` · ${t('localCopy')}` : ''}
        </span>
        <span className="me-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t('secureLink')}
          {pageCount ? ` · ${t('pages', { count: formatNumber(pageCount, locale) })}` : ''}
        </span>
      </div>

      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {isPdf ? (
          <iframe
            src={`${publicUrl}#toolbar=1&navpanes=0&view=FitH`}
            title={t('scannedInvoice')}
            sandbox="allow-same-origin"
            className="h-[80vh] w-full border-0 bg-surface-2"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed / blob URL of a private scan: next/image cannot optimize it
          <img
            src={publicUrl}
            alt={t('scannedInvoice')}
            className="h-auto max-h-[90vh] w-full bg-surface-2 object-contain"
          />
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3 text-xs">
          <span className="text-subtle">{t('notLoading')}</span>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:brightness-110"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {t('openInTab')}
          </a>
        </div>
      </div>
    </div>
  );
}
