'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDate } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { recovery } from '@/lib/i18n/messages/recovery';
import { approvals } from '@/lib/i18n/messages/approvals';
import { Badge, Button, Card, Field, Input, cn, type BadgeTone } from '@/lib/components';
import { discrepancyLabel, displayName } from '../approvals/vocab';
import { parseIlsInput } from './parseIls';

type Out = inferRouterOutputs<AppRouter>['recovery'];
type Claim = Out['list'][number];
type Suggestion = Out['creditLineSuggestions'][number];
type Status = Claim['status'];

/** Mirrors packages/api/src/recovery/lifecycle.ts (the server re-validates every move). */
const NEXT: Record<Status, Status[]> = {
  claimed: ['letter_sent', 'acknowledged', 'disputed', 'written_off'],
  letter_sent: ['acknowledged', 'disputed', 'written_off'],
  acknowledged: ['disputed', 'written_off'],
  credited: ['recovered', 'disputed'],
  recovered: [],
  disputed: ['letter_sent', 'acknowledged', 'written_off'],
  written_off: ['claimed'],
};
const CREDITABLE: Status[] = ['claimed', 'letter_sent', 'acknowledged', 'credited', 'disputed'];
const CLOSED: Status[] = ['recovered', 'written_off'];
const TONE: Record<Status, BadgeTone> = {
  claimed: 'neutral',
  letter_sent: 'info',
  acknowledged: 'info',
  credited: 'accent',
  recovered: 'gold',
  disputed: 'warning',
  written_off: 'neutral',
};

