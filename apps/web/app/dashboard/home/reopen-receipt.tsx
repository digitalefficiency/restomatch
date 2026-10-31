'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PackagePlus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

/**
 * A follow-up delivery for a PARTIAL receipt: one explicit tap reopens the same
 * receipt (one per PO; logged server-side) and opens the wizard on it.
 */
export function ReopenReceipt({ poId, label, hint, failed }: { poId: string; label: string; hint: string; failed: string }) {
  const router = useRouter();
  const reopen = trpc.receiving.startReceipt.useMutation();
  const [error, setError] = useState(false);
  return (
    <div className="mt-4 space-y-1.5">
      <button
        type="button"
        data-testid="receipt-follow-up"
        disabled={reopen.isPending}
        onClick={async () => {
          setError(false);
          try {
            await reopen.mutateAsync({ poId, reopen: true });
            router.push(`/dashboard/receiving/${poId}`);
          } catch {
            setError(true);
          }
        }}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-primary bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {reopen.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PackagePlus className="h-4 w-4" aria-hidden="true" />}
        {label}
      </button>
      <p className="text-xs text-muted">{hint}</p>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {failed}
        </p>
      ) : null}
    </div>
  );
}
