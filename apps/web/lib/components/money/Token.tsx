'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';

export type TokenKind = 'invoice' | 'po' | 'sku' | 'allocation' | 'phone';

/**
 * An identifier (invoice, PO, SKU, allocation or phone number): the ONLY place
 * mono type is used. `dir="ltr"` keeps "GD-1006" in order inside Hebrew; it
 * never wraps. `copy` adds a copy button ("הועתק" for 1.5 s). Never wrap money
 * in this — money is <Money>.
 */
export function Token({
  value,
  kind,
  copy = false,
  className,
}: {
  value: string;
  kind: TokenKind;
  copy?: boolean;
  className?: string;
}) {
  const t = useT(components);
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — the value stays selectable */
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)} data-token={kind}>
      <bdi dir="ltr" className="whitespace-nowrap font-mono text-[0.8125rem] font-medium">
        {value}
      </bdi>
      {copy ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? t('ds.token.copied') : t('ds.token.copy', { value })}
          title={copied ? t('ds.token.copied') : t('ds.token.copy', { value })}
          className="inline-flex h-6 w-6 items-center justify-center rounded-control text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      ) : null}
    </span>
  );
}
