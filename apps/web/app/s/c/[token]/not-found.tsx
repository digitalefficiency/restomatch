import { Link2Off } from 'lucide-react';
import { getLocale } from '@/lib/i18n/server';
import { AuthShell } from '../../../(auth)/_components/AuthShell';
import { claimCopy } from './copy';

/**
 * Unknown, forged, or turned-off reply link. The same page for every reason, so
 * a guesser learns nothing; a supplier has no account, so there is no dashboard
 * CTA — just what probably happened and what to do.
 */
export default async function ClaimLinkNotFound() {
  const c = claimCopy(await getLocale());
  return (
    <AuthShell>
      <div className="text-center">
        <Link2Off className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold text-ink">{c.inactiveTitle}</h1>
        <p className="mt-2 text-base text-ink">{c.inactiveBody}</p>
      </div>
    </AuthShell>
  );
}
