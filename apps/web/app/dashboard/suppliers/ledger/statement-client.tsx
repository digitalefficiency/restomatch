'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { Badge, Button, Card, Field, Select, Textarea, type BadgeTone } from '@/lib/components';
import { displayName } from '../../approvals/vocab';

type Result = inferRouterOutputs<AppRouter>['suppliers']['reconcileStatement'];
type FlagKind = Result['flags'][number]['kind'];

/** T2 act-now (warn) for gaps; T3 calm gold for the good news "a credit we have not recorded". */
const TONE: Record<FlagKind, BadgeTone> = {
  invoice_never_got: 'warning',
  billed_not_received: 'warning',
  amount_mismatch: 'warning',
  invoice_duplicate: 'warning',
  credit_missing: 'warning',
  credit_unrecorded: 'gold',
  payment_unapplied: 'warning',
};

export function StatementClient({
  suppliers,
  initialSupplierId,
}: {
  suppliers: Array<{ id: string; name: string; nameEn: string | null }>;
  initialSupplierId: string;
}) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const day = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00Z`, locale) : '—');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = trpc.suppliers.reconcileStatement.useMutation({
    onSuccess: (r) => {
      if (!r.headerFound) setError(t('statement.noHeader'));
      else if (r.lineCount === 0) setError(t('statement.noLines'));
    },
    onError: (e) => setError(e.message),
  });
  const result = run.data && run.data.lineCount > 0 ? run.data : null;

  return (
    <div className="space-y-4">
      <Card elevated>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            run.mutate({ supplierId, csv: text });
          }}
        >
          <Field label={t('statement.supplier')}>
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                // Another supplier's result must never stay on screen under this one's name.
                run.reset();
                setError(null);
              }}
              required
            >
              <option value="" disabled>
                {t('statement.pickSupplier')}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {displayName(locale, s.name, s.nameEn)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('statement.paste')} hint={error ?? undefined}>
            <Textarea
              dir="auto"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('statement.pastePlaceholder')}
              className="font-mono text-xs"
            />
          </Field>
          {run.data && run.data.skipped.length > 0 ? (
            <p className="text-xs text-muted">
              {t('statement.skipped', {
                count: formatNumber(run.data.skipped.length, locale),
                rows: run.data.skipped.slice(0, 8).map((s) => s.row).join(', '),
              })}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="primary" loading={run.isPending} disabled={!supplierId || !text.trim()}>
              {t('statement.run')}
            </Button>
          </div>
        </form>
      </Card>

      {result ? (
        <Card elevated>
          <div className="space-y-1 text-sm text-muted">
            <p>{t('statement.period', { from: day(result.period.from), to: day(result.period.to) })}</p>
            <p>
              {t('statement.totals', {
                invoiced: ils(result.totals.invoicedAgorot),
                credited: ils(result.totals.creditedAgorot),
                paid: ils(result.totals.paidAgorot),
              })}
            </p>
            <p>
              {t('statement.matched', {
                invoices: formatNumber(result.matched.invoices, locale),
                credits: formatNumber(result.matched.credits, locale),
              })}
            </p>
          </div>
          {result.flags.length === 0 ? (
            <p className="mt-3 font-semibold text-success" data-testid="statement-clean">
              {t('statement.clean')}
            </p>
          ) : (
            <>
              <h2 className="mt-4 text-base font-semibold text-ink">
                {t('statement.flagsTitle', { count: formatNumber(result.flags.length, locale) })}
              </h2>
              <ul className="mt-2 divide-y divide-line" data-testid="statement-flags">
                {result.flags.map((f, i) => (
                  <li key={`${f.kind}:${f.row ?? f.creditNoteId ?? i}`} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={TONE[f.kind]}>{t(`statement.flag.${f.kind}`)}</Badge>
                        {f.number ? (
                          <bdi dir="ltr" className="text-xs tabular-nums text-muted">
                            {f.number}
                          </bdi>
                        ) : null}
                        {f.row ? <span className="text-xs text-subtle">{t('statement.row', { row: f.row })}</span> : null}
                        {f.date ? <span className="text-xs text-subtle">{day(f.date)}</span> : null}
                      </div>
                      <p className="text-sm text-muted">
                        {t(`statement.hint.${f.kind}`, { amount: ils(Math.abs(f.diffAgorot ?? f.amountAgorot)) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums text-ink">{ils(f.amountAgorot)}</span>
                      {f.invoiceId ? (
                        <Link href={`/dashboard/invoices/${f.invoiceId}`} className="text-sm font-semibold text-primary hover:underline">
                          {t('statement.ours')}
                        </Link>
                      ) : null}
                      {f.kind === 'credit_unrecorded' || f.kind === 'credit_missing' ? (
                        <Link href="/dashboard/recovery" className="text-sm font-semibold text-primary hover:underline">
                          {t('statement.openRecovery')}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
