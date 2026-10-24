'use client';

import { MessageSquareText } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Spinner } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

type PreviewInput =
  | { poId: string }
  | {
      supplierId: string;
      expectedDeliveryDate?: string;
      lines: Array<{ productId?: string; rawDescription?: string; qty: number; unit: string }>;
    };

/**
 * Read-only: exactly the text the supplier will receive (orders.documentPreview
 * renders it with the same function placeOrder sends). The document is always
 * Hebrew — it goes to an Israeli supplier — so it keeps lang="he" / RTL even in
 * the English UI. Placement is the caller's (wizard review step, draft detail).
 */
export function OrderDocumentPreview({ input, className }: { input: PreviewInput; className?: string }) {
  const t = useT(ordersNs);
  const q = trpc.orders.documentPreview.useQuery(input, { retry: false, placeholderData: (prev) => prev });
  return (
    <section aria-labelledby="order-doc-preview-title" className={className} data-testid="order-document-preview">
      <h3 id="order-doc-preview-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('preview.title')}
      </h3>
      {q.data ? (
        <pre
          lang="he"
          dir="rtl"
          className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 p-3 font-sans text-sm leading-relaxed text-ink"
        >
          {q.data.body}
        </pre>
      ) : q.isError ? (
        <p className="text-xs text-subtle">{t('preview.unavailable')}</p>
      ) : (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <Spinner className="h-3.5 w-3.5" /> {t('preview.loading')}
        </p>
      )}
    </section>
  );
}
