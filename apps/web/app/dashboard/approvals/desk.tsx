'use client';

/**
 * W2-04 desk pieces for the approvals queue: the invoice group header, the
 * evidence body (Peek / side pane — no page navigation), the "היסטוריה"
 * disclosure, the escalation Sheet and the keyboard help. Pure UI over data
 * the list already holds; every decision still goes through `list.tsx`.
 */
import { useId, useState } from 'react';
import Link from 'next/link';
import { History, Keyboard } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import { Button, Textarea, cn } from '@/lib/components';
import { Sheet } from '@/lib/components/overlay/Sheet';
import { BULK_CAP_AGOROT, groupPrimary, type DeskRow, type InvoiceGroup } from './groups';
import { displayName } from './vocab';

type T = Translator<typeof approvalsHe>;
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface scroll-mb-28 scroll-mt-20';

export const ils = (agorot: number, locale: 'he' | 'en') =>
  formatIls(agorot / 100, { locale, maximumFractionDigits: 2 });

/* ───────────────────────────── invoice group header ───────────────────────────── */

/** "משקאות שטיינברג · ST-24108 · ₪104.80 בסיכון · 1 פער" + the group primary when allowed. */
export function GroupHeader<R extends DeskRow>({
  g,
  t,
  locale,
  busy,
  onApproveAll,
}: {
  g: InvoiceGroup<R>;
  t: T;
  locale: 'he' | 'en';
  busy: boolean;
  onApproveAll: () => void;
}) {
  const supplier = displayName(locale, g.supplierName, g.supplierNameEn);
  const count = g.rows.length;
  const gaps = count === 1 ? t('desk.groupGapsOne') : t('desk.groupGapsMany', { count: formatNumber(count, locale) });
  const primary = groupPrimary(g);
  const why =
    !primary.ok && primary.why === 'block' && count > 1
      ? t('desk.groupWhyBlock')
      : !primary.ok && primary.why === 'overCap'
        ? t('desk.groupWhyOverCap', { cap: ils(BULK_CAP_AGOROT, locale) })
        : null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1"
      data-testid="approval-group"
      data-invoice={g.invoiceId ?? ''}
    >
      <h2 className="min-w-0 text-sm font-semibold text-ink">
        {[supplier, g.invoiceNumber].filter(Boolean).map((p, i) => (
          <span key={i}>
            {i > 0 ? ' · ' : ''}
            <bdi className={i === 1 ? 'tabular-nums' : undefined}>{p}</bdi>
          </span>
        ))}
        {g.claimAgorot > 0 ? (
          <>
            {supplier || g.invoiceNumber ? ' · ' : ''}
            <bdi className="tabular-nums" data-testid="group-at-risk">
              {t('desk.groupAtRisk', { amount: ils(g.claimAgorot, locale) })}
            </bdi>
          </>
        ) : null}
        <span className="font-normal text-muted"> · {gaps}</span>
      </h2>
      {primary.ok ? (
        <button
          type="button"
          disabled={busy}
          onClick={onApproveAll}
          data-testid="group-approve"
          className={cn(
            'inline-flex h-12 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-95 disabled:opacity-45',
            focusRing,
          )}
        >
          {t('desk.groupApprove', { amount: ils(g.claimAgorot, locale) })}
        </button>
      ) : why ? (
        <p className="text-xs text-muted" data-testid="group-why">
          {why}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── evidence ───────────────────────────── */

export interface EvidenceRow extends DeskRow {
  type: string;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  qtyBilled: string | null;
  billedUnit: string | null;
  qtyOrdered: string | null;
  orderedUnit: string | null;
  qtyReceived: string | null;
  poRef: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  invoiceStatus?: string | null;
  hasScan?: boolean;
}

/** The scan crop + the PO, קבלת סחורה and invoice facts of one gap, and its decision buttons. */
export function EvidenceBody({
  d,
  t,
  locale,
  actions,
  split = false,
}: {
  d: EvidenceRow;
  t: T;
  locale: 'he' | 'en';
  actions?: React.ReactNode;
  /** ≥1536 px: the document and the decision side by side (the desk's 3rd pane). */
  split?: boolean;
}) {
  const qty = (v: string | null, unit: string | null) =>
    v == null ? '—' : `${formatNumber(Number(v), locale, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
  const facts: Array<[string, string]> = [
    [t('desk.evidenceOrder'), [qty(d.qtyOrdered, d.orderedUnit), d.poRef].filter((x) => x && x !== '—').join(' · ') || '—'],
    [t('desk.evidenceReceipt'), qty(d.qtyReceived, d.orderedUnit ?? d.billedUnit)],
    [t('desk.evidenceInvoice'), qty(d.qtyBilled, d.billedUnit)],
  ];
  return (
    <div
      className={cn(
        'space-y-4',
        split &&
          '[@media(min-width:1536px)]:grid [@media(min-width:1536px)]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] [@media(min-width:1536px)]:gap-4 [@media(min-width:1536px)]:space-y-0',
      )}
      data-testid="approval-evidence"
    >
      <section aria-label={t('desk.evidenceScan')} data-pane="document">
        {d.invoiceId && d.hasScan ? (
          // INTERIM(W2-02): a plain image until the shared scan viewer lands.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/scans/${d.invoiceId}/file`}
            alt={t('desk.evidenceScan')}
            className="max-h-[50vh] w-full rounded-lg border border-line bg-surface-2 object-contain"
            loading="lazy"
          />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
            {t('desk.evidenceNoScan')}
          </p>
        )}
      </section>
      <div className="space-y-4" data-pane="decision">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-end font-semibold tabular-nums text-ink">
              <bdi>{v}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {actions ? <div>{actions}</div> : null}
      {d.invoiceId ? (
        <Link
          href={`/dashboard/invoices/${d.invoiceId}`}
          className={cn('inline-flex min-h-12 items-center text-sm font-semibold text-primary underline', focusRing)}
        >
          {t('desk.openInvoice')}
        </Link>
      ) : null}
      </div>
    </div>
  );
}

