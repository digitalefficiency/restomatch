'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Card, cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { formatIls } from '@/lib/money';
import { parsePrice } from '@/app/dashboard/contracts/logic';

export interface PortalLine {
  id: string;
  name: string;
  sku: string | null;
  qtyOrdered: number;
  unit: string;
  unitPrice: number | null;
}

/** "12", "7.5", "7,5", "0" → number ≥ 0; anything else null. */
function parseQty(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

type Phase = { kind: 'edit' } | { kind: 'sending' } | { kind: 'done'; status: 'confirmed' | 'changes' } | { kind: 'error'; key: ErrorKey };
type ErrorKey = 'notFound' | 'expired' | 'rateLimited' | 'generic';

/**
 * The supplier's answer: per line, the quantity they will deliver and their unit
 * price (both prefilled with the order). "Confirm as is" sends no changes.
 */
export function SupplierAnswerForm({ token, lines }: { token: string; lines: PortalLine[] }) {
  const t = useT(supplierConfirm);
  const locale = useLocale();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.qtyOrdered)])),
  );
  const [price, setPrice] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.unitPrice == null ? '' : String(l.unitPrice)])),
  );
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });

  const parsed = useMemo(
    () =>
      lines.map((l) => {
        const q = parseQty(qty[l.id] ?? '');
        const rawP = (price[l.id] ?? '').trim();
        const p = rawP === '' ? null : parsePrice(rawP);
        const qtyBad = q === null;
        const priceBad = rawP !== '' && p === null;
        const shortage = q !== null && q < l.qtyOrdered;
        const priceChanged = p !== null && (l.unitPrice == null || Math.round(p * 10000) !== Math.round(l.unitPrice * 10000));
        const qtyChanged = q !== null && q !== l.qtyOrdered;
        return { l, q, p, qtyBad, priceBad, shortage, changed: qtyChanged || priceChanged, priceChanged };
      }),
    [lines, qty, price],
  );
  const invalid = parsed.some((x) => x.qtyBad || x.priceBad);
  const changeCount = parsed.filter((x) => x.changed).length;

  async function send(asIs: boolean) {
    setPhase({ kind: 'sending' });
    const body = {
      lines: asIs
        ? []
        : parsed.map((x) => ({ poLineId: x.l.id, qtyAvailable: x.q, proposedUnitPrice: x.p })),
      note: asIs ? null : note.trim() || null,
    };
    try {
      const res = await fetch(`/api/supplier-confirm/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: 'confirmed' | 'changes' };
      if (res.ok && data.ok && data.status) return setPhase({ kind: 'done', status: data.status });
      if (res.status === 409) return setPhase({ kind: 'done', status: 'changes' });
      const key: ErrorKey =
        res.status === 404 ? 'notFound' : res.status === 410 ? 'expired' : res.status === 429 ? 'rateLimited' : 'generic';
      setPhase({ kind: 'error', key });
    } catch {
      setPhase({ kind: 'error', key: 'generic' });
    }
  }

  if (phase.kind === 'done') {
    return (
      <Card elevated padding="md" className="mt-6" role="status">
        <p className="flex items-center gap-2 text-lg font-bold text-ink">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
          {t('portal.doneTitle')}
        </p>
        <p className="mt-2 text-sm text-muted">
          {phase.status === 'confirmed' ? t('portal.doneConfirmed') : t('portal.doneChanges')}
        </p>
      </Card>
    );
  }

  const busy = phase.kind === 'sending';
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) void send(false);
      }}
    >
      <ul className="space-y-3">
        {parsed.map(({ l, qtyBad, priceBad, shortage, priceChanged }) => (
          <li key={l.id}>
            <Card padding="sm" className={cn((shortage || priceChanged) && 'border-warn/40')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{l.name}</p>
                  {l.sku ? <p className="text-xs text-subtle">{t('portal.sku', { sku: l.sku })}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {shortage ? <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">{t('portal.shortage')}</span> : null}
                  {priceChanged ? <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">{t('portal.priceChange')}</span> : null}
                </div>
              </div>
              <p className="mt-1 text-sm text-muted">
                {t('portal.ordered')}: <bdi className="font-mono tabular-nums">{formatNumber(l.qtyOrdered, locale)}</bdi> {l.unit}
                {l.unitPrice != null ? (
                  <>
                    {' · '}
                    {t('portal.agreedPrice')}: <bdi dir="ltr" className="font-mono tabular-nums">{formatIls(l.unitPrice, { locale, maximumFractionDigits: 2 })}</bdi>
                  </>
                ) : null}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-muted">
                  {t('portal.available')}
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    value={qty[l.id] ?? ''}
                    onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                    aria-invalid={qtyBad || undefined}
                    className={cn(
                      'mt-1 block w-full rounded-lg border bg-surface px-3 py-2.5 text-base text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                      qtyBad ? 'border-danger' : 'border-line',
                    )}
                  />
                  {qtyBad ? <span className="mt-1 block text-danger">{t('portal.invalidQty')}</span> : null}
                </label>
                <label className="block text-xs font-medium text-muted">
                  {t('portal.yourPrice')} <span className="text-subtle">{t('portal.perUnit', { unit: l.unit })}</span>
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    value={price[l.id] ?? ''}
                    onChange={(e) => setPrice((s) => ({ ...s, [l.id]: e.target.value }))}
                    aria-invalid={priceBad || undefined}
                    className={cn(
                      'mt-1 block w-full rounded-lg border bg-surface px-3 py-2.5 text-base text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                      priceBad ? 'border-danger' : 'border-line',
                    )}
                  />
                  {priceBad ? <span className="mt-1 block text-danger">{t('portal.invalidPrice')}</span> : null}
                </label>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <label className="block text-sm font-medium text-muted">
        {t('portal.note')}
        <textarea
          value={note}
          maxLength={1000}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('portal.notePlaceholder')}
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>

      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {t(`portal.errors.${phase.key}`)}
        </p>
      ) : null}

      <p className="text-sm text-muted" aria-live="polite">
        {changeCount > 0 ? t('portal.changesCount', { count: formatNumber(changeCount, locale) }) : t('portal.noChanges')}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="w-full" disabled={busy} onClick={() => void send(true)}>
          {busy ? t('portal.sending') : t('portal.confirmAll')}
        </Button>
        <Button type="submit" variant="secondary" className="w-full" disabled={busy || invalid || (changeCount === 0 && !note.trim())}>
          {t('portal.sendChanges')}
        </Button>
      </div>
    </form>
  );
}
