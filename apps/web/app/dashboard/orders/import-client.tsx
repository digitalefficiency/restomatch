'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';

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
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const importPo = trpc.orders.importPo.useMutation({
    onSuccess: (res) => {
      setError(null);
      router.push(`/dashboard/orders/${res.poId}`);
    },
    onError: (e) => setError(e.message || 'הייבוא נכשל.'),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      importPo.mutate({ platform: 'zestt', file: { filename: file.name, base64 } });
    } catch {
      setError('קריאת הקובץ נכשלה.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={onFile}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={importPo.isPending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" /> ייבוא הזמנה (Zestt PDF)
      </Button>
      {error && <span className="max-w-xs text-end text-xs text-danger">{error}</span>}
    </div>
  );
}
