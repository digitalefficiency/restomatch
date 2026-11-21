'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/lib/components/Button';
import { DateTime } from '@/lib/components/money/DateTime';
import { Sheet } from '@/lib/components/overlay';
import { useT } from '@/lib/i18n/client';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { idbOutboxStore, markWarned, removeItem, retryItem, type OutboxItem } from './outbox';

/** The per-item view behind "⟳ 3 ממתינים": what waits, whose it is, and what can be done. */
export function OutboxStatusSheet({
  open,
  onClose,
  items,
  userId,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  /** This restaurant's items (mine and colleagues'). */
  items: OutboxItem[];
  userId: string;
  onRetry: () => void;
}) {
  const t = useT(receivingDelivery);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // A stuck item that the user has now SEEN starts its 14-day clock (it never leaves silently).
  useEffect(() => {
    if (!open) return;
    const stuck = items.filter((i) => i.status === 'parked' && i.warnedAt === null).map((i) => i.key);
    if (stuck.length) void markWarned(idbOutboxStore, stuck);
  }, [open, items]);

  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('pwa.outboxTitle')}
      description={t('pwa.outboxBody')}
      primary={
        <Button size="xl" onClick={() => onRetry()} data-testid="pwa-outbox-retry-all">
          {t('pwa.sendNow')}
        </Button>
      }
    >
      <ul className="divide-y divide-line" data-testid="pwa-outbox-list">
        {sorted.map((i) => {
          const mine = i.userId === userId;
          return (
            <li key={i.key} className="flex flex-col gap-1 py-3" data-testid="pwa-outbox-item" data-kind={i.kind}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-ink">{t(`pwa.kind.${kindKey(i.kind)}`)}</span>
                <DateTime value={i.createdAt} variant="time" className="text-sm text-muted" />
              </div>
              <p className="text-sm text-muted">
                {i.status === 'parked' ? t('pwa.state.parked') : i.attempts > 0 ? t('pwa.state.retrying') : t('pwa.state.waiting')}
                {!mine
                  ? ` · ${t(i.kind === 'photo' ? 'pwa.capturedBy' : 'pwa.savedBy', { name: i.capturedByName ?? t('pwa.someoneElse') })}`
                  : ''}
              </p>
              {i.status === 'parked' ? <p className="text-sm text-muted">{t('pwa.state.keptDays')}</p> : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {i.status === 'parked' ? (
                  <Button size="lg" variant="secondary" onClick={() => void retryItem(idbOutboxStore, i.key).then(onRetry)}>
                    {t('pwa.retryItem')}
                  </Button>
                ) : null}
                {/* Only whoever captured it may delete it (decision 22). */}
                {mine ? (
                  confirmKey === i.key ? (
                    <Button
                      size="lg"
                      variant="danger"
                      data-testid="pwa-outbox-delete-confirm"
                      onClick={() => {
                        setConfirmKey(null);
                        void removeItem(idbOutboxStore, i.key, { userId });
                      }}
                    >
                      {t('pwa.deleteConfirm')}
                    </Button>
                  ) : (
                    <Button size="lg" variant="ghost" data-testid="pwa-outbox-delete" onClick={() => setConfirmKey(i.key)}>
                      {t('pwa.deleteItem')}
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function kindKey(kind: string): 'grLine' | 'submitReceipt' | 'photo' | 'slipShared' | 'other' {
  return kind === 'grLine' || kind === 'submitReceipt' || kind === 'photo' || kind === 'slipShared' ? kind : 'other';
}
