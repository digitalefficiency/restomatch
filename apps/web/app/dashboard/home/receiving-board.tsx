import Link from 'next/link';
import { ArrowLeft, Clock, FileQuestion, PackageCheck, Truck } from 'lucide-react';
import { Badge, cn } from '@/lib/components';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { Translator } from '@/lib/i18n/translate';
import type { he as overviewHe } from '@/lib/i18n/messages/overview/he';
import { buildBoard, isClosed, truckHref, type BoardExpectation, type BoardItem } from './board';

type T = Translator<typeof overviewHe>;

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2';

/**
 * The receiving board (RCV-13/-31): a summary line, the next truck enlarged
 * with one 56 px CTA naming its next state, then late / now / later / no date /
 * received. Open receipts are neutral (never a warning); closed ones read
 * "התקבל ✓" and open read-only. No ₪ anywhere: this is the back door.
 */
export function ReceivingBoard({
  rows,
  t,
  locale,
  now = new Date(),
}: {
  rows: readonly BoardExpectation[];
  t: T;
  locale: Locale;
  now?: Date;
}) {
  const board = buildBoard(rows, now);
  const n = (v: number) => formatNumber(v, locale);
  const empty = rows.length === 0;
  return (
    <div className="space-y-5" data-testid="receiving-board">
      {!empty ? (
        <p
          data-testid="board-summary"
          className="flex min-h-12 flex-wrap items-center gap-x-2 rounded-xl border border-line bg-surface px-4 py-2 text-base font-semibold text-ink"
        >
          {t('board.summary', { total: n(board.summary.total), received: n(board.summary.received), late: n(board.summary.late) })}
        </p>
      ) : null}

      {board.next ? <NextTruck item={board.next} t={t} locale={locale} /> : null}

      {empty ? (
        <div data-testid="board-empty" className="rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          <PackageCheck className="mx-auto h-8 w-8 text-subtle" aria-hidden="true" />
          <p className="mt-2 text-base font-semibold text-ink">{t('board.empty.title')}</p>
          <p className="mt-1 text-sm text-muted">{t('board.empty.hint')}</p>
        </div>
      ) : null}

      <Group id="late" title={t('board.groups.late')} items={board.late} t={t} locale={locale} />
      <Group id="now" title={t('board.groups.now')} items={board.now} t={t} locale={locale} />
      <Group id="later" title={t('board.groups.later')} items={board.later} t={t} locale={locale} />
      <Group id="undated" title={t('board.groups.undated')} items={board.undated} t={t} locale={locale} />
      <Group id="received" title={t('board.groups.received')} items={board.received} t={t} locale={locale} />

      <div
        data-testid="board-no-po"
        className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2/50 px-4 py-3"
      >
        <FileQuestion className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">{t('board.noPo.title')}</p>
          <p className="mt-0.5 text-sm text-muted">{t('board.noPo.hint')}</p>
        </div>
      </div>
    </div>
  );
}

function supplierOf(item: BoardItem, locale: Locale) {
  return locale === 'en' && item.supplierNameEn ? item.supplierNameEn : item.supplierName;
}

function timeOf(item: BoardItem, t: T, locale: Locale) {
  if (!item.hasDeliveryDate) return t('board.noDate');
  if (item.late) return t('board.state.lateSince', { date: formatDate(item.expectedAt, locale, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) });
  return formatDate(item.expectedAt, locale, { hour: '2-digit', minute: '2-digit' });
}

function ctaLabel(item: BoardItem, t: T) {
  switch (item.state) {
    case 'notStarted':
      return t('board.cta.start');
    case 'inProgress':
      return t('board.cta.continue');
    case 'received':
      return t('board.cta.received');
    case 'receivedPartial':
      return t('board.cta.partial');
  }
}

function StateBadge({ item, t }: { item: BoardItem; t: T }) {
  if (item.isLate) return <Badge tone="warning-solid">{t('board.state.late')}</Badge>;
  if (item.state === 'inProgress') return <Badge tone="neutral">{t('board.state.inProgress')}</Badge>;
  return null;
}

function NextTruck({ item, t, locale }: { item: BoardItem; t: T; locale: Locale }) {
  return (
    <section aria-labelledby="next-truck-title" data-testid="board-next" data-po={item.poId} className="rounded-2xl border border-line-strong bg-surface p-4 shadow-card sm:p-5">
      <h2 id="next-truck-title" className="text-xs font-semibold text-subtle">
        {t('board.next')}
      </h2>
      <div className="mt-2 flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink">
          <Truck className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold text-ink">
            <bdi>{supplierOf(item, locale)}</bdi>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{timeOf(item, t, locale)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{t('board.items', { count: formatNumber(item.lineCount, locale) })}</span>
            <StateBadge item={item} t={t} />
          </p>
        </div>
      </div>
      <Link
        href={truckHref(item)}
        data-testid="board-next-cta"
        className={cn(
          'mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-on-primary hover:brightness-90',
          focus,
        )}
      >
        {ctaLabel(item, t)}
        <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" />
      </Link>
    </section>
  );
}

function Group({ id, title, items, t, locale }: { id: string; title: string; items: BoardItem[]; t: T; locale: Locale }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`board-${id}`} data-testid={`board-group-${id}`}>
      <h2 id={`board-${id}`} className="mb-2 text-sm font-bold text-ink">
        {title} <span className="font-normal text-muted">({formatNumber(items.length, locale)})</span>
      </h2>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <li key={item.poId}>
            <TruckRow item={item} t={t} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TruckRow({ item, t, locale }: { item: BoardItem; t: T; locale: Locale }) {
  const closed = isClosed(item.state);
  return (
    <Link
      href={truckHref(item)}
      data-testid="receiving-po-card"
      data-po={item.poId}
      data-state={item.state}
      className={cn(
        'flex min-h-16 items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-2.5 transition-colors hover:border-primary/40',
        item.isLate ? 'border-warn/50' : 'border-line',
        focus,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-base font-bold text-ink">
          <bdi>{supplierOf(item, locale)}</bdi>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span className="tabular-nums">
            {closed && item.closedAt
              ? t('board.closedAt', { time: formatDate(item.closedAt, locale, { hour: '2-digit', minute: '2-digit' }) })
              : timeOf(item, t, locale)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{t('board.items', { count: formatNumber(item.lineCount, locale) })}</span>
          <StateBadge item={item} t={t} />
        </span>
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 text-sm font-semibold',
          closed ? 'text-primary' : 'text-ink',
        )}
      >
        {ctaLabel(item, t)}
        {!closed ? <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" /> : null}
      </span>
    </Link>
  );
}
