'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';
import { SplitPane } from '@/lib/components/desk';
import {
  DataTable,
  NUM_ALIGN,
  NumValue,
  ViewTabs,
  buildExportCsv,
  deskCopy,
  downloadText,
  exportTable,
  updateTableUrl,
  useTableUrlValue,
  type ColumnDef,
} from '@/lib/components/table';
import { labCopy } from './_copy';
import { LAB_VIEWS, inView, labRows, type LabRow, type LabView } from './_data';

type LabState = 'ready' | 'loading' | 'error' | 'empty';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';

function SeverityChip({ severity, label }: { severity: LabRow['severity']; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        severity === 'block' && 'bg-danger text-on-primary',
        severity === 'warn' && 'border border-warn/50 text-warn',
        severity === 'none' && 'text-muted',
      )}
    >
      <span aria-hidden>{severity === 'block' ? '●' : severity === 'warn' ? '▲' : '✓'}</span>
      {label}
    </span>
  );
}

export function DeskLab({
  totals,
  mode,
  labState,
}: {
  /** Server-computed count + Σ|Δ| per built-in view. */
  totals: Record<LabView, { count: number; sumAgorot: number }>;
  mode: 'table' | 'split';
  labState: LabState;
}) {
  const locale = useLocale();
  const t = labCopy(locale);
  const router = useRouter();
  // Only `view` and `page` — so a J/K move or a Peek never re-renders the page around the table.
  const viewParam = useTableUrlValue('view');
  const pageParam = useTableUrlValue('page');
  const update = updateTableUrl;
  const [q, setQ] = useState('');
  const [approved, setApproved] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const view: LabView = (LAB_VIEWS as readonly string[]).includes(viewParam ?? '') ? (viewParam as LabView) : 'all';

  const all = useMemo(
    () => labRows().map((r) => (approved.has(r.id) ? { ...r, status: 'approved' as const } : r)),
    [approved],
  );
  const supplier = useCallback((r: LabRow) => (locale === 'en' ? r.supplierEn : r.supplierHe), [locale]);
  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    if (labState === 'empty') return [];
    return all.filter(
      (r) =>
        inView(r, view) &&
        (!query || supplier(r).toLowerCase().includes(query) || r.number.toLowerCase().includes(query)),
    );
  }, [all, view, query, supplier, labState]);

  const columns = useMemo<ColumnDef<LabRow>[]>(
    () => [
      { id: 'supplier', header: t.col.supplier, identity: true, value: supplier },
      {
        id: 'number',
        header: t.col.number,
        value: (r) => r.number,
        cell: (r) => (
          <bdi dir="ltr" className="whitespace-nowrap font-mono text-xs text-muted">
            {r.number}
          </bdi>
        ),
      },
      {
        id: 'date',
        header: t.col.date,
        kind: 'date',
        value: (r) => r.date,
        cell: (r) => formatDate(r.date, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
        exportValue: (r) => formatDate(r.date, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
      },
      { id: 'total', header: t.col.total, kind: 'money', decimals: 2, value: (r) => r.totalAgorot },
      {
        id: 'atRisk',
        header: t.col.atRisk,
        kind: 'money',
        decimals: 2,
        value: (r) => Math.abs(r.deltaAgorot),
        cell: (r) => (r.pendingDelta ? 'pending' : undefined),
      },
      {
        id: 'severity',
        header: t.col.severity,
        kind: 'status',
        value: (r) => (r.severity === 'block' ? 0 : r.severity === 'warn' ? 1 : 2),
        cell: (r) => <SeverityChip severity={r.severity} label={t.severity[r.severity]} />,
        exportValue: (r) => t.severity[r.severity],
      },
      {
        id: 'status',
        header: t.col.status,
        kind: 'status',
        hideable: true,
        value: (r) => t.status[r.status],
      },
    ],
    [t, supplier, locale],
  );

  const tableStatus = labState === 'loading' ? 'loading' : labState === 'error' ? 'error' : 'ready';
  const viewTotal = totals[view];
  // Lab-only filter: the "server" total for a search is the filtered rows' Σ (computed once, all pages).
  const shownTotals = query
    ? { count: rows.length, sumAgorot: rows.reduce((s, r) => s + Math.abs(r.deltaAgorot), 0), columnId: 'atRisk' }
    : { ...viewTotal, columnId: 'atRisk' };

  const approveRows = (ids: string[]) => {
    setApproved((s) => new Set([...s, ...ids]));
    setNotice(t.approvedToast(ids.length));
  };

  const exportSelected = (sel: LabRow[]) => {
    const out = exportTable(columns, sel);
    const csv = buildExportCsv(
      { title: t.caption, period: t.period, scope: t.scope, filters: t.exportBatch(sel.length), generatedAt: new Date() },
      deskCopy(locale).exportMeta,
      out.columns,
      out.rows,
    );
    downloadText('lab-desk-selected.csv', csv);
  };

  const peekBody = (r: LabRow) => {
    const lines = [
      { name: locale === 'en' ? 'Tomatoes, kg' : 'עגבניות, ק״ג', ordered: 20, received: 20, billed: 22 },
      { name: locale === 'en' ? 'Cucumbers, kg' : 'מלפפונים, ק״ג', ordered: 15, received: 14, billed: 15 },
      { name: locale === 'en' ? 'Lemons, kg' : 'לימונים, ק״ג', ordered: 5, received: 5, billed: 5 },
    ];
    return (
      <div className="space-y-4" data-peek-row={r.id}>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">{t.col.total}</dt>
            <dd className="text-lg font-bold tabular-nums text-ink" data-peek-total>
              <bdi>{formatIls(r.totalAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t.col.atRisk}</dt>
            <dd className="text-lg font-bold tabular-nums text-ink">
              <bdi>{formatIls(Math.abs(r.deltaAgorot) / 100, { maximumFractionDigits: 2, locale })}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t.col.severity}</dt>
            <dd>
              <SeverityChip severity={r.severity} label={t.severity[r.severity]} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t.col.status}</dt>
            <dd className="text-ink">{t.status[r.status]}</dd>
          </div>
        </dl>
        <table className="w-full text-sm">
          <caption className="mb-1 text-start font-semibold text-ink">{t.peekLines}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1 text-start font-semibold">{t.peekItem}</th>
              <th scope="col" className="py-1 text-right font-semibold">{t.peekOrdered}</th>
              <th scope="col" className="py-1 text-right font-semibold">{t.peekReceived}</th>
              <th scope="col" className="py-1 text-right font-semibold">{t.peekBilled}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.name} className="border-t border-line">
                <td className="py-1.5 text-ink">{l.name}</td>
                <td className={cn(NUM_ALIGN, 'py-1.5')}><NumValue kind="number" value={l.ordered} /></td>
                <td className={cn(NUM_ALIGN, 'py-1.5')}><NumValue kind="number" value={l.received} /></td>
                <td className={cn(NUM_ALIGN, 'py-1.5', l.billed !== l.received && 'font-semibold text-danger')}>
                  <NumValue kind="number" value={l.billed} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">{t.placeholderNote}</p>
      </div>
    );
  };

  const href = (r: LabRow) => `/dashboard/lab/desk/${r.id}`;

  const modeLink = (m: 'table' | 'split', label: string) => (
    <Link
      href={m === 'table' ? '/dashboard/lab/desk' : '/dashboard/lab/desk?mode=split'}
      aria-current={mode === m ? 'page' : undefined}
      className={cn('inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold', FOCUS, mode === m ? 'bg-primary text-on-primary' : 'text-ink hover:bg-surface-2')}
    >
      {label}
    </Link>
  );

  const stateLink = (s: LabState, label: string) => (
    <Link
      href={s === 'ready' ? '/dashboard/lab/desk' : `/dashboard/lab/desk?state=${s}`}
      aria-current={labState === s ? 'page' : undefined}
      className={cn('inline-flex h-9 items-center rounded-lg px-3 text-sm', FOCUS, labState === s ? 'bg-surface-2 font-semibold text-ink' : 'text-muted hover:text-ink')}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
        <p className="text-sm text-muted">{t.intro}</p>
      </header>
      <div className="flex flex-wrap items-center gap-4">
        <nav aria-label={t.modes} className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {modeLink('table', t.modeTable)}
          {modeLink('split', t.modeSplit)}
        </nav>
        {mode === 'table' ? (
          <nav aria-label={t.states} className="flex flex-wrap gap-1">
            {stateLink('ready', t.stateReady)}
            {stateLink('loading', t.stateLoading)}
            {stateLink('error', t.stateError)}
            {stateLink('empty', t.stateEmpty)}
          </nav>
        ) : null}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-primary" data-lab-notice>
        {notice}
      </p>

      {mode === 'split' ? (
        <SplitPane
          className="h-[min(72dvh,820px)]"
          items={all.slice(0, 80)}
          itemKey={(r) => r.id}
          label={t.splitList}
          hrefOf={href}
          detailTitle={(r) => `${supplier(r)} · ${r.number}`}
          emptyDetail={<p className="text-sm text-muted">{t.splitEmpty}</p>}
          renderItem={(r) => (
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate font-medium text-ink" title={supplier(r)}>
                {supplier(r)}
              </span>
              <span className={cn(NUM_ALIGN, 'shrink-0 text-sm text-ink')}>
                <bdi>{formatIls(r.totalAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
              </span>
            </div>
          )}
          renderDetail={(r) => (
            <div className="space-y-3" data-split-row={r.id}>
              <h2 className="text-lg font-bold text-ink">
                {supplier(r)} · <bdi dir="ltr" className="font-mono text-base">{r.number}</bdi>
              </h2>
              {peekBody(r)}
              <Link href={href(r)} className={cn('inline-flex text-sm font-semibold text-primary underline', FOCUS)}>
                {t.open}
              </Link>
            </div>
          )}
        />
      ) : (
        <DataTable<LabRow>
          id="lab-desk"
          caption={t.caption}
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ id: 'atRisk', desc: true }}
          totals={labState === 'ready' ? shownTotals : undefined}
          status={tableStatus}
          onRetry={() => router.push('/dashboard/lab/desk')}
          filtered={!!query}
          onClearFilters={() => setQ('')}
          emptyAction={
            <button type="button" className={cn('h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary', FOCUS)}>
              {t.firstUse}
            </button>
          }
          selectable={(r) => (r.severity === 'block' ? { disabled: deskCopy(locale).blockReason } : true)}
          amountAgorot={(r) => r.deltaAgorot}
          batchActions={[
            {
              id: 'approve',
              primary: true,
              capped: true,
              label: (n, sum) => t.approveBatch(n, formatIls(sum / 100, { maximumFractionDigits: 2, locale })),
              run: (sel) => approveRows(sel.map((r) => r.id)),
            },
            { id: 'assign', label: (n) => t.assignBatch(n), run: (sel) => setNotice(t.assignedToast(sel.length)) },
            { id: 'export', label: (n) => t.exportBatch(n), run: exportSelected },
          ]}
          rowActions={(r) => [
            { id: 'approve', label: t.approve, onRun: () => approveRows([r.id]) },
            { id: 'open', label: t.open, onRun: () => router.push(href(r)) },
            { id: 'hold', label: t.hold, onRun: () => undefined },
            { id: 'disable', label: t.disable, tone: 'danger', onRun: () => undefined },
          ]}
          rowTone={(r) => (r.severity === 'block' ? 'danger' : undefined)}
          peek={{ title: (r) => `${supplier(r)} · ${r.number}`, render: peekBody, href }}
          exportMeta={{
            title: t.caption,
            period: t.period,
            scope: t.scope,
            filters: [view !== 'all' ? t.views[view] : '', query ? `"${q.trim()}"` : ''].filter(Boolean).join(' · '),
          }}
          toolbar={
            <div className="space-y-2">
              <ViewTabs
                views={LAB_VIEWS.map((v) => ({ id: v, label: t.views[v], count: totals[v].count, sumAgorot: totals[v].sumAgorot }))}
                active={view}
                onChange={(v) => update({ view: v === 'all' ? null : v, page: 1, sel: null, peek: null })}
              />
              <label className="block max-w-sm">
                <span className="sr-only">{t.search}</span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (pageParam > 1) update({ page: 1 });
                  }}
                  placeholder={t.search}
                  className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-subtle md:text-sm"
                />
              </label>
            </div>
          }
        />
      )}
    </div>
  );
}
