'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { ingest } from '@/lib/i18n/messages/ingest';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';
import { refusalOf } from '../refusals';

type Action = 'separate' | 'delete_duplicate' | 'close_unreadable' | 'checked_together';
const PAGE_ONE = ['page_not_merged', 'page_merge_blocked', 'page_too_large'];

/**
 * G-09 (round 8) · the answer to ONE page question, on the page that shows both
 * invoices. One primary answer per question; a claim that releases payment
 * ("separate", "delete") asks first and names the ₪ at stake.
 */
export function PageAnswers(props: {
  documentId: string;
  flag: string;
  /** The page's own invoice, and the invoice shown beside it (round 9: "checked together" picks ONE to pay). */
  pageInvoiceId: string | null;
  otherInvoiceId: string | null;
  /** Round 10 (P4/Q4): the invoice the one shown is already "included in" (an earlier answer). */
  otherIncludedIn?: string | null;
  pageTotal: number | null;
  otherTotal: number | null;
  supplier: string | null;
  canManage: boolean;
}) {
  const t = useT(ingest);
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const resolve = trpc.ingest.resolvePageFlag.useMutation();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [payable, setPayable] = useState<string | null>(null);
  const [pickMissing, setPickMissing] = useState(false);
  if (!props.canManage) return <p className="text-sm text-muted">{t('inbox.compareManagerOnly')}</p>;

  const done: Record<Action, string> = {
    separate: t('inbox.pageSeparated'),
    delete_duplicate: t('inbox.pageDuplicateDeleted'),
    close_unreadable: t('inbox.pageClosedUnreadable'),
    checked_together: t('inbox.pageCheckedTogether'),
  };
  async function run(action: Action) {
    try {
      await resolve.mutateAsync({
        documentId: props.documentId,
        action,
        // Round 9 (N4): one of the two stays payable; the other is "included in it".
        ...(action === 'checked_together' && payable
          ? { payableInvoiceId: payable, ...(props.otherInvoiceId ? { withInvoiceId: props.otherInvoiceId } : {}) }
          : {}),
      });
      toast.success(done[action]);
      router.push('/dashboard/approvals');
      router.refresh();
    } catch (err) {
      // Round 9 (L14): a named refusal reads as a sentence (shared with the inbox); a
      // page someone else already answered refreshes so no stale button stays.
      const refusal = refusalOf(err);
      const msg = refusal
        ? t(`refusals.${refusal}`)
        : err instanceof Error && /[֐-׿]/.test(err.message)
          ? err.message
          : t('errors.unknown');
      toast.error(t('inbox.actionFailed', { message: msg }));
      if (refusal === 'not_flagged') router.refresh();
    }
  }
  const ils = (v: number | null) => (v === null ? '—' : formatIls(v, { locale }));
  const primary: Action =
    props.flag === 'page_duplicate' ? 'delete_duplicate' : props.flag === 'page_unreadable' ? 'close_unreadable' : PAGE_ONE.includes(props.flag) ? 'checked_together' : 'separate';
  const label: Record<Action, string> = {
    separate: t('inbox.pageSeparate'),
    delete_duplicate: t('inbox.pageDeleteDuplicate'),
    close_unreadable: t('inbox.pageCloseUnreadable'),
    checked_together: t('inbox.pageCheckTogether'),
  };
  // Every answer that decides what gets paid asks first and names the ₪ (round 9: "checked together" too).
  const confirmFirst = (a: Action) =>
    a === 'delete_duplicate' || a === 'checked_together' || (a === 'separate' && (props.flag === 'page_duplicate' || PAGE_ONE.includes(props.flag)));
  const together = confirm === 'checked_together';

  const secondary: Action | null = primary === 'separate' || primary === 'close_unreadable' ? null : 'separate';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" className="min-h-11" disabled={resolve.isPending} onClick={() => (confirmFirst(primary) ? setConfirm(primary) : void run(primary))}>
        {label[primary]}
      </Button>
      {secondary ? (
        <Button variant="secondary" className="min-h-11" disabled={resolve.isPending} onClick={() => (confirmFirst(secondary) ? setConfirm(secondary) : void run(secondary))}>
          {label[secondary]}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={
          together ? t('inbox.pageTogetherConfirmTitle') : confirm === 'delete_duplicate' ? t('inbox.pageDeleteConfirmTitle') : t('inbox.pageSeparateConfirmTitle')
        }
        body={
          together ? (
            <span className="block space-y-3">
              <span className="block">{t('inbox.pageTogetherConfirmBody')}</span>
              {props.otherIncludedIn ? <span className="block text-sm text-muted">{t('inbox.pageTogetherAlreadyIncluded')}</span> : null}
              <span role="radiogroup" aria-label={t('inbox.pageTogetherConfirmTitle')} className="flex flex-col gap-2">
                {[
                  { id: props.otherInvoiceId, label: t('inbox.pageTogetherPickOther', { amount: ils(props.otherTotal) }) },
                  { id: props.pageInvoiceId, label: t('inbox.pageTogetherPickThis', { amount: ils(props.pageTotal) }) },
                  ...(props.otherIncludedIn ? [{ id: props.otherIncludedIn, label: t('inbox.pageTogetherPickCarrier') }] : []),
                ].map((o) =>
                  o.id ? (
                    <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3">
                      <input
                        type="radio"
                        name="payable"
                        checked={payable === o.id}
                        onChange={() => {
                          setPayable(o.id);
                          setPickMissing(false);
                        }}
                      />
                      <span>{o.label}</span>
                    </label>
                  ) : null,
                )}
              </span>
              {pickMissing ? (
                <span role="alert" className="block text-sm font-semibold text-danger">
                  {t('inbox.pageTogetherPickRequired')}
                </span>
              ) : null}
            </span>
          ) : (
          <span>
            {confirm === 'delete_duplicate'
              ? t('inbox.pageDeleteConfirmBody')
              : props.flag === 'page_duplicate'
                ? t('inbox.pageSeparateConfirmBody')
                : t('inbox.pageSeparateBothBody', { page: ils(props.pageTotal), other: ils(props.otherTotal) })}
          </span>
          )
        }
        amount={together ? undefined : (props.pageTotal ?? undefined)}
        party={props.supplier ?? undefined}
        confirmLabel={together ? t('inbox.pageTogetherConfirm') : confirm ? label[confirm] : ''}
        cancelLabel={t('inbox.keep')}
        danger={!together}
        loading={resolve.isPending}
        onClose={() => {
          setConfirm(null);
          setPickMissing(false);
        }}
        onConfirm={() => {
          const a = confirm;
          if (a === 'checked_together' && !payable) {
            setPickMissing(true);
            return;
          }
          setConfirm(null);
          if (a) void run(a);
        }}
      />
    </div>
  );
}
