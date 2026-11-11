'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, FileWarning, Mail, MessageCircle } from 'lucide-react';
import { Badge, Button, cn, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { vat } from '@/lib/i18n/messages/vat';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';
import { supplierRequestText } from '@/lib/vat/requestText';
import {
  groupStage,
  handoffCtaKey,
  israelDay,
  newClientMutationId,
  stageLine,
  type AllocationStage,
} from '@/lib/vat/caseView';

export interface VatAtRiskRowView {
  invoiceId: string;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceDate: string;
  totalExclVat: number;
  vatAtRisk: number;
  allocationNumber: string | null;
  daysLeft: number;
  /** AU-08 case state (owner.vatAtRisk rows carry it; optional for older callers). */
  stage?: AllocationStage;
  requestedAt?: string | null;
}

const SHOWN = 3;

/**
 * "VAT at risk" card (flag vatAtRisk), next to — never inside — the leak hero.
 * A separate figure in the warn family: it is not a leak and is never summed
 * into one. T2 when there is something to act on (solid warn badge + ₪ + one
 * CTA that opens the Hebrew request text to copy); T3 calm when all clear.
 */
export function VatAtRiskCard({
  rows,
  total,
  thresholdIls,
  restaurantName,
}: {
  rows: VatAtRiskRowView[];
  total: number;
  thresholdIls: number;
  restaurantName: string;
}) {
  const t = useT(vat);
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const threshold = formatIls(thresholdIls, { locale });
  const supplierLabel = (r: Pick<VatAtRiskRowView, 'supplierName' | 'supplierNameEn'>) =>
    (locale === 'en' && r.supplierNameEn ? r.supplierNameEn : r.supplierName) ?? '—';

  // One request per supplier, listing all of that supplier's invoices.
  const requests = useMemo(() => {
    const by = new Map<string, VatAtRiskRowView[]>();
    for (const r of rows) {
      const k = r.supplierId ?? `none:${r.invoiceId}`;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].map(([key, list]) => ({
      key,
      supplierId: list[0]!.supplierId,
      shown: supplierLabel(list[0]!),
      invoiceIds: list.map((r) => r.invoiceId),
      stage: groupStage(list.map((r) => r.stage ?? 'new')),
      requestedAt: list.reduce<string | null>((a, r) => (r.requestedAt && (!a || r.requestedAt > a) ? r.requestedAt : a), null),
      daysLeft: Math.min(...list.map((r) => r.daysLeft)),
      // Copy-only fallback for invoices with no supplier (no server draft to ask for).
      fallbackText: supplierRequestText({ supplierName: list[0]!.supplierName ?? 'ספק', restaurantName, invoices: list }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, restaurantName, locale]);

  if (rows.length === 0) {
    return (
      <section
        data-testid="vat-at-risk-card"
        data-state="clear"
        className="mt-4 flex items-start gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card"
      >
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-bold text-ink">{t('card.clear', { threshold })}</h2>
          <p className="mt-1 text-sm text-muted">{t('card.clearHint')}</p>
        </div>
      </section>
    );
  }

  // H8: the deadline sets the tone — neutral while far, warn inside 30 days, danger inside 7.
  const minDays = Math.min(...rows.map((r) => r.daysLeft));
  const urgency: 'neutral' | 'warn' | 'danger' = minDays <= 7 ? 'danger' : minDays <= 30 ? 'warn' : 'neutral';
  const tone = {
    neutral: { border: 'border-line', rail: 'bg-line-strong', icon: 'text-muted', badge: 'neutral' as const, amount: 'text-ink' },
    warn: { border: 'border-warn/40', rail: 'bg-warn', icon: 'text-warn', badge: 'warning-solid' as const, amount: 'text-warn' },
    danger: { border: 'border-danger/40', rail: 'bg-danger', icon: 'text-danger', badge: 'danger-solid' as const, amount: 'text-danger' },
  }[urgency];

  return (
    <section
      data-testid="vat-at-risk-card"
      data-state="at-risk"
      data-urgency={urgency}
      className={cn('relative mt-4 overflow-hidden rounded-2xl border bg-surface p-5 shadow-card', tone.border)}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-1', tone.rail)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold text-ink">
            <FileWarning className={cn('h-5 w-5 shrink-0', tone.icon)} aria-hidden="true" />
            {t('card.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('card.subtitle', { threshold })}</p>
        </div>
        <Badge tone={tone.badge}>
          {rows.length === 1 ? t('card.countOne') : t('card.count', { count: formatNumber(rows.length, locale) })}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-1">
        <div>
          <p className="text-xs font-semibold text-muted">{t('card.amountLabel')}</p>
          <p className={cn('text-2xl font-bold tabular-nums', tone.amount)} data-testid="vat-at-risk-total">
            {formatIls(total, { locale })}
          </p>
        </div>
        <p className="text-xs text-subtle">{t('card.separate')}</p>
      </div>

      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {rows.slice(0, SHOWN).map((r) => {
          const name = supplierLabel(r);
          return (
            <li key={r.invoiceId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <Link
                href={`/dashboard/invoices/${r.invoiceId}`}
                className="touch-target w-full min-w-0 font-semibold text-ink hover:text-primary hover:underline"
              >
                <span {...originalProps(name)}>{name}</span>
                <span className="text-muted">
                  {' · '}
                  {r.invoiceNumber ? t('card.invoiceNo', { number: r.invoiceNumber }) : t('card.noInvoiceNo')}
                  {' · '}
                  {formatDate(r.invoiceDate, locale)}
                </span>
              </Link>
              <span className="text-xs text-muted">{r.allocationNumber ? t('card.badNumber') : t('card.noNumber')}</span>
              <span className="whitespace-nowrap text-xs font-semibold text-ink">
                {r.daysLeft === 0 ? t('card.lastDay') : t('card.daysLeft', { days: formatNumber(r.daysLeft, locale) })}
              </span>
              <span className="ms-auto whitespace-nowrap font-semibold tabular-nums text-ink">
                {formatIls(r.vatAtRisk, { locale })}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > SHOWN ? (
        <p className="mt-2 text-xs text-muted">{t('card.more', { count: formatNumber(rows.length - SHOWN, locale) })}</p>
      ) : null}

      <div className="mt-5">
        <Button className="min-h-12 w-full sm:w-auto" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="vat-request-cta">
          {t('card.cta')}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4" data-testid="vat-request-panel">
          <p className="text-sm text-muted">{t('request.hint')}</p>
          {requests.map((q) =>
            q.supplierId ? (
              <SupplierRequest
                key={q.key}
                supplierId={q.supplierId}
                shown={q.shown}
                invoiceIds={q.invoiceIds}
                stage={q.stage}
                requestedAt={q.requestedAt}
                daysLeft={q.daysLeft}
              />
            ) : (
              <CopyOnlyRequest key={q.key} shown={q.shown} text={q.fallbackText} />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

/** How long "סומן כנשלח" can be undone before the request is recorded (shared undo pattern, ≥10 s). */
const MARK_UNDO_MS = 10_000;

/**
 * AU-08 (A13): one supplier's allocation request inside the card.
 *
 * Stage line ("טרם נשלחה בקשה" / "נשלחה בקשה לפני 4 ימים" / "אין מענה 9 ימים ·
 * שלחו תזכורת"), the server draft (first ask or a gentle reminder), and the
 * hand-off: wa.me / mailto / copy. The server sends nothing. Right after a tap
 * the UI offers "סומן כנשלח" with a 10 s undo and only then records the
 * request (`vat.markRequested`; audit rows are append-only, so undo = never
 * written). Owner + bookkeeper only (`canWrite`); a manager sees the draft.
 */
function SupplierRequest({
  supplierId,
  shown,
  invoiceIds,
  stage,
  requestedAt,
  daysLeft,
}: {
  supplierId: string;
  shown: string;
  invoiceIds: string[];
  stage: AllocationStage;
  requestedAt: string | null;
  daysLeft: number;
}) {
  const t = useT(vat);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const [marked, setMarked] = useState(false);
  const pending = useRef<number | null>(null);
  const draftQ = trpc.vat.requestDraft.useQuery({ supplierId }, { retry: false });
  const mark = trpc.vat.markRequested.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.vat.requestDraft.invalidate({ supplierId }), utils.owner.vatAtRisk.invalidate()]);
    },
    onError: () => setMarked(false),
  });
  useEffect(() => () => {
    if (pending.current) window.clearTimeout(pending.current);
  }, []);

  const draft = draftQ.data;
  const effectiveRequestedAt = draft?.lastRequestedAt ?? requestedAt;
  const line = stageLine({ stage, requestedAt: effectiveRequestedAt, daysLeft, todayIso: israelDay(new Date()) });
  const text = draft?.text ?? '';
  const canWrite = draft?.canWrite ?? false;

  const scheduleMark = (channel: 'whatsapp' | 'email' | 'copy') => {
    if (!canWrite || marked || !draft || draft.invoices.length === 0) return;
    setMarked(true);
    const ids = draft.invoices.map((i) => i.invoiceId).filter((id) => invoiceIds.includes(id));
    const clientMutationId = newClientMutationId();
    pending.current = window.setTimeout(() => {
      pending.current = null;
      mark.mutate({ supplierId, invoiceIds: ids.length ? ids : invoiceIds, channel, clientMutationId });
    }, MARK_UNDO_MS);
    toast.success(t('case.markedSent'), {
      duration: MARK_UNDO_MS,
      action: {
        label: t('case.undo'),
        onClick: () => {
          if (pending.current) window.clearTimeout(pending.current);
          pending.current = null;
          setMarked(false);
        },
      },
    });
  };

  const cta = t(handoffCtaKey(effectiveRequestedAt) as never);

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4" data-testid="vat-request-supplier" data-stage={stage}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {t('request.title')} — <span {...originalProps(shown)}>{shown}</span>
        </p>
        <p className="text-xs font-semibold text-muted" data-testid="vat-request-stage">
          {t(line.key as never, line.params as never)}
        </p>
      </div>
      {draftQ.isLoading ? <p className="text-sm text-muted">…</p> : null}
      {text ? (
        <textarea
          readOnly
          dir="rtl"
          lang="he"
          rows={Math.min(12, text.split('\n').length + 1)}
          value={text}
          aria-label={`${t('request.title')} — ${shown}`}
          className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink"
          data-testid="vat-request-text"
        />
      ) : null}
      {draft ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {draft.waHref ? (
            <a
              href={draft.waHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => scheduleMark('whatsapp')}
              data-testid="vat-request-wa"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-primary bg-surface px-4 text-sm font-semibold text-primary"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {cta}
            </a>
          ) : null}
          {draft.mailtoHref ? (
            <a
              href={draft.mailtoHref}
              onClick={() => scheduleMark('email')}
              data-testid="vat-request-mail"
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-control border bg-surface px-4 text-sm font-semibold',
                draft.waHref ? 'border-line-strong text-ink' : 'border-primary text-primary',
              )}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {draft.waHref ? t('case.byEmail') : cta}
            </a>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            disabled={!text}
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => null);
              setCopied(true);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? t('request.copied') : t('request.copy')}
          </Button>
          {canWrite && text ? (
            <Button
              variant="tertiary"
              size="sm"
              className="min-h-11"
              disabled={marked}
              onClick={() => scheduleMark('copy')}
              data-testid="vat-request-mark"
            >
              {marked ? t('case.markedSent') : t('case.markSent')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {draft?.needsContact ? (
        <p className="mt-2 text-xs text-muted">
          {t('case.copyOnly')}{' '}
          <Link href={draft.supplierHref} className="font-semibold text-primary underline underline-offset-4">
            {t('case.addContact')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Invoices with no supplier on record: the copy-only text, as before. */
function CopyOnlyRequest({ shown, text }: { shown: string; text: string }) {
  const t = useT(vat);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <p className="mb-2 text-sm font-semibold text-ink">
        {t('request.title')} — <span {...originalProps(shown)}>{shown}</span>
      </p>
      <textarea
        readOnly
        dir="rtl"
        lang="he"
        rows={Math.min(12, text.split('\n').length + 1)}
        value={text}
        aria-label={`${t('request.title')} — ${shown}`}
        className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink"
        data-testid="vat-request-text"
      />
      <Button
        variant="secondary"
        size="sm"
        className="mt-2 min-h-11"
        onClick={async () => {
          await navigator.clipboard?.writeText(text).catch(() => null);
          setCopied(true);
        }}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        {copied ? t('request.copied') : t('request.copy')}
      </Button>
    </div>
  );
}
