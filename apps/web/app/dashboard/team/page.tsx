import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { team } from '@/lib/i18n/messages/team';
import { getT } from '@/lib/i18n/server';
import { TeamClient } from './team-client';

export default async function TeamPage() {
  // Owner manages the roster; a manager sees it and may set members' app
  // language (nav + middleware ROUTE_ROLES agree; this is the final guard).
  const session = await auth();
  const role = session?.user?.role;
  if (role !== 'owner' && role !== 'manager') redirect('/dashboard');

  const caller = await createServerCaller();
  const data = await caller.team.list();
  const t = await getT(team);

  return (
    <div>
      <SectionHeader title={t('title')} subtitle={t('subtitle')} />
      <TeamClient initial={data} currentUserId={session!.user.id} canManage={role === 'owner'} />
    </div>
  );
}
