'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, MessageCircle, PencilLine } from 'lucide-react';
import { Badge, Button, Card, Field, LinkButton, Textarea, cn } from '@/lib/components';
import { UnitText } from '@/lib/components/UnitText';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { ingest } from '@/lib/i18n/messages/ingest';
import { formatIls } from '@/lib/money';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';

type MatchedBy = 'picked' | 'phone' | 'name';
interface Candidate {
  id: string;
  name: string;
  nameEn: string | null;
}

/**
 * Paste / share → draft → one-tap confirm. Confirm = placeOrder with channel
 * 'none': the PO becomes a normal (sent) order and nothing is transmitted —
 * the supplier already has the WhatsApp message.
 */
export function CaptureClient({ initialText }: { initialText: string }) {
  const t = useT(ingest);
  const locale = useLocale();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [supplierId, setSupplierId] = useState<string>('');
  const [draft, setDraft] = useState<{ poId: string; created: boolean; matchedBy: MatchedBy } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const capture = trpc.orders.captureFromText.useMutation();
  const place = trpc.orders.placeOrder.useMutation();
  const order = trpc.orders.get.useQuery({ poId: draft?.poId ?? '' }, { enabled: !!draft });

  useEffect(() => {
    if (!initialText) document.getElementById('order-text')?.focus();
  }, [initialText]);

  async function submit(pickedSupplier?: string) {
    setError(null);
    try {
      const r = await capture.mutateAsync({ text, ...(pickedSupplier ? { supplierId: pickedSupplier } : {}) });
      if (r.status === 'no_lines') {
        setError(t('orderCapture.noLines'));
      } else if (r.status === 'needs_supplier') {
        setCandidates(r.candidates);
        setSupplierId(r.candidates[0]?.id ?? '');
      } else {
        setCandidates(null);
        setDraft({ poId: r.poId, created: r.created, matchedBy: r.matchedBy });
      }
    } catch (err) {
      setError(t('orderCapture.failed', { message: localizeServerError(err, locale) }));
    }
  }

  async function confirm() {
    if (!draft) return;
    setError(null);
    try {
      await place.mutateAsync({ poId: draft.poId, channel: 'none' });
      setConfirmed(true);
      void order.refetch();
    } catch (err) {
      setError(t('orderCapture.failed', { message: localizeServerError(err, locale) }));
    }
  }

  function reset() {
    setText('');
    setDraft(null);
    setCandidates(null);
    setConfirmed(false);
    setError(null);
    requestAnimationFrame(() => document.getElementById('order-text')?.focus());
  }

  const errorBox = error ? (
    <p role="alert" data-testid="capture-error" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-ink">
      {error}
    </p>
  ) : null;

  /* ── Step 3: draft review / confirmed ─────────────────────────────────── */
  if (draft) {
    const data = order.data;
    const supplier = data ? (locale === 'en' && data.supplierNameEn ? data.supplierNameEn : (data.supplierName ?? '')) : '';
    const lines = data?.lines ?? [];
    const mapped = lines.filter((l) => l.productId).length;
    const total = data?.po?.totalEstimated != null ? Number(data.po.totalEstimated) : null;
    const alreadySent = data?.po?.status && data.po.status !== 'draft';
    return (
      <Card padding="lg" data-testid="capture-draft">
        {confirmed || alreadySent ? (
          <div className="flex flex-col items-start gap-4" data-testid="capture-confirmed">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-lg font-bold text-ink">{confirmed ? t('orderCapture.confirmed') : t('orderCapture.statusSent')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/dashboard/orders/${draft.poId}`} variant="secondary">
                {t('orderCapture.openOrder')}
              </LinkButton>
              <Button variant="ghost" onClick={reset}>
                {t('orderCapture.another')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-ink">
              {t('orderCapture.draftTitle', { supplier: '' })}
              <span {...originalProps(supplier)}>{supplier}</span>
            </h2>
            <p className="mt-1 text-sm text-muted">{t('orderCapture.draftHint')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="neutral">{t(`orderCapture.matchedBy.${draft.matchedBy}`)}</Badge>
              {!draft.created ? <Badge tone="warning">{t('orderCapture.alreadyCaptured')}</Badge> : null}
            </div>

            <ul className="mt-5 divide-y divide-line rounded-xl border border-line" data-testid="capture-lines">
              {lines.map((l) => {
                const name = locale === 'en' && l.productNameEn ? l.productNameEn : (l.rawDescription ?? '');
                const price = l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                    <span className="min-w-0 flex-1 font-semibold text-ink" {...originalProps(name)}>
                      {name}
                    </span>
                    <span className="tabular-nums text-ink">
                      {formatNumber(Number(l.qtyOrdered), locale)} <UnitText unit={l.unit} />
                    </span>
                    <span className="w-24 text-end tabular-nums text-muted">
                      {price != null ? formatIls(price, { locale, maximumFractionDigits: 2 }) : t('orderCapture.noPrice')}
                    </span>
                    <Badge tone={l.productId ? 'accent' : 'neutral'}>
                      {l.productId ? t('orderCapture.inCatalog') : t('orderCapture.notInCatalog')}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            {data ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                <span>{t('orderCapture.mapped', { mapped: formatNumber(mapped, locale), count: formatNumber(lines.length, locale) })}</span>
                {total != null ? (
                  <span className="font-semibold text-ink">
                    {t('orderCapture.total')}: <span className="tabular-nums">{formatIls(total, { locale, maximumFractionDigits: 2 })}</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            {errorBox}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button
                size="md"
                className="min-h-14 flex-1 text-lg"
                onClick={confirm}
                loading={place.isPending}
                disabled={!data || place.isPending}
                data-testid="capture-confirm"
              >
                {place.isPending ? t('orderCapture.confirming') : t('orderCapture.confirm')}
              </Button>
              <LinkButton href={`/dashboard/orders/${draft.poId}`} variant="secondary" className="min-h-14">
                <PencilLine className="h-4 w-4" aria-hidden="true" /> {t('orderCapture.edit')}
              </LinkButton>
            </div>
          </>
        )}
      </Card>
    );
  }

  /* ── Step 2: pick the supplier ────────────────────────────────────────── */
  if (candidates) {
    return (
      <Card padding="lg" data-testid="capture-pick-supplier">
        <h2 className="text-lg font-bold text-ink">{t('orderCapture.pickSupplier')}</h2>
        <p className="mt-1 text-sm text-muted">{t('orderCapture.pickSupplierHint')}</p>
        {candidates.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-sm text-ink">{t('orderCapture.noSuppliers')}</p>
            <LinkButton href="/dashboard/suppliers" variant="secondary">
              {t('orderCapture.addSupplier')}
            </LinkButton>
          </div>
        ) : (
          <>
            <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{t('orderCapture.pickSupplier')}</legend>
              {candidates.map((c) => {
                const label = locale === 'en' && c.nameEn ? c.nameEn : c.name;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-ink transition-colors',
                      supplierId === c.id ? 'border-primary bg-primary/10' : 'border-line bg-surface-2 hover:border-primary/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="supplier"
                      value={c.id}
                      checked={supplierId === c.id}
                      onChange={() => setSupplierId(c.id)}
                      className="h-5 w-5 accent-primary"
                    />
                    <span className="font-semibold" {...originalProps(label)}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {errorBox}
            <div className="mt-5 flex gap-2">
              <Button className="min-h-14 flex-1" onClick={() => submit(supplierId)} loading={capture.isPending} disabled={!supplierId} data-testid="capture-pick-continue">
                {t('orderCapture.continue')}
              </Button>
              <Button variant="ghost" className="min-h-14" onClick={() => setCandidates(null)}>
                <PencilLine className="h-4 w-4" aria-hidden="true" /> {t('orderCapture.edit')}
              </Button>
            </div>
          </>
        )}
      </Card>
    );
  }

  /* ── Step 1: paste ────────────────────────────────────────────────────── */
  return (
    <Card padding="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('orderCapture.textLabel')} htmlFor="order-text" hint={t('orderCapture.textHint')}>
          <Textarea
            id="order-text"
            dir="auto"
            rows={9}
            maxLength={8000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('orderCapture.textPlaceholder')}
            data-testid="capture-text"
            className="font-mono text-base"
          />
        </Field>
        {errorBox}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="min-h-14 flex-1 text-lg" loading={capture.isPending} disabled={!text.trim() || capture.isPending} data-testid="capture-submit">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            {capture.isPending ? t('orderCapture.parsing') : t('orderCapture.parse')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
