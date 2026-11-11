'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { ingest } from '@/lib/i18n/messages/ingest';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';

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
  if (!props.canManage) return <p className="text-sm text-muted">{t('inbox.compareManagerOnly')}</p>;

  const done: Record<Action, string> = {
    separate: t('inbox.pageSeparated'),
    delete_duplicate: t('inbox.pageDuplicateDeleted'),
    close_unreadable: t('inbox.pageClosedUnreadable'),
    checked_together: t('inbox.pageCheckedTogether'),
  };
  async function run(action: Action) {
    try {
      await resolve.mutateAsync({ documentId: props.documentId, action });
      toast.success(done[action]);
      router.push('/dashboard/approvals');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error && /[֐-׿]/.test(err.message) ? err.message : t('errors.unknown');
      toast.error(t('inbox.actionFailed', { message: msg }));
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
  const confirmFirst = (a: Action) => a === 'delete_duplicate' || (a === 'separate' && (props.flag === 'page_duplicate' || PAGE_ONE.includes(props.flag)));
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
        title={confirm === 'delete_duplicate' ? t('inbox.pageDeleteConfirmTitle') : t('inbox.pageSeparateConfirmTitle')}
        body={
          <span>
            {confirm === 'delete_duplicate'
              ? t('inbox.pageDeleteConfirmBody')
              : props.flag === 'page_duplicate'
                ? t('inbox.pageSeparateConfirmBody')
                : t('inbox.pageSeparateBothBody', { page: ils(props.pageTotal), other: ils(props.otherTotal) })}
          </span>
        }
        amount={props.pageTotal ?? undefined}
        party={props.supplier ?? undefined}
        confirmLabel={confirm ? label[confirm] : ''}
        cancelLabel={t('inbox.keep')}
        danger
        loading={resolve.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const a = confirm;
          setConfirm(null);
          if (a) void run(a);
        }}
      />
    </div>
  );
}