/** Decision 19: the channel the money takes, by invoice state. */
export function effectLine(t: T, invoiceStatus: string | null | undefined): string {
  return invoiceStatus === 'paid' ? t('desk.effectClaim') : t('desk.effectOffset');
}

/* ───────────────────────────── history ───────────────────────────── */

const DECISION_OF: Record<string, MessageKey<typeof approvalsHe>> = {
  'discrepancy.approved': 'decision.approved',
  'discrepancy.rejected': 'decision.rejected',
  'discrepancy.escalated': 'decision.escalated',
  'discrepancy.reopened': 'decision.reopened',
};

/** "היסטוריה": the last 3 audit rows (who, role, when, decision, note), loaded on open. */
export function HistoryDisclosure({ id, t, locale }: { id: string; t: T; locale: 'he' | 'en' }) {
  const [open, setOpen] = useState(false);
  const q = trpc.approvals.history.useQuery({ discrepancyId: id, limit: 3 }, { enabled: open, staleTime: 30_000 });
  const role = (r: string | undefined) => {
    if (!r) return null;
    const out = t(`roles.${r}` as MessageKey<typeof approvalsHe>);
    return out.startsWith('roles.') ? r : out;
  };
  return (
    <details
      className="mt-2 text-sm"
      data-testid="approval-history"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className={cn('inline-flex min-h-12 cursor-pointer items-center gap-1.5 rounded-lg text-muted', focusRing)}>
        <History className="h-4 w-4" aria-hidden="true" />
        {t('desk.history')}
      </summary>
      {!open ? null : q.isLoading ? (
        <p role="status" className="text-xs text-subtle">
          {t('desk.historyLoading')}
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-xs text-danger">
          {t('desk.historyError')}{' '}
          <button type="button" className={cn('touch-target underline', focusRing)} onClick={() => void q.refetch()}>
            {t('desk.historyRetry')}
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="text-xs text-subtle">{t('desk.historyEmpty')}</p>
      ) : (
        <ol className="space-y-1 text-xs text-muted">
          {q.data.map((a) => {
            const after = (a.after ?? {}) as { role?: string; fromRole?: string; note?: string | null; reason?: string | null };
            const what = DECISION_OF[a.action] ? t(DECISION_OF[a.action]!) : t('desk.historyCreated');
            const who = [a.actorName ?? t('card.someone'), role(after.role ?? after.fromRole)].filter(Boolean).join(' · ');
            const note = after.reason ?? after.note;
            return (
              <li key={a.id}>
                <bdi>{who}</bdi> · <time dateTime={new Date(a.at).toISOString()}>{formatDateTime(a.at, locale)}</time> · {what}
                {note ? <> · <bdi>{note}</bdi></> : null}
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}

/* ───────────────────────────── escalation sheet ───────────────────────────── */

const CHIPS = ['escalateChipPrice', 'escalateChipSupplier', 'escalateChipAmount', 'escalateChipUnsure'] as const;

/** "העבר לבעלים": note chips + an optional note; the owners are notified server-side. */
export function EscalateSheet({
  open,
  t,
  busy,
  onClose,
  onSend,
}: {
  open: boolean;
  t: T;
  busy: boolean;
  onClose: () => void;
  onSend: (note: string | undefined) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const noteId = useId();
  const note = [...picked, text.trim()].filter(Boolean).join(' · ') || undefined;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('desk.escalateTitle')}
      description={t('desk.escalateDescription')}
      primary={
        <div className="grid grid-cols-2 gap-2">
          <Button size="xl" disabled={busy} onClick={() => onSend(note)} data-testid="escalate-send">
            {t('desk.escalateSend')}
          </Button>
          <Button size="xl" variant="secondary" onClick={onClose}>
            {t('desk.cancel')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('desk.escalateNote')}>
        {CHIPS.map((k) => {
          const label = t(`desk.${k}`);
          const on = picked.includes(label);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== label) : [...p, label]))}
              className={cn(
                'inline-flex min-h-12 items-center rounded-full border px-4 text-sm',
                on ? 'border-primary bg-primary/10 font-semibold text-ink' : 'border-line-strong text-ink',
                focusRing,
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <label htmlFor={noteId} className="mt-3 block text-sm font-semibold text-ink">
        {t('desk.escalateNote')}
      </label>
      <Textarea id={noteId} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} className="mt-1" />
    </Sheet>
  );
}

/* ───────────────────────────── keyboard help ───────────────────────────── */

const KEY_LINES = ['keyNav', 'keySelect', 'keyEvidence', 'keyApprove', 'keyWaive', 'keyEscalate', 'keyUndo', 'keyHelp'] as const;

export function KeysHelp({ open, t, onClose }: { open: boolean; t: T; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('desk.keysTitle')}
      primary={
        <Button size="xl" variant="secondary" onClick={onClose}>
          {t('desk.keysClose')}
        </Button>
      }
    >
      <ul className="space-y-2 text-sm text-ink" data-testid="approvals-keys">
        {KEY_LINES.map((k) => (
          <li key={k}>
            <bdi>{t(`desk.${k}`)}</bdi>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function KeysButton({ t, onOpen }: { t: T; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('hidden min-h-12 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 lg:inline-flex', focusRing)}
      data-testid="approvals-keys-open"
    >
      <Keyboard className="h-4 w-4" aria-hidden="true" />
      {t('desk.keysOpen')}
    </button>
  );
}
