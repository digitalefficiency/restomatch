'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDate } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { recovery } from '@/lib/i18n/messages/recovery';
import { Peek } from '@/lib/components/desk/Peek';
import type { RecoveryStatus } from './logic';

const ROLES = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const;

/**
 * The claim dossier (chain-05): its ₪, the invoice link and the full history —
 * who moved it (name + role in this restaurant), when (dd.MM.yyyy HH:mm,
 * Asia/Jerusalem) and why. Reads `recovery.history` only when opened.
 */
export function ClaimPeek({
  claim,
  onClose,
}: {
  claim: {
    id: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
    supplierLabel: string;
    itemLabel: string;
    amountAgorot: number;
    outstandingAgorot: number;
  } | null;
  onClose: () => void;
}) {
  const t = useT(recovery);
  const locale = useLocale();
  const history = trpc.recovery.history.useQuery({ claimId: claim?.id ?? '' }, { enabled: claim != null });
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const when = (v: string | Date) =>
    formatDate(v, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const roleOf = (r: string | null) => ((ROLES as readonly string[]).includes(r ?? '') ? t(`peek.role.${r as (typeof ROLES)[number]}`) : '');
  return (
    <Peek open={claim != null} title={claim ? `${claim.supplierLabel} · ${claim.itemLabel}` : ''} onClose={onClose}>
      {claim ? (
        <div className="space-y-4 text-sm" data-testid="claim-peek">
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs text-subtle">{t('peek.claimed')}</dt>
              <dd className="text-right font-semibold tabular-nums text-ink">{ils(claim.amountAgorot)}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">{t('peek.owed')}</dt>
              <dd className="text-right font-semibold tabular-nums text-ink">{ils(claim.outstandingAgorot)}</dd>
            </div>
          </dl>
          {claim.invoiceId ? (
            <Link href={`/dashboard/invoices/${claim.invoiceId}`} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
              {t('peek.invoice', { number: claim.invoiceNumber ?? '—' })}
            </Link>
          ) : null}
          <section aria-labelledby="claim-peek-history">
            <h3 id="claim-peek-history" className="mb-2 text-xs font-bold text-ink">
              {t('peek.history')}
            </h3>
            {history.isError ? (
              <p role="alert" className="text-danger">
                {t('actions.failed')}{' '}
                <button type="button" className="font-semibold underline" onClick={() => void history.refetch()}>
                  {t('peek.retry')}
                </button>
              </p>
            ) : !history.data ? (
              <p className="text-muted">{t('peek.loading')}</p>
            ) : (
              <ol className="space-y-2" data-testid="claim-history">
                {history.data.map((e) => (
                  <li key={e.id} className="border-s-2 border-line ps-3">
                    <p className="text-ink">
                      <span className="font-semibold">{t(`status.${e.toStatus as RecoveryStatus}`)}</span>
                      {e.amountAgorot != null ? <span className="tabular-nums"> · {ils(e.amountAgorot)}</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      <bdi>{when(e.createdAt)}</bdi> ·{' '}
                      {e.actorName ? (
                        <>
                          {e.actorName}
                          {e.actorRole ? ` (${roleOf(e.actorRole)})` : ''}
                        </>
                      ) : (
                        t('peek.system')
                      )}
                    </p>
                    {e.note ? <p className="text-xs text-muted">{e.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Peek>
  );
}
