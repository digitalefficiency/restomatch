import type { Metadata } from 'next';
import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import { Card, LinkButton, SectionHeader } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { automations as ns } from '@/lib/i18n/messages/automations';
import { labelForRole } from '@/lib/roles';
import { createServerCaller } from '@/lib/trpc/server';
import { AutomationsList } from './automations-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(ns);
  return { title: `${t('page.title')} — RestoMatch` };
}

/** Who may open the page: the owner edits; manager and bookkeeper read. */
const READERS: UserRole[] = ['owner', 'manager', 'bookkeeper'];

/**
 * AU-01 · "אוטומציות": what runs for this restaurant, when, for whom, and how
 * often it ran this week. The settings route is open to all five roles, so the
 * role gate is here (and again in the procedure): receiver and chef get the
 * calm forbidden card, never the list.
 */
export default async function AutomationsPage() {
  const [caller, session, t, locale] = await Promise.all([createServerCaller(), auth(), getT(ns), getLocale()]);
  const memberships = await caller.onboarding.myMemberships();
  const active = memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const role = (active?.role ?? null) as UserRole | null;

  if (!role || !READERS.includes(role)) {
    return (
      <Card className="p-6">
        <h1 className="mb-2 text-lg font-semibold text-ink">{t('page.forbiddenTitle')}</h1>
        <p className="mb-4 text-sm text-muted">
          {t('page.forbiddenAllowed', { roles: READERS.map((r) => labelForRole(r, locale)).join(', ') })}
        </p>
        <LinkButton href="/dashboard/settings" variant="secondary">
          {t('page.back')}
        </LinkButton>
      </Card>
    );
  }

  const { rows, canEdit } = await caller.automations.list();
  return (
    <div>
      <SectionHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      <AutomationsList rows={rows} canEdit={canEdit} />
    </div>
  );
}
