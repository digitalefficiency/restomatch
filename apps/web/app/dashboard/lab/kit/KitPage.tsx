'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BookText,
  Box,
  Camera,
  Clock,
  Eye,
  Home,
  Inbox,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import {
  Badge,
  Button,
  Calculation,
  CalculationFold,
  CreditGlyph,
  DataAnswer,
  Delta,
  EmptyState,
  ErrorNotice,
  Field,
  FilterChip,
  Icon,
  IconButton,
  Input,
  LeakGlyph,
  MatchGlyph,
  MatchStrip,
  Money,
  NumberField,
  PaceLine,
  ReceiptGlyph,
  SegmentedControl,
  Skeleton,
  SplitBar,
  StatusChip,
  StatusDot,
  StatusRail,
  Switch,
  Tooltip,
  useToast,
} from '@/lib/components';
import { cnMerge as cn } from '@/lib/components/cn';
import { CommandPalette, type PaletteItem, type PaletteScreen } from '@/lib/components/palette';
import { DataTable } from '@/lib/components/table/DataTable';
import { ViewTabs } from '@/lib/components/table/ViewTabs';
import type { ColumnDef } from '@/lib/components/table/types';
import { BreakdownChart } from '@/lib/components/views/BreakdownChart';
import { kitCopy, type KitCopy } from './_copy';

type KitDensity = 'regular' | 'compact';

interface GapRow {
  id: string;
  supplier: string;
  invoice: string;
  kind: 'overbilled' | 'price';
  blocks: boolean;
  due: string;
  gapAgorot: number;
}

/** The reference's demo gaps (docs/ux/ds3 kit "טבלה"); lab data, not a record. */
const GAPS: GapRow[] = [
  { id: 'g1', supplier: 'ירקות השרון', invoice: 'SH-24121', kind: 'overbilled', blocks: true, due: '14.11.2026', gapAgorot: 3870 },
  { id: 'g2', supplier: 'משקאות שטיינברג', invoice: 'ST-24108', kind: 'price', blocks: true, due: '20.11.2026', gapAgorot: 10480 },
  { id: 'g3', supplier: 'קצביית הכרם', invoice: 'HK-24108', kind: 'price', blocks: false, due: '18.11.2026', gapAgorot: 10000 },
  { id: 'g4', supplier: 'דגי הים התיכון', invoice: 'MF-24108', kind: 'price', blocks: false, due: '19.11.2026', gapAgorot: 5250 },
];

/** Cumulative leak per day (the reference's pace line, in shekels). */
const PACE_NOW = [0, 4, 10, 10, 18, 24, 31, 31, 31, 46, 56, 57, 61, 61, 61, 61, 72, 78, 87, 87, 98, 100];
const PACE_PREV = [5, 11, 11, 11, 20, 20, 20, 28, 34, 34, 40, 40, 40, 40, 48, 48, 57, 61, 61, 61, 73, 80, 80, 95, 101];

