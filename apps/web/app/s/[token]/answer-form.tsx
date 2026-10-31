'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Card, cn } from '@/lib/components';
import { UnitText } from '@/lib/components/UnitText';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { supplierConfirm } from '@/lib/i18n/messages/supplierConfirm';
import { formatIls } from '@/lib/money';
import { DiffList } from './Diff';
import { answerBody, computeAnswer, type DiffItem, type PortalLine } from './logic';

export type { PortalLine } from './logic';

type Phase =
  | { kind: 'edit' }
  | { kind: 'sending'; what: 'answer' | 'asIs' }
  | { kind: 'done'; status: 'confirmed' | 'changes'; diff: DiffItem[]; note: string | null }
  | { kind: 'error'; key: ErrorKey };
type ErrorKey = 'notFound' | 'expired' | 'rateLimited' | 'generic';

const inputClass =
  'mt-1 block min-h-12 w-full rounded-lg border bg-surface px-3 py-2.5 text-base text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** ₪ in a plain `<bdi>` — no `dir`, so in Hebrew the ₪ sits left of the digits (E4). */
function Ils({ agorot, locale }: { agorot: number; locale: 'he' | 'en' }) {
  return <bdi className="tabular-nums">{formatIls(agorot / 100, { locale, maximumFractionDigits: 2 })}</bdi>;
}

/**
 * The supplier's answer (auth-02, auth-16, auth-28): per line the quantity they
 * will deliver ("אין במלאי" in one tap) and their unit price, both prefilled
 * with the order. ONE adaptive, sticky primary:
 *  - nothing changed → "אישור ההזמנה כפי שהיא";
 *  - something changed → "שליחת התשובה · N שינויים" with the diff above it, and
 *    "as ordered" demoted to a text button that first asks to discard the edits.
 * A marked change can therefore never be dropped by the natural tap.
 */
