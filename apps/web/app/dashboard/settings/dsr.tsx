'use client';

import { useState } from 'react';
import { Download, ShieldX } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';
import { signOutAfterDeletionAction } from './dsr-actions';

/**
 * Data-subject-rights self-service (E.6). Lets the signed-in user export a
 * portable copy of their personal data and request erasure of their own
 * account. Both call owner-gated DSR mutations and are audited server-side.
 */
export function DsrSection() {
  const t = useT(settings);
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const exportMutation = trpc.dsr.exportMyData.useMutation({
    onSuccess: (data) => {
      setError(null);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `restomatch-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => setError(localizeServerError(e, locale, t('dsr.failed'))),
  });

  const deleteMutation = trpc.dsr.deleteMyAccount.useMutation({
    onSuccess: () => {
      setError(null);
      setDeleted(true);
      // The JWT is already revoked server-side (token_version bump); end this
      // device's cookie too so the user isn't left on a dead session.
      void signOutAfterDeletionAction();
    },
    onError: (e) => setError(localizeServerError(e, locale, t('dsr.failed'))),
  });

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
          {t('dsr.export')}
        </Button>
        <Button
          variant="danger"
          loading={deleteMutation.isPending}
          disabled={deleted}
          onClick={() => {
            if (
              window.confirm(t('dsr.confirmDelete'))
            ) {
              deleteMutation.mutate({ confirm: true });
            }
          }}
        >
          <ShieldX className="me-1.5 h-4 w-4" aria-hidden="true" />
          {t('dsr.delete')}
        </Button>
      </div>

      {deleted ? (
        <p
          role="status"
          className="rounded-md border-s-4 border-primary bg-primary/5 px-3 py-2 text-sm text-ink"
        >
          {t('dsr.deleted')}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-subtle">
        {t('dsr.note')}
      </p>
    </div>
  );
}
