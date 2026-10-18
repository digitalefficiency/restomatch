'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  SectionHeader,
  Select,
  Spinner,
  cn,
  displayName,
  entitlementCauseOf,
  friendlyError,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { addOrMerge, lineTotalIls, linesValid, orderTotalIls } from '../order-logic';

type Outputs = inferRouterOutputs<AppRouter>;
type Channel = 'email' | 'whatsapp' | 'none';
type DeliveryPreview = NonNullable<Outputs['orders']['previewDelivery']>;

interface DraftLine {
  key: string;
  productId?: string;
  /** Hebrew source text — what the supplier and the matcher see. */
  rawDescription: string;
  /** English display name, when known (UI only). */
  nameEn?: string | null;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
}

type Step = 'SUPPLIER' | 'BUILD' | 'REVIEW' | 'SENT';
const STEPS: Step[] = ['SUPPLIER', 'BUILD', 'REVIEW', 'SENT'];
const STEP_KEY = { SUPPLIER: 'supplier', BUILD: 'build', REVIEW: 'review', SENT: 'sent' } as const;

const fwd = 'h-4 w-4 rtl:-scale-x-100';

export function NewOrderWizard({ initialSupplierId }: { initialSupplierId: string }) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const locale = useLocale();

  const [step, setStep] = useState<Step>(initialSupplierId ? 'BUILD' : 'SUPPLIER');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [announce, setAnnounce] = useState('');
  /** The draft created on the first submit — retries only re-send it (no duplicate drafts). */
  const [draftId, setDraftId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(rawSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const suppliers = trpc.suppliers.list.useQuery({});
  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const supplierLabel = supplier ? displayName(supplier.name, supplier.nameEn, locale).primary : '';

  // An unknown/foreign ?supplierId= falls back to the picker instead of a dead end.
  useEffect(() => {
    if (suppliers.data && supplierId && !supplier) {
      setSupplierId('');
      setStep('SUPPLIER');
    }
  }, [suppliers.data, supplierId, supplier]);

  const catalog = trpc.catalog.items.useQuery(
    { supplierId, search: search || undefined, limit: search ? 20 : 8 },
    { enabled: step === 'BUILD' && !!supplierId, placeholderData: (prev) => prev },
  );

  // Cadence: derive the delivery date for the manager to CONFIRM (never silent).
  const delivery = trpc.orders.previewDelivery.useQuery(
    { supplierId },
    { enabled: !!supplierId, retry: false },
  );

  // Default channel follows what the supplier can actually receive.
  const defaultChannel: Channel = supplier?.contactEmail
    ? 'email'
    : supplier?.contactWhatsapp
      ? 'whatsapp'
      : 'none';
  const effectiveChannel = channel ?? defaultChannel;

  const total = useMemo(() => orderTotalIls(lines), [lines]);
  const valid = linesValid(lines);
  const pricedLines = useMemo(
    () =>
      lines
        .filter((l) => l.productId && typeof l.unitPriceExpected === 'number')
        .map((l) => ({ productId: l.productId!, unitPriceExpected: l.unitPriceExpected! })),
    [lines],
  );

  const guardrail = trpc.orders.guardrail.useQuery(
    { supplierId, lines: pricedLines },
    { enabled: step === 'REVIEW' && pricedLines.length > 0, retry: false },
  );
  const guardrailGated = guardrail.error ? !!entitlementCauseOf(guardrail.error) : false;
  const warningsByProduct = new Map((guardrail.data?.warnings ?? []).map((w) => [w.productId, w]));

  const createDraft = trpc.orders.createDraft.useMutation();
  const placeOrder = trpc.orders.placeOrder.useMutation();

  function addLine(line: Omit<DraftLine, 'key'>) {
    const res = addOrMerge(lines, line, () => crypto.randomUUID());
    setLines(res.lines);
    const name = displayName(line.rawDescription, line.nameEn, locale).primary;
    setAnnounce(res.merged ? t('wizard.alreadyAdded', { name }) : t('wizard.added', { name }));
  }
  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function submit() {
    try {
      let poId = draftId;
      if (!poId) {
        const draft = await createDraft.mutateAsync({
          supplierId,
          lines: lines.map((l) => ({
            productId: l.productId,
            rawDescription: l.rawDescription || undefined,
            qty: l.qty,
            unit: l.unit,
            unitPriceExpected: l.unitPriceExpected,
          })),
        });
        poId = draft.poId;
        setDraftId(poId);
      }
      await placeOrder.mutateAsync({ poId, channel: effectiveChannel });
      setStep('SENT');
    } catch {
      // Surfaced below via createDraft.error / placeOrder.error.
    }
  }

  const placeErr = placeOrder.error;
  const placeErrMsg = placeErr
    ? entitlementCauseOf(placeErr)
      ? t('errors.whatsappGated')
      : friendlyError(placeErr, tc, {
          BAD_REQUEST: t('errors.noContact', {
            channel: t(`detail.channelNames.${effectiveChannel === 'whatsapp' ? 'whatsapp' : 'email'}`),
          }),
        })
    : null;

  const reset = () => {
    setStep('SUPPLIER');
    setSupplierId('');
    setLines([]);
    setChannel(null);
    setRawSearch('');
    setDraftId(null);
    createDraft.reset();
    placeOrder.reset();
  };

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const deliveryDate = (iso: string) =>
    formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeader level={1} title={t('wizard.title')} subtitle={t('wizard.subtitle')} />
      <ol aria-label={t('wizard.stepsLabel')} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((s, i) => {
          const idx = STEPS.indexOf(step);
          return (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'rounded-full px-3 py-1',
                i <= idx
                  ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                  : 'bg-surface-2 text-subtle',
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {t(`wizard.steps.${STEP_KEY[s]}`)}
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {step === 'SUPPLIER' && (
        <Card elevated flow>
          {suppliers.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted">
              <Spinner className="h-4 w-4" />
            </div>
          ) : (suppliers.data ?? []).length === 0 ? (
            <EmptyState
              title={t('wizard.noSuppliers')}
              action={
                <LinkButton href="/dashboard/suppliers" size="sm">
                  {t('wizard.addSupplier')}
                </LinkButton>
              }
            />
          ) : (
            <>
              <Field label={t('wizard.pickSupplier')} htmlFor="ord-supplier">
                <Select
                  id="ord-supplier"
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    setLines([]);
                    setChannel(null);
                    setDraftId(null);
                  }}
                >
                  <option value="">{t('wizard.pickSupplierOption')}</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {displayName(s.name, s.nameEn, locale).primary}
                    </option>
                  ))}
                </Select>
              </Field>
              {supplierId ? (
                <DeliveryPanel d={delivery.data ?? null} loading={delivery.isLoading} fmt={deliveryDate} />
              ) : null}
              <div className="mt-4">
                <Button variant="primary" size="sm" disabled={!supplierId} onClick={() => setStep('BUILD')}>
                  {t('wizard.continue')} <ArrowRight className={fwd} aria-hidden="true" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {step === 'BUILD' && (
        <div className="space-y-4">
          <Card elevated>
            <p className="mb-3 text-sm text-muted">
              {t('wizard.supplierLabel')} <span className="font-semibold text-ink">{supplierLabel}</span>
            </p>
            <Field label={t('wizard.addFromCatalog')} htmlFor="ord-search">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                  aria-hidden="true"
                />
                <Input
                  id="ord-search"
                  type="search"
                  value={rawSearch}
                  onChange={(e) => setRawSearch(e.target.value)}
                  placeholder={t('wizard.searchPlaceholder')}
                  className="ps-9"
                  autoComplete="off"
                />
              </div>
            </Field>
            {!search && (catalog.data ?? []).length > 0 ? (
              <p className="mt-2 text-xs text-subtle">{t('wizard.browseHint')}</p>
            ) : null}
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted">
                  <Spinner className="h-4 w-4" /> {t('wizard.searching')}
                </div>
              ) : (catalog.data ?? []).length === 0 ? (
                search ? (
                  <p className="p-3 text-sm text-subtle">{t('wizard.noCatalogResults')}</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-subtle">
                    <span>{t('wizard.catalogEmpty')}</span>
                    <LinkButton href={`/dashboard/catalog/import?supplierId=${supplierId}`} size="sm" variant="secondary">
                      <Upload className="h-4 w-4" aria-hidden="true" /> {t('wizard.importCatalog')}
                    </LinkButton>
                  </div>
                )
              ) : (
                <ul>
                  {(catalog.data ?? []).map((it) => {
                    const name = displayName(it.supplierNameRaw, it.productNameEn, locale);
                    return (
                      <li key={it.id} className="border-b border-line/60 last:border-0">
                        <button
                          type="button"
                          onClick={() =>
                            addLine({
                              productId: it.productId ?? undefined,
                              rawDescription: it.supplierNameRaw,
                              nameEn: it.productNameEn,
                              qty: 1,
                              unit: it.unit ?? (locale === 'en' ? 'unit' : 'יח׳'),
                              unitPriceExpected: it.listPrice != null ? Number(it.listPrice) : undefined,
                            })
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{name.primary}</span>
                            {name.secondary || it.supplierSku ? (
                              <span className="block truncate text-xs text-subtle">
                                {[name.secondary, it.supplierSku].filter(Boolean).join(' · ')}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted">
                            {it.listPrice != null ? money(Number(it.listPrice)) : '—'}
                            {it.unit ? <span className="font-sans">/ {it.unit}</span> : null}
                            <Plus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { key: crypto.randomUUID(), rawDescription: '', qty: 1, unit: locale === 'en' ? 'unit' : 'יח׳' },
                  ])
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('wizard.addFreeLine')}
              </Button>
            </div>
          </Card>

          <Card elevated>
            {lines.length === 0 ? (
              <EmptyState title={t('wizard.emptyOrderTitle')} description={t('wizard.emptyOrderBody')} />
            ) : (
              <ul className="space-y-3">
                {lines.map((l) => {
                  const name = displayName(l.rawDescription, l.nameEn, locale);
                  return (
                    <li key={l.key} className="flex flex-wrap items-end gap-3 border-b border-line/60 pb-3 last:border-0">
                      <div className="min-w-[10rem] flex-1">
                        {l.productId ? (
                          <>
                            <p className="truncate text-sm text-ink">{name.primary}</p>
                            {name.secondary ? (
                              <p className="truncate text-xs text-subtle" lang="he" dir="rtl">
                                {name.secondary}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <Input
                            value={l.rawDescription}
                            onChange={(e) => patchLine(l.key, { rawDescription: e.target.value })}
                            placeholder={t('wizard.freeLinePlaceholder')}
                            aria-label={t('wizard.freeLinePlaceholder')}
                            maxLength={400}
                            aria-invalid={!l.rawDescription.trim() || undefined}
                            className="text-sm"
                          />
                        )}
                      </div>
                      <label className="text-xs text-subtle">
                        {t('wizard.qty')}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={Number.isFinite(l.qty) ? l.qty : ''}
                          onChange={(e) => patchLine(l.key, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                          aria-invalid={!(l.qty > 0) || undefined}
                          className="mt-0.5 w-20 text-end text-sm tabular-nums"
                        />
                      </label>
                      <label className="text-xs text-subtle">
                        {t('wizard.unit')}
                        <Input
                          value={l.unit}
                          onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                          maxLength={32}
                          className="mt-0.5 w-20 text-sm"
                        />
                      </label>
                      <label className="text-xs text-subtle">
                        {t('wizard.price')}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={l.unitPriceExpected ?? ''}
                          onChange={(e) =>
                            patchLine(l.key, {
                              unitPriceExpected: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="mt-0.5 w-24 text-end text-sm tabular-nums"
                        />
                      </label>
                      <span className="w-24 pb-2 text-end font-mono text-sm tabular-nums text-ink">
                        {money(lineTotalIls(l.qty, l.unitPriceExpected))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="mb-1.5 rounded p-1 text-subtle hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        aria-label={t('wizard.remove', { name: name.primary || t('wizard.freeLinePlaceholder') })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
                <li className="flex justify-between pt-1 text-sm font-semibold text-ink">
                  <span>{t('wizard.total')}</span>
                  <span className="font-mono tabular-nums">{money(total)}</span>
                </li>
              </ul>
            )}
            {lines.length > 0 && !valid ? (
              <p className="mt-3 text-xs text-warn">{t('wizard.fixLines')}</p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={!valid} onClick={() => setStep('REVIEW')}>
                {t('wizard.toReview')} <ArrowRight className={fwd} aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('SUPPLIER')}>
                {t('wizard.back')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {step === 'REVIEW' && (
        <Card elevated flow>
          <h2 className="mb-3 text-base font-bold text-ink">{t('wizard.reviewTitle', { supplier: supplierLabel })}</h2>
          <ul className="space-y-2">
            {lines.map((l) => {
              const w = l.productId ? warningsByProduct.get(l.productId) : undefined;
              const name = displayName(l.rawDescription, l.nameEn, locale);
              return (
                <li
                  key={l.key}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{name.primary}</span>
                  <span className="text-xs tabular-nums text-muted">
                    {l.qty} {l.unit}
                  </span>
                  <span className="w-24 text-end font-mono text-sm tabular-nums text-ink">
                    {money(lineTotalIls(l.qty, l.unitPriceExpected))}
                  </span>
                  {w && (
                    <Badge
                      tone={w.level === 'high' ? 'danger' : 'warning'}
                      icon={<TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                    >
                      {w.level === 'high'
                        ? t('wizard.aboveP90')
                        : t('wizard.aboveMedian', { pct: formatPercent(w.pctOverMedian, locale, 0) })}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-sm font-semibold text-ink">
            <span>{t('wizard.total')}</span>
            <span className="font-mono tabular-nums">{money(total)}</span>
          </div>

          <DeliveryPanel d={delivery.data ?? null} loading={delivery.isLoading} fmt={deliveryDate} />

          {guardrail.isFetching && (
            <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
              <Spinner className="h-3.5 w-3.5" /> {t('wizard.checkingBaseline')}
            </p>
          )}
          {guardrailGated && <p className="mt-3 text-xs text-subtle">{t('wizard.guardrailGated')}</p>}

          <div className="mt-5 space-y-3 border-t border-line pt-4">
            <Field label={t('wizard.channel')} htmlFor="ord-channel">
              <Select
                id="ord-channel"
                value={effectiveChannel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                disabled={!!draftId && placeOrder.isPending}
              >
                <option value="email" disabled={!supplier?.contactEmail}>
                  {supplier?.contactEmail
                    ? t('wizard.channelEmailTo', { to: supplier.contactEmail })
                    : `${t('wizard.channelEmail')} — ${t('wizard.channelMissing')}`}
                </option>
                <option value="whatsapp" disabled={!supplier?.contactWhatsapp}>
                  {supplier?.contactWhatsapp
                    ? t('wizard.channelWhatsappTo', { to: supplier.contactWhatsapp })
                    : `${t('wizard.channelWhatsapp')} — ${t('wizard.channelMissing')}`}
                </option>
                <option value="none">{t('wizard.channelNone')}</option>
              </Select>
            </Field>
            {placeErrMsg && (
              <p role="alert" className="text-sm text-danger">
                {placeErrMsg}
              </p>
            )}
            {createDraft.error && (
              <p role="alert" className="text-sm text-danger">
                {friendlyError(createDraft.error, tc)}
              </p>
            )}
            {draftId && placeErr ? (
              <p className="text-xs text-muted">
                {t('wizard.draftSaved')}{' '}
                <Link href={`/dashboard/orders/${draftId}`} className="text-primary underline">
                  {t('wizard.openDraft')}
                </Link>
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={createDraft.isPending || placeOrder.isPending}
                onClick={submit}
              >
                {t('wizard.submit')}
              </Button>
              <Button variant="ghost" size="sm" disabled={!!draftId} onClick={() => setStep('BUILD')}>
                {t('wizard.back')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'SENT' && (
        <Card elevated flow className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-ink" role="status">
            {t('wizard.sentTitle')}
          </p>
          <p className="mt-1 text-sm text-muted">{t('wizard.sentBody')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {draftId ? (
              <LinkButton href={`/dashboard/orders/${draftId}`} size="sm">
                {t('wizard.viewOrder')}
              </LinkButton>
            ) : null}
            <LinkButton href="/dashboard/orders" size="sm" variant="secondary">
              {t('wizard.toList')}
            </LinkButton>
            <Button variant="ghost" size="sm" onClick={reset}>
              {t('wizard.another')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Shows the DERIVED delivery date for the manager to confirm. When the order is
 * placed after today's cutoff we say so explicitly instead of silently rolling.
 */
function DeliveryPanel({
  d,
  loading,
  fmt,
}: {
  d: DeliveryPreview | null;
  loading: boolean;
  fmt: (iso: string) => string;
}) {
  const t = useT(ordersNs);
  if (loading) return null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
      {d ? (
        <>
          <p className="flex items-center gap-2 text-ink">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>
              {t('wizard.deliveryExpected')} <span className="font-semibold">{fmt(d.expectedDeliveryAt)}</span>
            </span>
          </p>
          {d.missedCutoff && (
            <p className="mt-2 text-xs text-warn">{t('wizard.missedCutoff', { date: fmt(d.expectedDeliveryAt) })}</p>
          )}
          <p className="mt-1 text-xs text-subtle">{t('wizard.deliveryHint')}</p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> {t('wizard.noSchedule')}
        </p>
      )}
    </div>
  );
}
