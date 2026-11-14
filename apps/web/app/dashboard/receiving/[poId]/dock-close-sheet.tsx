'use client';

import { Camera, PenLine } from 'lucide-react';
import { Button, Sheet } from '@/lib/components';
import { useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { DockGap } from './_dock';
import { PHONE_CTA } from './_phone';

/** How the document of this receipt stands: photographed (or kept on the phone until it can upload), or not. */
export type DocState = 'none' | 'done' | 'queued';

/**
 * "לפני הסגירה" (SPEC §10.3): shown only when there is something to check — a
 * gap, or (when the document comes after the count) no photo yet. It names the
 * gaps, says whether the document was photographed, and reminds to write the gap
 * on the delivery note too. A clean receipt with its photo never sees it: it
 * closes in one tap, as today.
 */
export function DockCloseSheet({
  open,
  gaps,
  doc,
  askPhoto,
  onClose,
  onPhoto,
  onBack,
}: {
  open: boolean;
  gaps: DockGap[];
  doc: DocState;
  /** Offer the photo here (the document comes after the count, and none was taken). */
  askPhoto: boolean;
  onClose: () => void;
  /** Photograph the document, then close. */
  onPhoto: () => void;
  onBack: () => void;
}) {
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const n = gaps.length;
  return (
    <Sheet
      open={open}
      onClose={onBack}
      detent="full"
      title={td('delivery.dock.check.title')}
      primary={
        <div className="flex flex-col gap-2">
          {askPhoto ? (
            <>
              <Button size="xl" onClick={onPhoto} className={PHONE_CTA} icon={<Camera className="h-5 w-5" aria-hidden="true" />} data-testid="close-photo">
                {td('delivery.dock.actions.photoClose')}
              </Button>
              <Button size="xl" variant="secondary" onClick={onClose} className={PHONE_CTA} data-testid="close-nodoc">
                {td('delivery.dock.actions.closeNoDoc')}
              </Button>
              <Button size="lg" variant="tertiary" onClick={onBack} data-testid="close-back">
                {td('delivery.dock.actions.backToCount')}
              </Button>
            </>
          ) : (
            <>
              <Button size="xl" onClick={onClose} className={PHONE_CTA} data-testid="close-confirm">
                {td('delivery.count.close')}
              </Button>
              <Button size="xl" variant="secondary" onClick={onBack} className={PHONE_CTA} data-testid="close-back">
                {td('delivery.dock.actions.backToCount')}
              </Button>
            </>
          )}
        </div>
      }
    >
      {open ? (
        <div className="flex flex-col gap-4 pt-1" data-testid="close-check" data-gaps={n}>
          <dl className="divide-y divide-line rounded-card border border-line bg-surface">
            {n > 0 ? (
              <div className="flex flex-col gap-1 px-4 py-3">
                <dt className="text-body-sm font-semibold text-muted">{td('delivery.dock.check.gaps', { count: n, n: formatNumber(n, locale) })}</dt>
                <dd className="text-body text-ink">
                  <GapList gaps={gaps} />
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-body-sm font-semibold text-muted">{td('delivery.dock.check.doc')}</dt>
              <dd className="text-body text-ink" data-testid="close-check-doc" data-doc={doc}>
                {doc === 'done' ? td('delivery.dock.check.docDone') : doc === 'queued' ? td('delivery.dock.check.docQueued') : td('delivery.dock.check.docNone')}
              </dd>
            </div>
          </dl>
          {n > 0 ? (
            <p className="flex items-start gap-2 text-body text-muted">
              <PenLine className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              {td('delivery.dock.check.hint')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** One line per gap, worded from the count against the order only (no billed quantity, no price). */
export function GapList({ gaps }: { gaps: DockGap[] }) {
  return (
    <ul className="flex flex-col gap-1" data-testid="gap-list">
      {gaps.map((g) => (
        <li key={g.key} data-testid="gap-line" data-key={g.key} data-kind={g.note.kind}>
          <GapText gap={g} />
        </li>
      ))}
    </ul>
  );
}

function GapText({ gap }: { gap: DockGap }) {
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const unit = useUnitLabel();
  const { line, note } = gap;
  const u = line.poUnit ?? line.invoiceUnit;
  const qty = (v: number, withUnit = true) => `${formatNumber(v, locale, { maximumFractionDigits: 3 })}${withUnit && u ? ` ${unit(u)}` : ''}`;
  const name = locale === 'en' && line.productNameEn ? line.productNameEn : line.productName;
  let text: string;
  switch (note.kind) {
    case 'missing':
      text = td('delivery.count.missingTag');
      break;
    case 'damaged':
      text = td('delivery.dock.row.damaged');
      break;
    case 'unordered':
      text = td('delivery.dock.gap.unordered', { got: qty(note.got) });
      break;
    case 'short':
    case 'over': {
      const base =
        note.kind === 'short'
          ? td('delivery.dock.gap.short', { got: qty(note.got, false), ordered: qty(note.ordered) })
          : td('delivery.dock.gap.over', { got: qty(note.got, false), ordered: qty(note.ordered) });
      text = note.damaged ? td('delivery.dock.row.withDamage', { text: base }) : base;
      break;
    }
  }
  return td('delivery.dock.gap.line', { name, text });
}
