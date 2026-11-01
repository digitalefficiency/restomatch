'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { Boxes, Check, Plus, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Spinner,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { catalog as catalogNs } from '@/lib/i18n/messages/catalog';
import { components } from '@/lib/i18n/messages/components';

type Outputs = inferRouterOutputs<AppRouter>;
type UnmappedSku = Outputs['mapping']['unmapped'][number];
type ConfirmResult = Outputs['mapping']['confirm'];
/** A confirm, or an answer (answerLink) whose undo is a server-signed token. */
type LinkResult = Omit<ConfirmResult, 'undo'> & { undo: ConfirmResult['undo'] | null; undoToken?: string | null };

/** How long "ביטול" stays on screen after a link (an action needs ≥10 s). */
const UNDO_MS = 10_000;

/** The confirm key: (supplier, SKU), or a G-08 name question (supplier, name, no SKU). */
function confirmKey(row: UnmappedSku) {
  return {
    supplierId: row.supplierId,
    ...(row.supplierSku ? { supplierSku: row.supplierSku } : {}),
    rawName: row.sampleDescription || row.supplierSku || '',
  };
}
const rowKey = (row: UnmappedSku) => `${row.supplierId}::${row.kind}::${row.supplierSku ?? row.nameKey ?? ''}`;

/** The last link, with what it changed, so it can be undone. */
interface LastLink {
  row: UnmappedSku;
  result: LinkResult;
  /** Made through mapping.answerLink (a suggestion chip): undone the same way. */
  answered?: boolean;
}

