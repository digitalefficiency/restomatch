'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, friendlyError, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { startRouteProgress } from '@/lib/components/routeProgressState';

/** base64 of the raw file bytes — matches importPo's Buffer.from(base64,'base64'). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Upload a Zestt PO PDF → parse via Claude → land an order, then open it. */
export function ZesttImportButton() {
  const t = useT(ordersNs);
  const tc = useT(components);
  const toast = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const importPo = trpc.orders.importPo.useMutation({
    onSuccess: (res) => {
      toast.success(t('import.imported'));
      startRouteProgress(`/dashboard/orders/${res.poId}`);
      router.push(`/dashboard/orders/${res.poId}`);
    },
    onError: (e) =>
      toast.error(
        friendlyError(e, tc, {
          PRECONDITION_FAILED: t('import.notConfigured'),
          BAD_REQUEST: t('import.badFile'),
        }),
      ),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      importPo.mutate({ platform: 'zestt', file: { filename: file.name, base64 } });
    } catch {
      toast.error(t('import.readFailed'));
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={importPo.isPending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden="true" /> {t('import.button')}
      </Button>
    </>
  );
}
