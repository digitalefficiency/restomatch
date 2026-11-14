import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { formatNumber } from '@/lib/i18n/format';
import { AccountingMapping } from './accounting-mapping';
import { PosImport } from './pos-import';
import { ProcurementProviders } from './procurement';
import { HubStatusBoard, type HubTileView } from './_hub/HubStatus';
import { procurementTiles } from './_hub/hub';

/**
 * Integrations hub (flag `integrations`). Invisible when the flag is off (404).
 * W3-07a: a "חיבורים" status board on top — four groups (הנהלת חשבונות · קופה ·
 * רכש · קליטת חשבוניות), a chip and last sync per connection — then the existing
 * sections. Each source is read only for the roles its procedure allows; a
 * source that refuses (role, flag) simply leaves its tile out.
 */
/** A source the role or a flag refuses leaves its tile out; any other failure is real and surfaces. */
function refusedOnly<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((err: unknown) => {
    if (err instanceof TRPCError && (err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND')) return null;
    throw err;
  });
}

export default async function IntegrationsPage() {
  const caller = await createServerCaller();
  const [status, memberships, session, t, locale] = await Promise.all([
    caller.integrations.status(),
    caller.onboarding.myMemberships(),
    auth(),
    getT(integrationsNs),
    getLocale(),
  ]);
  if (!status.enabled) notFound();
  const role = (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role;
  const finance = role === 'owner' || role === 'bookkeeper';
  const ops = role === 'owner' || role === 'manager';
  const intakeRole = role === 'owner' || role === 'manager' || role === 'bookkeeper';

  const [accounting, posImports, providers, intake] = await Promise.all([
    finance ? refusedOnly(caller.integrations.accountingConfig()) : null,
    ops ? refusedOnly(caller.integrations.posImports()) : null,
    ops ? refusedOnly(caller.integrations.procurementProviders()) : null,
    intakeRole ? refusedOnly(caller.ingest.overview()) : null,
  ]);

  const tiles: HubTileView[] = [];
  if (accounting) {
    tiles.push({
      key: 'accounting',
      group: 'accounting',
      status: accounting.lastChange ? 'connected' : 'not_connected',
      lastSyncAt: accounting.lastChange ? new Date(accounting.lastChange.at) : null,
      href: '#accounting',
    });
  }
  if (posImports) {
    const last = posImports[0];
    tiles.push({
      key: 'pos',
      group: 'pos',
      status: last ? 'connected' : 'not_connected',
      lastSyncAt: last ? new Date(last.createdAt) : null,
      href: '#pos',
    });
  }
  if (providers) tiles.push(...procurementTiles(providers).map((p) => ({ ...p, href: '#procurement' })));
  if (intake) {
    tiles.push({
      key: 'intake',
      group: 'intake',
      status: intake.channels.length > 0 ? 'connected' : 'not_connected',
      lastSyncAt: null,
      detail: t('hub.channels', { count: formatNumber(intake.channels.length, locale) }),
      href: '/dashboard/inbox?view=settings',
    });
  }

  return (
    <div className="space-y-8">
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      {tiles.length ? <HubStatusBoard tiles={tiles} /> : null}
      {finance ? (
        <div id="accounting" className="scroll-mt-20">
          <AccountingMapping canEdit={finance} />
        </div>
      ) : null}
      {ops ? (
        <div id="pos" className="scroll-mt-20">
          <PosImport />
        </div>
      ) : null}
      {ops ? (
        <div id="procurement" className="scroll-mt-20">
          <ProcurementProviders />
        </div>
      ) : null}
    </div>
  );
}
