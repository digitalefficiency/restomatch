'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { takeAttempt } from './attempt';
import { isOwnAnswer, type PortalLine } from './logic';

type Recorded = {
  lines: Array<{ poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null }>;
  note: string | null;
};

/**
 * The heading + sentence of the "already answered" card (auth-03). After a 409
 * it says plainly whether THIS browser's answer is the one on record (a retried
 * submit whose first try landed) or whether the changes just marked were not
 * saved. A plain revisit gets the neutral "answered on {date}".
 */
export function RecordedNotice({
  token,
  lines,
  recorded,
  date,
}: {
  token: string;
  lines: PortalLine[];
  recorded: Recorded;
  date: string;
}) {
  const t = useT(supplierConfirm);
  const [mode, setMode] = useState<'plain' | 'own' | 'conflict'>('plain');
  useEffect(() => {
    const attempt = takeAttempt(token);
    if (attempt) setMode(isOwnAnswer(lines, attempt, recorded) ? 'own' : 'conflict');
  }, [token, lines, recorded]);
  return (
    <>
      <p className="flex items-center gap-2 text-lg font-bold text-ink">
        {mode === 'conflict' ? (
          <Info className="h-5 w-5 text-muted" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
        )}
        {mode === 'own' ? t('portal.doneTitle') : t('portal.alreadyTitle')}
      </p>
      <p className="mt-2 text-base text-ink" role={mode === 'plain' ? undefined : 'status'} data-mode={mode}>
        {mode === 'conflict'
          ? t('portal.conflictBody', { date })
          : mode === 'own'
            ? t('portal.ownRecorded', { date })
            : t('portal.alreadyBody', { date })}
      </p>
    </>
  );
}
