'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { recovery } from '@/lib/i18n/messages/recovery';
import { approvals } from '@/lib/i18n/messages/approvals';
import { Badge, Button, Card, ConfirmDialog, Field, Input, cn, type BadgeTone } from '@/lib/components';
import { discrepancyLabel, displayName } from '../approvals/vocab';
import { parseIlsInput } from './parseIls';
import { UndoBar, useDeferredCommit } from './deferred';
import { RowMenu } from './row-menu';
import { ReminderDrafts } from './reminder-drafts';
import { ClaimPeek } from './claim-peek';
import { ExportButtons } from './export-buttons';
import {
  CLOSED,
  CONFIRMED_MOVES,
  batchMoves,
  bySupplier,
  confirmAgorot,
  countdownOf,
  menuMoves,
  nextStep,
  previewExclAgorot,
  type Countdown,
  type RecoveryStatus,
} from './logic';

type Out = inferRouterOutputs<AppRouter>['recovery'];
type Claim = Out['list'][number];
type Suggestion = Out['creditLineSuggestions'][number];
type Status = Claim['status'];
type Move = Exclude<Status, 'credited'>;

const CREDITABLE: Status[] = ['claimed', 'letter_sent', 'acknowledged', 'credited', 'disputed'];
const TONE: Record<Status, BadgeTone> = {
  claimed: 'neutral',
  letter_sent: 'info',
  acknowledged: 'info',
  credited: 'accent',
  recovered: 'gold',
  disputed: 'warning',
  written_off: 'neutral',
};
const WRITE_OFF_REASONS = ['refused', 'trivial', 'ourMistake', 'other'] as const;
const RECOVERED_REASONS = ['offset', 'refund', 'other'] as const;
type Tab = 'todo' | 'all' | 'closed';

/**
 * The ₪-back claims list. No money state ever changes on a select's `change`:
 * each row has ONE next-step button plus a ⋯ menu. Reversible moves show at
 * once and are written after 10 s unless undone; ending a claim (write-off,
 * money back) goes through a ConfirmDialog that names the ₪ and the supplier,
 * with a reason sent as the transition note. Selected rows move in ONE call.
 */
