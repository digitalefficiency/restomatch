'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, FilterChip, Input, Sheet, friendlyError, useToast } from '@/lib/components';
import { moneyText } from '@/lib/components/money/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { classifyQty, qtyText } from '../inventory-ui';
import { lineValueAgorot } from '../count/guard';

/** The closed count as a CSV file for the accountant (UTF-8 with BOM, opens in Excel). */
export function CsvButton({ countId }: { countId: string }) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className="touch-target"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { filename, csv } = await utils.inventory.exportCsv.fetch({ countId });
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          toast.error(friendlyError(e, tc));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('detail.csv')}
    </Button>
  );
}

const REASONS = ['reasonTypo', 'reasonUnit', 'reasonForgot', 'reasonOther'] as const;

/**
 * Owner-only correction of one line of a closed count ("תיקון כמות"): a decimal
 * qty, a reason chip (or free text) that goes to the audit log, and the ₪
 * before → after for money viewers. A short reason shows an inline error — never
 * a silent abort.
 */
export function AmendSheet({
  countId,
  line,
  money,
  onClose,
}: {
  countId: string;
  line: { productId: string; unit: string; qty: string | null; unitCost: string | null; valueAgorot: number | null };
  money: boolean;
  onClose: () => void;
}) {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [raw, setRaw] = useState(qtyText(line.qty));
  const [reasonKey, setReasonKey] = useState<(typeof REASONS)[number] | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const amend = trpc.inventory.amendLine.useMutation({
    onSuccess: () => {
      toast.success(t('detail.amended'));
      onClose();
      router.refresh();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const parsed = classifyQty(raw);
  const qty = parsed.kind === 'ok' ? parsed.value : parsed.kind === 'empty' ? null : undefined;
  const after = qty === undefined ? null : lineValueAgorot(qty, line.unitCost);
  const reason = reasonKey && reasonKey !== 'reasonOther' ? `${t(`detail.${reasonKey}`)}${reasonText.trim() ? ` · ${reasonText.trim()}` : ''}` : reasonText.trim();
  const save = () => {
    if (qty === undefined) {
      setError(t('period.salesInvalid'));
      return;
    }
    if (reason.length < 3) {
      setError(t('detail.reasonShort'));
      return;
    }
    setError(null);
    amend.mutate({ countId, productId: line.productId, qty, reason });
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('detail.amend')}
      primary={
        <Button size="xl" loading={amend.isPending} onClick={save} data-testid="amend-save">
          {t('detail.amendSave')}
        </Button>
      }
    >
      <label className="block text-sm text-muted" htmlFor="amend-qty">
        {t('detail.amendQty', { unit: line.unit })}
      </label>
      <Input id="amend-qty" inputMode="decimal" dir="ltr" autoComplete="off" className="mt-1 text-base" value={raw} onChange={(e) => setRaw(e.target.value)} />
      {parsed.kind === 'ambiguous' ? <p className="mt-1 text-sm text-ink">{t('count.ambiguous', { a: parsed.options[0], b: parsed.options[1] })}</p> : null}
      {money && line.unitCost ? (
        <p className="mt-2 text-sm text-muted" data-testid="amend-value">
          {t('detail.amendValue', {
            before: moneyText((line.valueAgorot ?? 0) / 100, 'line', locale),
            after: after == null ? '—' : moneyText(after / 100, 'line', locale),
          })}
        </p>
      ) : null}
      <fieldset className="mt-3">
        <legend className="text-sm text-muted">{t('detail.amendReason')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {REASONS.map((k) => (
            <FilterChip key={k} label={t(`detail.${k}`)} active={reasonKey === k} onClick={() => setReasonKey(k)} />
          ))}
        </div>
      </fieldset>
      <Input
        aria-label={t('detail.amendReason')}
        className="mt-2 text-base"
        value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'amend-error' : undefined}
      />
      {error ? (
        <p id="amend-error" className="mt-1 text-sm text-danger" role="status">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
