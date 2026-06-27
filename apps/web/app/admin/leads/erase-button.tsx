'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

/**
 * Admin DSR erasure for a marketing lead (E.6). Platform-admin only — the
 * mutation is gated by adminProcedure server-side and writes a dsr_requests
 * audit row.
 */
export function LeadEraseButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const erase = trpc.dsr.eraseLead.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <button
      type="button"
      disabled={erase.isPending}
      onClick={() => {
        if (window.confirm('למחוק את הליד לצמיתות? פעולה זו אינה הפיכה.')) {
          erase.mutate({ leadId });
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-danger transition-colors hover:border-danger/40 hover:bg-danger/5 disabled:opacity-45"
      aria-label="מחיקת ליד"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      מחיקה
    </button>
  );
}
