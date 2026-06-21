import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { TeamClient } from './team-client';

export default async function TeamPage() {
  // Owner-only (the nav already hides this and middleware gates the route; this
  // is the final server-side guard, and also catches a null/non-owner role).
  const session = await auth();
  if (session?.user?.role !== 'owner') redirect('/dashboard');

  const caller = await createServerCaller();
  const data = await caller.team.list();

  return (
    <div>
      <SectionHeader
        title="צוות"
        subtitle="הזמינו עובדים, הגדירו תפקידים, ונהלו את הגישה למסעדה."
      />
      <TeamClient initial={data} currentUserId={session.user.id} />
    </div>
  );
}
