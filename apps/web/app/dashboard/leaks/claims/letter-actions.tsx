'use client';

import { useState } from 'react';
import { Check, Mail, MessageCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button } from '@/lib/components';
import { useSharedDeferred } from '../../recovery/deferred';
import { PrintButton } from './print-button';

/**
 * One letter's action bar: print/PDF of THIS letter only, a WhatsApp / email
 * hand-off the user sends from their own phone or mail (nothing leaves the
 * server), and "mark as sent" — written to the ₪-back tracker after 10 s
 * unless undone, so the claims move claimed → letter_sent in one call.
 */
export function LetterActions({
  scope,
  claimIds,
  whatsappText,
  mailSubject,
  labels,
}: {
  scope: string;
  claimIds: string[];
  whatsappText: string;
  mailSubject: string;
  labels: {
    print: string;
    whatsapp: string;
    mail: string;
    markSent: string;
    markSentAria: string;
    sentBadge: string;
    undoMoved: string;
    failed: string;
    notTracked: string;
  };
}) {
  const [error, setError] = useState(false);
  const transition = trpc.recovery.transition.useMutation();
  // One queue + ONE undo bar for all the letters (DeferredProvider on the page).
  const deferred = useSharedDeferred();
  const pending = claimIds.length > 0 && claimIds.every((id) => deferred.pendingTo(id) === 'letter_sent');
  const wa = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
  const mail = `mailto:?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(whatsappText)}`;
  const link =
    'inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary md:min-h-9';

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="letter-actions">
      <PrintButton label={labels.print} scope={scope} />
      <a href={wa} target="_blank" rel="noopener noreferrer" className={link} data-testid="letter-whatsapp">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {labels.whatsapp}
      </a>
      <a href={mail} className={link} data-testid="letter-mail">
        <Mail className="h-4 w-4" aria-hidden="true" />
        {labels.mail}
      </a>
      {claimIds.length > 0 ? (
        pending ? (
          <span data-testid="letter-sent-badge">
            <Badge tone="info" icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}>
              {labels.sentBadge}
            </Badge>
          </span>
        ) : (
          <Button
            size="md"
            variant="primary"
            aria-label={labels.markSentAria}
            className="min-h-11 md:min-h-9"
            data-testid="letter-mark-sent"
            onClick={() => {
              setError(false);
              deferred.schedule({
                keys: claimIds,
                to: 'letter_sent',
                label: labels.undoMoved,
                run: () => transition.mutateAsync({ claimIds, to: 'letter_sent' }),
                onFailed: () => setError(true),
              });
            }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {labels.markSent}
          </Button>
        )
      ) : (
        <span className="text-xs text-subtle">{labels.notTracked}</span>
      )}
      {error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
