'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { contrastRatio, dataViz, elevation, motion, status, surfaces, text, typeRoles, type MoneyState, type StatusFamily } from '@restomatch/ui-tokens';
import {
  Banner,
  Button,
  ConfirmDialog,
  CountBadge,
  DateField,
  DateTime,
  DeadlineChip,
  Delta,
  DirIcon,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  InlineMessage,
  Input,
  LinkButton,
  MetricTile,
  Money,
  MoneyInput,
  PriceMove,
  QtyKeypad,
  QuantityInput,
  RowActions,
  SegmentedControl,
  Sheet,
  Skeleton,
  Sparkline,
  Spinner,
  StatusChip,
  Steps,
  Tabs,
  Token,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { interpolate, type MessageVars } from '@/lib/i18n/translate';
import { components } from '@/lib/i18n/messages/components';
import { labEn, labHe } from './copy';

type LabKey = keyof typeof labHe;

function useLab() {
  const locale = useLocale();
  const copy = locale === 'he' ? labHe : labEn;
  return (key: LabKey, vars?: MessageVars) => interpolate(copy[key], vars, locale === 'he' ? 'he-IL' : 'en-GB');
}

const FAMILIES: StatusFamily[] = ['primary', 'danger', 'warn', 'gold', 'info', 'neutral'];
const MONEY_STATES: MoneyState[] = ['leak', 'atRisk', 'caught', 'claimed', 'credited', 'returned', 'outstanding', 'pending', 'spend', 'zero'];
const DENSITIES = ['compact', 'default', 'touch'] as const;
// Literal class names (Tailwind only generates classes it can find in the source).
const TYPE_CLASS: Record<string, string> = {
  caption: 'text-caption',
  'body-sm': 'text-body-sm',
  body: 'text-body',
  'heading-sm': 'text-heading-sm',
  'heading-md': 'text-heading-md',
  'heading-lg': 'text-heading-lg',
  'metric-sm': 'text-metric-sm',
  'metric-md': 'text-metric-md',
  'metric-lg': 'text-metric-lg',
  'metric-hero': 'text-metric-hero',
};
const SHADOW_CLASS = { e0: 'shadow-e0', e1: 'shadow-e1', e2: 'shadow-e2', e3: 'shadow-e3' } as const;
const RADIUS_CLASS = { control: 'rounded-control', card: 'rounded-card', overlay: 'rounded-overlay', pill: 'rounded-pill' } as const;
// Fixed reference date for the lab (DEMO_TODAY) so the page renders the same every day.
const LAB_TODAY = new Date('2026-10-25T09:00:00+03:00');

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id={id} className="text-heading-md text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ name, hex, on }: { name: string; hex: string; on: string }) {
  const lab = useLab();
  return (
    <div className="overflow-hidden rounded-control border border-line">
      <div className="flex h-12 items-center justify-center text-caption font-semibold" style={{ background: hex, color: on }}>
        Aa
      </div>
      <div className="space-y-0.5 px-2 py-1.5">
        <p className="truncate text-caption font-semibold text-ink">{name}</p>
        <p className="num text-caption text-muted">
          <bdi dir="ltr">{hex}</bdi> · {lab('contrast', { ratio: contrastRatio(on, hex).toFixed(2) })}
        </p>
      </div>
    </div>
  );
}

