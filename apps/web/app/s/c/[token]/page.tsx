import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Clock } from 'lucide-react';
import { displayName } from '@/lib/components';
import { formatDate, formatDateTime } from '@/lib/i18n/format';
import { getLocale } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { claimLetterView } from '@/app/api/claims/data';
import { AuthShell } from '../../../(auth)/_components/AuthShell';
import { ClaimAnswerForm, type ClaimFormLine } from './answer-form';
import { claimCopy, fill } from './copy';
import { guardClaimView } from './guard';

export const dynamic = 'force-dynamic';

/** Never indexed; the token must not leak to third parties through Referer. */
export async function generateMetadata(): Promise<Metadata> {
  const c = claimCopy(await getLocale());
  return {
    title: { absolute: `${c.metaTitle} · RestoMatch` },
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <AuthShell>
      <div className="text-center">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-base text-ink">{body}</p>
      </div>
    </AuthShell>
  );
}

/**
 * H-06ʰ — the supplier's reply link for a "מכתב בקשת זיכוי". No account, no
 * session: the signed 72 h token is the credential. Unknown / forged / off ⇒ the
 * portal's own not-found; expired ⇒ explains itself and how to get a new link.
 */
export default async function ClaimLetterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const c = claimCopy(locale);

  if (!(await guardClaimView(await headers()))) return <Shell title={c.inactiveTitle} body={c.rateLimited} />;

  const res = await claimLetterView(token);
  if (!res.ok) {
    if (res.error === 'NOT_FOUND') notFound();
    return <Shell title={c.inactiveTitle} body={c.expiredBody} />;
  }
  const v = res.view;
  const supplier = displayName(v.supplierName ?? "", v.supplierNameEn, locale).primary;
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const lines: ClaimFormLine[] = v.lines.map((l) => ({
    claimId: l.claimId,
    invoice: l.invoiceNumber
      ? l.invoiceDate
        ? fill(c.invoice, { number: l.invoiceNumber, date: formatDate(l.invoiceDate, locale, { dateStyle: 'medium' }) })
        : fill(c.invoiceNoDate, { number: l.invoiceNumber })
      : null,
    item: displayName(l.item ?? "", l.itemEn, locale).primary,
    reason: c.reasons[l.reason],
    amount: ils(l.amountAgorot),
  }));

  return (
    <AuthShell width="xl" plain>
      <p className="text-sm font-semibold text-primary">{c.eyebrow}</p>
      <h1 className="mt-1 text-2xl font-extrabold text-ink sm:text-3xl">{fill(c.title, { restaurant: v.restaurantName })}</h1>
      <div className="mt-3 grid gap-1 text-sm text-ink">
        {v.sentAt ? <p>{fill(c.sentOn, { date: formatDate(v.sentAt, locale, { dateStyle: 'medium' }) })}</p> : null}
        <p className="flex items-center gap-1.5 text-muted">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {fill(c.expires, { date: formatDateTime(v.expiresAt, locale) })}
        </p>
      </div>

      {lines.length === 0 ? (
        <p className="mt-6 text-base text-ink" data-testid="claim-portal-empty">
          {c.empty}
        </p>
      ) : (
        <>
          <p className="mt-5 text-base text-ink">
            {fill(c.intro, { supplier: supplier || '', amount: ils(v.totalAgorot) })}
          </p>
          <p className="mt-2 text-sm text-muted">{c.goodFaith}</p>
          <ClaimAnswerForm
            token={token}
            restaurant={v.restaurantName}
            lines={lines}
            totalText={ils(v.totalAgorot)}
          />
        </>
      )}
      <p className="mt-10 text-center text-sm text-muted">{c.poweredBy}</p>
    </AuthShell>
  );
}
