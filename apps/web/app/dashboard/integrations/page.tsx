import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { AccountingMapping } from './accounting-mapping';
import { PosImport } from './pos-import';
import { ProcurementProviders } from './procurement';

/**
 * Wave-1 integrations hub (flag `integrations`). Invisible when the flag is
 * off (404). Sections follow the procedures' roles: accounting codes for
 * owner + bookkeeper (owner edits), POS sales + procurement for owner + manager.
 */
export default async function IntegrationsPage() {
  const caller = await createServerCaller();
  const [status, memberships, session, t] = await Promise.all([
    caller.integrations.status(),
    caller.onboarding.myMemberships(),
    auth(),
    getT(integrationsNs),
  ]);
  if (!status.enabled) notFound();
  const role = (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role;
  const finance = role === 'owner' || role === 'bookkeeper';
  const ops = role === 'owner' || role === 'manager';

  return (
    <div className="space-y-8">
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      {finance ? <AccountingMapping canEdit={role === 'owner'} /> : null}
      {ops ? <PosImport /> : null}
      {ops ? <ProcurementProviders /> : null}
    </div>
  );
}
