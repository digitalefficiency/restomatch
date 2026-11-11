import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { ChevronLeft, ChevronRight, ClipboardList, FileWarning } from 'lucide-react';
import { auth } from '@/auth';
import { EmptyState, SectionHeader } from '@/lib/components';
import { StatusChip } from '@/lib/components/feedback';
import { formatDate } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { invoices } from '@/lib/i18n/messages/invoices';
import { createServerCaller } from '@/lib/trpc/server';
import { holdReasonKeys } from './hold-reasons';

export const dynamic = 'force-dynamic';

/**
 * PILOT (train B, W2-02): the invoices waiting for a person to complete their
 * lines — a failed read or a read with no lines — so the owner can find an
 * unread photo invoice without a link. Read-only; each row opens the invoice
 * page, where the lines are added. Owner, manager and bookkeeper (the receiver
 * and chef never: `financeProcedure` + the nav gate). W2-02's register (#217)
 * supersedes this page at integration.
 */
export default async function InvoicesWaitingPage() {
  const [caller, t, locale, session] = await Promise.all([createServerCaller(), getT(invoices), getLocale(), auth()]);
  // The bookkeeper sees these read-only (the owner or manager reviews them).
  const readOnly = session?.user?.role === 'bookkeeper';
  let data;
  try {
    data = await caller.invoices.needsLines();
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') notFound();
    throw err; // the dashboard error boundary: in-shell error with retry, never an empty "nothing waiting"
  }
  const Chevron = locale === 'he' ? ChevronLeft : ChevronRight;
  const date = (d: Date | null) =>
    d ? formatDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.') : null;

  return (
    <div>
      <SectionHeader level={1} title={t('needsLines.title')} subtitle={t('needsLines.subtitle')} />
      {data.rows.length === 0 ? (
        <EmptyState title={t('needsLines.empty')} description={t('needsLines.emptyBody')} />
      ) : (
        <section aria-label={t('needsLines.caption')} data-testid="invoices-needs-lines">
          <p className="mb-3 text-sm text-muted">{t('needsLines.count', { count: data.count })}</p>
          <ul className="space-y-2">
            {data.rows.map((r) => {
              const supplier = (locale === 'en' && r.supplierNameEn ? r.supplierNameEn : r.supplierName) ?? t('needsLines.noSupplier');
              const held = r.reason === 'held';
              return (
                <li key={r.id}>
                  <Link
                    href={`/dashboard/invoices/${r.id}`}
                    data-testid="needs-lines-row"
                    className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
                  >
                    {held ? (
                      // T4: held for review — a neutral icon, never a warning.
                      <ClipboardList className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                    ) : (
                      <FileWarning className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{supplier}</span>
                      <span className="block text-sm text-muted">
                        {[date(r.invoiceDate), r.invoiceNumber ?? t('needsLines.noNumber')].filter(Boolean).join(' · ')}
                      </span>
                      {r.reviewReasons.length > 0 ? (
                        // T4: the review reasons — calm, neutral, one chip per reason, never an alarm
                        // (on a held row, and as extra chips on an unread one).
                        <span className="mt-1 flex flex-wrap gap-1" data-testid="needs-lines-held-reasons">
                          {holdReasonKeys(r.reviewReasons).map((k) => (
                            <StatusChip key={k} tone="neutral" emphasis="subtle" shape="control" icon={null} label={t(`needsLines.held.${k}`)} />
                          ))}
                        </span>
                      ) : null}
                    </span>
                    {held ? null : <StatusChip tone="warn" emphasis="bold" label={t(`needsLines.reason.${r.reason}`)} />}
                    <span className="hidden text-sm font-semibold text-primary sm:inline">{t(readOnly ? 'needsLines.openReadOnly' : held ? 'needsLines.openHeld' : 'needsLines.open')}</span>
                    <Chevron className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
