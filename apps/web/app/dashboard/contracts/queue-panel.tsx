'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, FileSignature, MessageCircle, ShoppingCart, TrendingUp, Upload } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  Menu,
  Money,
  PriceMove,
  Skeleton,
  cn,
  displayName,
  friendlyError,
  useToast,
  type RowAction,
} from '@/lib/components';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import { approvalsDeepLink, waDraftLink } from './logic';

type Queue = inferRouterOutputs<AppRouter>['contracts']['queue'];
type Item = Queue['items'][number];
type OverItem = Extract<Item, { kind: 'offset' | 'claim' | 'request' }>;
type AlertItem = Pick<Extract<Item, { kind: 'alert' }>, 'alert' | 'impact'>;

const REASONS = ['new_agreed_price', 'invoice_error', 'one_off', 'other'] as const;

/** "ק״ג" → "לק״ג" (he) / "per kg" (en): the basis of a per-unit price. */
function useBasis() {
  const t = useT(contractsNs);
  return (unit: string | null | undefined) => (unit ? t('queue.over.perUnit', { unit }) : undefined);
}

/**
 * W2-12 "לטיפול": one ₪-ranked queue. The header ₪ is Σ of the BILLED
 * over-contract cards below it (the server's `totalOverAgorot`); price-alert
 * estimates rank in the same list but are never added to it.
 */
