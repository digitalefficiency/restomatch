'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';

/**
 * Admin DSR erasure for a marketing lead (E.6). Platform-admin only — the
 * mutation is gated by adminProcedure server-side and writes a dsr_requests
 * audit row.
 */
export function LeadEraseButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const erase = trpc.dsr.eraseLead.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <div>
      <button
        type="button"
        disabled={erase.isPending}
        onClick={() => {
          if (window.confirm(t('leads.confirmErase'))) {
            erase.mutate({ leadId });
          }
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-danger transition-colors hover:border-danger/40 hover:bg-danger/5 disabled:opacity-45"
        aria-label={t('leads.eraseLabel')}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('leads.erase')}
      </button>
      {erase.error ? (
        <p className="mt-1 text-xs text-danger">{localizeServerError(erase.error, locale, t('generic'))}</p>
      ) : null}
    </div>
  );
}
