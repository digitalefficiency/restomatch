'use client';

import { useRef } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { Button, LinkButton } from '@/lib/components/Button';
import { Money } from '@/lib/components/money/Money';
import { UndoToast } from '@/lib/components/desk/UndoToast';
import { useActionBarHeight } from '@/lib/components/desk/useActionBarHeight';
import { amountBasisOf, barKindOf, batchBasisBlock, claimNoteOf } from './desk-facts';
import { basisText, ilsText, nextLineText } from './desk-text';
import type { DeskController, DeskMode, How, QueueItem, RowState } from './desk-types';
import { BULK_CAP_AGOROT, groupByInvoice, groupPrimary } from './groups';
import { ReasonsRow } from './reasons';
import { Template } from './rich-message';
import { UNDO_FAILED_MS, UNDO_VISIBLE_MS } from './undo-window';
import { canEscalate } from './vocab';

/**
 * The approvals desk's decision bar (DS3-04 spec §4.5) and the evidence's "approve the whole invoice" (§4.4, §5.8).
 * Views only: every click is an intent on the controller (`c.claim`, `c.openReasons`, `c.pay`, …), which keeps calling
 * the same procedures with the same inputs (§5.4). One filled primary per viewport: the variant's primary steps down
 * to secondary while the BatchBar shows its filled approve (R13); "שלמו כפי שחויב", the paying action, is always
 * secondary. Key caps are drawn only while single keys are on (`singleKeys` = usePrefs().singleKeys); narrow and the
 * landing hide them by CSS.
 */

/** #190's page question, one prop away (§2.9): the words of the note that replaces claim + pay. */
export interface DecisionBlockText {
  title: string;
  body: string;
  cta: string;
  href: string;
}

export interface DecisionBarProps {
  c: DeskController;
  mode: DeskMode;
  singleKeys: boolean;
  wide: boolean;
  viewerRole: string | null;
  /** #190 one prop away: when set, a role="note" block (`data-testid="dq-page-question"`, #190's own testid) with a
   *  LinkButton replaces claim + pay; the quiet escalate stays (#190's server refuses every decision except an
   *  escalation during a page question, P13). */
  blocked?: DecisionBlockText | null;
}

type Variant = 'claim' | 'duplicate' | 'review' | 'link' | 'conflict' | 'blocked';

/** Two literal class maps (§4.0): the desk switches at xl; the landing ('single') is the narrow view, unprefixed. */
const BAR: Record<DeskMode, string> = {
  desk: 'flex flex-wrap items-center gap-2.5 border-t border-line-rule bg-surface xl:min-h-[4.5rem] xl:px-7 xl:py-3.5 xl:group-data-[density=compact]/desk:min-h-[3.75rem] xl:group-data-[density=compact]/desk:px-6 xl:group-data-[density=compact]/desk:py-2.5 max-xl:sticky max-xl:bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px))] max-xl:z-action-bar max-xl:-mx-4 sm:max-xl:-mx-6 lg:max-xl:-mx-8 max-xl:mt-4 max-xl:gap-2 max-xl:px-3.5 max-xl:pb-3.5 max-xl:pt-3 max-xl:[&_[data-kbd]]:hidden',
  single:
    'sticky bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px))] z-action-bar -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-line-rule bg-surface px-3.5 pb-3.5 pt-3 sm:-mx-6 lg:-mx-8 [&_[data-kbd]]:hidden',
};
const PAIR: Record<DeskMode, string> = {
  desk: 'flex flex-wrap gap-2.5 max-xl:w-full max-xl:flex-col max-xl:gap-2',
  single: 'flex w-full flex-col gap-2',
};
/** The bar's buttons (Button merges with cnMerge: an override of its size class is safe). */
const BTN: Record<DeskMode, string> = {
  desk: 'max-xl:min-h-14 max-xl:w-full xl:group-data-[density=compact]/desk:min-h-10',
  single: 'min-h-14 w-full',
};
const ESC: Record<DeskMode, string> = {
  desk: 'max-xl:min-h-11 max-xl:w-full',
  single: 'min-h-11 w-full',
};
const NEXT_LINE: Record<DeskMode, string> = {
  desk: 'num text-caption text-fg-tertiary max-xl:w-full max-xl:text-center',
  single: 'num w-full text-center text-caption text-fg-tertiary',
};
const SPACER: Record<DeskMode, string> = {
  desk: 'flex-1 max-xl:hidden',
  single: 'hidden',
};
/** An error box: a word in the danger colour on its subtle fill, never a ₪ (a money figure is never red). */
const ALERT_BOX =
  'flex w-full flex-wrap items-center gap-2 rounded-control border border-danger-subtle bg-danger-subtle px-3 py-2 text-body-sm text-danger';

