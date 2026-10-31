'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowLeft, ArrowRight, Pencil, X } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/components/cn';
import { StatusChip } from '@/lib/components/feedback';
import { SegmentedControl } from '@/lib/components/form';
import { Token } from '@/lib/components/money';
import { isTypingTarget, useMediaQuery } from '@/lib/components/desk';
import { InvoiceScanViewer } from '@/lib/components/invoice';
import { DocumentFlow, type FlowNode } from '@/lib/components/documents';
import { STATE_TONE, ddmmyyyy, type InvoiceStateKey } from '../columns';

type Detail = inferRouterOutputs<AppRouter>['invoices']['detail'];
type Line = Detail['lines'][number];
type Finding = Line['findings'][number];
export type CockpitFrom = 'approvals' | 'payRun' | 'inbox' | 'register' | 'leaks';

/** Below this OCR line confidence a value carries "לבדיקה" (approvals-46). */
export const OCR_REVIEW_BELOW = 0.8;

export interface CockpitCopy {
  back: string;
  fromLabel: string;
  fromHref: string;
  doc: string;
  lines: string;
  segLabel: string;
  viewer: { title: string; zoomIn: string; zoomOut: string; rotate: string; zoomTemplate: string; openOriginal: string; noDoc: string };
  col: { item: string; ordered: string; received: string; billed: string; expected: string; invoicePrice: string; gap: string };
  source: Record<'po_price' | 'receipt' | 'invoice', string>;
  decideTemplate: string;
  decideOneTemplate: string;
  noGaps: string;
  headerFindings: string;
  review: string;
  lowConfidence: string;
  reconcileTemplate: string;
  reconcileUnknown: string;
  editMode: string;
  exitEdit: string;
  duplicateTemplate: string;
  prev: string;
  next: string;
  keysHint: string;
  flow: { label: string; po: string; gr: string; invoice: string; claim: string; missing: string };
  state: string | null;
  findingType: Record<string, string>;
  tolerance: Record<string, string>;
  resolution: Record<string, string>;
}

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';
const OPEN = new Set(['open', 'escalated']);

