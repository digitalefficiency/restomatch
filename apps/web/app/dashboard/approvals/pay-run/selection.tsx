'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, useToast } from '@/lib/components';
import { BatchBar } from '@/lib/components/table/BatchBar';
import { downloadCsv, type CsvColumn, type CsvRow } from '@/lib/components/views';
import { useLocale, useT } from '@/lib/i18n/client';
import { payRun as payRunNs } from '@/lib/i18n/messages/payRun';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';

/** One selectable pay-run row, as the server rendered it. */
export interface SelectableRow {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string;
  /** Total incl. VAT in integer agorot (exact payment figure). */
  agorot: number;
  csv: CsvRow;
}

interface Ctx {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
}
const SelectionCtx = createContext<Ctx>({ selected: new Set(), toggle: () => {}, clear: () => {} });
// Same cast as Toast.tsx: the repo's mixed @types/react copies reject Context.Provider as a JSX type.
const SelectionProvider = SelectionCtx.Provider as unknown as React.ComponentType<{
  value: Ctx;
  children?: ReactNode;
}>;

const METHODS = ['bank_transfer', 'check', 'cash', 'credit_card', 'other'] as const;
type Method = (typeof METHODS)[number];

/**
 * W2-03 · the pay-run batch: a client island around the server-rendered table. Only payable rows
 * (no hold of any kind) get a checkbox. Mark-paid is NOT an approval, so there is no ₪200 cap
 * (`capAgorot: null`); held / duplicate / missing-allocation rows are never selectable. The
 * mark-paid action appears only while the server flag PAY_RUN_MARK_PAID is on (after H-03).
 */
export function PayRunSelection({
  rows,
  markPaidEnabled,
  today,
  csvColumns,
  csvFile,
  children,
}: {
  rows: SelectableRow[];
  markPaidEnabled: boolean;
  today: string;
  csvColumns: CsvColumn[];
  csvFile: string;
  children: ReactNode;
}) {
  const t = useT(payRunNs);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'mark' | 'undo' | null>(null);
  const [lastMarked, setLastMarked] = useState<SelectableRow[]>([]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.invoiceId, r])), [rows]);

  // Drop ids that left the list (after a refresh).
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => byId.has(id))));
  }, [byId]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const chosen = [...selected].map((id) => byId.get(id)).filter((r): r is SelectableRow => !!r);
  const sumAgorot = chosen.reduce((s, r) => s + r.agorot, 0);
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });

  const markPaid = trpc.payRun.markPaid.useMutation();
  const unmarkPaid = trpc.payRun.unmarkPaid.useMutation();

  const errText = (e: { data?: { code?: string } | null; message?: string }) =>
    e.data?.code === 'PRECONDITION_FAILED'
      ? t('batch.openLeak')
      : e.data?.code === 'CONFLICT'
        ? t('batch.conflict')
        : e.data?.code === 'NOT_IMPLEMENTED'
          ? t('batch.notYet')
          : (e.message ?? '');

  const runMark = async (form: { paidOn: string; method: Method; reference: string }) => {
    const items = chosen.map((r) => ({
      invoiceId: r.invoiceId,
      expectedStatus: r.invoiceStatus as never,
    }));
    try {
      await markPaid.mutateAsync({
        items,
        paidOn: form.paidOn,
        method: form.method,
        reference: form.reference || undefined,
        clientMutationId: crypto.randomUUID(),
      });
      const done = chosen;
      setDialog(null);
      clear();
      setLastMarked(done);
      toast.success(t('batch.done', { count: String(done.length), amount: ils(sumAgorot) }), {
        action: { label: t('batch.undo'), onClick: () => setDialog('undo') },
      });
      router.refresh();
    } catch (e) {
      toast.error(errText(e as never));
    }
  };

  const runUndo = async (reason: string) => {
    try {
      await unmarkPaid.mutateAsync({
        items: lastMarked.map((r) => ({ invoiceId: r.invoiceId, expectedStatus: 'paid' as const })),
        reason,
        clientMutationId: crypto.randomUUID(),
      });
      setDialog(null);
      setLastMarked([]);
      toast.success(t('batch.undone'));
      router.refresh();
    } catch (e) {
      toast.error(errText(e as never));
    }
  };

  const ctx = useMemo(() => ({ selected, toggle, clear }), [selected, toggle, clear]);
  return (
    <SelectionProvider value={ctx}>
      <BatchBar
        className="mb-3"
        count={chosen.length}
        sum={{ kind: 'sum', sumAgorot, unknownCount: 0 }}
        onClear={clear}
        actions={[
          ...(markPaidEnabled
            ? [
                {
                  id: 'mark',
                  label: t('batch.markPaid'),
                  primary: true,
                  onRun: () => setDialog('mark'),
                },
              ]
            : []),
          {
            id: 'export',
            label: t('batch.exportSel'),
            onRun: () =>
              downloadCsv(
                csvFile,
                csvColumns,
                chosen.map((r) => r.csv),
              ),
          },
        ]}
      />
      {children}
      {dialog === 'mark' ? (
        <MarkPaidDialog
          title={t('batch.dialogTitle', { count: String(chosen.length), amount: ils(sumAgorot) })}
          today={today}
          busy={markPaid.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={runMark}
        />
      ) : null}
      {dialog === 'undo' ? (
        <UndoDialog
          busy={unmarkPaid.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={runUndo}
        />
      ) : null}
    </SelectionProvider>
  );
}

/** The row checkbox (payable rows only). */
export function RowCheck({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useContext(SelectionCtx);
  return (
    <input
      type="checkbox"
      className="h-5 w-5 accent-primary"
      aria-label={label}
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      data-testid="payrun-select"
    />
  );
}

function useModal(onCancel: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onClose = () => onCancel();
    d?.addEventListener('close', onClose);
    return () => d?.removeEventListener('close', onClose);
  }, [onCancel]);
  return ref;
}

function MarkPaidDialog({
  title,
  today,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  today: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (f: { paidOn: string; method: Method; reference: string }) => void;
}) {
  const t = useT(payRunNs);
  const ref = useModal(onCancel);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<Method>('bank_transfer');
  const [reference, setReference] = useState('');
  return (
    <dialog
      ref={ref}
      className="!m-auto w-[min(28rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-5 text-ink"
      data-testid="payrun-mark-dialog"
    >
      <form
        method="dialog"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ paidOn, method, reference: reference.trim() });
        }}
      >
        <h2 className="text-base font-bold">{title}</h2>
        <label className="block text-sm font-semibold">
          {t('batch.paidOn')}
          <Input
            type="date"
            required
            max={today}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </label>
        <label className="block text-sm font-semibold">
          {t('batch.method')}
          <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`batch.methods.${m}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm font-semibold">
          {t('batch.reference')}
          <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onCancel} autoFocus>
            {t('batch.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('batch.confirm')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function UndoDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useT(payRunNs);
  const ref = useModal(onCancel);
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 3;
  return (
    <dialog
      ref={ref}
      className="!m-auto w-[min(28rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-5 text-ink"
      data-testid="payrun-undo-dialog"
    >
      <form
        method="dialog"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onConfirm(reason.trim());
        }}
      >
        <h2 className="text-base font-bold">{t('batch.undoTitle')}</h2>
        <label className="block text-sm font-semibold">
          {t('batch.reason')}
          <Input
            required
            minLength={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('batch.cancel')}
          </Button>
          <Button type="submit" disabled={!ok} loading={busy}>
            {t('batch.undoConfirm')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
