import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { formatDate } from '@/lib/i18n/format';
import { admin } from '@/lib/i18n/messages/admin';
import { getLocale, getT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/translate';
import { AssignPlanForm } from './AssignPlanForm';
import { OverridesForm } from './OverridesForm';
import { MemberRoles } from './MemberRoles';

type Overrides = {
  limits?: { invoicesPerMonth?: number | null; restaurants?: number | null; seatsPerRestaurant?: number | null };
  features?: string[];
};
type AdminKey = MessageKey<typeof admin.he>;

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Human-readable overrides summary (never raw JSON in the console). */
function overridesSummary(o: Overrides, t: (k: AdminKey) => string): string {
  const parts: string[] = [];
  if (o.limits?.invoicesPerMonth != null) parts.push(`${t('overrides.invoices')}: ${o.limits.invoicesPerMonth}`);
  if (o.limits?.restaurants != null) parts.push(`${t('overrides.restaurants')}: ${o.limits.restaurants}`);
  if (o.limits?.seatsPerRestaurant != null) parts.push(`${t('overrides.seats')}: ${o.limits.seatsPerRestaurant}`);
  for (const f of o.features ?? []) parts.push(t(`overrides.features.${f}` as AdminKey));
  return parts.length ? parts.join(' · ') : '—';
}

export default async function AdminRestaurantDetail({ params }: PageProps) {
  const { id } = await params;
  const caller = await createServerCaller();
  let data;
  try {
    data = await caller.admin.getRestaurant({ restaurantId: id });
  } catch {
    notFound();
  }
  const [t, locale] = await Promise.all([getT(admin), getLocale()]);
  const { restaurant, subscription, members } = data;

  return (
    <div>
      <Link href="/admin" className="text-sm text-subtle transition-colors hover:text-ink">
        {t('detail.back')}
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-ink">{restaurant.name}</h1>
      <p className="mb-6 font-mono text-xs tabular-nums text-subtle">
        {restaurant.businessId ? `${t('detail.businessId')} ${restaurant.businessId} · ` : ''}
        {t('detail.created')} {formatDate(restaurant.createdAt, locale)}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="relative overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-card">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('detail.subscription')}
          </h2>
          {subscription ? (
            <dl className="space-y-2 text-sm">
              <Row label={t('detail.plan')} value={t(`plans.${subscription.planKey}` as AdminKey)} />
              <Row label={t('detail.status')} value={t(`statuses.${subscription.status}` as AdminKey)} />
              {subscription.trialEndsAt ? (
                <Row label={t('detail.trialEnds')} value={formatDate(subscription.trialEndsAt, locale)} />
              ) : null}
              <Row
                label={t('detail.overrides')}
                value={overridesSummary((subscription.overrides ?? {}) as Overrides, t)}
              />
            </dl>
          ) : (
            <p className="text-sm text-subtle">{t('detail.noSubscription')}</p>
          )}
          <div className="mt-5 border-t border-line pt-5">
            <AssignPlanForm restaurantId={restaurant.id} currentPlan={subscription?.planKey ?? null} />
          </div>
          {subscription ? (
            <OverridesForm restaurantId={restaurant.id} current={(subscription.overrides ?? {}) as Overrides} />
          ) : null}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">
            {t('detail.members', { count: members.length })}
          </h2>
          {members.length ? (
            <MemberRoles restaurantId={restaurant.id} members={members} />
          ) : (
            <p className="text-sm text-subtle">{t('detail.noMembers')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-end font-medium text-ink">{value}</dd>
    </div>
  );
}
