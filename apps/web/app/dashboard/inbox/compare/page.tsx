import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { ingest } from '@/lib/i18n/messages/ingest';
import { createServerCaller } from '@/lib/trpc/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * G-09 (round 7): "בדקו את שתיהן יחד" — a page question's two invoices side by
 * side. Both ids are re-read through the caller's tenant-scoped tRPC (a foreign
 * id is a 404); the scans load through the tenant-checked /scans route.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  if (!a || !b || !UUID.test(a) || !UUID.test(b) || a === b) notFound();
  const caller = await createServerCaller();
  const ok = await Promise.all([a, b].map((id) => caller.receiving.getInvoice({ invoiceId: id }).then(() => true, () => false)));
  if (!ok.every(Boolean)) notFound();
  const t = await getT(ingest);
  return (
    <div>
      <SectionHeader level={1} title={t('inbox.compareTitle')} subtitle={t('inbox.compareSubtitle')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[b, a].map((id, i) => (
          <section key={id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">{i === 0 ? t('inbox.compareBefore') : t('inbox.compareThis')}</h2>
              <Link href={`/dashboard/invoices/${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                {t('inbox.openInvoice')}
              </Link>
            </div>
            <iframe
              src={`/scans/${id}`}
              title={i === 0 ? t('inbox.compareBefore') : t('inbox.compareThis')}
              className="h-[70vh] w-full rounded-2xl border border-line bg-surface"
            />
          </section>
        ))}
      </div>
    </div>
  );
}
