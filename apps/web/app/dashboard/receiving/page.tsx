import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { receiving } from '@/lib/i18n/messages/receiving';
import { overview } from '@/lib/i18n/messages/overview';
import { auth } from '@/auth';
import { enabledFeatures } from '@/lib/ingest/features';
import { ReceiverPwa } from '@/lib/pwa/ReceiverPwa';
import { ReceivingBoard } from '../home/receiving-board';
import { ReceiptView } from '../home/receipt-view';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The receiving board (W1-05): today's trucks with one state-labelled action
 * each, late ones carried over, and closed receipts opened read-only
 * (`?receipt=<poId>`) instead of re-entering the wizard.
 */
export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const receiptPo = typeof sp.receipt === 'string' && UUID.test(sp.receipt) ? sp.receipt : null;
  const caller = await createServerCaller();
  const session = await auth();
  const [expectations, locale, t, to, features] = await Promise.all([
    caller.receiving.todayExpectations({ includeLate: true }),
    getLocale(),
    getT(receiving),
    getT(overview),
    enabledFeatures(session?.user?.restaurantId),
  ]);

  const notFound = (err: unknown) => {
    if (err instanceof TRPCError && err.code === 'NOT_FOUND') return null;
    throw err;
  };
  const [closed, po, memberships] = receiptPo
    ? await Promise.all([
        caller.receiving.getReceipt({ poId: receiptPo }).catch(notFound),
        caller.receiving.getPo({ poId: receiptPo }).catch(notFound),
        caller.onboarding.myMemberships(),
      ])
    : [null, null, []];
  // Who may receive goods (startReceipt's roles) may open a follow-up delivery.
  const role = (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role;
  const canReopen = role === 'owner' || role === 'manager' || role === 'receiver';
  const supplierName = po ? (locale === 'en' && po.supplierNameEn ? po.supplierNameEn : po.supplierName) : '';

  return (
    <div>
      {features.includes('receiverPwa') && session?.user?.restaurantId && session.user.id ? (
        <ReceiverPwa restaurantId={session.user.restaurantId} userId={session.user.id} />
      ) : null}
      <SectionHeader level={1} title={t('inbox.title')} subtitle={t('inbox.subtitle')} />

      {receiptPo ? (
        closed && closed.status !== 'pending' ? (
          <ReceiptView receipt={closed} poId={receiptPo} canReopen={canReopen} supplierName={supplierName} t={to} locale={locale} />
        ) : (
          <p role="status" className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
            {to('board.receipt.notFound')}
          </p>
        )
      ) : (
        <ReceivingBoard rows={expectations} t={to} locale={locale} />
      )}
    </div>
  );
}