function KitCard({ id, title, note, wide, children }: { id: string; title: string; note: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-kit-card={id}
      className={cn('flex min-w-0 flex-col rounded-card border border-line bg-surface p-4 shadow-e1', wide && 'lg:col-span-2')}
    >
      <h2 id={`${id}-title`} className="text-title-sm text-fg">
        {title}
      </h2>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
      <p className="mt-3 border-t border-line-rule pt-2 text-caption text-fg-secondary">{note}</p>
    </section>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-rule py-1.5 last:border-b-0">
      <span className="text-caption text-fg-tertiary">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function KitPage({ initialDensity, locale, role }: { initialDensity: KitDensity; locale: 'he' | 'en'; role: UserRole }) {
  const c: KitCopy = kitCopy(locale);
  const d = c.demo;
  const router = useRouter();
  const toast = useToast();
  const [density, setDensity] = useState<KitDensity>(initialDensity);
  const [view, setView] = useState('decide');
  const [filters, setFilters] = useState({ supplier: true, over: true });
  const [shortcuts, setShortcuts] = useState(true);
  const [threshold, setThreshold] = useState(10);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [skeletonKey, setSkeletonKey] = useState(0);

  const changeDensity = (next: KitDensity) => {
    setDensity(next);
    // Shareable, without a navigation (the page is the same).
    const url = new URL(window.location.href);
    if (next === 'compact') url.searchParams.set('density', 'compact');
    else url.searchParams.delete('density');
    window.history.replaceState(window.history.state, '', url);
  };

  const columns = useMemo<ColumnDef<GapRow>[]>(
    () => [
      { id: 'supplier', header: d.colSupplier, identity: true, value: (r) => r.supplier },
      { id: 'invoice', header: d.colInvoice, value: (r) => r.invoice, cell: (r) => <bdi className="text-fg-secondary">{r.invoice}</bdi> },
      { id: 'kind', header: d.colKind, value: (r) => (r.kind === 'overbilled' ? d.kindOverbilled : d.kindPrice) },
      {
        id: 'status',
        header: d.colStatus,
        kind: 'status',
        value: (r) => (r.blocks ? 1 : 0),
        cell: (r) => (r.blocks ? <StatusChip tone="danger" emphasis="bold" label={d.blocks} shape="pill" /> : ''),
      },
      { id: 'due', header: d.colDue, value: (r) => r.due, cell: (r) => <bdi className="text-fg-secondary">{r.due}</bdi> },
      { id: 'gap', header: d.colGap, kind: 'money', value: (r) => r.gapAgorot, decimals: 2 },
    ],
    [d],
  );

  const screens: PaletteScreen[] = [
    { key: 'approvals', href: '/dashboard/approvals', label: c.icons.approvals, aliases: ['approvals'] },
    { key: 'leaks', href: '/dashboard/leaks', label: c.icons.leak, aliases: ['leaks'] },
    { key: 'kit', href: '/dashboard/lab/kit', label: c.title, aliases: ['kit'] },
  ];
  const waiting: PaletteItem[] = [{ kind: 'waiting', id: 'w1', label: d.openGaps, secondary: d.blocks, href: '/dashboard/approvals' }];

  const icons: Array<[LucideIcon, string]> = [
    [Home, c.icons.home],
    [Inbox, c.icons.approvals],
    [MatchGlyph, c.icons.match],
    [ReceiptGlyph, c.icons.invoice],
    [CreditGlyph, c.icons.credit],
    [LeakGlyph, c.icons.leak],
    [Wallet, c.icons.payments],
    [BookText, c.icons.ledger],
    [ShoppingCart, c.icons.order],
    [Box, c.icons.receiving],
    [Truck, c.icons.supplier],
    [Camera, c.icons.camera],
    [Eye, c.icons.scanned],
    [Clock, c.icons.pending],
    [Bell, c.icons.alert],
    [Sparkles, c.icons.ask],
  ];

  return (
    <div className="mx-auto max-w-app px-gutter-page py-6" data-kit="">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title-lg text-fg">{c.title}</h1>
          <p className="mt-1 max-w-prose text-body-sm text-fg-secondary">{c.intro}</p>
          <p className="mt-0.5 text-caption text-fg-tertiary">{c.source}</p>
        </div>
        <SegmentedControl<KitDensity>
          label={c.densityLabel}
          value={density}
          onChange={changeDensity}
          size="sm"
          options={[
            { value: 'regular', label: c.densityRegular },
            { value: 'compact', label: c.densityCompact },
          ]}
        />
      </header>

      <div data-density={density === 'compact' ? 'compact' : 'default'} data-kit-density={density} className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <KitCard id="kit-buttons" title={c.cards.buttons} note={c.notes.buttons}>
          <div className="grid gap-3">
            <Row>
              <Button kbd="1">{d.claim}</Button>
              <Button variant="secondary" kbd="2">
                {d.payAsBilled}
              </Button>
              <Button variant="ghost">{d.cancel}</Button>
            </Row>
            <Row>
              <Button variant="secondary" size="sm">
                {d.small}
              </Button>
              <Button variant="secondary">{d.regular}</Button>
              <Button variant="secondary" size="lg">
                {d.large}
              </Button>
            </Row>
            <Row>
              <Button variant="secondary" loading>
                {d.loading}
              </Button>
              <Button variant="secondary" disabled disabledReason={d.disabledWhy}>
                {d.disabled}
              </Button>
            </Row>
            <Button variant="secondary" size="xl">
              {d.field}
            </Button>
          </div>
        </KitCard>

        <KitCard id="kit-money" title={c.cards.money} note={c.notes.money}>
          <Labelled label={d.hero}>
            <Money value={760} context="hero" />
          </Labelled>
          <Labelled label={d.line}>
            <Money value={1104.8} context="line" split />
          </Labelled>
          <Labelled label={d.unit}>
            <span className="inline-flex items-baseline gap-1.5">
              <Money value={12.9} context="unit" split />
              <span className="text-caption text-fg-secondary">{d.perKg}</span>
            </span>
          </Labelled>
          <Labelled label={d.credit}>
            <Money value={-120} context="line" credit split />
          </Labelled>
          <Labelled label={d.pending}>
            <Money value={null} pending />
          </Labelled>
          <Labelled label={d.unavailable}>
            <Money value={null} unavailable />
          </Labelled>
          <Labelled label={d.header}>
            <Money value={38.7} context="line" symbol="header" split />
          </Labelled>
        </KitCard>

        <KitCard id="kit-delta" title={c.cards.delta} note={c.notes.delta}>
          <div className="grid gap-2.5">
            <Delta current={746} previous={760} goodWhen="down" showPercent about={d.inLeak} />
            <Delta current={846} previous={760} goodWhen="down" showPercent about={d.inLeak} />
            <Delta current={1280} previous={970} goodWhen="up" showPercent about={d.inCredits} />
            <Delta current={761} previous={760} goodWhen="down" flatBelow={0.02} />
          </div>
        </KitCard>

        <KitCard id="kit-status" title={c.cards.status} note={c.notes.status}>
          <div className="grid gap-2.5">
            <Row>
              <StatusChip tone="danger" emphasis="bold" label={d.blocks} />
              <StatusChip tone="danger" label={d.openGap} />
              <StatusChip tone="warn" emphasis="bold" label={d.awaitingReply} />
            </Row>
            <Row>
              <StatusChip tone="neutral" label={d.awaitingLink} />
              <StatusChip tone="success" label={d.credited} />
              <StatusChip tone="neutral" label={d.fine} icon={<StatusDot tone="neutral" size="sm" />} />
            </Row>
            <Row>
              <span className="inline-flex items-center gap-2 text-body-sm text-fg">
                <StatusDot tone="leak" />
                {d.inLeak}
              </span>
              <Badge tone="neutral">{d.regular}</Badge>
              <Badge tone="info">{d.toReview}</Badge>
            </Row>
          </div>
        </KitCard>

        <KitCard id="kit-match" title={c.cards.match} note={c.notes.match}>
          <div className="grid gap-2.5">
            <MatchStrip ordered={9.5} received={6.5} billed={9.5} unit={d.kg} off="received" gap={{ value: 3, kind: 'qty', direction: 'less' }} />
            <MatchStrip
              kind="price"
              ordered={522.6}
              received={null}
              billed={575}
              unit={d.barrel}
              off="billed"
              tone="warn"
              gap={{ value: 0.1, kind: 'pct', direction: 'more' }}
            />
            <MatchStrip ordered={12} received={12} unit={d.kg} />
          </div>
        </KitCard>

        <KitCard id="kit-tabs" title={c.cards.tabs} note={c.notes.tabs}>
          <ViewTabs
            views={[
              { id: 'decide', label: d.toDecide, count: 4 },
              { id: 'review', label: d.toReview, count: 0 },
              { id: 'others', label: d.waitingOthers, count: 3 },
            ]}
            active={view}
            onChange={setView}
          />
          <Row className="mt-3">
            {filters.supplier ? (
              <FilterChip label={d.supplierFilter} active onRemove={() => setFilters((f) => ({ ...f, supplier: false }))} />
            ) : null}
            {filters.over ? <FilterChip label={d.overFilter} active onRemove={() => setFilters((f) => ({ ...f, over: false }))} /> : null}
            <Button variant="ghost" size="sm" onClick={() => setFilters({ supplier: false, over: false })}>
              {d.clear}
            </Button>
          </Row>
        </KitCard>

        <KitCard id="kit-table" title={c.cards.table} note={c.notes.table} wide>
          <p className="mb-2 text-body-sm font-medium text-fg">{d.tableCaption}</p>
          <DataTable<GapRow>
            id="kit-table"
            caption={d.tableCaption}
            rows={GAPS}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort={{ id: 'gap', desc: true }}
            density={density === 'compact' ? 'compact' : 'default'}
            totals={{ columnId: 'gap', count: GAPS.length, sumAgorot: GAPS.reduce((s, r) => s + r.gapAgorot, 0) }}
          />
        </KitCard>

        <KitCard id="kit-toast" title={c.cards.toast} note={c.notes.toast}>
          <Button
            variant="secondary"
            onClick={() => toast.success(d.toastText, { action: { label: d.cancel, onClick: () => toast.info(d.toastUndone) } })}
          >
            {d.showToast}
          </Button>
        </KitCard>

        <KitCard id="kit-palette" title={c.cards.palette} note={c.notes.palette}>
          <Button variant="secondary" kbd="Ctrl K" onClick={() => setPaletteOpen(true)}>
            {d.openPalette}
          </Button>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            role={role}
            locale={locale}
            screens={screens}
            canSee={() => true}
            onNavigate={(href) => {
              setPaletteOpen(false);
              router.push(href);
            }}
            waiting={waiting}
          />
        </KitCard>

        <KitCard id="kit-explain" title={c.cards.explain} note={c.notes.explain}>
          <CalculationFold line={<Money value={38.7} context="line" split />} about={d.howCalc}>
            <Calculation
              terms={[`3 ${d.kg}`, <Money key="p" value={12.9} context="line" split />]}
              result={<Money value={38.7} context="line" split quietParts={false} />}
              sources={[
                { value: `9.5 ${d.kg}`, kind: 'scan', text: d.readFromScan },
                { value: `6.5 ${d.kg}`, kind: 'count', text: d.countedAt },
                { value: <Money value={12.9} context="line" split />, kind: 'order', text: d.orderPrice },
              ]}
            />
          </CalculationFold>
        </KitCard>

        <KitCard id="kit-states" title={c.cards.states} note={c.notes.states} wide>
          <div className="grid gap-4 md:grid-cols-3">
            <div aria-busy="true" aria-label={d.loadingLabel}>
              <p className="mb-2 text-caption text-fg-tertiary">{d.loadingLabel}</p>
              <Skeleton key={skeletonKey} variant="card" delayed />
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSkeletonKey((k) => k + 1)}>
                {d.retry}
              </Button>
            </div>
            <EmptyState kind="inbox-zero" variant="inline" title={d.emptyTitle} description={d.emptyLine} />
            <ErrorNotice
              title={d.errorTitle}
              safe={d.errorSafe}
              action={
                <Button variant="secondary" size="sm">
                  {d.retry}
                </Button>
              }
            />
          </div>
        </KitCard>

        <KitCard id="kit-answer" title={c.cards.answer} note={c.notes.answer}>
          <DataAnswer
            question={d.question}
            figures={[
              { value: <Money value={760} context="tile" split />, caption: d.leakSince },
              { value: <Money value={296} context="tile" split />, caption: d.unpaid },
            ]}
            facts={[d.checked, d.openGaps]}
            action={
              <Button variant="secondary" size="sm">
                {d.toDecision}
              </Button>
            }
          />
        </KitCard>

        <KitCard id="kit-charts" title={c.cards.charts} note={c.notes.charts} wide>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="mb-2 text-caption text-fg-tertiary">{d.byKind}</p>
              <BreakdownChart
                chart="bar"
                density={density === 'compact' ? 'compact' : 'comfortable'}
                caption={d.byKind}
                keyHeader={d.colKind}
                valueHeader={d.colGap}
                emptyText={d.emptyTitle}
                digits={2}
                rows={[
                  { key: 'price', label: d.kindPrice, value: 400.82 },
                  { key: 'over', label: d.kindOverbilled, value: 274.06 },
                  { key: 'unordered', label: d.kindUnordered, value: 72 },
                  { key: 'vat', label: d.kindVat, value: 12.66 },
                ]}
              />
            </div>
            <div className="grid content-start gap-4">
              <div>
                <p className="mb-2 text-caption text-fg-tertiary">{d.pace}</p>
                <PaceLine current={PACE_NOW} previous={PACE_PREV} days={31} label={d.paceLabel} />
              </div>
              <div>
                <p className="mb-2 text-caption text-fg-tertiary">{d.paid}</p>
                <SplitBar first={296} second={464} />
              </div>
            </div>
          </div>
        </KitCard>

        <KitCard id="kit-icons" title={c.cards.icons} note={c.notes.icons} wide>
          {(['rest', 'active'] as const).map((state) => (
            <ul
              key={state}
              aria-label={state === 'rest' ? d.iconsRest : d.iconsActive}
              className={cn('grid grid-cols-4 gap-2 sm:grid-cols-8', state === 'active' && 'mt-3 border-t border-line-rule pt-3 text-primary')}
            >
              {icons.map(([glyph, name]) => (
                <li key={name} className="flex flex-col items-center gap-1 text-center">
                  <Icon as={glyph} size="body" state={state} />
                  <span aria-hidden={state === 'active' ? true : undefined} className="text-caption text-fg-secondary">
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </KitCard>

        <KitCard id="kit-rail" title={c.cards.rail} note={c.notes.rail}>
          <StatusRail
            label={d.railLabel}
            steps={[
              { key: 'sent', label: d.sent, detail: <bdi>{d.sentDetail}</bdi>, state: 'done' },
              {
                key: 'wait',
                label: d.awaitingReply,
                detail: d.waitingDays,
                state: 'now',
                action: (
                  <Button variant="secondary" size="sm">
                    {d.remind}
                  </Button>
                ),
              },
              { key: 'ok', label: d.supplierApproved, state: 'todo' },
              { key: 'credited', label: d.creditedNotOffset, state: 'todo' },
              { key: 'offset', label: d.offset, state: 'todo' },
            ]}
          />
        </KitCard>

        <KitCard id="kit-controls" title={c.cards.controls} note={c.notes.controls}>
          <div className="grid gap-3">
            <Field label={d.fieldLabel} hint={d.fieldHint}>
              <Input defaultValue="ירקות השרון" />
            </Field>
            <Switch checked={shortcuts} onCheckedChange={setShortcuts} label={d.switchLabel} hint={d.switchHint} />
            <Field label={d.numberLabel}>
              <NumberField value={threshold} onValueChange={setThreshold} min={0} max={20} unit="%" />
            </Field>
            <Row>
              <Tooltip label={d.tooltipTarget} kbd="G S">
                <IconButton label={d.tooltipTarget} icon={<Icon as={Settings} />} />
              </Tooltip>
            </Row>
          </div>
        </KitCard>
      </div>
    </div>
  );
}
