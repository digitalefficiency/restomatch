import { notFound } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { getT } from '@/lib/i18n/server';
import { ask as askNs } from '@/lib/i18n/messages/ask';
import { AskClient } from './ask-client';

export const dynamic = 'force-dynamic';

/**
 * "Ask RestoMatch" (S14, flag `aiAssistant`) — owner/manager only (middleware
 * route guard + managerProcedure). Invisible (404) when the flag is off.
 */
export default async function AskPage() {
  const caller = await createServerCaller();
  const status = await caller.ask.status().catch(() => null);
  if (!status?.enabled) notFound();
  const t = await getT(askNs);
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>
      <AskClient claude={status.claude} questionsLeftToday={status.questionsLeftToday} />
    </div>
  );
}
