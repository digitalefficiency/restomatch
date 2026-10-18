import Link from 'next/link';
import { ArrowLeft, FileWarning } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, EmptyState, SectionHeader, displayName } from '@/lib/components';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { getWave1Access } from './access';

const DAYS = 90;

/** Load the 90-day over-contract set; null when the feature/role can't read it (fail silent). */
async function loadOverContract() {
  const access = await getWave1Access();
  if (!access.contracts) return null;
  try {
    const caller = await createServerCaller();
    return await caller.contracts.overContract({ days: DAYS });
  } catch {
    return null;
  }
}

/**
 * "Over contract (90 days)" — every invoice line billed above the contract
 * price in force on its invoice date, with the server-computed total
 * (integer agorot → ₪ for display only).
 *
 * `variant="full"`: the contracts tab (table + empty state).
 * `variant="compact"`: the leak view — renders NOTHING unless there is at least
 * one over-contract line (and nothing when the flag/role is off).
 */
export async function OverContractCard({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const data = await loadOverContract();
  if (!data) return null;
  if (variant === 'compact' && data.lines.length === 0) return null;
  const [t, locale] = await Promise.all([getT(contractsNs), getLocale()]);
  const money = (ils: number) => formatIls(ils, { locale, maximumFractionDigits: 2 });
  const total = formatIls(data.totalOverAgorot / 100, { locale, maximumFractionDigits: 2 });
  const lines = [...data.lines].sort((a, b) => b.overAgorot - a.overAgorot);

  if (variant === 'compact') {
    const top = lines.slice(0, 3);
    return (
      <Card elevated flow padding="md" className="mb-6 border-warn/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-warn">
              <FileWarning className="h-4 w-4" aria-hidden="true" />
              {t('over.leaksTitle')}
            </p>
            <p className="mt-1 text-sm text-muted">
              {t('over.leaksBody', { count: formatNumber(lines.length, locale) })}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <p className="text-xs text-subtle">{t('over.total')}</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-warn">
              <bdi dir="ltr">{total}</bdi>
            </p>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {top.map((l) => (
            <li key={l.invoiceLineId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-ink">
                {displayName(l.productName, l.productNameEn, locale).primary}
                <span className="text-subtle"> · </span>
                <span className="text-muted">
                  {displayName(l.supplierName, l.supplierNameEn, locale).primary}
                </span>
              </span>
              <Badge
                tone="warning"
                className="font-mono tabular-nums"
              >
                <span
                  title={t('over.badgeTitle', {
                    contract: money(l.contractUnitPrice),
                    billed: money(l.billedUnitPrice),
                  })}
                >
                  <bdi dir="ltr">+{formatIls(l.overAgorot / 100, { locale, maximumFractionDigits: 2 })}</bdi>
                </span>
              </Badge>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Link
            href="/dashboard/contracts?tab=contracts"
            className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-primary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {t('over.leaksLink')}
            <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    );
  }

  const shown = lines.slice(0, 50);
  return (
    <section className="mt-10">
      <SectionHeader
        title={t('over.title')}
        subtitle={t('over.subtitle')}
        action={
          <div className="text-end">
            <p className="text-xs text-subtle">{t('over.total')}</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-warn">
              <bdi dir="ltr">{total}</bdi>
            </p>
            <p className="text-xs text-subtle">
              {t('over.lines', { count: formatNumber(data.lineCount ?? lines.length, locale) })}
            </p>
            {data.truncated ? <p className="text-xs text-warn">{t('over.truncated')}</p> : null}
          </div>
        }
      />
      {lines.length === 0 ? (
        <EmptyState
          icon={<FileWarning className="h-6 w-6" />}
          title={t('over.emptyTitle')}
          description={t('over.emptyBody')}
        />
      ) : (
        <Card elevated padding="none" flow className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">{t('over.caption')}</caption>
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colInvoice')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colDate')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colSupplier')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colProduct')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colQty')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colContract')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colBilled')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('over.colOver')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.invoiceLineId} className="border-t border-line transition-colors hover:bg-surface-2/60">
                  <td className="p-3">
                    <Link
                      href={`/dashboard/invoices/${l.invoiceId}`}
                      className="font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {l.invoiceNumber ?? t('over.noNumber')}
                    </Link>
                  </td>
                  <td className="p-3 tabular-nums text-muted">{formatDate(l.invoiceDate, locale)}</td>
                  <td className="p-3 text-muted">
                    {displayName(l.supplierName, l.supplierNameEn, locale).primary}
                  </td>
                  <td className="p-3 font-medium text-ink">
                    {displayName(l.productName, l.productNameEn, locale).primary}
                  </td>
                  <td className="p-3 font-mono tabular-nums text-muted">
                    <bdi dir="ltr">{formatNumber(l.qty, locale, { maximumFractionDigits: 3 })}</bdi>
                  </td>
                  <td className="p-3 font-mono tabular-nums text-muted">
                    <bdi dir="ltr">{money(l.contractUnitPrice)}</bdi>
                  </td>
                  <td className="p-3 font-mono tabular-nums text-ink">
                    <bdi dir="ltr">{money(l.billedUnitPrice)}</bdi>
                  </td>
                  <td className="p-3 font-mono font-semibold tabular-nums text-warn">
                    <bdi dir="ltr">+{formatIls(l.overAgorot / 100, { locale, maximumFractionDigits: 2 })}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length > shown.length ? (
            <p className="border-t border-line p-3 text-xs text-subtle">
              {t('over.more', { count: formatNumber(lines.length - shown.length, locale) })}
            </p>
          ) : null}
        </Card>
      )}
    </section>
  );
}

/** Small "Over contract" pill with a "contract ₪X, billed ₪Y" tooltip (server-rendered). */
function OverContractBadge({ label, title }: { label: string; title: string }) {
  return (
    <span title={title} className="ms-2 inline-flex align-middle">
      <Badge tone="warning">
        {label}
        <span className="sr-only"> — {title}</span>
      </Badge>
    </span>
  );
}

/**
 * Per-line "Over contract" badges for one invoice, keyed by invoice-line id.
 * Empty when the feature is off, the role can't read contracts, or nothing on
 * the invoice is over contract (fail silent — never blocks the invoice view).
 */
export async function overContractBadgesForInvoice(invoiceId: string): Promise<Record<string, React.ReactNode>> {
  const access = await getWave1Access();
  if (!access.contracts) return {};
  let lines: Awaited<ReturnType<Awaited<ReturnType<typeof createServerCaller>>['contracts']['overContractForInvoice']>>;
  try {
    const caller = await createServerCaller();
    lines = await caller.contracts.overContractForInvoice({ invoiceId });
  } catch {
    return {};
  }
  if (lines.length === 0) return {};
  const [t, locale] = await Promise.all([getT(contractsNs), getLocale()]);
  const money = (ils: number) => formatIls(ils, { locale, maximumFractionDigits: 2 });
  const out: Record<string, React.ReactNode> = {};
  for (const l of lines) {
    out[l.invoiceLineId] = (
      <OverContractBadge
        label={t('over.badge')}
        title={t('over.badgeTitle', { contract: money(l.contractUnitPrice), billed: money(l.billedUnitPrice) })}
      />
    );
  }
  return out;
}
