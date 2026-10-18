import { TRPCError } from '@trpc/server';
import { Network, Store } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { chain } from '@/lib/i18n/messages/chain';
import { Badge, Card, EmptyState, EntitlementUpsell, LinkButton, SectionHeader } from '@/lib/components';
import { SwitchBranchButton } from '../chain/switch-button';
import { AddBranchForm, BranchCreated, RenameBranch } from './branch-forms';

type Branches = Awaited<ReturnType<Awaited<ReturnType<typeof createServerCaller>>['chain']['branches']>>;

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; suppliers?: string; products?: string }>;
}) {
  const [caller, t, locale, sp] = await Promise.all([createServerCaller(), getT(chain), getLocale(), searchParams]);

  let data: Branches | null = null;
  try {
    data = await caller.chain.branches();
  } catch (err) {
    if (!(err instanceof TRPCError && err.code === 'FORBIDDEN')) throw err;
  }

  if (!data) {
    return (
      <div>
        <SectionHeader level={1} title={t('branches.title')} />
        <EmptyState icon={<Store className="h-6 w-6" />} title={t('branches.ownerOnly')} />
      </div>
    );
  }

  const active = data.branches.find((b) => b.isActive) ?? data.branches[0]!;
  // Only a branch from the caller's own (server-read) list — never a free-form id.
  const created = sp.created ? data.branches.find((b) => b.restaurantId === sp.created && !b.isActive) : undefined;
  const countParam = (v: string | undefined) => (v && /^\d{1,5}$/.test(v) ? Number(v) : 0);
  const count = formatNumber(data.branches.length, locale);
  const plan = t(`plans.${data.planKey}`);

  return (
    <div>
      <SectionHeader
        level={1}
        title={t('branches.title')}
        subtitle={t('branches.subtitle')}
        action={
          data.chainEnabled ? (
            <LinkButton href="/dashboard/chain" variant="secondary" size="sm">
              <Network className="h-4 w-4" aria-hidden="true" />
              {t('switcher.chainLink')}
            </LinkButton>
          ) : null
        }
      />
      <p className="mb-4 text-sm text-muted" data-testid="branches-plan">
        {data.branchLimit === null
          ? t('branches.planLineUnlimited', { plan, count })
          : t('branches.planLine', { plan, count, limit: formatNumber(data.branchLimit, locale) })}
      </p>

      {created ? (
        <BranchCreated
          restaurantId={created.restaurantId}
          name={created.name}
          suppliers={countParam(sp.suppliers)}
          products={countParam(sp.products)}
        />
      ) : null}

      <Card padding="none" className="divide-y divide-line">
        <ul data-testid="branches-list">
          {data.branches.map((b) => (
            <li key={b.restaurantId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-primary ring-1 ring-line">
                  <Store className="h-4 w-4" aria-hidden="true" />
                </span>
                <RenameBranch restaurantId={b.restaurantId} name={b.name} />
                {b.isActive ? <Badge tone="accent">{t('branches.list.active')}</Badge> : null}
              </div>
              {b.isActive ? null : (
                <SwitchBranchButton restaurantId={b.restaurantId} label={t('branches.list.switchTo')} variant="secondary" />
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-8">
        {data.canAddBranch ? (
          <AddBranchForm currentBranch={active.name} />
        ) : data.hasBillingAccount && !data.isBillingOwner ? (
          // A co-owner on someone else's account: say who can add a branch — never a plan upsell.
          <Card padding="md" className="border-info/30 bg-info/5 text-sm text-ink" data-testid="branches-not-payer">
            {t('branches.notPayer')}
          </Card>
        ) : !data.hasBillingAccount || data.planKey !== 'chain' ? (
          <>
            <EntitlementUpsell feature="chain" title={t('branches.upsell')} />
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted">
              {data.hasBillingAccount ? t('dashboard.upsellBody') : t('branches.noBilling')}
            </p>
          </>
        ) : (
          <Card padding="md" className="border-warn/30 bg-warn/5 text-sm text-ink">
            {t('branches.limitReached')}
          </Card>
        )}
      </div>
    </div>
  );
}
