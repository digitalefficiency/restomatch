'use client';

import { useState } from 'react';
import { Copy, Link2, MessageCircle } from 'lucide-react';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { trpc } from '@/lib/trpc/client';

/** Mint a 72h supplier link and share it (copy / WhatsApp). The raw link is shown once. */
export function SupplierLinkButton({ poId, restaurantName }: { poId: string; restaurantName: string }) {
  const t = useT(supplierConfirm);
  const locale = useLocale();
  const create = trpc.supplierConfirm.createLink.useMutation();
  const [copied, setCopied] = useState(false);
  const link = create.data ? `${window.location.origin}${create.data.path}` : null;

  if (!link) {
    return (
      <div>
        <Button type="button" size="sm" disabled={create.isPending} onClick={() => create.mutate({ poId })}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {create.isPending ? t('card.creating') : t('card.createLink')}
        </Button>
        {create.isError ? <p role="alert" className="mt-2 text-sm text-danger">{t('card.error')}</p> : null}
      </div>
    );
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(t('card.whatsappText', { restaurant: restaurantName, url: link }))}`;
  return (
    <div className="space-y-2">
      <input
        readOnly
        dir="ltr"
        value={link}
        aria-label={t('card.createLink')}
        onFocus={(e) => e.currentTarget.select()}
        className="block w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {copied ? t('card.copied') : t('card.copy')}
        </Button>
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('card.whatsapp')}
        </a>
        <span className="text-xs text-subtle">
          {t('card.linkExpires', { date: formatDateTime(create.data!.expiresAt, locale) })}
        </span>
      </div>
    </div>
  );
}