export function TokensShowcase({ density }: { density: (typeof DENSITIES)[number] }) {
  const t = useT(components);
  const lab = useLab();
  const toast = useToast();
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const [amount, setAmount] = useState<number | null>(125050);
  const [qty, setQty] = useState<number | null>(12);
  const [date, setDate] = useState<string | null>('2026-10-25');
  const [sheet, setSheet] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [filter, setFilter] = useState(true);

  return (
    <div data-density={density} data-lab="tokens" className="mx-auto max-w-app space-y-6 pb-16">
      <header className="space-y-2">
        <h1 className="text-heading-lg text-ink">{lab('title')}</h1>
        <p className="text-body-sm text-muted">{lab('intro')}</p>
        <nav aria-label={lab('density', { mode: density })} className="flex flex-wrap gap-2">
          {DENSITIES.map((d) => (
            <LinkButton key={d} href={`?density=${d}`} size="sm" variant={d === density ? 'primary' : 'secondary'} aria-current={d === density ? 'page' : undefined}>
              {lab('density', { mode: d })}
            </LinkButton>
          ))}
        </nav>
      </header>

      <Section id="lab-colors" title={lab('colors')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Swatch name="canvas / ink" hex={surfaces.canvas} on={text.ink} />
          <Swatch name="surface / ink" hex={surfaces.surface} on={text.ink} />
          <Swatch name="sunken / muted" hex={surfaces.sunken} on={text.muted} />
          <Swatch name="surface / muted" hex={surfaces.surface} on={text.muted} />
          <Swatch name="surface / subtle" hex={surfaces.surface} on={text.subtle} />
          <Swatch name="line-strong" hex={surfaces.lineStrong} on={text.ink} />
          <Swatch name="line-field" hex={surfaces.lineField} on={text.onBold} />
          <Swatch name="focus" hex="#1A5BC7" on={text.onBold} />
        </div>
      </Section>

      <Section id="lab-families" title={lab('families')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FAMILIES.map((f) => (
            <div key={f} className="grid grid-cols-3 gap-2">
              <Swatch name={`${f} bold`} hex={status[f].bgBold} on={status[f].onBold} />
              <Swatch name={`${f} subtle`} hex={status[f].bgSubtle} on={status[f].text} />
              <Swatch name={`${f} hover`} hex={status[f].bgSubtleHover} on={status[f].text} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="lab-money-states" title={lab('moneyStates')}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {MONEY_STATES.map((s) => (
            <li key={s} className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
              <span className="text-caption font-semibold text-muted">{s}</span>
              <Money value={s === 'zero' ? 0 : 1759.5} context="line" state={s} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="lab-type" title={lab('type')}>
        <div className="space-y-2">
          {Object.keys(typeRoles).map((role) => (
            <div key={role} className="flex flex-wrap items-baseline gap-4 border-b border-line pb-2">
              <span className="w-28 shrink-0 text-caption text-muted">
                <bdi dir="ltr">{role}</bdi>
              </span>
              <span className={`${TYPE_CLASS[role]} text-ink`}>
                {role.startsWith('metric') ? <Money value={759.54} context={role === 'metric-hero' ? 'hero' : 'inline'} /> : lab('sample')}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="lab-shape" title={lab('shape')}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(elevation) as Array<keyof typeof elevation>).map((e) => (
            <div key={e} className={`flex h-20 items-center justify-center rounded-card border border-line bg-surface ${SHADOW_CLASS[e]}`}>
              <bdi dir="ltr" className="text-caption font-semibold text-muted">
                {e}
              </bdi>
            </div>
          ))}
          {(['control', 'card', 'overlay', 'pill'] as const).map((r) => (
            <div key={r} className={`flex h-12 items-center justify-center border border-line-strong bg-surface-2 ${RADIUS_CLASS[r]}`}>
              <bdi dir="ltr" className="text-caption text-muted">
                {r}
              </bdi>
            </div>
          ))}
        </div>
      </Section>

      <Section id="lab-motion" title={lab('motion')}>
        <ul className="grid gap-2 sm:grid-cols-4">
          {Object.entries(motion.duration).map(([k, v]) => (
            <li key={k} className="rounded-control border border-line px-3 py-2 text-caption text-muted">
              <bdi dir="ltr">
                --dur-{k} · {v}
              </bdi>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="lab-viz" title={lab('dataViz')}>
        <div className="flex flex-wrap gap-2">
          {dataViz.categorical.map((hex, i) => (
            <span key={hex} className="inline-flex h-8 w-16 items-center justify-center rounded-control text-caption font-semibold text-on-bold" style={{ background: hex }}>
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {dataViz.creep.map((s, i) => (
            <span key={s.bg} className="num inline-flex h-10 w-16 items-center justify-center rounded-control text-caption font-semibold" style={{ background: s.bg, color: s.text }}>
              {(i + 1) * 4}%
            </span>
          ))}
        </div>
        <Sparkline data={[131, 96, 120, 54, 40, 12, 0]} tone="leak" label="מגמת דליפה: יורדת" className="h-8 w-32" />
      </Section>

      <Section id="lab-numeric" title={lab('numeric')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3" data-testid="lab-money">
            <p className="text-ink">
              <Money value={759.54} context="hero" state="leak" />
            </p>
            <p className="flex flex-wrap gap-4 text-body text-ink">
              <Money value={1240} context="line" />
              <Money value={12.3456} context="unit" />
              <Money value={120} context="inline" credit state="credited" />
              <Money value={null} />
              <Money value={null} pending />
            </p>
            <p className="flex flex-wrap items-center gap-4 text-body-sm">
              <Token kind="invoice" value="INV-2026-1000" copy />
              <Token kind="sku" value="GD-1006" />
              <Delta current={760} previous={1020} goodWhen="down" showPercent />
              <PriceMove from={18.5} to={21.9} basis="לק״ג" />
              <DateTime value={LAB_TODAY} variant="datetime" />
            </p>
            <DeadlineChip due="2026-10-31" today={LAB_TODAY} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label={lab('leak')} value={<Money value={759.54} context="tile" />} state="leak" context="אוקטובר · עד 25.10" />
            <MetricTile label={lab('caught')} value={<Money value={296} context="tile" />} state="caught" delta={<Delta current={296} previous={180} goodWhen="up" />} />
            <MetricTile label={lab('claimed')} value={<Money value={1759} context="tile" />} state="claimed" href="/dashboard/recovery" linkLabel={lab('view')} />
            <MetricTile label={lab('pending')} loading />
          </div>
        </div>
      </Section>

      <Section id="lab-actions" title={lab('actions')}>
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            <Button size={size}>{lab('addSupplier')}</Button>
            <Button size={size} variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              {lab('addSupplier')}
            </Button>
            <Button size={size} variant="tertiary">
              {lab('view')}
            </Button>
            <Button size={size} variant="danger">
              {lab('remove')}
            </Button>
            <Button size={size} loading>
              {lab('addSupplier')}
            </Button>
            <Button size={size} variant="secondary" pressed>
              {lab('month')}
            </Button>
            <Button size={size} disabled disabledReason={lab('nameError')}>
              {lab('addSupplier')}
            </Button>
          </div>
        ))}
        <Button size="xl" success successLabel={t('ds.button.done')}>
          {lab('addSupplier')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label={lab('edit')} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} />
          <IconButton label={lab('remove')} tone="danger" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} />
          <DirIcon kind="forward" />
          <DirIcon kind="back" />
          <RowActions
            actions={[
              { label: lab('view'), onClick: () => {} },
              { label: lab('edit'), onClick: () => {} },
              { label: lab('remove'), onClick: () => {}, tone: 'danger' },
            ]}
          />
        </div>
      </Section>

      <Section id="lab-status" title={lab('status')}>
        <div className="flex flex-wrap items-center gap-2">
          {(['danger', 'warn', 'success', 'gold', 'info', 'neutral'] as const).map((tone) => (
            <span key={tone} className="inline-flex gap-1">
              <StatusChip tone={tone} label={tone} />
              <StatusChip tone={tone} label={tone} emphasis="bold" />
            </span>
          ))}
          <CountBadge count={3} label="3 ממתינות" />
          <CountBadge count={140} tone="danger" />
        </div>
      </Section>

      <Section id="lab-forms" title={lab('forms')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={lab('nameLabel')} error={lab('nameError')}>
            <Input defaultValue="" />
          </Field>
          <Field label={lab('amountLabel')} hint={lab('dateHint')}>
            <MoneyInput value={amount} onValueChange={setAmount} data-testid="lab-money-input" />
          </Field>
          <Field label={lab('qtyLabel')} optional={t('ds.field.optional')}>
            <QuantityInput value={qty} onValueChange={setQty} unit="ק״ג" stepper step={0.5} />
          </Field>
          <Field label={lab('dateLabel')} hint={lab('dateHint')}>
            <DateField value={date} onValueChange={setDate} data-testid="lab-date" />
          </Field>
        </div>
        <p className="num text-caption text-muted" data-testid="lab-form-values">
          <bdi dir="ltr">
            {String(amount)} · {String(qty)} · {String(date)}
          </bdi>
        </p>
      </Section>

      <Section id="lab-choosing" title={lab('choosing')}>
        <SegmentedControl
          label={lab('period')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: lab('week') },
            { value: 'month', label: lab('month') },
            { value: 'quarter', label: lab('quarter') },
          ]}
        />
        <Tabs
          label={lab('tabsLabel')}
          items={[
            { href: '?density=' + density, label: lab('open'), count: 7, current: true },
            { href: '?density=' + density + '#paid', label: lab('paid'), count: 0 },
            { href: '?density=' + density + '#all', label: lab('all') },
          ]}
        />
        <Steps steps={[lab('stepSupplier'), lab('stepItems'), lab('stepReview'), lab('stepSend')]} current={1} />
        <div className="flex flex-wrap gap-2">
          <FilterChip label={lab('filterSupplier', { value: lab('supplier') })} active={filter} count={1} onRemove={() => setFilter(false)} onClick={() => setFilter(true)} />
          <FilterChip label={lab('filterSupplier', { value: lab('all') })} />
        </div>
        <div data-density="compact" className="overflow-hidden rounded-card border border-line">
          {DENSITIES.map((d) => (
            <div key={d} data-density={d} className="flex items-center justify-between border-b border-line px-[var(--cell-inline)] last:border-b-0" style={{ minHeight: 'var(--row-h)' }}>
              <span className="text-body-sm text-ink">{lab('density', { mode: d })}</span>
              <Money value={1240.5} context="line" />
            </div>
          ))}
        </div>
      </Section>

      <Section id="lab-feedback" title={lab('feedback')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toast.success(lab('toastSaved'))}>
            {lab('showToast')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.info(lab('toastUndo'), { action: { label: lab('undo'), onClick: () => toast.success(lab('toastUndone')) } })}
          >
            {lab('showActionToast')}
          </Button>
          <Button variant="secondary" onClick={() => toast.error(lab('toastError'))}>
            {lab('showErrorToast')}
          </Button>
          <Spinner />
        </div>
        <Banner tone="neutral" title={lab('bannerTitle')}>
          {lab('bannerBody')}
        </Banner>
        <InlineMessage tone="warn">{lab('inline')}</InlineMessage>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <EmptyState
            kind="first-use"
            icon={<Truck className="h-6 w-6" aria-hidden="true" />}
            title={lab('emptyFirstUse')}
            description={lab('emptyFirstUseBody')}
            action={<Button size="sm">{lab('addSupplier')}</Button>}
          />
          <EmptyState kind="no-results" title={lab('emptyNoResults')} action={<Button size="sm" variant="secondary">{t('ds.emptyState.clearFilters')}</Button>} />
          <EmptyState kind="inbox-zero" title={lab('emptyInboxZero')} description={lab('emptyInboxZeroBody')} />
          <EmptyState kind="error" title={lab('emptyError')} action={<Button size="sm" variant="secondary">{t('ds.emptyState.retry')}</Button>} />
          <EmptyState kind="permission" title={lab('emptyPermission')} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton variant="hero" />
          <Skeleton variant="kpiRow" />
          <Skeleton variant="table" rows={3} />
          <Skeleton variant="form" rows={2} />
        </div>
      </Section>

      <Section id="lab-overlays" title={lab('overlays')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            {lab('openSheet')}
          </Button>
          <Button variant="secondary" onClick={() => setKeypad(true)}>
            {lab('openKeypad')}
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {lab('openConfirm')}
          </Button>
          <Link href="/dashboard" className="self-center text-body-sm text-primary underline">
            /dashboard
          </Link>
        </div>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title={lab('sheetTitle')}
          description={lab('sheetBody')}
          primary={
            <Button size="xl" onClick={() => setSheet(false)}>
              {t('ds.keypad.confirm')}
            </Button>
          }
        >
          <SegmentedControl
            label={lab('period')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: lab('week') },
              { value: 'month', label: lab('month') },
            ]}
          />
        </Sheet>
        <QtyKeypad
          open={keypad}
          onClose={() => setKeypad(false)}
          onConfirm={(v) => {
            setQty(v);
            setKeypad(false);
          }}
          title={lab('qtyLabel')}
          unit="ק״ג"
          ordered={12}
          initial={qty}
        />
        <ConfirmDialog
          open={confirm}
          title={lab('confirmTitle')}
          body={lab('confirmBody')}
          amount={1240}
          party={lab('supplier')}
          confirmLabel={lab('confirmCta')}
          cancelLabel={lab('keep')}
          onConfirm={() => setConfirm(false)}
          onClose={() => setConfirm(false)}
        />
      </Section>
    </div>
  );
}
