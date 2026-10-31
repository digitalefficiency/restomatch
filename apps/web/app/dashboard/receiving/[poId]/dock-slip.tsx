'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileWarning, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import type { LineMark } from '@/app/showcase/receiver/_state';
import { ItemName, useUnitLabel } from '@/app/showcase/receiver/_steps/english';
import { Badge } from '@/lib/components';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { receiving } from '@/lib/i18n/messages/receiving';
import { approvals } from '@/lib/i18n/messages/approvals';
import { waLink } from '@/lib/messageTemplates';
import { discrepancyLabel } from '../../approvals/vocab';
import { buildSlipLines, issueMessageKey, needsSlip, slipBullet, slipNote, sumIls, type SlipLine } from './_dockSlip';

/** Stop polling for the engine after this long; the slip still shows quantities. */
const ENGINE_WAIT_MS = 120_000;

/**
 * Dock dispute slip ("תעודת פערים", flag `dockSlip`): the verdict at the dock,
 * while the driver is still there. Quantities from the receiver's count; ₪ only
 * from the matching engine (same allocation as the claims letters). Copy text or
 * open WhatsApp with it pre-filled — nothing is sent by us.
 */
export function DockSlip({
  grId,
  invoiceId,
  lines,
  marks,
  duplicateNumber,
  fallbackSupplierName,
  showMoney = true,
}: {
  grId: string;
  invoiceId: string | null;
  lines: ReconciliationLine[];
  marks: Record<string, LineMark>;
  duplicateNumber: string | null;
  fallbackSupplierName: string;
  /** Off for the receiver and the chef (owner decision): the slip carries quantities only — no ₪, not in its text either. */
  showMoney?: boolean;
}) {
  const t = useT(receiving);
  const ta = useT(approvals);
  const locale = useLocale();
  const dir = useDir();
  const unit = useUnitLabel();
  const startedAt = useRef(Date.now());
  const [copied, setCopied] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  const q = trpc.receiving.dockSlip.useQuery(
    { grId, invoiceId },
    {
      // Poll only while the receipt is closed and its re-match is on the way.
      refetchInterval: (query) => {
        const d = query.state.data;
        // Held re-matches poll too (quietly — the note already says why): a
        // manager's match.runForInvoice can still bring the ₪ in.
        const waiting = showMoney && !!invoiceId && d?.enabled === true && d.engine.receiptClosed && !d.engine.ready;
        return waiting && Date.now() - startedAt.current < ENGINE_WAIT_MS ? 4_000 : false;
      },
    },
  );
  const data = q.data?.enabled ? q.data : null;
  const waiting = !!invoiceId && !!data && data.engine.receiptClosed && !data.engine.ready;
  // After ENGINE_WAIT_MS stop the spinner: a calm note + a manual refresh.
  useEffect(() => {
    if (!waiting || gaveUp) return;
    const left = ENGINE_WAIT_MS - (Date.now() - startedAt.current);
    const timer = setTimeout(() => setGaveUp(true), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [waiting, gaveUp]);
  function refresh() {
    startedAt.current = Date.now();
    setGaveUp(false);
    void q.refetch();
  }

  const slipLines = useMemo(
    () => buildSlipLines(lines, marks, data?.engine.lines ?? []),
    [lines, marks, data?.engine.lines],
  );
  const total = data && showMoney ? sumIls(slipLines.map((l) => l.amountIls ?? 0)) : 0;
  const dup = duplicateNumber ?? data?.invoice?.duplicateOfNumber ?? null;

  // Nothing to dispute: no flagged line, no engine finding, no duplicate.
  if (q.isLoading || !data || !needsSlip(slipLines, dup)) return null;
  // The notes are all about when the ₪ arrives — nothing to say without ₪.
  const note = showMoney ? slipNote(data.engine, !!invoiceId, gaveUp) : null;
  const engineReady = showMoney && data.engine.ready;
  const amountOf = (l: SlipLine) => (showMoney ? l.amountIls : null);

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const qty = (v: number | null, u: string | null) =>
    v === null ? '—' : `${formatNumber(v, locale, { maximumFractionDigits: 3 })}${u ? ` ${unit(u)}` : ''}`;
  const name = (l: SlipLine) => (locale === 'en' && l.nameEn ? l.nameEn : l.name);
  const supplier =
    (locale === 'en' && data.header.supplierNameEn ? data.header.supplierNameEn : data.header.supplierName) ??
    fallbackSupplierName;
  // One reference everywhere (orders-12): the one printed on the order the
  // supplier received (api orders/supplierMessage poRefOf: first 8 hex, upper-case).
  const poRef = data.header.poRef ?? (data.header.poId ? data.header.poId.replace(/-/g, '').slice(0, 8).toUpperCase() : '—');
  const invoiceNo = data.invoice?.number ?? '—';
  const at = formatDate(data.header.receivedAt ?? new Date(), locale, { dateStyle: 'short', timeStyle: 'short' });

  function issueTexts(l: SlipLine): string[] {
    const out = l.issues.map((i) =>
      t(`dockSlip.issue.${issueMessageKey(i, engineReady)}`, {
        ordered: qty(l.ordered, l.unit),
        received: qty(l.received, l.unit),
        rejected: qty(l.rejected, l.unit),
        invoiced: qty(l.invoiced, l.unit),
        po: l.poPrice === null ? '—' : money(l.poPrice),
        invoice: l.invoicePrice === null ? '—' : money(l.invoicePrice),
      }),
    );
    if (out.length === 0) out.push(...l.engineTypes.map((type) => discrepancyLabel(ta, type)));
    return out;
  }

  const text = [
    `${t('dockSlip.title')} — ${supplier}`,
    `${t('dockSlip.po')}: ${poRef} · ${t('dockSlip.invoice')}: ${invoiceNo}`,
    `${t('dockSlip.at')}: ${at}${data.header.receiverName ? ` · ${t('dockSlip.receiver')}: ${data.header.receiverName}` : ''}`,
    ...(dup ? [t('dockSlip.duplicate', { number: dup })] : []),
    '',
    ...slipLines.map(
      (l) => slipBullet(name(l), issueTexts(l), amountOf(l) !== null ? money(amountOf(l)!) : null),
    ),
    ...(total > 0 ? ['', `${t('dockSlip.total')}: ${money(total)}`] : []),
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard blocked — the WhatsApp link still carries the text */
    }
  }
  const phone = data.header.supplierWhatsapp;
  const wa = phone ? waLink(phone, text) : `https://wa.me/?text=${encodeURIComponent(text)}`;

  return (
    <section
      dir={dir}
      data-testid="dock-slip"
      aria-labelledby="dock-slip-title"
      className="mt-6 rounded-2xl border border-line-strong bg-surface p-4 text-start shadow-card sm:p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dock-slip-title" className="flex items-center gap-2 text-lg font-bold text-ink">
            <FileWarning className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
            {t('dockSlip.title')}
          </h2>
          <p className="mt-0.5 text-base text-muted">{t('dockSlip.subtitle')}</p>
        </div>
        {total > 0 ? (
          // T2 (act now): solid badge + ₪ (engine total = the claims letters) + one primary CTA below.
          <span data-testid="dock-slip-total" className="shrink-0">
            <Badge tone="warning-solid" className="px-3 py-1 text-base font-bold">
              <bdi className="tabular-nums">{money(total)}</bdi>
            </Badge>
          </span>
        ) : null}
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-surface-2 p-3 text-sm">
        <dt className="text-muted">{t('dockSlip.supplier')}</dt>
        <dd className="font-medium text-ink" data-testid="dock-slip-supplier">{supplier}</dd>
        <dt className="text-muted">{t('dockSlip.po')}</dt>
        <dd className="font-mono text-ink"><bdi dir="ltr">{poRef}</bdi></dd>
        <dt className="text-muted">{t('dockSlip.invoice')}</dt>
        <dd className="font-mono text-ink"><bdi dir="ltr">{invoiceNo}</bdi></dd>
        <dt className="text-muted">{t('dockSlip.at')}</dt>
        <dd className="text-ink"><bdi dir="ltr">{at}</bdi></dd>
        {data.header.receiverName ? (
          <>
            <dt className="text-muted">{t('dockSlip.receiver')}</dt>
            <dd className="text-ink">{data.header.receiverName}</dd>
          </>
        ) : null}
      </dl>

      {dup ? (
        <p data-testid="dock-slip-duplicate" className="mb-3 rounded-xl border border-warn/40 bg-surface px-3 py-2 text-base text-ink">
          {t('dockSlip.duplicate', { number: dup })}
        </p>
      ) : null}

      <ul className="divide-y divide-line">
        {slipLines.map((l) => (
          <li key={l.key} data-testid="dock-slip-line" className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <ItemName he={l.name} en={l.nameEn} className="text-base font-semibold text-ink" />
              <ul className="mt-0.5 space-y-0.5 text-sm text-ink tabular-nums">
                {issueTexts(l).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="shrink-0 text-end text-base">
              {amountOf(l) !== null ? (
                <bdi data-testid="dock-slip-amount" className="font-semibold tabular-nums text-ink">
                  {money(amountOf(l)!)}
                </bdi>
              ) : showMoney ? (
                <span className="text-sm text-muted">{t('dockSlip.quantitiesOnly')}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {note === 'afterClose' ? (
        <p className="mt-2 text-sm text-muted" data-testid="dock-slip-after-close">
          {t('dockSlip.afterClose')}
        </p>
      ) : note === 'held' ? (
        <p className="mt-2 text-sm text-muted" data-testid="dock-slip-held">
          {t(data.engine.holdReason === 'settled' ? 'dockSlip.heldSettled' : 'dockSlip.heldReview')}
        </p>
      ) : note === 'computing' ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted" data-testid="dock-slip-computing">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('dockSlip.computing')}
        </p>
      ) : note === 'slow' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="dock-slip-slow">
          <span>{t('dockSlip.slow')}</span>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-4 font-semibold text-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('dockSlip.refresh')}
          </button>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-base font-bold text-ink">
          <span>{t('dockSlip.total')}</span>
          <bdi className="tabular-nums" data-testid="dock-slip-total-line">{money(total)}</bdi>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="dock-slip-whatsapp"
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-base font-semibold text-on-primary"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {phone ? t('dockSlip.whatsapp') : t('dockSlip.share')}
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          data-testid="dock-slip-copy"
          data-slip-text={text}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-base font-medium text-ink"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? t('dockSlip.copied') : t('dockSlip.copy')}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">{t('dockSlip.noSend')}</p>
    </section>
  );
}