export function Cockpit({
  detail: d,
  title,
  locale,
  from,
  view,
  copy: t,
  scan,
  showMoney,
  canRematch,
  aside,
  editor,
}: {
  detail: Detail;
  title: string;
  locale: Locale;
  from: CockpitFrom;
  view: string | null;
  copy: CockpitCopy;
  scan: { src: string; mimeType: string } | null;
  showMoney: boolean;
  canRematch: boolean;
  aside: React.ReactNode;
  editor: React.ReactNode;
}) {
  const router = useRouter();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [pane, setPane] = useState<'doc' | 'lines'>('lines');
  const [editing, setEditing] = useState(false);
  const ils = (agorot: number | null) => (agorot == null ? null : formatIls(agorot / 100, { maximumFractionDigits: 2, locale }));
  const price = (v: number | null) => (v == null ? null : formatIls(v, { maximumFractionDigits: 2, locale }));
  const qty = (v: number | null) => (v == null ? null : formatNumber(v, locale, { maximumFractionDigits: 3 }));

  // English names (receiver legacy): filled in the background, never before the first paint (approvals-48).
  const ensureEnglish = trpc.receiving.ensureEnglish.useMutation();
  useEffect(() => {
    if (locale === 'en') ensureEnglish.mutate({ invoiceId: d.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per invoice
  }, [d.id, locale]);

  // [ / ] step through the originating register tab (KeyboardEvent.code; inactive in inputs).
  const queue = trpc.invoices.list.useQuery({}, { enabled: from === 'register' && showMoney, staleTime: 60_000 });
  const siblings = useMemo(() => {
    const rows = queue.data?.rows ?? [];
    const tab = view ?? 'review';
    const inTab = rows.filter((r) =>
      tab === 'noAllocation' ? !r.hasAllocation && r.state !== 'in_ocr' : r.tab === tab,
    );
    const list = inTab.some((r) => r.id === d.id) ? inTab : rows;
    const i = list.findIndex((r) => r.id === d.id);
    const href = (id: string) => `/dashboard/invoices/${id}?from=register${view ? `&view=${view}` : ''}`;
    return {
      prev: i > 0 ? href(list[i - 1]!.id) : null,
      next: i >= 0 && i < list.length - 1 ? href(list[i + 1]!.id) : null,
    };
  }, [queue.data, d.id, view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.code === 'BracketLeft' && siblings.prev) router.push(siblings.prev);
      if (e.code === 'BracketRight' && siblings.next) router.push(siblings.next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [siblings, router]);

  const openFindings = [...d.lines.flatMap((l) => l.findings), ...d.headerFindings].filter((f) => OPEN.has(f.resolutionStatus));
  const flow: FlowNode[] = [
    { key: 'po', label: t.flow.po, href: d.match?.poId ? `/dashboard/orders/${d.match.poId}` : null },
    { key: 'gr', label: t.flow.gr, href: d.match?.grId && d.match.poId ? `/dashboard/receiving/${d.match.poId}` : null },
    { key: 'invoice', label: t.flow.invoice, href: null, current: true },
    {
      key: 'claim',
      label: t.flow.claim,
      href: d.state === 'claim_open' && d.supplierId ? `/dashboard/leaks/claims?sup=${d.supplierId}` : null,
    },
  ];
  const BackIcon = locale === 'he' ? ArrowRight : ArrowLeft;
  const tone = d.state ? STATE_TONE[d.state as InvoiceStateKey] : null;

  const reconcile = d.reconciliation
    ? fill(t.reconcileTemplate, {
        lines: d.reconciliation.linesMatchSubtotal ? '✓' : '✗',
        vat: d.vatRate != null ? formatNumber(d.vatRate * 100, locale, { maximumFractionDigits: 2 }) : '',
        vatOk: d.reconciliation.vatMatches ? '✓' : '✗',
      })
    : t.reconcileUnknown;

  const findingRow = (f: Finding) => (
    <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="cockpit-finding">
      <StatusChip
        tone={OPEN.has(f.resolutionStatus) ? (f.severity === 'block' ? 'danger' : 'warn') : 'neutral'}
        emphasis={OPEN.has(f.resolutionStatus) ? 'bold' : 'subtle'}
        label={t.findingType[f.type] ?? f.type}
      />
      {showMoney && f.deltaAgorot != null ? (
        <bdi className="font-semibold text-ink">{ils(Math.abs(f.deltaAgorot))}</bdi>
      ) : null}
      {f.toleranceUsed && t.tolerance[f.toleranceUsed] ? <span className="text-muted">{t.tolerance[f.toleranceUsed]}</span> : null}
      <span className="text-muted">· {t.resolution[f.resolutionStatus] ?? f.resolutionStatus}</span>
    </li>
  );

  const lowConf = (l: Line) => l.ocrConfidenceLine != null && l.ocrConfidenceLine < OCR_REVIEW_BELOW;
  const reviewMark = (
    <span className="ms-1 inline-flex rounded-full border border-warn/50 px-1.5 text-xs font-semibold text-warn" title={t.lowConfidence}>
      {t.review}
      <span className="sr-only"> · {t.lowConfidence}</span>
    </span>
  );
  const expectedCell = (l: Line) =>
    l.expectedPrice == null ? null : (
      <span className="inline-flex flex-col items-end">
        <bdi>{price(l.expectedPrice)}</bdi>
        <span className="text-xs text-muted">
          {l.expectedPriceSource ? t.source[l.expectedPriceSource] : ''}
          {l.expectedPriceAt ? ` · ${ddmmyyyy(l.expectedPriceAt, locale)}` : ''}
        </span>
      </span>
    );
  const lineGap = (l: Line) => {
    const s = l.findings.reduce((a, f) => a + Math.abs(f.deltaAgorot ?? 0), 0);
    return s > 0 ? s : null;
  };

  const table = (
    <div className="rounded-2xl border border-line bg-surface shadow-card" data-testid="cockpit-lines">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{t.lines}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="w-[28%] px-3 py-2 text-start font-medium">{t.col.item}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{t.col.ordered}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{t.col.received}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{t.col.billed}</th>
            {showMoney ? (
              <>
                <th scope="col" className="px-2 py-2 text-right font-medium">{t.col.expected}</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">{t.col.invoicePrice}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t.col.gap}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => {
            const flagged = l.findings.length > 0;
            return (
              <FragmentRows key={l.id}>
                <tr id={`line-${l.id}`} className={cn('scroll-mt-28 border-b border-line/60 align-top target:bg-surface-2', flagged && 'bg-warn-subtle/40')}>
                  <td className="break-words px-3 py-2 text-ink">
                    {l.name}
                    {lowConf(l) ? reviewMark : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted"><bdi>{qty(l.qtyOrdered)}</bdi></td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted"><bdi>{qty(l.qtyReceived)}</bdi></td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink"><bdi>{qty(l.qtyBilled)}</bdi></td>
                  {showMoney ? (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums">{expectedCell(l)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink"><bdi>{price(l.unitPriceBilled)}</bdi></td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink"><bdi>{ils(lineGap(l))}</bdi></td>
                    </>
                  ) : null}
                </tr>
                {flagged ? (
                  <tr className="border-b border-line/60 bg-warn-subtle/40">
                    <td colSpan={showMoney ? 7 : 4} className="px-3 pb-3">
                      <ul className="space-y-1">{l.findings.map(findingRow)}</ul>
                    </td>
                  </tr>
                ) : null}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const cards = (
    <ul className="space-y-3" data-testid="cockpit-line-cards">
      {d.lines.map((l) => (
        <li key={l.id} id={`line-${l.id}`} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words font-medium text-ink">
              {l.name}
              {lowConf(l) ? reviewMark : null}
            </p>
            {showMoney && lineGap(l) != null ? (
              <bdi className="shrink-0 text-right font-semibold text-ink">{ils(lineGap(l))}</bdi>
            ) : null}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted">{t.col.ordered}</dt><dd className="text-right text-sm"><bdi>{qty(l.qtyOrdered)}</bdi></dd></div>
            <div><dt className="text-muted">{t.col.received}</dt><dd className="text-right text-sm"><bdi>{qty(l.qtyReceived)}</bdi></dd></div>
            <div><dt className="text-muted">{t.col.billed}</dt><dd className="text-right text-sm"><bdi>{qty(l.qtyBilled)}</bdi></dd></div>
            {showMoney ? (
              <>
                <div className="col-span-2"><dt className="text-muted">{t.col.expected}</dt><dd className="text-right text-sm">{expectedCell(l)}</dd></div>
                <div><dt className="text-muted">{t.col.invoicePrice}</dt><dd className="text-right text-sm"><bdi>{price(l.unitPriceBilled)}</bdi></dd></div>
              </>
            ) : null}
          </dl>
          {l.findings.length ? <ul className="mt-2 space-y-1">{l.findings.map(findingRow)}</ul> : null}
        </li>
      ))}
    </ul>
  );

  const viewer = (
    <InvoiceScanViewer
      src={scan?.src ?? null}
      mimeType={scan?.mimeType ?? null}
      className={wide ? 'sticky top-20 h-[calc(100dvh-7rem)]' : 'h-[70dvh]'}
      copy={{ ...t.viewer, zoom: (pct) => fill(t.viewer.zoomTemplate, { pct }) }}
    />
  );

  const linesPane = (
    <div className="min-w-0 space-y-4">
      {d.duplicateOf ? (
        <p role="alert" data-testid="invoice-duplicate-notice" className="rounded-xl border border-danger/40 bg-danger-subtle px-3 py-2 text-sm font-semibold text-danger">
          {fill(t.duplicateTemplate, { number: d.duplicateOf.invoiceNumber })}
        </p>
      ) : null}
      <p className="text-sm text-muted" data-testid="cockpit-reconcile">{reconcile}</p>
      {wide ? table : cards}
      {d.headerFindings.length ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t.headerFindings}</h2>
          <ul className="space-y-1">{d.headerFindings.map(findingRow)}</ul>
        </section>
      ) : null}
      {openFindings.length === 0 ? <p className="text-sm text-muted">{t.noGaps}</p> : null}
      {canRematch ? (
        <div className="space-y-3">
          <button
            type="button"
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
            className={cn('inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2', FOCUS)}
            data-testid="cockpit-edit-toggle"
          >
            {editing ? <X className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
            {editing ? t.exitEdit : t.editMode}
          </button>
          {editing ? editor : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="pb-24">
      <nav aria-label={t.back} className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href={t.fromHref} className={cn('inline-flex items-center gap-1 font-semibold text-primary', FOCUS)} data-testid="cockpit-back">
          <BackIcon className="h-4 w-4" aria-hidden="true" />
          {t.fromLabel}
        </Link>
        {from === 'register' ? (
          <span className="flex items-center gap-2">
            {siblings.prev ? <Link href={siblings.prev} className={cn('text-primary underline-offset-4 hover:underline', FOCUS)} aria-keyshortcuts="BracketLeft">{t.prev}</Link> : null}
            {siblings.next ? <Link href={siblings.next} className={cn('text-primary underline-offset-4 hover:underline', FOCUS)} aria-keyshortcuts="BracketRight">{t.next}</Link> : null}
          </span>
        ) : null}
      </nav>
      <header className="mb-4 space-y-2">
        <h1 className="text-2xl font-bold text-ink" data-testid="cockpit-title">{title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {d.state && tone && t.state ? <StatusChip tone={tone.tone} emphasis={tone.emphasis} label={t.state} /> : null}
          {d.invoiceNumber ? <Token kind="invoice" value={d.invoiceNumber} /> : null}
          {d.invoiceDate ? <span>{ddmmyyyy(d.invoiceDate, locale)}</span> : null}
          {showMoney && d.totalInclVatAgorot != null ? <bdi className="font-semibold text-ink">{ils(d.totalInclVatAgorot)}</bdi> : null}
          {d.match?.poRef ? <Token kind="po" value={d.match.poRef} /> : null}
        </div>
        <DocumentFlow nodes={flow} label={t.flow.label} missing={t.flow.missing} />
      </header>
      {aside}
      {wide ? (
        <div className="grid grid-cols-[44fr_56fr] gap-4">
          {viewer}
          {linesPane}
        </div>
      ) : (
        <div className="space-y-3">
          <SegmentedControl
            label={t.segLabel}
            value={pane}
            onChange={setPane}
            options={[
              { value: 'doc', label: t.doc },
              { value: 'lines', label: t.lines },
            ]}
          />
          {pane === 'doc' ? viewer : linesPane}
        </div>
      )}
      {showMoney && openFindings.length > 0 ? (
        <div className="sticky bottom-3 z-10 mt-4 flex justify-center">
          <Link
            href={`/dashboard/approvals?invoice=${d.id}`}
            data-testid="cockpit-decide"
            className={cn('inline-flex min-h-12 items-center rounded-xl bg-primary px-5 text-base font-semibold text-on-primary shadow-card hover:brightness-110', FOCUS)}
          >
            {openFindings.length === 1
              ? fill(t.decideOneTemplate, { amount: ils(d.openGapAgorot ?? 0) ?? '' })
              : fill(t.decideTemplate, { count: openFindings.length, amount: ils(d.openGapAgorot ?? 0) ?? '' })}
          </Link>
        </div>
      ) : null}
      <p className="sr-only">{t.keysHint}</p>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
