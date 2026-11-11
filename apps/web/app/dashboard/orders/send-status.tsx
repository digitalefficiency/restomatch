'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Copy } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, cn, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import type { SendState } from './order-logic';

/** The PO page re-reads the send state this often until it is final (brief: ≤ 60 s). */
export const SEND_STATUS_POLL_MS = 30_000;

/**
 * orders.sendStatus, polled until final (queued → sent / failed / skipped). `guess`
 * is what the screen knows before the first read (the channel just picked).
 */
export function useSendStatus(poId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return trpc.orders.sendStatus.useQuery(
    { poId: poId ?? '00000000-0000-0000-0000-000000000000' },
    {
      enabled: enabled && !!poId,
      refetchInterval: (q) => (q.state.data?.final ? false : SEND_STATUS_POLL_MS),
      refetchOnWindowFocus: true,
      retry: false,
    },
  );
}

/** One sentence for the state, in place (owner 31.10: short texts). */
export function useSendStatusText() {
  const t = useT(ordersNs);
  const locale = useLocale();
  return (state: SendState, channel: 'email' | 'whatsapp' | null, sentAt: string | null) => {
    if (state === 'sent') {
      const time = sentAt
        ? `${formatDate(sentAt, locale, { day: '2-digit', month: '2-digit' })} ${formatDate(sentAt, locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
        : '';
      return t(channel === 'whatsapp' ? 'sendStatus.sentWhatsapp' : 'sendStatus.sentEmail', { time }).replace(/ · $/, '');
    }
    if (state === 'failed' || state === 'skipped') return t('sendStatus.failed');
    if (state === 'none') return t('sendStatus.none');
    return t('sendStatus.queued');
  };
}

const ICON: Record<SendState, typeof Clock> = {
  queued: Clock,
  sent: CheckCircle2,
  failed: AlertTriangle,
  skipped: AlertTriangle,
  none: ClipboardCheck,
};

/**
 * The send state of a placed PO, in one line. Failed / skipped is T2: a solid warning
 * with the fallback (WhatsApp or phone) and one button that copies the order text.
 * `hero` is the wizard's success screen (the line is its title); `inline` the PO page.
 */
export function SendStatusNote({
  poId,
  state,
  channel,
  sentAt,
  variant = 'inline',
  className,
}: {
  poId: string;
  state: SendState;
  channel: 'email' | 'whatsapp' | null;
  sentAt: string | null;
  variant?: 'hero' | 'inline';
  className?: string;
}) {
  const t = useT(ordersNs);
  const toast = useToast();
  const text = useSendStatusText();
  const utils = trpc.useUtils();
  const [copying, setCopying] = useState(false);
  const warn = state === 'failed' || state === 'skipped';
  const Icon = ICON[state];

  async function copyOrderText() {
    setCopying(true);
    try {
      const msg = await utils.orders.supplierMessagePreview.fetch({ poId });
      await navigator.clipboard.writeText(msg.body);
      toast.success(t('sendStatus.copied'));
    } catch {
      toast.error(t('sendStatus.copyFailed'));
    } finally {
      setCopying(false);
    }
  }

  const line = text(state, channel, sentAt);
  if (variant === 'hero') {
    return (
      <div data-testid="send-status" data-state={state} className={className}>
        <Icon className={cn('mx-auto h-10 w-10', warn ? 'text-warn' : 'text-primary')} aria-hidden="true" />
        <p className="mt-3 text-lg font-semibold text-ink" role="status">
          {line}
        </p>
        {warn ? <WarnHelp onCopy={copyOrderText} copying={copying} centered /> : null}
      </div>
    );
  }
  return (
    <div
      data-testid="send-status"
      data-state={state}
      className={cn(
        'rounded-xl text-sm',
        warn ? 'border border-warn/50 bg-warn/12 p-3 text-ink' : 'text-muted',
        className,
      )}
    >
      <p className="flex items-center gap-2" role="status">
        <Icon className={cn('h-4 w-4 shrink-0', warn ? 'text-warn' : 'text-subtle')} aria-hidden="true" />
        <span className={warn ? 'font-semibold' : undefined}>{line}</span>
      </p>
      {warn ? <WarnHelp onCopy={copyOrderText} copying={copying} /> : null}
    </div>
  );
}

function WarnHelp({ onCopy, copying, centered = false }: { onCopy: () => void; copying: boolean; centered?: boolean }) {
  const t = useT(ordersNs);
  return (
    <div className={cn('mt-2 flex flex-wrap items-center gap-2', centered && 'justify-center')}>
      <span className="text-sm text-ink">{t('sendStatus.failedHint')}</span>
      <Button variant="secondary" className="min-h-12" onClick={onCopy} disabled={copying} data-testid="copy-order-text">
        <Copy className="h-4 w-4" aria-hidden="true" /> {t('sendStatus.copy')}
      </Button>
    </div>
  );
}

/**
 * The live send state of a placed PO: reads orders.sendStatus (polled until final)
 * and, before the first read, shows what the picked channel implies — "none" is
 * recorded only, anything else is on its way.
 */
export function LiveSendStatus({
  poId,
  pickedChannel,
  variant = 'inline',
  className,
}: {
  poId: string;
  pickedChannel: 'email' | 'whatsapp' | 'none' | null;
  variant?: 'hero' | 'inline';
  className?: string;
}) {
  const q = useSendStatus(poId);
  const state: SendState = q.data?.state ?? (pickedChannel === 'none' || pickedChannel === null ? 'none' : 'queued');
  const channel = q.data?.channel ?? (pickedChannel === 'email' || pickedChannel === 'whatsapp' ? pickedChannel : null);
  return (
    <SendStatusNote poId={poId} state={state} channel={channel} sentAt={q.data?.sentAt ?? null} variant={variant} className={className} />
  );
}
