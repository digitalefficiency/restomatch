'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowLeftRight, FileText, ShieldAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { Badge, Button, Card, LoadMore, Textarea, type BadgeTone } from '@/lib/components';
import {
  discrepancyExplain,
  discrepancyLabel,
  displayName,
  ruleLabel,
  severityLabel,
  toleranceLabel,
} from './vocab';

type QueueItem = inferRouterOutputs<AppRouter>['approvals']['myQueue'][number];

/** The view filters the server page was rendered with (URL → myQueue input). */
export interface QueueFilters {
  types?: QueueItem['type'][];
  severities?: QueueItem['severity'][];
  supplierIds?: string[];
}

// Must equal the server page size so "has more" is right on first paint.
const PAGE = 50;

export function ApprovalsList({
  initial,
  filters = {},
  density = 'comfortable',
}: {
  initial: QueueItem[];
  filters?: QueueFilters;
  density?: 'comfortable' | 'compact';
}) {
  const compact = density === 'compact';
  const t = useT(approvals);
  const locale = useLocale();
  const utils = trpc.useUtils();

  // Local list seeded from the server page; cursor pagination appends older rows.
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which row a mutation is running for (so only that row's button spins).
  const [busyId, setBusyId] = useState<string | null>(null);

  // After a decision, refetch the first page so the resolved row drops out.
  async function refreshFirstPage() {
    const fresh = await utils.approvals.myQueue.fetch({ limit: PAGE, ...filters });
    setItems(fresh);
    setHasMore(fresh.length >= PAGE);
  }
  const onError = (err: { data?: { code?: string } | null }) =>
    setError(err.data?.code === 'FORBIDDEN' ? t('card.forbidden') : t('card.error'));
  const handlers = {
    onSuccess: async () => {
      setError(null);
      await refreshFirstPage();
    },
    onError,
    onSettled: () => setBusyId(null),
  };

  const approve = trpc.approvals.approve.useMutation(handlers);
  const reject = trpc.approvals.reject.useMutation(handlers);
  const escalate = trpc.approvals.escalate.useMutation(handlers);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await utils.approvals.myQueue.fetch({
        limit: PAGE,
        ...filters,
        cursor: new Date(last.createdAt).toISOString(),
      });
      setItems((prev) => [...prev, ...next]);
      setHasMore(next.length >= PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  const [activeReject, setActiveReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // At-a-glance summary above the queue: how many decisions and ₪ at risk.
  const { atRisk, blockers } = useMemo(() => {
    let sum = 0;
    let blk = 0;
    for (const d of items) {
      if (d.type !== 'PRICE_LOWER') sum += Math.abs(Number(d.deltaAmount ?? 0));
      if (d.severity === 'block') blk += 1;
    }
    return { atRisk: sum, blockers: blk };
  }, [items]);

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });

  return (
    <div className="space-y-5">
      {/* Queue summary strip — keeps the money context present while deciding. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <SummaryTile label={t('summary.inQueue')} value={formatNumber(items.length, locale)} />
        <SummaryTile label={t('summary.atRisk')} value={formatIls(atRisk, { locale })} danger />
        <SummaryTile label={t('summary.blockers')} value={formatNumber(blockers, locale)} danger />
      </div>

      {error ? (
        <Card padding="sm" role="alert" className="border-danger/30 bg-danger/5 text-sm text-danger">
          {error}
        </Card>
      ) : null}

      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {items.map((d) => {
          const isBlock = d.severity === 'block';
          const isRejecting = activeReject === d.id;
          const label = discrepancyLabel(t, d.type);
          const product = displayName(locale, d.productName, d.productNameEn);
          const supplier = displayName(locale, d.supplierName, d.supplierNameEn);
          const busy = busyId === d.id;
          return (
            <Card
              key={d.id}
              as="article"
              elevated
              padding="none"
              className="relative overflow-hidden"
              aria-label={label}
            >
              {/* Severity rail: leak gradient for blockers, tinted bar otherwise. */}
              <span
                aria-hidden="true"
                className={
                  isBlock
                    ? 'leak-gradient absolute inset-y-0 end-0 w-1'
                    : `absolute inset-y-0 end-0 w-1 ${railTint(d.severity)}`
                }
              />

              <div className={compact ? 'p-3 ps-4' : 'p-4 ps-5'}>
                <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={d.severity} label={severityLabel(t, d.severity)} />
                      <h3 className="text-base font-bold text-ink">{label}</h3>
                    </div>
                    {product || supplier ? (
                      <p className="mt-1 text-sm text-muted">
                        {[product, supplier].filter(Boolean).join(' · ')}
                        {d.invoiceNumber ? (
                          <span className="text-subtle"> · {t('card.invoice', { number: d.invoiceNumber })}</span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="mt-1.5 flex items-baseline gap-1.5 text-sm text-muted">
                      {t('card.estimatedLoss')}
                      <span className="font-mono text-lg font-extrabold tabular-nums text-danger">
                        {money(Number(d.deltaAmount ?? 0))}
                      </span>
                    </p>
                  </div>
                  <time
                    dateTime={new Date(d.createdAt).toISOString()}
                    className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-subtle"
                  >
                    {formatDateTime(d.createdAt, locale)}
                  </time>
                </header>

                {compact ? null : <WhyFlagged d={d} t={t} />}

                {d.invoiceId ? (
                  <Link
                    href={`/dashboard/invoices/${d.invoiceId}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {t('card.fixInvoice')}
                  </Link>
                ) : null}

                {isRejecting ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-danger/25 bg-danger/5 p-3">
                    <Textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={t('card.rejectReason')}
                      rows={2}
                      aria-label={t('card.rejectReason')}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setActiveReject(null);
                          setRejectReason('');
                        }}
                      >
                        {t('card.cancel')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy && reject.isPending}
                        disabled={!rejectReason.trim()}
                        onClick={() => {
                          setBusyId(d.id);
                          reject.mutate(
                            { discrepancyId: d.id, reason: rejectReason },
                            {
                              onSuccess: () => {
                                setActiveReject(null);
                                setRejectReason('');
                              },
                            },
                          );
                        }}
                      >
                        {t('card.confirmReject')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {d.requiredRole !== 'owner' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy && escalate.isPending}
                        onClick={() => {
                          setBusyId(d.id);
                          escalate.mutate({ discrepancyId: d.id });
                        }}
                      >
                        {t('card.escalate')}
                      </Button>
                    ) : null}
                    <Button variant="danger" size="sm" onClick={() => setActiveReject(d.id)}>
                      {t('card.reject')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy && approve.isPending}
                      onClick={() => {
                        setBusyId(d.id);
                        approve.mutate({ discrepancyId: d.id });
                      }}
                    >
                      {t('card.approve')}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        <LoadMore onClick={loadMore} loading={loadingMore} hasMore={hasMore} />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card padding="sm" className="flex min-w-0 flex-col justify-center">
      <p className="truncate text-xs font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p
        className={`mt-1 truncate font-mono text-lg font-extrabold tabular-nums sm:text-2xl ${danger ? 'text-danger' : 'text-ink'}`}
      >
        {value}
      </p>
    </Card>
  );
}

/** "Why was this flagged?" — a plain-language explanation of the type, the
 *  expected vs actual values, the tolerance breached, and the routing reason. */
function WhyFlagged({ d, t }: { d: QueueItem; t: Translator<typeof approvalsHe> }) {
  const hasValues = d.expectedValue != null && d.actualValue != null && isMeaningful(d.type);
  const routing = ruleLabel(t, d.ruleId, d.ruleName);
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-subtle">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        {t('card.whyFlagged')}
      </div>
      <p>{discrepancyExplain(t, d.type)}</p>
      {hasValues ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span>{t('card.expected')}</span>
          <span className="font-mono font-semibold tabular-nums text-ink" dir="ltr">
            {fmtValue(d.expectedValue)}
          </span>
          <ArrowLeftRight className="h-3 w-3 text-subtle" aria-hidden="true" />
          <span>{t('card.actual')}</span>
          <span className="font-mono font-semibold tabular-nums text-danger" dir="ltr">
            {fmtValue(d.actualValue)}
          </span>
        </div>
      ) : null}
      {d.toleranceUsed ? (
        <div className="mt-0.5">
          {t('card.threshold')}: <span className="tabular-nums">{toleranceLabel(t, d.toleranceUsed)}</span>
        </div>
      ) : null}
      {routing ? (
        <div className="mt-0.5">
          {t('card.routing')}: {routing}
        </div>
      ) : null}
    </div>
  );
}

/** DATE_ANOMALY stores epoch ms in expected/actual — not useful as raw numbers. */
const isMeaningful = (type: string) => type !== 'DATE_ANOMALY';

/** Trim NUMERIC noise ("8.0000" → "8"). */
function fmtValue(v: string | null): string {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : v;
}

/** Tinted severity rail color for non-blocker rows. */
function railTint(severity: string): string {
  return severity === 'warn' ? 'bg-warn/60' : 'bg-info/50';
}

function SeverityBadge({ severity, label }: { severity: string; label: string }) {
  const tone: BadgeTone =
    severity === 'block' ? 'danger' : severity === 'warn' ? 'warning' : 'info';
  return <Badge tone={tone}>{label}</Badge>;
}
