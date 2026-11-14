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
  /**
   * Round 11 (M5/M6): every invoice shown — the page, each head it may continue, and
   * the carrier the head is already included in — with its supplier, number and ₪.
   */
  options?: Array<{ id: string; role: 'page' | 'head' | 'carrier'; supplier: string | null; number: string | null; total: number | null }>;
}) {
  const t = useT(ingest);
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const resolve = trpc.ingest.resolvePageFlag.useMutation();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const options = props.options ?? [];
  const headOptions = options.filter((o) => o.role === 'head');
  // Round 11 (M5): default carrier = the invoice that carries the printed document total
  // (the largest printed ₪ among them) — never a guess without ₪.
  const totalCarrier = options.filter((o) => o.total !== null).sort((x, y) => (y.total ?? 0) - (x.total ?? 0))[0] ?? null;
  const [payable, setPayable] = useState<string | null>(totalCarrier?.id ?? null);
  const [withHead, setWithHead] = useState<string | null>(props.otherInvoiceId);
  const [smallerOk, setSmallerOk] = useState(false);
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
          ? { payableInvoiceId: payable, ...(withHead ? { withInvoiceId: withHead } : {}) }
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
  const describe = (o: { supplier: string | null; number: string | null; total: number | null }) =>
    [o.supplier, o.number, o.total !== null ? ils(o.total) : null].filter(Boolean).join(' · ') || '—';
  const pickedOption = options.find((o) => o.id === payable) ?? null;
  const smallerPick = Boolean(
    pickedOption && totalCarrier && pickedOption.id !== totalCarrier.id && (pickedOption.total ?? 0) < (totalCarrier.total ?? 0),
  );

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
              {/* Round 11 (M6): the page may continue more than one invoice — the person says which. */}
              {headOptions.length > 1 ? (
                <span role="radiogroup" aria-label={t('inbox.pageTogetherWithTitle')} className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-ink">{t('inbox.pageTogetherWithTitle')}</span>
                  {headOptions.map((o) => (
                    <label key={`with-${o.id}`} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3">
                      <input type="radio" name="with" checked={withHead === o.id} onChange={() => setWithHead(o.id)} />
                      <span>{describe(o)}</span>
                    </label>
                  ))}
                </span>
              ) : null}
              <span role="radiogroup" aria-label={t('inbox.pageTogetherConfirmTitle')} className="flex flex-col gap-2">
                {options
                  .filter((o) => o.role === 'page' || o.role === 'carrier' || o.id === withHead)
                  .map((o) => (
                    <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3">
                      <input
                        type="radio"
                        name="payable"
                        checked={payable === o.id}
                        onChange={() => {
                          setPayable(o.id);
                          setSmallerOk(false);
                          setPickMissing(false);
                        }}
                      />
                      <span>{t('inbox.pageTogetherPickOption', { what: describe(o) })}</span>
                    </label>
                  ))}
              </span>
              {/* Round 11 (M5): making the invoice with the bigger printed total "included" in a smaller one needs an explicit yes. */}
              {smallerPick ? (
                <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-warn/50 bg-surface-2 px-3 py-2 text-sm">
                  <input type="checkbox" checked={smallerOk} onChange={(e) => setSmallerOk(e.target.checked)} />
                  <span>
                    {t('inbox.pageTogetherSmallerConfirm', { bigger: ils(totalCarrier?.total ?? null), picked: ils(pickedOption?.total ?? null) })}
                  </span>
                </label>
              ) : null}
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
          if (a === 'checked_together' && (!payable || (smallerPick && !smallerOk))) {
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