export function SkuMapper({ initial, chef = false }: { initial: UnmappedSku[]; chef?: boolean }) {
  const t = useT(catalogNs);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const q = trpc.mapping.unmapped.useQuery(undefined, { initialData: initial });
  // The chef's "לא בטוח — להשאיר לבעלים" hides a question for this visit only.
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const rows = (q.data ?? []).filter((r) => !skipped.has(rowKey(r)));
  const questions = rows.filter((r) => r.kind === 'name').length;
  const [last, setLast] = useState<LastLink | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /** The undo window runs only while nobody is on it: hover / focus pause it, leaving restarts it. */
  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const resume = () => {
    pause();
    timer.current = setTimeout(() => setLast(null), UNDO_MS);
  };
  const onLinked = (link: LastLink) => {
    setLast(link);
    resume();
    void utils.mapping.unmapped.invalidate();
  };

  // The live region is always mounted (outside the loading / empty / list
  // branches), so the link outcome is announced, not just painted.
  const status = (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={pause}
      onMouseLeave={() => last && resume()}
      onFocus={pause}
      onBlur={(e) => {
        if (last && !e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
    >
      {last ? (
        <LinkStatus
          key={last.result.productId + rowKey(last.row)}
          last={last}
          chef={chef}
          onUndone={() => {
            pause();
            setLast(null);
            void utils.mapping.unmapped.invalidate();
          }}
        />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      {status}
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted">
          <Spinner className="h-4 w-4" /> {t('mapping.loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title={t('mapping.emptyTitle')}
          description={chef ? t('mapping.chefEmptyBody') : t('mapping.emptyBody')}
        />
      ) : (
        <>
          {questions > 0 && (
            <p className="text-sm text-muted">
              {t('mapping.pendingQuestions', { count: formatNumber(questions, locale) })}
            </p>
          )}
          {rows.length - questions > 0 && (
            <p className="text-sm text-muted">
              {t('mapping.pending', { count: formatNumber(rows.length - questions, locale) })}
            </p>
          )}
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={rowKey(row)}>
                <MapRow
                  row={row}
                  onLinked={onLinked}
                  chef={chef}
                  onSkip={() => setSkipped((s) => new Set(s).add(rowKey(row)))}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {!chef && <ChargeKeys />}
    </div>
  );
}

/**
 * G-08 charge keys (round 3): what the restaurant answered "שורת חיוב — לא מוצר"
 * for — learned, so next week's line is not asked again. Visible and removable
 * (owner / manager); a removal is audited and applies to future lines only.
 */
function ChargeKeys() {
  const t = useT(catalogNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const keys = trpc.mapping.chargeKeys.useQuery();
  const locale = useLocale();
  const remove = trpc.mapping.removeChargeKey.useMutation({
    onSuccess: (r) => {
      toast.success(r.linesReturned > 0 || r.linesLocked > 0
        ? t('mapping.chargeKeyRemoved', { count: formatNumber(r.linesReturned, locale) }) +
          (r.linesLocked > 0 ? ` ${t('mapping.chargeKeyLocked', { count: formatNumber(r.linesLocked, locale) })}` : '')
        : t('mapping.chargeKeyRemovedNone'));
      void utils.mapping.chargeKeys.invalidate();
      void utils.mapping.unmapped.invalidate();
      void utils.mapping.questionCount.invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  if (!keys.data || keys.data.length === 0) return null;
  return (
    <Card className="p-4" data-testid="mapping-charge-keys">
      <h2 className="text-sm font-medium text-ink">{t('mapping.chargeKeysTitle')}</h2>
      <p className="mt-1 text-sm text-muted">{t('mapping.chargeKeysBody')}</p>
      <ul className="mt-3 space-y-2">
        {keys.data.map((k) => (
          <li key={`${k.supplierId}:${k.sku ?? ''}:${k.nameKey ?? ''}`} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <Badge>{k.supplierName}</Badge>
              <span>{k.rawName ?? k.nameKey}</span>
              {k.sku ? <span className="font-mono text-subtle">{t('mapping.sku', { sku: k.sku })}</span> : null}
            </span>
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending && remove.variables?.supplierId === k.supplierId && remove.variables?.nameKey === k.nameKey && remove.variables?.sku === k.sku}
              aria-label={t('mapping.chargeKeyRemoveLabel', { name: k.rawName ?? k.nameKey ?? k.sku ?? '' })}
              disabled={!k.nameKey}
              onClick={() => k.nameKey && remove.mutate({ supplierId: k.supplierId, sku: k.sku, nameKey: k.nameKey })}
            >
              {t('mapping.chargeKeyRemove')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * "קושר · 6 שורות · 3 חשבוניות נשלחו לבדיקה מחדש · ביטול" — the link changed
 * invoice lines, so their invoices are re-matched (the leak ₪ follows). Inline
 * (not a toast) so the undo button can stay for 10 s and be reached by keyboard.
 */
function LinkStatus({ last, chef, onUndone }: { last: LastLink; chef: boolean; onUndone: () => void }) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const { row, result } = last;
  const undoHandlers = {
    onSuccess: (r: LinkResult) => {
      toast.success(
        t('mapping.undone', {
          count: formatNumber(r.poLinesUpdated + r.invoiceLinesUpdated, locale),
        }),
      );
      onUndone();
    },
    onError: (e: Parameters<typeof friendlyError>[0]) => toast.error(friendlyError(e, tc)),
  };
  const undoConfirm = trpc.mapping.confirm.useMutation(undoHandlers);
  // An answer (G-08, any role that may answer) is undone through answerLink.
  const undoAnswer = trpc.mapping.answerLink.useMutation(undoHandlers);
  const viaAnswer = chef || !!last.answered;
  const undo = viaAnswer ? undoAnswer : undoConfirm;
  const n = (v: number) => formatNumber(v, locale);
  // The linked row just left the list, so focus would fall to <body>: move it to
  // the undo (the next likely action), where it also pauses the 10 s window.
  useEffect(() => {
    document.getElementById('map-undo')?.focus();
  }, []);
  const skipped = (key: 'linkedBlocked' | 'linkedSettled' | 'linkedConsolidated', count: number) =>
    count > 0 ? (
      <p className="text-xs text-muted">{t(`mapping.${key}`, { count: n(count) })}</p>
    ) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-ink">
      <div className="min-w-0">
        <p className="font-medium">
          {t('mapping.linked', {
            count: n(result.poLinesUpdated + result.invoiceLinesUpdated),
            invoices: n(result.rematch.requeued),
          })}
        </p>
        {skipped('linkedBlocked', result.rematch.blockedByClaims)}
        {skipped('linkedSettled', result.rematch.settled)}
        {skipped('linkedConsolidated', result.rematch.consolidated)}
        {result.rematch.failed > 0 && (
          <p className="text-xs text-danger">
            {t('mapping.linkedFailed', { count: n(result.rematch.failed) })}
          </p>
        )}
      </div>
      {(viaAnswer ? result.undoToken : result.undo) && (
        <Button
          id="map-undo"
          variant="secondary"
          size="sm"
          loading={undo.isPending}
          aria-label={
            row.supplierSku
              ? t('mapping.undoLabel', { sku: row.supplierSku })
              : t('mapping.undoLabelName', { name: row.sampleDescription })
          }
          onClick={() =>
            viaAnswer
              ? undoAnswer.mutate({
                  supplierId: row.supplierId,
                  rawName: row.sampleDescription,
                  productId: result.productId,
                  revert: result.undoToken!,
                })
              : undoConfirm.mutate({ ...confirmKey(row), revert: result.undo! })
          }
        >
          {t('mapping.undo')}
        </Button>
      )}
    </div>
  );
}

function MapRow({
  row,
  onLinked,
  chef,
  onSkip,
}: {
  row: UnmappedSku;
  onLinked: (link: LastLink) => void;
  chef: boolean;
  onSkip: () => void;
}) {
  const t = useT(catalogNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(raw.trim()), 250);
    return () => clearTimeout(timer);
  }, [raw]);

  const results = trpc.mapping.searchProducts.useQuery(
    { q: search, limit: 8 },
    { enabled: open && search.length >= 1 },
  );

  const confirm = trpc.mapping.confirm.useMutation({
    onSuccess: (r) => {
      setOpen(false);
      onLinked({ row, result: r });
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  // G-08: a suggestion chip answers through answerLink (owner, manager and chef):
  // the server re-checks that the product is one of this question's suggestions.
  const answer = trpc.mapping.answerLink.useMutation({
    onSuccess: (r) => onLinked({ row, result: r, answered: true }),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  // G-08 charge (review M-2): owner / manager answer "שורת חיוב — לא מוצר" — a
  // deposit / delivery / discount line leaves the questions and the engine input.
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.mapping.unmapped.invalidate();
    void utils.mapping.questionCount.invalidate();
  };
  // The row unmounts once its question is gone: the undo chains on the promise.
  const unCharge = trpc.mapping.markCharge.useMutation();
  const charge = trpc.mapping.markCharge.useMutation({
    onSuccess: (r) => {
      setOpen(false);
      const undo = r.undo;
      toast.success(
        t('mapping.chargeMarked'),
        undo
          ? {
              action: {
                label: t('mapping.undo'),
                onClick: () =>
                  void unCharge
                    .mutateAsync({ ...confirmKey(row), undo })
                    .then(refresh, (e: Parameters<typeof friendlyError>[0]) => toast.error(friendlyError(e, tc))),
              },
            }
          : undefined,
      );
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const pending = confirm.isPending || answer.isPending || charge.isPending;
  // Round 5: the amount shown with "שורת חיוב" — fetched only when the panel is open
  // (owner / manager); the question list itself carries no ₪.
  const sample = trpc.mapping.chargeSample.useQuery(confirmKey(row), { enabled: open && !chef });
  const chargeSample = sample.data ?? null;
  const pick = (productId: string) =>
    answer.mutate({ supplierId: row.supplierId, rawName: row.sampleDescription, productId });

  const link = (args: { productId?: string; newProductName?: string }) => {
    confirm.mutate({ ...confirmKey(row), ...args });
  };
  const panelId = `map-${useId().replace(/:/g, '')}`;
  const isQuestion = row.kind === 'name';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{row.supplierName}</Badge>
            {row.supplierSku ? (
              <span className="font-mono text-sm text-subtle">
                {t('mapping.sku', { sku: row.supplierSku })}
              </span>
            ) : (
              <span className="text-sm font-medium text-ink">{t('mapping.question')}</span>
            )}
            {row.occurrences > 1 && (
              <span className="text-xs text-subtle">
                · {t('mapping.occurrences', { count: formatNumber(row.occurrences, locale) })}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-ink" lang="he">
            {row.sampleDescription || '—'}
          </div>
          {isQuestion && (
            <p className="mt-1 text-xs text-muted">
              {chef ? t('mapping.chefQuestionBody') : t('mapping.questionBody')}
            </p>
          )}
        </div>
        {!chef && (
          <Button
            variant={open ? 'secondary' : 'primary'}
            size="sm"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t('mapping.close') : t('mapping.map')}
          </Button>
        )}
      </div>

      {isQuestion && (
        <div className="mt-3">
          {row.suggestions.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('mapping.suggestionsLabel')}>
              {row.suggestions.map((sug) => (
                <li key={sug.productId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => pick(sug.productId)}
                    aria-label={t('mapping.linkTo', { name: sug.canonicalName })}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink transition hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span lang="he">{sug.canonicalName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">
              {chef ? t('mapping.chefNoSuggestions') : t('mapping.noSuggestions')}
            </p>
          )}
          {chef && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={onSkip}>
              {t('mapping.skip')}
            </Button>
          )}
        </div>
      )}

      {open && !chef && (
        <div id={panelId} className="mt-4 border-t border-line pt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('mapping.searchPlaceholder')}
              aria-label={t('mapping.searchLabel')}
              className="ps-9"
              autoFocus
            />
          </div>

          <div className="mt-3 space-y-1.5" aria-live="polite">
            {results.isFetching && (
              <div className="flex items-center gap-2 py-2 text-sm text-muted">
                <Spinner className="h-3.5 w-3.5" /> {t('mapping.searching')}
              </div>
            )}
            {(results.data ?? []).map((p) => {
              const name = displayName(p.canonicalName, p.nameEn, locale);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={confirm.isPending}
                  onClick={() => link({ productId: p.id })}
                  aria-label={t('mapping.linkTo', { name: name.primary })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-start text-ink transition hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">
                    {name.primary}
                    {name.secondary ? (
                      <span className="ms-2 text-xs text-subtle">{name.secondary}</span>
                    ) : null}
                  </span>
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                </button>
              );
            })}
            {search.length >= 1 && !results.isFetching && (results.data?.length ?? 0) === 0 && (
              <p className="py-1 text-sm text-subtle">{t('mapping.noMatches')}</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">{t('mapping.notInCatalog')}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirm.isPending || !row.sampleDescription}
              onClick={() => link({ newProductName: row.sampleDescription })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />{' '}
              {t('mapping.createNew', { name: row.sampleDescription || '—' })}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">
              {t('mapping.chargeHint')}
              {chargeSample ? (
                <>
                  {' '}
                  {t('mapping.chargeSample', { amount: formatIls(chargeSample.lineTotal, { locale }) })}
                </>
              ) : null}
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={charge.isPending}
              disabled={pending || !row.sampleDescription}
              onClick={() =>
                charge.mutate({
                  ...confirmKey(row),
                  // Round 5: only the line shown here bounds what the key auto-marks later.
                  ...(chargeSample ? { shownLineIds: [chargeSample.invoiceLineId] } : {}),
                })
              }
            >
              {t('mapping.markCharge')}
            </Button>
          </div>

          {confirm.isPending && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5" /> {t('mapping.linking')}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
