import { Link2Off } from 'lucide-react';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { getT } from '@/lib/i18n/server';
import { AuthShell } from '../../(auth)/_components/AuthShell';

/**
 * Unknown or revoked supplier link (auth-17). Portal-scoped: a supplier has no
 * account, so there is no "back to the dashboard" — just what probably happened.
 */
export default async function SupplierLinkNotFound() {
  const t = await getT(supplierConfirm);
  return (
    <AuthShell>
      <div className="text-center">
        <Link2Off className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold text-ink">{t('portal.inactiveTitle')}</h1>
        <p className="mt-2 text-base text-ink">{t('portal.inactiveBody')}</p>
      </div>
    </AuthShell>
  );
}
