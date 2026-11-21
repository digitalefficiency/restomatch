'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button, Card, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/**
 * The shared order text for a role that cannot create orders (W2-06 §5.4,
 * orders-17): neutral (T4), the text kept as received, and one action —
 * forward it to the manager (the system share sheet, else copy).
 */
export function ShareForward({ text }: { text: string }) {
  const t = useT(ordersNs);
  const toast = useToast();
  const [value] = useState(text);
  async function forward() {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: value });
        return;
      }
    } catch {
      // Dismissed share sheet: fall through to copy.
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('w2.copied'));
    } catch {
      // Clipboard blocked: the text stays selectable below.
    }
  }
  return (
    <Card elevated data-testid="share-forward">
      {value ? (
        <pre dir="auto" className="mb-4 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-base text-ink">
          {value}
        </pre>
      ) : null}
      <Button className="h-14 w-full text-base" onClick={() => void forward()} data-testid="share-forward-cta">
        <Share2 className="h-5 w-5" aria-hidden="true" />
        {t('w2.shareForward')}
      </Button>
    </Card>
  );
}
