'use client';

import { useState } from 'react';
import { Download, ShieldX } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';

/**
 * Data-subject-rights self-service (E.6). Lets the signed-in user export a
 * portable copy of their personal data and request erasure of their own
 * account. Both call owner-gated DSR mutations and are audited server-side.
 */
export function DsrSection() {
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
    onError: (e) => setError(e.message),
  });

  const deleteMutation = trpc.dsr.deleteMyAccount.useMutation({
    onSuccess: () => {
      setError(null);
      setDeleted(true);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download className="ml-1.5 h-4 w-4" aria-hidden="true" />
          ייצוא הנתונים שלי
        </Button>
        <Button
          variant="danger"
          loading={deleteMutation.isPending}
          disabled={deleted}
          onClick={() => {
            if (
              window.confirm(
                'מחיקת החשבון תהפוך את פרטי הזיהוי שלכם לאנונימיים ותנתק אתכם. להמשיך?',
              )
            ) {
              deleteMutation.mutate({ confirm: true });
            }
          }}
        >
          <ShieldX className="ml-1.5 h-4 w-4" aria-hidden="true" />
          מחיקת החשבון שלי
        </Button>
      </div>

      {deleted ? (
        <p
          role="status"
          className="rounded-md border-r-4 border-primary bg-primary/5 px-3 py-2 text-sm text-ink"
        >
          הבקשה בוצעה. פרטי הזיהוי שלכם הוסרו — מומלץ להתנתק כעת.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-subtle">
        הייצוא כולל את פרטי החשבון, החברויות והפעילות שלכם. אם אתם הבעלים היחידים של
        מסעדה עם חברים נוספים, יש להעביר תחילה את הבעלות לפני מחיקת החשבון.
      </p>
    </div>
  );
}