export function SupplierAnswerForm({ token, poNumber, lines }: { token: string; poNumber: string; lines: PortalLine[] }) {
  const t = useT(supplierConfirm);
  const locale = useLocale();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.qtyOrdered)])),
  );
  const [price, setPrice] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.unitPrice == null ? '' : String(l.unitPrice)])),
  );
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showInvalid, setShowInvalid] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const answer = useMemo(() => computeAnswer(lines, qty, price, note), [lines, qty, price, note]);
  const { rows, diff, changeCount, invalid } = answer;
  const hasChanges = changeCount > 0;

  async function send(what: 'answer' | 'asIs') {
    setConfirmDiscard(false);
    setPhase({ kind: 'sending', what });
    const body = answerBody(what, answer, note);
    try {
      const res = await fetch(`/api/supplier-confirm/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: 'confirmed' | 'changes' };
      if (res.ok && data.ok && data.status) {
        return setPhase({
          kind: 'done',
          status: data.status,
          diff: what === 'asIs' ? [] : diff,
          note: what === 'asIs' ? null : body.note,
        });
      }
      // auth-03: someone already answered this order. Never a false success —
      // reload the page, which shows the RECORDED answer, its date, and that
      // these changes were not saved.
      if (res.status === 409) {
        router.replace(`/s/${encodeURIComponent(token)}?answered=1`);
        router.refresh();
        return;
      }
      const key: ErrorKey =
        res.status === 404 ? 'notFound' : res.status === 410 ? 'expired' : res.status === 429 ? 'rateLimited' : 'generic';
      setPhase({ kind: 'error', key });
    } catch {
      setPhase({ kind: 'error', key: 'generic' });
    }
  }

  if (phase.kind === 'done') {
    return (
      <Card elevated padding="md" className="mt-6" role="status" data-testid="portal-done">
        <p className="flex items-center gap-2 text-lg font-bold text-ink">
          <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('portal.doneTitle')}
        </p>
        {phase.diff.length === 0 && !phase.note ? (
          <p className="mt-2 text-base text-ink">{t('portal.doneConfirmedOrder', { number: poNumber })}</p>
        ) : (
          <>
            <p className="mt-2 text-base text-ink">{t('portal.doneChangesOrder', { number: poNumber })}</p>
            <DiffList items={phase.diff} note={phase.note} className="mt-2 space-y-1 text-sm text-ink" />
            <p className="mt-3 text-sm text-muted">{t('portal.doneChanges')}</p>
          </>
        )}
      </Card>
    );
  }

  const busy = phase.kind === 'sending';
  const primaryLabel = !hasChanges
    ? t('portal.confirmAll')
    : changeCount === 1
      ? t('portal.sendAnswerOne')
      : t('portal.sendAnswerMany', { count: formatNumber(changeCount, locale) });

  function onPrimary() {
    if (!hasChanges) return void send('asIs');
    if (invalid) {
      // Never a silently disabled button: say why and go to the first bad field.
      setShowInvalid(true);
      formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    void send('answer');
  }

  return (
    <form
      ref={formRef}
      className="mt-6 space-y-3 pb-64"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onPrimary();
      }}
    >
      <OrderTotals answer={answer} locale={locale} />

      <ul className="space-y-3">
        {rows.map(({ line: l, qtyBad, priceBad, shortage, out, priceChanged, orderAgorot, answerAgorot, changed }) => {
          const qtyId = `qty-${l.id}`;
          const priceId = `price-${l.id}`;
          return (
            <li key={l.id}>
              <Card padding="sm" className={cn((shortage || priceChanged) && 'border-warn')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-ink">{l.name}</p>
                    {l.sku ? <p className="text-sm text-muted">{t('portal.sku', { sku: l.sku })}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {shortage && !out ? (
                      <span className="rounded-full border border-warn px-2 py-0.5 text-sm font-semibold text-ink">{t('portal.shortage')}</span>
                    ) : null}
                    {priceChanged ? (
                      <span className="rounded-full border border-warn px-2 py-0.5 text-sm font-semibold text-ink">{t('portal.priceChange')}</span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {t('portal.ordered')}: <bdi className="tabular-nums">{formatNumber(l.qtyOrdered, locale)}</bdi>{' '}
                  <UnitText unit={l.unit} />
                  {l.unitPrice != null ? (
                    <>
                      {' · '}
                      {t(l.agreed ? 'portal.agreedPrice' : 'portal.orderPrice')}:{' '}
                      <bdi className="tabular-nums">{formatIls(l.unitPrice, { locale, maximumFractionDigits: 2 })}</bdi>
                    </>
                  ) : null}
                </p>
                {orderAgorot !== null ? (
                  <p className="mt-0.5 text-sm text-muted" data-testid="line-total">
                    {t('portal.lineTotal')}: <Ils agorot={orderAgorot} locale={locale} />
                    {changed && answerAgorot !== null && answerAgorot !== orderAgorot ? (
                      <>
                        {' · '}
                        {t('portal.answerLineTotal')}: <Ils agorot={answerAgorot} locale={locale} />
                      </>
                    ) : null}
                  </p>
                ) : null}

                <div className="mt-3">
                  <button
                    type="button"
                    aria-pressed={out}
                    onClick={() => setQty((s) => ({ ...s, [l.id]: out ? String(l.qtyOrdered) : '0' }))}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      out ? 'border-warn bg-warn text-on-primary' : 'border-line-strong bg-surface text-ink',
                    )}
                  >
                    {t('portal.outOfStock')}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={qtyId} className="block text-sm font-medium text-ink">
                      {t('portal.available')}
                    </label>
                    <input
                      id={qtyId}
                      inputMode="decimal"
                      dir="ltr"
                      autoComplete="off"
                      value={qty[l.id] ?? ''}
                      onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                      aria-invalid={qtyBad || undefined}
                      aria-describedby={qtyBad ? `${qtyId}-error` : undefined}
                      className={cn(inputClass, qtyBad ? 'border-danger' : 'border-line-strong')}
                    />
                    {qtyBad ? (
                      <span id={`${qtyId}-error`} className="mt-1 block text-sm text-danger">
                        {t('portal.invalidQty')}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor={priceId} className="block text-sm font-medium text-ink">
                      {t('portal.yourPrice')}{' '}
                      <span className="font-normal text-muted">
                        ({t('portal.perUnit')} <UnitText unit={l.unit} />)
                      </span>
                    </label>
                    <input
                      id={priceId}
                      inputMode="decimal"
                      dir="ltr"
                      autoComplete="off"
                      value={price[l.id] ?? ''}
                      onChange={(e) => setPrice((s) => ({ ...s, [l.id]: e.target.value }))}
                      aria-invalid={priceBad || undefined}
                      aria-describedby={priceBad ? `${priceId}-error` : undefined}
                      className={cn(inputClass, priceBad ? 'border-danger' : 'border-line-strong')}
                    />
                    {priceBad ? (
                      <span id={`${priceId}-error`} className="mt-1 block text-sm text-danger">
                        {t('portal.invalidPrice')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <div>
        <label htmlFor="portal-note" className="block text-sm font-medium text-ink">
          {t('portal.note')}
        </label>
        <textarea
          id="portal-note"
          value={note}
          maxLength={1000}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('portal.notePlaceholder')}
          className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      {/* The sticky action bar — above the cookie bar and the home indicator. */}
      <div
        className="fixed inset-x-0 z-30 border-t border-line bg-surface/95 shadow-card backdrop-blur"
        style={{ bottom: 'var(--consent-h, 0px)' }}
        data-testid="portal-actions"
      >
        <div className="mx-auto w-full max-w-xl px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <div aria-live="polite" className="mb-2">
            {hasChanges ? (
              <div className="rounded-lg border border-warn bg-surface px-3 py-2" data-testid="portal-diff">
                <DiffList items={diff} note={note.trim() || null} limit={3} className="space-y-0.5 text-sm text-ink" />
              </div>
            ) : (
              <p className="text-sm text-muted">{t('portal.noChanges')}</p>
            )}
            {showInvalid && invalid ? (
              <p role="alert" className="mt-1 text-sm font-medium text-danger">
                {t('portal.fixFields')}
              </p>
            ) : null}
            {phase.kind === 'error' ? (
              <p role="alert" className="mt-1 text-sm font-medium text-danger">
                {t(`portal.errors.${phase.key}`)}
              </p>
            ) : null}
          </div>

          {confirmDiscard ? (
            <div role="alertdialog" aria-labelledby="discard-q" className="space-y-2">
              <p id="discard-q" className="text-base font-semibold text-ink">
                {changeCount === 1
                  ? t('portal.discardOne')
                  : t('portal.discardMany', { count: formatNumber(changeCount, locale) })}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" className="min-h-12" onClick={() => setConfirmDiscard(false)} autoFocus>
                  {t('portal.discardNo')}
                </Button>
                <Button type="button" variant="danger" className="min-h-12" onClick={() => void send('asIs')}>
                  {t('portal.discardYes')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                type="submit"
                data-keep-clear
                data-primary
                className="min-h-14 w-full text-base"
                disabled={busy}
                loading={busy}
              >
                {busy ? t('portal.sending') : primaryLabel}
              </Button>
              {hasChanges ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDiscard(true)}
                  className="mt-1 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  {t('portal.asIsText')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function OrderTotals({ answer, locale }: { answer: ReturnType<typeof computeAnswer>; locale: 'he' | 'en' }) {
  const t = useT(supplierConfirm);
  const { orderTotalAgorot, answerTotalAgorot, unpriced, rows, changeCount, invalid } = answer;
  if (rows.length === unpriced) return null;
  return (
    <div className="rounded-xl border border-line-strong bg-surface px-3 py-3" data-testid="order-total">
      <p className="flex items-baseline justify-between gap-3 text-base font-semibold text-ink">
        <span>{t('portal.orderTotal')}</span>
        <Ils agorot={orderTotalAgorot} locale={locale} />
      </p>
      {changeCount > 0 && !invalid && answerTotalAgorot !== orderTotalAgorot ? (
        <p className="mt-1 flex items-baseline justify-between gap-3 text-sm text-ink">
          <span>{t('portal.answerOrderTotal')}</span>
          <Ils agorot={answerTotalAgorot} locale={locale} />
        </p>
      ) : null}
      {unpriced > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {unpriced === 1 ? t('portal.unpricedOne') : t('portal.unpricedMany', { count: formatNumber(unpriced, locale) })}
        </p>
      ) : null}
    </div>
  );
}
