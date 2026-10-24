import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { createTranslator } from '@/lib/i18n/translate';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { displayName } from '@/lib/components';
import { PrintButton } from '../../../leaks/claims/print-button';
import { loadSupplierLeakCard } from '../leak-card-data';
import { LeakCardBody } from '../leak-card-view';

export const dynamic = 'force-dynamic';

/**
 * "כרטיס ספק למו״מ" — the supplier leak card as ONE A4 page (flag
 * `supplierLeakCard`). Owner/manager like every supplier page; the layout
 * above already 404s a foreign supplier. Print → "Save as PDF" for a file.
 */
export default async function SupplierLeakCardPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await createServerCaller();
  const supplier = await caller.suppliers.get({ supplierId: id });
  if (!supplier.leakCardEnabled) notFound();
  const [card, t, locale, memberships, session] = await Promise.all([
    loadSupplierLeakCard(id),
    getT(suppliersNs),
    getLocale(),
    caller.onboarding.myMemberships(),
    auth(),
  ]);
  const restaurant =
    (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.restaurantName ?? '';
  // The card is handed to an Israeli supplier: always Hebrew RTL, whatever the UI language.
  const th = createTranslator('he', suppliersNs);
  const tah = createTranslator('he', approvalsNs);
  const name = displayName(supplier.name, supplier.nameEn, 'he').primary;
  const Back = locale === 'he' ? ArrowRight : ArrowLeft;

  return (
    <div>
      {/* A4 print: only the card, on white, one page. */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          /* One page whatever the (hidden) dashboard chrome adds below: the card is pinned to page 1. */
          html, body { background: #fff !important; background-image: none !important;
            height: 100% !important; min-height: 0 !important; overflow: hidden !important; }
          body > * { max-height: 100vh !important; overflow: hidden !important; }
          body * { visibility: hidden !important; }
          #supplier-leak-card, #supplier-leak-card * { visibility: visible !important; }
          html::before, html::after, body::before, body::after { display: none !important; }
          /* Pinned to the page box (an ancestor is positioned on screen); one page by design. */
          #supplier-leak-card { position: fixed; top: 0; left: 0; right: 0; width: auto; max-width: none; margin: 0; padding: 0;
            color: #111 !important; background: #fff !important; border: 0 !important; box-shadow: none !important;
            font-size: 11pt; }
          #supplier-leak-card * { color: #111 !important; border-color: #ccc !important; background: transparent !important; box-shadow: none !important; }
          #supplier-leak-card .rm-print-accent { color: #b4123a !important; }
          #supplier-leak-card .rm-bar { background: #b4123a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #supplier-leak-card section { break-inside: avoid; }
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/suppliers/${id}?tab=leak`}
          className="-ms-2 inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Back className="h-4 w-4" aria-hidden="true" /> {t('leakCard.back')}
        </Link>
        <PrintButton label={t('leakCard.printNow')} />
      </div>

      <article
        id="supplier-leak-card"
        lang="he"
        dir="rtl"
        className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-8 shadow-card"
      >
        <header className="mb-6 border-b border-line pb-4">
          <h1 className="text-2xl font-extrabold text-ink">{th('leakCard.printTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{th('leakCard.printSubtitle', { supplier: name, restaurant })}</p>
        </header>
        <LeakCardBody card={card} supplierId={id} locale="he" t={th} ta={tah} print />
        <footer className="mt-6 border-t border-line pt-3 text-xs text-subtle">
          {th('leakCard.printFooter', { date: formatDate(new Date(), 'he', { day: '2-digit', month: '2-digit', year: 'numeric' }) })}
        </footer>
      </article>
    </div>
  );
}
