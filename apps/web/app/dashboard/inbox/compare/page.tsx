import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { Badge, SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { ingest } from '@/lib/i18n/messages/ingest';
import { formatIls } from '@/lib/money';
import { resolveScan } from '@/lib/supabase/server';
import { createServerCaller } from '@/lib/trpc/server';
import { PageAnswers } from './answers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * G-09 (round 8) · ONE open page question, from any of its invoices
 * (`?invoice=<id>`): the page and the invoice it belongs to / repeats, side by
 * side, with what is at stake (supplier, number, ₪) and the answer itself.
 *
 *  - every id is re-read through the caller's tenant-scoped tRPC (foreign → 404);
 *  - the scans are resolved SERVER-SIDE (tenant-checked, signed) and shown as
 *    <img> / the signed PDF — an app route is never framed (X-Frame-Options DENY);
 *  - 404 when the invoice has no open page question (switch / intake off and
 *    nothing to answer); with one open it is answerable whatever the switches say.
 */
export default async function PageQuestionPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice } = await searchParams;
  if (!invoice || !UUID.test(invoice)) notFound();
  const session = await auth();
  const caller = await createServerCaller();
  const q = await caller.ingest.pageQuestionOf({ invoiceId: invoice }).catch(() => null);
  if (!q) notFound();
  const [locale, t] = await Promise.all([getLocale(), getT(ingest)]);

  const ids = [q.otherInvoiceId, q.pageInvoiceId].filter((id): id is string => Boolean(id) && UUID.test(id!));
  const panels = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const inv = await caller.receiving.getInvoice({ invoiceId: id }).catch(() => null);
      if (!inv) return null;
      const scan = await resolveScan(id, session?.user?.restaurantId ?? null, async () => inv.rawImageUrl ?? null).catch(() => null);
      const total = inv.totalInclVat ?? inv.totalExclVat;
      return {
        id,
        isPage: id === q.pageInvoiceId,
        supplier: (locale === 'en' && inv.supplierNameEn) || inv.supplierName || null,
        number: inv.invoiceNumber ?? null,
        total: total == null ? null : Number(total),
        /** Round 10 (P5): a copy of an invoice already on file — said on the panel, never hidden. */
        duplicateOfNumber: inv.duplicateOf?.invoiceNumber ?? null,
        scan,
      };
    }),
  );
  const shown = panels.filter((p): p is NonNullable<typeof p> => p !== null);
  if (shown.length === 0) notFound();
  const page = shown.find((p) => p.isPage) ?? null;
  const other = shown.find((p) => !p.isPage) ?? null;

  return (
    <div className="space-y-4">
      {/* Round 9 (L15): one invoice only (another supplier / unreadable page) → no "side by side" wording. */}
      <SectionHeader
        level={1}
        title={other ? t('inbox.compareTitle') : t('inbox.compareTitleSingle')}
        subtitle={other ? t('inbox.compareSubtitle') : t('inbox.compareSubtitleSingle')}
      />
      <div className="flex flex-wrap items-center gap-2" role="note">
        <Badge tone={q.pageFlag === 'page_duplicate' ? 'danger-solid' : 'warning-solid'}>
          {q.pageFlag === 'page_duplicate' ? t('inbox.possibleDuplicate') : t('inbox.pageQuestion')}
        </Badge>
        <p className="text-sm text-ink">{t(`errors.${q.pageFlag as 'page_not_merged'}`)}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[other, page].map((p, i) =>
          p ? (
            <section key={p.id} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{i === 0 ? t('inbox.compareBefore') : t('inbox.compareThis')}</h2>
                <Link href={`/dashboard/invoices/${p.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                  {t('inbox.openInvoice')}
                </Link>
              </div>
              {p.duplicateOfNumber ? (
                <Badge tone="danger-solid">{t('inbox.compareDuplicateOf', { number: p.duplicateOfNumber })}</Badge>
              ) : null}
              <p className="text-sm text-muted">
                {[p.supplier, p.number].filter(Boolean).join(' · ') || '—'}
                {p.total !== null ? (
                  <>
                    {' · '}
                    <bdi className="num font-semibold text-ink">{formatIls(p.total, { locale })}</bdi>
                  </>
                ) : null}
              </p>
              {p.scan ? (
                p.scan.mimeType === 'application/pdf' ? (
                  p.scan.source === 'supabase' ? (
                    <iframe src={`${p.scan.signedUrl}#view=FitH`} title={p.number ?? p.id} className="h-[60vh] w-full rounded-xl border border-line bg-stone-100" />
                  ) : (
                    <a href={p.scan.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                      {t('inbox.compareOpenDocument')}
                    </a>
                  )
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed URL of a private scan
                  <img src={p.scan.signedUrl} alt={p.number ?? p.id} className="h-auto max-h-[60vh] w-full rounded-xl border border-line bg-stone-100 object-contain" />
                )
              ) : (
                <p className="text-sm text-subtle">{t('inbox.compareNoScan')}</p>
              )}
            </section>
          ) : null,
        )}
      </div>
      <PageAnswers
        documentId={q.documentId}
        flag={q.pageFlag}
        pageInvoiceId={page?.id ?? null}
        otherInvoiceId={other?.id ?? null}
        otherIncludedIn={q.otherIncludedIn ?? null}
        pageTotal={page?.total ?? null}
        otherTotal={other?.total ?? null}
        supplier={page?.supplier ?? other?.supplier ?? null}
        canManage={session?.user?.role === 'owner' || session?.user?.role === 'manager'}
      />
    </div>
  );
}