/** pointer click (detail ≥ 1) · keyboard-activated button (detail 0). */
const howOf = (e: React.MouseEvent): How => (e.detail === 0 ? 'keyboard' : 'pointer');

function variantOf(g: QueueItem, state: RowState | null, blocked: DecisionBlockText | null): Variant {
  if (state === 'elsewhere') return 'conflict';
  if (blocked) return 'blocked';
  const kind = barKindOf(g);
  return kind === 'claimPay' ? 'claim' : kind;
}

/** The claim note under the calculation (§4.4 ClaimNote) shows on claim rows whose claim differs from |Δ|: the bar's
 *  primary is described by it. One rule for both places. */
export function claimNoteShown(g: QueueItem): boolean {
  return barKindOf(g) === 'claimPay' && claimNoteOf(g) != null;
}

export function DecisionBar({ c, mode, singleKeys, wide, viewerRole, blocked = null }: DecisionBarProps) {
  const t = useT(approvals);
  const locale = useLocale();
  const barRef = useRef<HTMLDivElement>(null);
  // At the desk (≥1280) the toast lives in the queue column; below 1280 and on the landing it is the bar's first child.
  const placement: 'queue' | 'bar' = mode === 'desk' && wide ? 'queue' : 'bar';
  const g = c.current;
  const shown = g != null || (c.undo != null && placement === 'bar');
  // The sticky bar publishes its height so focus scrolling keeps controls clear of it (W1-01 "focus not obscured").
  useActionBarHeight(barRef, shown && (mode === 'single' || !wide));
  if (!shown) return null;

  const variant = g ? variantOf(g, c.currentState, blocked) : null;
  const asking = g != null && c.asking != null && c.asking.id === g.id && variant !== 'conflict' && !blocked;
  const primaryVariant = wide && c.selection.ids.size > 0 ? 'secondary' : 'primary';
  const kbd = (key: string) => (singleKeys ? key : undefined);
  const escalateAllowed =
    g != null && variant !== 'conflict' && canEscalate(g.requiredRole, viewerRole) && g.canAct !== false;

  // A double click is one decision (§4.5): the second click event (detail 2) is ignored.
  const onClaim = (e: React.MouseEvent) => {
    if (e.detail <= 1) c.claim(howOf(e), 'bar');
  };
  const onPay = (e: React.MouseEvent) => {
    if (e.detail <= 1) c.openReasons(howOf(e), 'bar');
  };
  const onEscalate = (e: React.MouseEvent) => {
    if (e.detail <= 1) c.requestEscalate('bar');
  };

  let pair: React.ReactNode = null;
  if (g && variant === 'claim') {
    const note = claimNoteOf(g);
    pair = (
      <div data-testid="decide-pair" className={PAIR[mode]}>
        <Button
          variant={primaryVariant}
          size="lg"
          kbd={kbd('1')}
          data-testid="decide-approve"
          data-desk-primary=""
          aria-describedby={claimNoteShown(g) ? 'desk-claim-note' : undefined}
          className={BTN[mode]}
          onClick={onClaim}
        >
          {note?.kind === 'none' ? (
            // R5: a ₪0 claim (a pending order link, the cap used up) is never printed; the input stays seenClaimAgorot 0.
            t('desk.actions.claim')
          ) : (
            <Template text={t('decision.approve')} values={{ amount: <Money agorot={g.claimAgorot} context="line" /> }} />
          )}
        </Button>
        <Button variant="secondary" size="lg" kbd={kbd('2')} data-testid="decide-reject" className={BTN[mode]} onClick={onPay}>
          {t('decision.reject')}
        </Button>
      </div>
    );
  } else if (g && variant === 'duplicate') {
    pair = (
      <div data-testid="decide-pair" className={PAIR[mode]}>
        <Button
          variant={primaryVariant}
          size="lg"
          kbd={kbd('1')}
          data-testid="decide-approve"
          data-desk-primary=""
          className={BTN[mode]}
          onClick={onClaim}
        >
          {t('decision.duplicateApprove')}
        </Button>
        <Button variant="secondary" size="lg" kbd={kbd('2')} data-testid="decide-reject" className={BTN[mode]} onClick={onPay}>
          {t('decision.duplicateReject')}
        </Button>
      </div>
    );
  } else if (g && variant === 'review') {
    pair = (
      <div data-testid="decide-pair" className={PAIR[mode]}>
        <Button
          variant="secondary"
          size="lg"
          kbd={kbd('1')}
          data-testid="decide-review"
          data-desk-primary=""
          className={BTN[mode]}
          onClick={onClaim}
        >
          {t('decision.reviewed')}
        </Button>
      </div>
    );
  } else if (g && variant === 'link') {
    // Not a decision: the invoice is linked to its order on the invoice screen (key 1 opens it, as today, P11a).
    pair = (
      <div data-testid="decide-pair" className={PAIR[mode]}>
        <LinkButton
          variant="secondary"
          size="lg"
          href={g.invoiceId ? `/dashboard/invoices/${g.invoiceId}` : '/dashboard/invoices'}
          kbd={kbd('1')}
          data-testid="decide-link"
          data-desk-primary=""
          className={BTN[mode]}
        >
          {t('decision.link')}
        </LinkButton>
      </div>
    );
  } else if (g && variant === 'blocked' && blocked) {
    pair = (
      <div role="note" data-testid="dq-page-question" className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-medium text-fg">{blocked.title}</p>
          <p className="text-body-sm text-fg-secondary">{blocked.body}</p>
        </div>
        <LinkButton variant={primaryVariant} size="lg" href={blocked.href} data-desk-primary="" className={BTN[mode]}>
          {blocked.cta}
        </LinkButton>
      </div>
    );
  } else if (g && variant === 'conflict') {
    pair = (
      <>
        <p role="status" data-testid="row-note" className="min-w-0 flex-1 text-body-sm text-fg">
          {c.elsewhereText}
        </p>
        <Button variant="ghost" size="sm" data-testid="row-hide" className="touch-target" onClick={() => c.hideElsewhere()}>
          {t('card.hide')}
        </Button>
      </>
    );
  }

  return (
    <div ref={barRef} data-record="" data-testid="decision-bar" data-pane="decision" data-variant={variant ?? undefined} className={BAR[mode]}>
      {placement === 'bar' && c.undo ? (
        <UndoToast
          text={c.undo.text}
          undoLabel={t('undo.action')}
          capAt={c.undo.capAt}
          visibleMs={UNDO_VISIBLE_MS}
          failedMs={UNDO_FAILED_MS}
          failed={c.undo.failed}
          busy={c.undo.busy}
          instant={c.undo.instant}
          keyHint={false}
          placement="bar"
          // The toast hands no event: its button is the pointer path (Z is the keyboard's).
          onUndo={() => c.undoLast('pointer')}
          onExpire={c.expireUndo}
        />
      ) : null}
      {g ? <BarNotes c={c} g={g} locale={locale} /> : null}
      {g == null ? null : asking ? (
        <ReasonsRow
          g={g}
          mode={mode}
          singleKeys={singleKeys}
          onPick={(code, reason, how) => c.pay(code, reason, how)}
          onBack={() => c.closeReasons()}
        />
      ) : (
        <>
          {pair}
          {escalateAllowed ? (
            <Button variant="ghost" size="md" kbd={kbd('3')} data-testid="decide-escalate" className={ESC[mode]} onClick={onEscalate}>
              {t('decision.escalate')}
            </Button>
          ) : null}
          <span aria-hidden="true" className={SPACER[mode]} />
          {variant !== 'blocked' && variant !== 'conflict' ? (
            <p data-testid="desk-next-line" className={NEXT_LINE[mode]}>
              {nextLineText(t, c.summary.count, mode)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The bar's notes for the current gap (§4.5 BarNotes): a status line, or an alert box with no amount in red. */
function BarNotes({ c, g, locale }: { c: DeskController; g: QueueItem; locale: 'he' | 'en' }) {
  const t = useT(approvals);
  const note = c.note;
  if (!note) return null;
  switch (note.kind) {
    case 'amountChanged':
      return (
        <p role="status" className="w-full text-body-sm text-fg">
          <Template
            text={t('desk.amountChanged', { basis: basisText(t, amountBasisOf(g.type)) })}
            values={{ amount: ilsText(locale, note.amountAgorot) }}
          />
        </p>
      );
    case 'escalatedToYou':
      return (
        <p role="status" className="w-full text-body-sm text-fg">
          {t('desk.escalatedToYou')}
        </p>
      );
    case 'error':
      // The primary stays enabled (not aria-busy): "נסו שוב" repeats the same decision (W1-04:346-349).
      return (
        <div role="alert" className={ALERT_BOX}>
          <span>{t('card.error')}</span>
          <Button variant="ghost" size="sm" onClick={(e) => c.retry(howOf(e))}>
            {t('card.retry')}
          </Button>
        </div>
      );
    case 'forbidden':
      return (
        <div role="alert" className={ALERT_BOX}>
          <span>{t('card.forbidden')}</span>
        </div>
      );
    case 'batchError':
      return (
        <div role="alert" className={ALERT_BOX}>
          <span>{note.text}</span>
        </div>
      );
    default:
      return null;
  }
}

/**
 * "Approve the whole invoice" (§4.4 GroupApprove, §5.8): in the evidence foot of an open gap whose invoice has ≥ 2
 * loaded open rows. A secondary action (`group-approve`, "לפני מע״מ" beside it, outside the button) when no row is a
 * block or a VAT gap (R6) and the group primary is allowed (all actionable, ₪ > 0, ≤ the cap); else one line says
 * why (`group-why`). The approval is optimistic in the controller (R11).
 */
export function GroupApprove({ c }: { c: DeskController }) {
  const t = useT(approvals);
  const locale = useLocale();
  const g = c.current;
  if (!g || c.currentState !== 'open' || !g.invoiceId || c.siblings.length < 2) return null;
  const invoiceId = g.invoiceId;
  const group = groupByInvoice(c.live).find((x) => x.invoiceId === invoiceId);
  if (!group) return null;
  const why = (text: React.ReactNode) => (
    <p data-testid="group-why" className="text-caption text-fg-secondary">
      {text}
    </p>
  );
  let action: React.ReactNode = null;
  if (group.rows.some((r) => r.severity === 'block')) {
    action = why(t('desk.groupWhyBlock'));
  } else if (group.rows.some((r) => batchBasisBlock(r) != null)) {
    action = why(t('desk.groupWhyVat'));
  } else {
    const primary = groupPrimary(group);
    if (primary.ok) {
      action = (
        <>
          <Button
            variant="secondary"
            size="md"
            data-testid="group-approve"
            disabled={c.selection.busy}
            onClick={(e) => c.approveInvoice(invoiceId, howOf(e))}
          >
            <Template text={t('desk.groupApprove')} values={{ amount: <Money agorot={group.claimAgorot} context="line" /> }} />
          </Button>
          <span className="text-caption text-fg-tertiary">{t('summary.atRiskBasis')}</span>
        </>
      );
    } else if (primary.why === 'overCap') {
      action = why(<Template text={t('desk.groupWhyOverCap')} values={{ cap: ilsText(locale, BULK_CAP_AGOROT) }} />);
    }
  }
  return (
    <div data-testid="desk-group" className="mt-3 flex flex-wrap items-center gap-2.5">
      <p data-testid="desk-group-more" className="num text-caption text-fg-secondary">
        {t('desk.group.more', { count: c.siblings.length - 1 })}
      </p>
      {action}
    </div>
  );
}