export function TrackerClient({
  claims,
  suggestions,
  nowIso,
  initialTab = 'todo',
}: {
  claims: Claim[];
  suggestions: Suggestion[];
  nowIso: string;
  initialTab?: Tab;
}) {
  const t = useT(recovery);
  const ta = useT(approvals);
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // URL state (?tab=): Back- and refresh-stable, without a server round-trip.
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'todo') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* no URL API: the tab still switches */
    }
  };
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [creditFor, setCreditFor] = useState<string | null>(null); // supplier id
  // A suggested invoice credit line opens the same form, prefilled (the user still picks the claims).
  const [creditLine, setCreditLine] = useState<Suggestion | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; to: 'written_off' | 'recovered' } | null>(null);
  const [reason, setReason] = useState<string>('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  const supplierOf = (c: Claim) => displayName(locale, c.supplierName, c.supplierNameEn) || '—';
  const itemOf = (c: Claim) =>
    displayName(locale, c.productName, c.productNameEn) ||
    displayName(locale, c.lineDescription, c.lineDescriptionEn) ||
    discrepancyLabel(ta, c.discrepancyType);

  const transition = trpc.recovery.transition.useMutation();
  const deferred = useDeferredCommit({
    onCommitted: () => router.refresh(),
    onFailed: () => {
      setMessage({ tone: 'error', text: t('actions.failed') });
      router.refresh();
    },
  });
  const credit = trpc.recovery.recordCreditNote.useMutation({
    onSuccess: (res) => {
      setMessage({
        tone: 'ok',
        text: res.unallocatedAgorot > 0 ? t('creditForm.remainder', { amount: ils(res.unallocatedAgorot) }) : t('actions.saved'),
      });
      setCreditFor(null);
      router.refresh();
    },
    onError: () => setMessage({ tone: 'error', text: t('actions.failed') }),
  });

  /** The status a row shows: a pending (undoable) move wins. */
  const statusOf = (c: Claim): Status => (deferred.pendingTo(c.id) as Status | null) ?? c.status;
  const byId = useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);

  const inTab = (c: Claim, which: Tab) => {
    const s = statusOf(c);
    return which === 'all' ? true : which === 'closed' ? CLOSED.includes(s) : !CLOSED.includes(s);
  };
  const shown = claims.filter((c) => inTab(c, tab));
  const counts = { todo: 0, all: claims.length, closed: 0 };
  for (const c of claims) {
    if (inTab(c, 'closed')) counts.closed += 1;
    else counts.todo += 1;
  }

  const sumOf = (ids: string[]) => ids.reduce((s, id) => s + (byId.get(id)?.outstandingAgorot ?? 0), 0);
  /** The ₪ a closing confirm names: money back for "recovered", the remainder for a write-off. */
  const confirmSum = (ids: string[], to: 'written_off' | 'recovered') =>
    confirmAgorot(ids.map((id) => byId.get(id)).filter((c): c is Claim => c != null), to);
  /** A row whose move is still in its undo window is not selectable / batchable (it acts on a status not yet written). */
  const isPending = (id: string) => deferred.pendingTo(id) != null;
  const nameOfIds = (ids: string[]) => {
    const names = [...new Set(ids.map((id) => byId.get(id)).filter(Boolean).map((c) => supplierOf(c!)))];
    return names.length === 1 ? names[0]! : t('undo.suppliers', { count: formatNumber(names.length, locale) });
  };

  const itemsOf = (ids: string[]) => ids.map((claimId) => ({ claimId, expectedStatus: byId.get(claimId)!.status }));
  /** Whether the server says this move needs a reason for any of the claims (terminal edges, a short "money back"). */
  const needsReason = (ids: string[], to: Move) =>
    ids.some((id) => byId.get(id)?.next.find((e) => e.to === to)?.requiresReason === true);

  /** A reversible move: optimistic now, written after 10 s unless undone. */
  function moveLater(ids: string[], to: Move) {
    if (ids.length === 0) return;
    setMessage(null);
    deferred.schedule({
      keys: ids,
      to,
      label: t('undo.moved', {
        status: t(`status.${to}`),
        count: formatNumber(ids.length, locale),
        amount: ils(sumOf(ids)),
        supplier: nameOfIds(ids),
      }),
      // Guarded: each claim must still be in the status this screen showed (CONFLICT otherwise).
      run: () => transition.mutateAsync({ items: itemsOf(ids), to }),
    });
    setSelected(new Set());
  }

  function request(all: string[], to: Move) {
    const ids = all.filter((id) => !isPending(id));
    if (ids.length === 0) return;
    if ((CONFIRMED_MOVES as readonly string[]).includes(to)) {
      setReason('');
      setReasonMissing(false);
      setConfirm({ ids, to: to as 'written_off' | 'recovered' });
    } else moveLater(ids, to);
  }

  async function confirmNow() {
    if (!confirm) return;
    const reasons = confirm.to === 'written_off' ? WRITE_OFF_REASONS : RECOVERED_REASONS;
    const note = reason && (reasons as readonly string[]).includes(reason) ? t(`confirm.reasons.${confirm.to}.${reason}` as never) : undefined;
    if (!note && needsReason(confirm.ids, confirm.to)) {
      setReasonMissing(true);
      return;
    }
    try {
      await transition.mutateAsync({ items: itemsOf(confirm.ids), to: confirm.to, note });
      setMessage({ tone: 'ok', text: t('actions.saved') });
      setConfirm(null);
      setSelected(new Set());
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: t('actions.failed') });
    }
  }

  // Creditable claims grouped by supplier — one credit note usually covers several lines.
  const creditable = useMemo(() => {
    const m = new Map<string, { supplierId: string; name: string; owed: number; claims: Claim[] }>();
    for (const c of claims) {
      if (!c.supplierId || !CREDITABLE.includes(c.status) || c.outstandingAgorot <= 0) continue;
      const g = m.get(c.supplierId) ?? { supplierId: c.supplierId, name: supplierOf(c), owed: 0, claims: [] };
      g.claims.push(c);
      g.owed += c.outstandingAgorot;
      m.set(c.supplierId, g);
    }
    return [...m.values()].sort((a, b) => b.owed - a.owed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims, locale]);

  const openCredit = (supplierId: string | null) => {
    if (!supplierId) return;
    setCreditLine(null);
    setCreditFor(supplierId);
    requestAnimationFrame(() => document.getElementById(`credit-${supplierId}`)?.scrollIntoView({ block: 'center' }));
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedIds = [...selected].filter((id) => byId.has(id) && !isPending(id));
  // The server's next[] per claim (no client mirror of the transition table).
  const selectedMoves = batchMoves(selectedIds.map((id) => byId.get(id)!.next)) as Move[];

  const countdownText = (cd: Countdown) =>
    cd.tone === 'danger'
      ? t('countdown.late', { days: formatNumber(cd.daysLate, locale) })
      : cd.daysLeft === 0
        ? t('countdown.today', { date: formatDate(cd.dueIso, locale) })
        : t('countdown.left', { days: formatNumber(cd.daysLeft, locale), date: formatDate(cd.dueIso, locale) });

  const rowActions = (c: Claim, wide = false) => {
    const status = statusOf(c);
    const step = nextStep(status as RecoveryStatus);
    const pending = deferred.pendingTo(c.id) != null;
    const name = t('actions.rowLabel', { invoice: c.invoiceNumber ?? '—', item: itemOf(c) });
    const menu: Array<{ key: string; label: string; danger: boolean; onSelect: () => void }> = menuMoves(
      status as RecoveryStatus,
      pending ? [] : c.next,
    ).map((to) => ({
      key: to,
      label: t(`actions.${to as Move}`),
      danger: to === 'written_off',
      onSelect: () => request([c.id], to as Move),
    }));
    menu.push({ key: 'history', label: t('peek.open'), danger: false, onSelect: () => setPeekId(c.id) });
    if ((CREDITABLE as string[]).includes(status) && step?.kind !== 'credit' && c.outstandingAgorot > 0 && c.supplierId) {
      menu.push({ key: 'credit', label: t('actions.credit'), danger: false, onSelect: () => openCredit(c.supplierId) });
    }
    return (
      <div className={cn('flex items-center gap-2', wide ? 'w-full' : 'justify-end')}>
        {step ? (
          <Button
            size="sm"
            variant={status === 'claimed' ? 'primary' : 'secondary'}
            disabled={pending}
            aria-label={`${step.kind === 'credit' ? t('step.credit') : t(`step.${step.to as 'letter_sent' | 'recovered' | 'claimed'}`)} · ${name}`}
            onClick={() => (step.kind === 'credit' ? openCredit(c.supplierId) : request([c.id], step.to as Move))}
            className={cn('min-h-11 md:min-h-9', wide && 'flex-1 text-sm')}
          >
            {step.kind === 'credit' ? t('step.credit') : t(`step.${step.to as 'letter_sent' | 'recovered' | 'claimed'}`)}
          </Button>
        ) : null}
        {!pending ? <RowMenu label={t('actions.menu', { name })} items={menu} /> : null}
      </div>
    );
  };

  const statusChips = (c: Claim) => {
    const status = statusOf(c);
    const cd = countdownOf({ status: status as RecoveryStatus, letterSentAt: c.letterSentAt, claimedAt: c.claimedAt }, nowIso);
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>
        {cd ? (
          <span data-testid="countdown" data-tone={cd.tone}>
            <Badge tone={cd.tone === 'danger' ? 'danger' : cd.tone === 'warn' ? 'warning' : 'neutral'}>{countdownText(cd)}</Badge>
          </span>
        ) : null}
        {c.recoveredAt && status === 'recovered' ? (
          <span className="text-xs text-muted">{formatDate(c.recoveredAt, locale)}</span>
        ) : null}
      </span>
    );
  };

  const amountCell = (c: Claim) => (
    <>
      <span className="font-semibold tabular-nums text-ink">{ils(c.outstandingAgorot > 0 ? c.outstandingAgorot : c.amountAgorot)}</span>
      {c.outstandingAgorot > 0 && c.outstandingAgorot !== c.amountAgorot ? (
        <span className="block text-xs text-muted">{t('tracker.ofClaimed', { amount: ils(c.amountAgorot) })}</span>
      ) : null}
      {c.creditedAgorot > 0 ? (
        <span className="block text-xs text-primary">
          {c.creditNoteNumber ? <bdi className="whitespace-nowrap">{c.creditNoteNumber}</bdi> : null}
          {c.creditNoteNumber ? ' · ' : ''}
          {t('tracker.creditedAmount', { amount: ils(c.creditedAgorot) })}
        </span>
      ) : null}
    </>
  );

  // The desk order: suppliers ranked by owed ₪ × days overdue; rows follow their supplier.
  const groups = bySupplier(shown);
  const ordered = groups.flatMap((g) => g.claims);
  const overdueGroups = bySupplier(claims.filter((c) => c.daysOverdue > 0 && c.outstandingAgorot > 0 && !isPending(c.id)));

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role="status"
          className={cn(
            'rounded-xl border px-3 py-2 text-sm',
            message.tone === 'ok' ? 'border-primary/40 bg-primary/10 text-ink' : 'border-danger/40 bg-danger/10 text-ink',
          )}
        >
          {message.text}
        </p>
      ) : null}

      {overdueGroups.length > 0 ? (
        <ReminderDrafts
          suppliers={overdueGroups
            .filter((g) => g.claims[0]?.supplierId)
            .map((g) => ({ supplierId: g.claims[0]!.supplierId!, name: supplierOf(g.claims[0]!) }))}
        />
      ) : null}

      <Card padding="lg" id="claims">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink" id="claims-title">
            {t('tracker.claimsTitle')}
          </h2>
          <ExportButtons />
          <div role="radiogroup" aria-label={t('tracker.claimsTitle')} className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
            {(['todo', 'all', 'closed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={tab === f}
                tabIndex={tab === f ? 0 : -1}
                onClick={() => setTab(f)}
                onKeyDown={(e) => {
                  const order = ['todo', 'all', 'closed'] as const;
                  const i = order.indexOf(f);
                  const go = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
                  if (!go) return;
                  e.preventDefault();
                  const rtl = document.documentElement.dir === 'rtl';
                  const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
                  const next = order[(i + step + order.length) % order.length]!;
                  setTab(next);
                  (e.currentTarget.parentElement?.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
                }}
                data-tab={f}
                className={cn(
                  'min-h-11 rounded-lg px-3 font-semibold md:min-h-8',
                  tab === f ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                )}
              >
                {t(`tracker.tab.${f}`)} · {formatNumber(counts[f], locale)}
              </button>
            ))}
          </div>
        </div>

        {selectedIds.length > 0 ? (
          <div
            className="sticky top-[calc(var(--rm-header-h,4rem)+0.5rem)] z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-surface px-3 py-2 shadow-card"
            data-testid="batch-bar"
          >
            <span className="text-sm font-semibold text-ink">
              {t('batch.selected', { count: formatNumber(selectedIds.length, locale), amount: ils(sumOf(selectedIds)) })}
            </span>
            {selectedMoves
              .filter((to) => to !== 'written_off')
              .map((to) => (
                <Button key={to} size="sm" variant="secondary" className="min-h-11 md:min-h-9" onClick={() => request(selectedIds, to)}>
                  {t(`actions.${to}`)}
                </Button>
              ))}
            {selectedMoves.includes('written_off') ? (
              <Button size="sm" variant="ghost" className="min-h-11 text-danger md:min-h-9" onClick={() => request(selectedIds, 'written_off')}>
                {t('actions.written_off')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="ms-auto min-h-11 md:min-h-9" onClick={() => setSelected(new Set())}>
              {t('batch.clear')}
            </Button>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-line bg-surface-2/50 px-4 py-6 text-center text-sm text-muted">
            {t(`tracker.tabEmpty.${tab}`)}
          </p>
        ) : (
          <>
            {/* Desktop: one dense table, ₪ beside the item. */}
            <div className="mt-3 hidden md:block">
              <table className="w-full text-sm" data-testid="recovery-claims" aria-labelledby="claims-title">
                <thead className="border-b border-line text-xs text-subtle">
                  <tr>
                    <th scope="col" className="w-8 py-2 pe-2">
                      <span className="sr-only">{t('batch.selectColumn')}</span>
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colSupplier')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colInvoice')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colItem')}</th>
                    <th scope="col" className="py-2 pe-3 text-right font-semibold">{t('tracker.colAmount')}</th>
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colStatus')}</th>
                    <th scope="col" className="py-2 text-end font-semibold">{t('tracker.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((c) => (
                    <tr key={c.id} className="border-b border-line/60 align-top" data-testid="claim-row" data-status={statusOf(c)}>
                      <td className="py-2 pe-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-primary"
                          checked={selected.has(c.id) && !isPending(c.id)}
                          disabled={isPending(c.id)}
                          onChange={() => toggle(c.id)}
                          aria-label={t('batch.select', { invoice: c.invoiceNumber ?? '—', item: itemOf(c) })}
                        />
                      </td>
                      <td className="py-2 pe-3 text-ink">{supplierOf(c)}</td>
                      <td className="py-2 pe-3 text-muted">
                        <bdi dir="ltr" className="whitespace-nowrap font-mono text-xs">{c.invoiceNumber ?? '—'}</bdi>
                      </td>
                      <td className="py-2 pe-3">
                        <span className="text-ink">{itemOf(c)}</span>
                        <span className="block text-xs text-muted">{discrepancyLabel(ta, c.discrepancyType)}</span>
                      </td>
                      <td className="py-2 pe-3 text-right">{amountCell(c)}</td>
                      <td className="py-2 pe-3">{statusChips(c)}</td>
                      <td className="py-2">{rowActions(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: cards grouped by supplier, the outstanding ₪ at the line end. */}
            <div className="mt-3 space-y-4 md:hidden" data-testid="recovery-claim-cards">
              {groups.map((g) => {
                const first = g.claims[0]!;
                return (
                  <section key={g.key} aria-label={supplierOf(first)}>
                    <h3 className="sticky top-[var(--rm-header-h,4rem)] z-20 flex items-baseline justify-between gap-2 border-b border-line bg-surface py-2 text-sm font-bold text-ink">
                      <span className="min-w-0 truncate">
                        {supplierOf(first)} · {formatNumber(g.claims.length, locale)}
                      </span>
                      <span className="shrink-0 tabular-nums" data-testid="group-outstanding">
                        {t('tracker.groupOpen', { amount: ils(g.outstandingAgorot) })}
                      </span>
                    </h3>
                    <ul className="divide-y divide-line/60">
                      {g.claims.map((c) => (
                        <li key={c.id} className="space-y-2 py-3" data-testid="claim-card" data-status={statusOf(c)}>
                          <div className="flex items-start gap-3">
                            {/* The label is the 44 px touch target around the box. */}
                            <label className="-m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center">
                              <input
                                type="checkbox"
                                className="h-5 w-5 accent-primary"
                                checked={selected.has(c.id) && !isPending(c.id)}
                                disabled={isPending(c.id)}
                                onChange={() => toggle(c.id)}
                                aria-label={t('batch.select', { invoice: c.invoiceNumber ?? '—', item: itemOf(c) })}
                              />
                            </label>
                            <span className="min-w-0 flex-1 font-medium text-ink">{itemOf(c)}</span>
                            <span className="shrink-0 text-end text-lg font-bold tabular-nums text-ink">{amountCell(c)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 ps-8 text-xs text-muted">
                            <bdi dir="ltr" className="whitespace-nowrap font-mono">{c.invoiceNumber ?? '—'}</bdi>
                            <span>· {discrepancyLabel(ta, c.discrepancyType)}</span>
                            {statusChips(c)}
                          </div>
                          <div className="ps-8">{rowActions(c, true)}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {suggestions.length > 0 ? (
        <Card padding="lg">
          <h2 className="text-sm font-bold text-ink">{t('tracker.suggestionsTitle')}</h2>
          <p className="mt-1 text-xs text-muted">{t('tracker.suggestionsHint')}</p>
          <ul className="mt-3 divide-y divide-line/60">
            {suggestions.map((s) => {
              const group = creditable.find((g) => g.supplierId === s.supplierId);
              return (
                <li key={s.invoiceLineId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{displayName(locale, s.supplierName, s.supplierNameEn)}</span>
                    <bdi dir="ltr" className="ms-2 whitespace-nowrap font-mono text-xs text-muted">{s.invoiceNumber ?? '—'}</bdi>
                    <span className="ms-2 text-muted">{displayName(locale, s.description, s.descriptionEn)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-primary">{ils(s.amountAgorot)}</span>
                    {group ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setCreditLine(s);
                          setCreditFor(group.supplierId);
                        }}
                      >
                        {t('tracker.useLine')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {creditable.length > 0 ? (
        <Card padding="lg">
          <h2 className="text-sm font-bold text-ink">{t('tracker.creditNote')}</h2>
          <p className="mt-1 text-xs text-muted">{t('tracker.creditNoteHint')}</p>
          <ul className="mt-2 divide-y divide-line/60">
            {creditable.map((g) => (
              <li key={g.supplierId} className="py-2" id={`credit-${g.supplierId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="font-semibold text-ink">{g.name}</span>
                    <span className="tabular-nums text-ink">{t('tracker.groupOpen', { amount: ils(g.owed) })}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-expanded={creditFor === g.supplierId}
                    onClick={() => {
                      setCreditLine(null);
                      setCreditFor(creditFor === g.supplierId ? null : g.supplierId);
                    }}
                  >
                    {t('actions.credit')}
                  </Button>
                </div>
                {creditFor === g.supplierId ? (
                  <CreditForm
                    key={`${g.supplierId}:${creditLine?.invoiceLineId ?? 'manual'}`}
                    supplier={g.name}
                    claims={g.claims}
                    line={creditLine && creditLine.supplierId === g.supplierId ? creditLine : null}
                    busy={credit.isPending}
                    onCancel={() => {
                      setCreditFor(null);
                      setCreditLine(null);
                    }}
                    onSubmit={(v) =>
                      credit.mutate(
                        v.invoiceLineId
                          ? { claimIds: v.claimIds, invoiceLineId: v.invoiceLineId, idempotencyKey: v.idempotencyKey }
                          : {
                              claimIds: v.claimIds,
                              supplierId: g.supplierId,
                              number: v.number,
                              printedAgorot: v.printedAgorot,
                              vat: v.vat,
                              issuedOn: v.issuedOn,
                              idempotencyKey: v.idempotencyKey,
                            },
                      )
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirm != null}
        danger={confirm?.to === 'written_off'}
        loading={transition.isPending}
        title={
          confirm
            ? t(confirm.to === 'written_off' ? 'confirm.writeOffTitle' : 'confirm.recoveredTitle', {
                amount: ils(confirmSum(confirm.ids, confirm.to)),
                supplier: nameOfIds(confirm.ids),
              })
            : ''
        }
        body={
          confirm ? (
            <>
              <p>{t(confirm.to === 'written_off' ? 'confirm.writeOffBody' : 'confirm.recoveredBody', { count: formatNumber(confirm.ids.length, locale) })}</p>
              {confirm.to === 'recovered' && confirmSum(confirm.ids, 'written_off') > 0 ? (
                // A partial credit: closing it lets the rest go — say how much, in ₪.
                <p className="font-semibold text-ink" data-testid="confirm-let-go">
                  {t('confirm.recoveredLetGo', { amount: ils(confirmSum(confirm.ids, 'written_off')) })}
                </p>
              ) : null}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-subtle">{t('confirm.reason')}</legend>
                <div role="radiogroup" className="flex flex-wrap gap-2">
                  {(confirm.to === 'written_off' ? WRITE_OFF_REASONS : RECOVERED_REASONS).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={reason === r}
                      onClick={() => {
                        setReason(r);
                        setReasonMissing(false);
                      }}
                      className={cn(
                        'min-h-11 rounded-full border px-3 text-sm md:min-h-9',
                        reason === r ? 'border-primary bg-primary/10 font-semibold text-ink' : 'border-line text-muted hover:text-ink',
                      )}
                    >
                      {t(`confirm.reasons.${confirm.to}.${r}` as never)}
                    </button>
                  ))}
                </div>
                {reasonMissing ? (
                  <p role="alert" className="mt-1.5 text-sm font-semibold text-danger" data-testid="confirm-reason-missing">
                    {t('confirm.reasonRequired')}
                  </p>
                ) : null}
              </fieldset>
            </>
          ) : null
        }
        confirmLabel={
          confirm
            ? confirm.to === 'written_off'
              ? t('confirm.writeOffCta', { amount: ils(confirmSum(confirm.ids, 'written_off')) })
              : t('confirm.recoveredCta')
            : ''
        }
        cancelLabel={t('confirm.cancel')}
        onConfirm={() => void confirmNow()}
        onClose={() => setConfirm(null)}
      />

      <ClaimPeek
        claim={(() => {
          const c = peekId ? byId.get(peekId) : undefined;
          return c
            ? {
                id: c.id,
                invoiceId: c.invoiceId,
                invoiceNumber: c.invoiceNumber,
                supplierLabel: supplierOf(c),
                itemLabel: itemOf(c),
                amountAgorot: c.amountAgorot,
                outstandingAgorot: c.outstandingAgorot,
              }
            : null;
        })()}
        onClose={() => setPeekId(null)}
      />

      <UndoBar
        pending={deferred.pending}
        onUndo={deferred.undo}
        onHold={deferred.hold}
        undoLabel={t('undo.cta')}
        countdownLabel={(s) => t('undo.seconds', { seconds: formatNumber(s, locale) })}
      />
    </div>
  );
}

function CreditForm({
  supplier,
  claims,
  line,
  busy,
  onSubmit,
  onCancel,
}: {
  supplier: string;
  claims: Claim[];
  /** A suggested invoice credit line: amount / number / date come from the invoice. */
  line: Suggestion | null;
  busy: boolean;
  onSubmit: (v: {
    claimIds: string[];
    number?: string;
    printedAgorot?: number;
    vat?: 'incl' | 'excl';
    issuedOn?: string;
    invoiceLineId?: string;
    idempotencyKey: string;
  }) => void;
  onCancel: () => void;
}) {
  const t = useT(recovery);
  const ta = useT(approvals);
  const locale = useLocale();
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });
  // One key per form instance: a double submit records the note once (server-side idempotency).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // chain-09: nothing is pre-selected and the amount starts empty — the paper is the source, not our number.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const chosen = claims.filter((c) => selected.has(c.id));
  const owed = chosen.reduce((sum, c) => sum + c.outstandingAgorot, 0);
  const [number, setNumber] = useState(line?.invoiceNumber ?? '');
  const [amount, setAmount] = useState(line ? (line.amountAgorot / 100).toFixed(2) : '');
  // As printed: incl. or excl. VAT — NO default; the server converts (agorot, half-up, the supplier's rate).
  const [vat, setVat] = useState<'incl' | 'excl' | null>(line ? 'excl' : null);
  const [date, setDate] = useState(line?.invoiceDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  // TODO(G-13): parseDecimalInput(raw, 'ils') once it lands; "1,250" = ₪1,250.00 either way.
  const typed = line ? line.amountAgorot : parseIlsInput(amount);
  // Before-VAT preview of what the server will book (it converts again); compares like with like.
  const rateBp = claims[0]?.vatRateBp ?? 1800;
  const typedExcl = typed != null && vat ? previewExclAgorot(typed, vat, rateBp) : null;
  const diff = typedExcl == null ? null : typedExcl - owed;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const canSubmit = chosen.length > 0 && (line != null || (vat != null && typed != null));
  return (
    <form
      className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-2/60 p-3 sm:grid-cols-3"
      data-testid="credit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen.length === 0) {
          setError(t('creditForm.noneSelected'));
          return;
        }
        const claimIds = chosen.map((c) => c.id);
        if (line) {
          onSubmit({ claimIds, invoiceLineId: line.invoiceLineId, idempotencyKey });
          return;
        }
        if (typed == null) {
          setError(t('creditForm.invalidAmount'));
          return;
        }
        if (!vat) {
          setError(t('creditForm.vatRequired'));
          return;
        }
        onSubmit({ claimIds, number: number.trim() || undefined, printedAgorot: typed, vat, issuedOn: date, idempotencyKey });
      }}
    >
      <p className="text-sm font-semibold text-ink sm:col-span-3">{t('creditForm.title', { supplier })}</p>
      <fieldset className="sm:col-span-3">
        <legend className="mb-1.5 text-sm font-medium text-muted">{t('creditForm.selectClaims')}</legend>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {claims.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink md:min-h-9">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <bdi className="whitespace-nowrap text-xs text-muted">{c.invoiceNumber ?? '—'}</bdi>
                <span className="min-w-0 flex-1 truncate">
                  {displayName(locale, c.productName, c.productNameEn) || discrepancyLabel(ta, c.discrepancyType)}
                </span>
                <span className="text-right tabular-nums">{ils(c.outstandingAgorot)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <Field label={t('creditForm.number')}>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} readOnly={!!line} />
      </Field>
      <Field label={t('creditForm.amountAsPrinted')} hint={error ?? undefined}>
        <Input
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          readOnly={!!line}
          data-testid="credit-amount"
        />
      </Field>
      <Field label={t('creditForm.date')}>
        <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required readOnly={!!line} />
      </Field>
      {line ? null : (
        <fieldset className="sm:col-span-3">
          <legend className="mb-1.5 text-sm font-medium text-muted">{t('creditForm.vatLegend')}</legend>
          <div role="radiogroup" aria-label={t('creditForm.vatLegend')} className="flex flex-wrap gap-2" data-testid="credit-vat">
            {(['incl', 'excl'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={vat === v}
                onClick={() => {
                  setVat(v);
                  setError(null);
                }}
                className={cn(
                  'min-h-11 rounded-full border px-3 text-sm md:min-h-9',
                  vat === v ? 'border-primary bg-primary/10 font-semibold text-ink' : 'border-line text-muted hover:text-ink',
                )}
              >
                {t(`creditForm.vat.${v}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-sm text-ink sm:col-span-3" aria-live="polite" data-testid="credit-remainder">
        {t('creditForm.running', { chosen: ils(owed), typed: typedExcl == null ? '—' : ils(typedExcl) })}
        {diff == null ? null : diff === 0 ? (
          <span className="ms-2 font-semibold text-gold">✓</span>
        ) : (
          <span className="ms-2 font-semibold text-warn">{t('creditForm.diff', { amount: ils(Math.abs(diff)) })}</span>
        )}
      </p>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" variant="gold" loading={busy} disabled={!canSubmit}>
          {t('creditForm.submit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('creditForm.cancel')}
        </Button>
      </div>
    </form>
  );
}
