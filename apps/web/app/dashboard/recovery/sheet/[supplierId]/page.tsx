import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { Card, SectionHeader } from '@/lib/components';
import { displayName } from '../../../approvals/vocab';
import { PrintButton } from '../../../leaks/claims/print-button';
import { ALL_CLAIMS } from '../../logic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-supplier printable sheet of credit requests (W2-10 acceptance 11): every
 * request of ONE supplier, any status, with its ₪ and dates — the page the
 * owner prints (browser PDF) for a call or a meeting with the supplier.
 * Finance tier (recovery.list); a foreign / unknown supplier is a 404.
 */
export default async function SupplierSheetPage({ params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  if (!UUID_RE.test(supplierId)) notFound();
  const caller = await createServerCaller();
  const flags = await caller.recovery.flags();
  if (!flags.recovery) notFound();
  const [t, locale] = await Promise.all([getT(recoveryNs), getLocale()]);
  const claims = await caller.recovery.list({ supplierId, limit: ALL_CLAIMS });
  if (claims.length === 0) notFound();
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const supplier = displayName(locale, claims[0]!.supplierName, claims[0]!.supplierNameEn) || '—';
  const totals = claims.reduce(
    (a, c) => ({ asked: a.asked + c.amountAgorot, credited: a.credited + c.creditedAgorot, open: a.open + c.outstandingAgorot }),
    { asked: 0, credited: 0, open: 0 },
  );
  return (
    <div className="space-y-4" data-print-root="supplier-sheet">
      <SectionHeader level={1} title={t('sheet.title', { supplier })} action={<PrintButton label={t('sheet.print')} scope="supplier-sheet" />} />
      <Card padding="lg">
        <table className="w-full text-sm" data-testid="supplier-sheet">
          <thead className="border-b border-line text-xs text-subtle">
            <tr>
              <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colInvoice')}</th>
              <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colItem')}</th>
              <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('sheet.date')}</th>
              <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colStatus')}</th>
              <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('peek.claimed')}</th>
              <th scope="col" className="py-2 text-right font-semibold">{t('peek.owed')}</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id} className="border-b border-line/60">
                <td className="py-2 pe-3"><bdi>{c.invoiceNumber ?? '—'}</bdi></td>
                <td className="py-2 pe-3">{displayName(locale, c.productName, c.productNameEn) || displayName(locale, c.lineDescription, c.lineDescriptionEn) || '—'}</td>
                <td className="py-2 pe-3"><bdi>{formatDate(c.letterSentAt ?? c.claimedAt, locale)}</bdi></td>
                <td className="py-2 pe-3">{t(`status.${c.status}`)}</td>
                <td className="py-2 pe-3 text-right tabular-nums">{ils(c.amountAgorot)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{ils(c.outstandingAgorot)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-2" colSpan={4}>{t('sheet.total', { count: String(claims.length) })}</td>
              <td className="pt-2 text-right tabular-nums" data-testid="sheet-asked" data-agorot={totals.asked}>{ils(totals.asked)}</td>
              <td className="pt-2 text-right tabular-nums" data-testid="sheet-open" data-agorot={totals.open}>{ils(totals.open)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}