export function TrackerClient({ claims, suggestions }: { claims: Claim[]; suggestions: Suggestion[] }) {
  const t = useT(recovery);
  const ta = useT(approvals);
  const locale = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<'open' | 'all' | 'closed'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [creditFor, setCreditFor] = useState<string | null>(null); // supplier key
  const ils = (agorot: number) => formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });

  const done = {
    onSuccess: () => {
      setMessage({ tone: 'ok', text: t('actions.saved') });
      setCreditFor(null);
      router.refresh();
    },
    onError: () => setMessage({ tone: 'error', text: t('actions.failed') }),
    onSettled: () => setBusy(null),
  };
  const transition = trpc.recovery.transition.useMutation(done);
  const credit = trpc.recovery.recordCreditNote.useMutation({
    ...done,
    onSuccess: (res) => {
      setMessage({
        tone: 'ok',
        text: res.unallocatedAgorot > 0 ? t('creditForm.remainder', { amount: ils(res.unallocatedAgorot) }) : t('actions.saved'),
      });
      setCreditFor(null);
      router.refresh();
    },
  });

  const shown = useMemo(
    () =>
      claims.filter((c) =>
        filter === 'all' ? true : filter === 'closed' ? CLOSED.includes(c.status) : !CLOSED.includes(c.status),
      ),
    [claims, filter],
  );

  // Creditable claims grouped by supplier — one credit note usually covers several lines.
  const creditable = useMemo(() => {
    const m = new Map<string, { supplierId: string; name: string; ids: string[]; owed: number }>();
    for (const c of claims) {
      if (!c.supplierId || !CREDITABLE.includes(c.status) || c.outstandingAgorot <= 0) continue;
      const g = m.get(c.supplierId) ?? {
        supplierId: c.supplierId,
        name: displayName(locale, c.supplierName, c.supplierNameEn) || '—',
        ids: [],
        owed: 0,
      };
      g.ids.push(c.id);
      g.owed += c.outstandingAgorot;
      m.set(c.supplierId, g);
    }
    return [...m.values()];
  }, [claims, locale]);

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
                    <span className="font-semibold text-ink">
                      {displayName(locale, s.supplierName, s.supplierNameEn)}
                    </span>
                    <span className="ms-2 font-mono text-muted">{s.invoiceNumber ?? '—'}</span>
                    <span className="ms-2 text-muted">{displayName(locale, s.description, s.descriptionEn)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-primary">{ils(s.amountAgorot)}</span>
                    {group ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === s.invoiceLineId}
                        onClick={() => {
                          setBusy(s.invoiceLineId);
                          credit.mutate({ claimIds: group.ids, invoiceLineId: s.invoiceLineId });
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
          <ul className="mt-2 divide-y divide-line/60">
            {creditable.map((g) => (
              <li key={g.supplierId} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-ink">{g.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-danger">{ils(g.owed)}</span>
                    <Button size="sm" variant="gold" onClick={() => setCreditFor(creditFor === g.supplierId ? null : g.supplierId)}>
                      {t('actions.credit')}
                    </Button>
                  </span>
                </div>
                {creditFor === g.supplierId ? (
                  <CreditForm
                    supplier={g.name}
                    count={g.ids.length}
                    owed={g.owed}
                    busy={credit.isPending}
                    onCancel={() => setCreditFor(null)}
                    onSubmit={(v) => credit.mutate({ claimIds: g.ids, supplierId: g.supplierId, ...v })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">{t('tracker.claimsTitle')}</h2>
          <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1 text-xs">
            {(['open', 'all', 'closed'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-lg px-3 py-1 font-semibold',
                  filter === f ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                )}
              >
                {t(`tracker.filter${f === 'open' ? 'Open' : f === 'all' ? 'All' : 'Closed'}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="recovery-claims">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colSupplier')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colInvoice')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colItem')}</th>
                <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('tracker.colAmount')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('tracker.colStatus')}</th>
                <th scope="col" className="py-2 pe-3 text-end font-semibold">{t('tracker.colAge')}</th>
                <th scope="col" className="py-2 text-end font-semibold">{t('tracker.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const item =
                  displayName(locale, c.productName, c.productNameEn) ||
                  displayName(locale, c.lineDescription, c.lineDescriptionEn);
                return (
                  <tr key={c.id} className="border-b border-line/60 align-top">
                    <td className="py-2 pe-3 text-ink">{displayName(locale, c.supplierName, c.supplierNameEn) || '—'}</td>
                    <td className="py-2 pe-3 font-mono text-muted">{c.invoiceNumber ?? '—'}</td>
                    <td className="py-2 pe-3">
                      <span className="text-ink">{item || '—'}</span>
                      <span className="block text-xs text-muted">{discrepancyLabel(ta, c.discrepancyType)}</span>
                    </td>
                    <td className="py-2 pe-3 text-end font-mono tabular-nums">
                      {ils(c.amountAgorot)}
                      {c.creditedAgorot > 0 ? (
                        <span className="block text-xs text-primary">
                          {c.creditNoteNumber ? `${c.creditNoteNumber} · ` : ''}
                          {ils(c.creditedAgorot)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3">
                      <Badge tone={TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
                      {c.overdue ? <Badge tone="danger" className="ms-1">!</Badge> : null}
                      {c.recoveredAt ? (
                        <span className="block text-xs text-muted">{formatDate(c.recoveredAt, locale)}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted">{c.ageDays}</td>
                    <td className="py-2 text-end">
                      {NEXT[c.status].length > 0 ? (
                        <select
                          aria-label={t('actions.menu')}
                          disabled={busy === c.id}
                          value=""
                          onChange={(e) => {
                            const to = e.target.value as Exclude<Status, 'credited'>;
                            if (!to) return;
                            setBusy(c.id);
                            transition.mutate({ claimIds: [c.id], to });
                          }}
                          className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-ink"
                        >
                          <option value="">{t('actions.menu')}</option>
                          {NEXT[c.status].map((s) => (
                            <option key={s} value={s}>
                              {t(`actions.${s as Exclude<Status, 'credited'>}`)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CreditForm({
  supplier,
  count,
  owed,
  busy,
  onSubmit,
  onCancel,
}: {
  supplier: string;
  count: number;
  owed: number;
  busy: boolean;
  onSubmit: (v: { number?: string; amountAgorot: number; issuedOn: string; note?: string }) => void;
  onCancel: () => void;
}) {
  const t = useT(recovery);
  const locale = useLocale();
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState((owed / 100).toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-2/60 p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const agorot = parseIlsInput(amount);
        if (agorot == null) {
          setError(t('creditForm.invalidAmount'));
          return;
        }
        onSubmit({ number: number.trim() || undefined, amountAgorot: agorot, issuedOn: date });
      }}
    >
      <p className="text-sm font-semibold text-ink sm:col-span-3">{t('creditForm.title', { supplier })}</p>
      <Field label={t('creditForm.number')}>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} />
      </Field>
      <Field label={t('creditForm.amount')} hint={error ?? undefined}>
        <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label={t('creditForm.date')}>
        <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <p className="text-xs text-muted sm:col-span-3">
        {t('creditForm.claims', { count, amount: formatIls(owed / 100, { locale, maximumFractionDigits: 2 }) })}
      </p>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" variant="gold" loading={busy}>
          {t('creditForm.submit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('creditForm.cancel')}
        </Button>
      </div>
    </form>
  );
}