export function QueuePanel({ initial, canManage }: { initial: Queue; canManage: boolean }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const q = trpc.contracts.queue.useQuery(undefined, { initialData: initial });
  const data = q.data ?? initial;

  if (q.error && !q.data) {
    return (
      <EmptyState
        kind="error"
        title={t('queue.errorTitle')}
        description={friendlyError(q.error, tc)}
        action={
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t('queue.retry')}
          </Button>
        }
      />
    );
  }

  if (data.state === 'no_contracts') {
    return (
      <EmptyState
        kind="first-use"
        icon={<FileSignature className="h-6 w-6" aria-hidden="true" />}
        title={t('queue.noContractsTitle')}
        description={t('queue.noContractsBody')}
        action={
          canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/dashboard/contracts?tab=contracts&add=1">{t('queue.addContract')}</LinkButton>
              <LinkButton href="/dashboard/contracts/import" variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />}>
                {t('queue.importList')}
              </LinkButton>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('readOnly')}</p>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <QueueHeader data={data} />
      {data.state === 'clean' ? (
        <Card padding="md" className="border-success/30">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('queue.cleanTitle')}
          </p>
          <p className="mt-1 text-sm text-muted">{t('queue.cleanBody')}</p>
        </Card>
      ) : data.state === 'unchecked' ? (
        <EmptyState kind="inbox-zero" title={t('queue.uncheckedTitle')} description={t('queue.uncheckedBody')} />
      ) : (
        <ul aria-label={t('queue.listLabel')} className="space-y-3">
          {data.items.map((item) =>
            item.kind === 'alert' ? (
              <li key={`a:${item.alert.id}`}>
                <AlertCard item={item} canManage={canManage} dismissReasons={data.dismissReasons} />
              </li>
            ) : (
              <li key={`l:${item.invoiceLineId}`}>
                <OverCard item={item} canManage={canManage} />
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-subtle">
        {t('queue.basis')} {data.truncated ? t('queue.truncated') : null}
      </p>
    </div>
  );
}

/** "₪152.50 חויבו מעל החוזה · 2 שורות · 1 התראת מחיר" — ₪ is Σ billed lines only. */
function QueueHeader({ data }: { data: Queue }) {
  const t = useT(contractsNs);
  return (
    <Card padding="md" data-testid="queue-header">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Money
          agorot={data.totalOverAgorot}
          context="tile"
          decimals={2}
          state={data.totalOverAgorot > 0 ? 'atRisk' : undefined}
          className="text-metric-lg font-bold"
        />
        <span className="font-semibold text-ink">{t('queue.billed')}</span>
        <span aria-hidden="true" className="text-subtle">
          ·
        </span>
        <span className="text-muted">{t('queue.lines', { count: data.lineCount })}</span>
        <span aria-hidden="true" className="text-subtle">
          ·
        </span>
        <span className="text-muted">{t('queue.alerts', { count: data.alertCount })}</span>
      </p>
    </Card>
  );
}

function OverCard({ item, canManage }: { item: OverItem; canManage: boolean }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const basis = useBasis();
  const adopt = trpc.contracts.adoptPrice.useMutation();
  const remove = trpc.contracts.delete.useMutation();
  const update = trpc.contracts.update.useMutation();

  const product = displayName(item.productName, item.productNameEn, locale).primary;
  const supplier = displayName(item.supplierName, item.supplierNameEn, locale).primary;
  const diff = Math.round((item.billedUnitPrice - item.contractUnitPrice) * 10_000) / 10_000;
  const unitText = (v: number) => formatIls(v, { locale, maximumFractionDigits: 4 });
  const date = formatDate(item.invoiceDate, locale, { day: '2-digit', month: '2-digit' });
  const number = item.invoiceNumber ?? t('queue.over.noNumber');
  const qty = formatNumber(item.qty, locale, { maximumFractionDigits: 3 });

  function refresh() {
    void utils.contracts.queue.invalidate();
    void utils.contracts.list.invalidate();
    router.refresh();
  }

  async function onAdopt() {
    try {
      const res = await adopt.mutateAsync({
        supplierId: item.supplierId,
        productId: item.productId,
        contractPrice: item.billedUnitPrice,
        unit: item.unit,
      });
      refresh();
      toast.success(t('queue.over.adopted'), {
        action: {
          label: t('queue.over.undo'),
          onClick: async () => {
            try {
              if (res.created) await remove.mutateAsync({ id: res.id });
              else if (res.previousPrice != null)
                await update.mutateAsync({ id: res.id, contractPrice: res.previousPrice, unit: res.previousUnit });
              toast.info(t('queue.over.undone'));
              refresh();
            } catch (err) {
              toast.error(friendlyError(err, tc));
            }
          },
        },
      });
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  const menu: RowAction[] = [
    { label: t('queue.over.openInvoice'), href: `/dashboard/invoices/${item.invoiceId}` },
    ...(canManage
      ? [
          { label: t('queue.over.adopt', { price: unitText(item.billedUnitPrice) }), onClick: () => void onAdopt(), disabled: adopt.isPending },
          ...(item.discrepancyId ? [{ label: t('queue.over.reject'), href: approvalsDeepLink(item.invoiceId) }] : []),
        ]
      : []),
  ];

  const waText = t('queue.over.waText', {
    number,
    date,
    product,
    billed: unitText(item.billedUnitPrice),
    contract: unitText(item.contractUnitPrice),
  });

  return (
    <Card padding="md" className="border-warn/40" data-testid="over-card" data-over-agorot={item.overAgorot}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="warning-solid">{t('queue.over.kicker')}</Badge>
            <span className="text-muted">{supplier}</span>
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
            <Link href={`/dashboard/invoices/${item.invoiceId}`} className="text-primary underline-offset-2 hover:underline">
              {t('queue.over.invoice', { number, date })}
            </Link>
            <span className="text-xs text-subtle">{item.invoicePaid ? t('queue.over.paid') : t('queue.over.unpaid')}</span>
          </p>
          <h3 className="mt-2 text-base font-semibold text-ink">{product}</h3>
        </div>
        <div className="text-end">
          <p className="text-xs text-subtle">{t('queue.over.overTotal')}</p>
          <Money agorot={item.overAgorot} context="line" state="atRisk" className="text-xl font-bold" />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-subtle">{t('queue.over.contractUnit')}</dt>
          <dd className="text-right">
            <Money value={item.contractUnitPrice} context="unit" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">{t('queue.over.billedUnit')}</dt>
          <dd className="text-right font-semibold">
            <Money value={item.billedUnitPrice} context="unit" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">{t('queue.over.qty')}</dt>
          <dd className="text-right num">
            {qty} {item.unit}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm" data-testid="over-math">
        <p className="sr-only">{t('queue.over.mathLabel')}</p>
        <PriceMove from={item.contractUnitPrice} to={item.billedUnitPrice} basis={basis(item.unit)} />
        <p className="mt-1 flex flex-wrap items-baseline gap-1 text-muted">
          <Money value={item.billedUnitPrice} context="line" />
          <span aria-hidden="true">−</span>
          <Money value={item.contractUnitPrice} context="line" />
          <span aria-hidden="true">=</span>
          <Money value={diff} context="line" />
          <span aria-hidden="true">×</span>
          <span className="num">
            {qty} {item.unit}
          </span>
          <span aria-hidden="true">=</span>
          <Money agorot={item.overAgorot} context="line" className="font-semibold text-ink" />
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.kind === 'request' ? (
          <>
            <LinkButton
              href={waDraftLink(waText)}
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
              data-testid="over-primary"
            >
              {t('queue.over.request')}
            </LinkButton>
            <span className="text-xs text-subtle">{t('queue.over.requestHint')}</span>
          </>
        ) : canManage ? (
          <LinkButton href={approvalsDeepLink(item.invoiceId)} variant="primary" data-testid="over-primary">
            {item.kind === 'claim' ? t('queue.over.claim') : t('queue.over.offset')}
            <span aria-hidden="true">·</span>
            <Money agorot={item.overAgorot} context="line" />
          </LinkButton>
        ) : null}
        <span className="ms-auto">
          <Menu items={menu} label={t('queue.over.more')} />
        </span>
      </div>
    </Card>
  );
}

/** One price alert ("מחירים שעלו", never "דליפה"). Shared by the queue and the alerts tab. */
export function AlertCard({ item, canManage, dismissReasons }: { item: AlertItem; canManage: boolean; dismissReasons: boolean }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const dismiss = trpc.priceAlerts.dismiss.useMutation();
  const reopen = trpc.priceAlerts.reopen.useMutation();
  const [picking, setPicking] = useState(false);
  const a = item.alert;
  const impact = item.impact;
  const product = displayName(a.productName, a.productNameEn, locale).primary;
  const supplier = displayName(a.supplierName, a.supplierNameEn, locale).primary;
  const t2 = impact.tone === 't2';

  function refresh() {
    void utils.contracts.queue.invalidate();
    void utils.priceAlerts.list.invalidate();
    router.refresh();
  }

  async function onDismiss(reason?: (typeof REASONS)[number]) {
    setPicking(false);
    try {
      await dismiss.mutateAsync({ id: a.id, ...(reason ? { reason } : {}) });
      refresh();
      toast.success(t('queue.alert.dismissed'), {
        action: {
          label: t('queue.alert.undo'),
          onClick: async () => {
            try {
              await reopen.mutateAsync({ id: a.id });
              toast.info(t('queue.alert.reopened'));
              refresh();
            } catch (err) {
              toast.error(friendlyError(err, tc));
            }
          },
        },
      });
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  async function onReopen() {
    try {
      await reopen.mutateAsync({ id: a.id });
      toast.info(t('queue.alert.reopened'));
      refresh();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  return (
    <Card padding="md" className={cn(t2 ? 'border-danger/40' : 'border-line')} data-testid="alert-card" data-tone={impact.tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={t2 ? 'danger-solid' : 'neutral'}>
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> {t('queue.alert.kicker')}
            </Badge>
            <span className="text-muted">{supplier}</span>
          </p>
          <h3 className="mt-2 text-base font-semibold text-ink">{product}</h3>
        </div>
        <div className="text-end" title={t('queue.alert.monthlyTitle', { qty: formatNumber(impact.qty90, locale, { maximumFractionDigits: 3 }) })}>
          <p className="flex items-baseline justify-end gap-1">
            <span aria-hidden="true" className="text-muted">
              ≈
            </span>
            <Money agorot={impact.monthlyAgorot} context="line" state={t2 ? 'atRisk' : 'pending'} className="text-xl font-bold" />
          </p>
          <p className="text-xs text-subtle">{t('queue.alert.monthly')}</p>
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <PriceMove from={Number(a.startPrice)} to={Number(a.endPrice)} />
        {impact.contractUnitPrice != null ? (
          <span className="text-muted">
            <span aria-hidden="true">· </span>
            {t('queue.alert.contract')} <Money value={impact.contractUnitPrice} context="unit" />
          </span>
        ) : null}
        {impact.median90 != null ? (
          <span className="text-muted">
            <span aria-hidden="true">· </span>
            {t('queue.alert.median')} <Money value={impact.median90} context="unit" />
          </span>
        ) : null}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.cheaperSupplierId && a.cheaperSupplierName && a.cheaperPrice != null ? (
          <LinkButton
            href={`/dashboard/orders/new?supplierId=${encodeURIComponent(a.cheaperSupplierId)}`}
            variant={t2 ? 'primary' : 'secondary'}
            icon={<ShoppingCart className="h-4 w-4" aria-hidden="true" />}
          >
            {t('queue.alert.order', {
              supplier: displayName(a.cheaperSupplierName, a.cheaperSupplierNameEn, locale).primary,
              price: formatIls(Number(a.cheaperPrice), { locale, maximumFractionDigits: 4 }),
            })}
          </LinkButton>
        ) : null}
        {a.status === 'dismissed' ? (
          <>
            <Badge tone="neutral">{t('alerts.dismissedBadge')}</Badge>
            {canManage ? (
              <Button size="sm" variant="ghost" onClick={() => void onReopen()} disabled={reopen.isPending}>
                {t('queue.alert.undo')}
              </Button>
            ) : null}
          </>
        ) : canManage ? (
          dismissReasons && picking ? (
            <span role="group" aria-label={t('queue.alert.dismissWith')} className="flex flex-wrap gap-1">
              {REASONS.map((r) => (
                <Button key={r} size="sm" variant="tertiary" onClick={() => void onDismiss(r)} disabled={dismiss.isPending}>
                  {t(`queue.alert.reasons.${r}`)}
                </Button>
              ))}
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (dismissReasons ? setPicking(true) : void onDismiss())}
              disabled={dismiss.isPending}
              aria-expanded={dismissReasons ? picking : undefined}
              data-testid="alert-dismiss"
            >
              {t('queue.alert.dismiss')}
              {dismissReasons ? <span aria-hidden="true"> ▾</span> : null}
            </Button>
          )
        ) : null}
      </div>
    </Card>
  );
}

/** Layout-true skeleton for loading.tsx. */
export function QueueSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  );
}
