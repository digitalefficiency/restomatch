'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, friendlyError, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { normalizeQty } from '../inventory-ui';

/** The closed count as a CSV file for the accountant (UTF-8 with BOM, opens in Excel). */
export function CsvButton({ countId }: { countId: string }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className="touch-target"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { filename, csv } = await utils.inventory.exportCsv.fetch({ countId });
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          toast.error(friendlyError(e, tc));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('detail.csv')}
    </Button>
  );
}

/** Owner-only correction of one line of a closed count, with a reason that goes to the audit log. */
export function AmendButton({ countId, productId, unit, qty }: { countId: string; productId: string; unit: string; qty: string | null }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const toast = useToast();
  const router = useRouter();
  const amend = trpc.inventory.amendLine.useMutation({
    onSuccess: () => {
      toast.success(t('detail.amended'));
      router.refresh();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="touch-target"
      loading={amend.isPending}
      onClick={() => {
        const raw = window.prompt(t('detail.amendQty', { unit }), qty ?? '');
        if (raw === null) return;
        // Same keypad rules as the count ("1,200" = 1200, "2,5" = 2.5).
        const v = normalizeQty(raw);
        if (v == null) return;
        const reason = window.prompt(t('detail.amendReason'), '');
        if (!reason || reason.trim().length < 3) return;
        amend.mutate({ countId, productId, qty: v === '' ? null : v, reason: reason.trim() });
      }}
    >
      {t('detail.amend')}
    </Button>
  );
}
