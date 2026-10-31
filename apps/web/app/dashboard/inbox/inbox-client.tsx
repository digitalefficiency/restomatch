'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, FileText, Mail, MessageCircle, Settings, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Select, cn, useToast, type BadgeTone } from '@/lib/components';
import { Tabs } from '@/lib/components/form';
import { formatIls } from '@/lib/money';
import { localizeServerError } from '@/lib/serverErrors';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { ingest } from '@/lib/i18n/messages/ingest';
import { trpc } from '@/lib/trpc/client';

type Kind = 'whatsapp' | 'email';

export interface InboxMessage {
  id: string;
  kind: Kind;
  sender: string;
  senderAllowed: boolean;
  subject: string | null;
  status: 'accepted' | 'needs_review' | 'rejected' | 'failed' | 'empty';
  error: string | null;
  receivedAt: string;
  supplierName: string | null;
  documents: Array<{
    id: string;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    status: 'registered' | 'needs_review' | 'rejected' | 'failed' | 'duplicate' | 'skipped';
    error: string | null;
    invoiceId: string | null;
    stored: boolean;
    /** W2-02: the OCR outcome of the registered invoice (null before registration). */
    ocr?: {
      state: 'reading' | 'read' | 'failed';
      supplierName: string | null;
      totalInclVatAgorot: number | null;
      lineCount: number;
      failureReason: string | null;
    } | null;
  }>;
  /** orderCapture: a forwarded WhatsApp order (text) and the draft PO captured from it. */
  order?: { poId: string | null; poStatus: string | null } | null;
}

interface Props {
  filter: 'all' | 'needs_review' | 'errors';
  canManage: boolean;
  features: Record<Kind, boolean>;
  needsReview: number;
  suppliers: Array<{ id: string; name: string; nameEn: string | null }>;
  messages: InboxMessage[];
}

// Emphasis tiers (DESIGN-BRIEF): needs a decision = T2 warn (solid); read / registered = T3
// green; a manager's rejection, duplicates and skips are calm history (T4, never red);
// only a processing failure is red.
const MESSAGE_TONE: Record<InboxMessage['status'], BadgeTone> = {
  accepted: 'accent',
  needs_review: 'warning-solid',
  rejected: 'neutral',
  failed: 'danger',
  empty: 'neutral',
};
const DOC_TONE: Record<InboxMessage['documents'][number]['status'], BadgeTone> = {
  registered: 'accent',
  needs_review: 'warning-solid',
  rejected: 'neutral',
  failed: 'danger',
  duplicate: 'info',
  skipped: 'neutral',
};
const KNOWN_ERRORS = [
  'too_large',
  'unsupported_type',
  'fetch_failed',
  'store_failed',
  'too_many_attachments',
  'rejected_by_user',
  'processing_failed',
  'quota_exceeded',
] as const;

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  return kind === 'whatsapp' ? (
    <MessageCircle className={className} aria-hidden="true" />
  ) : (
    <Mail className={className} aria-hidden="true" />
  );
}

export function InboxClient(props: Props) {
  const t = useT(ingest);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();

  const approve = trpc.ingest.approveDocument.useMutation();
  const reject = trpc.ingest.rejectDocument.useMutation();
  const bulk = trpc.ingest.bulkApprove.useMutation();
  const [supplierFor, setSupplierFor] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState(props.messages);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<
    { docId: string; state: 'loading' } | { docId: string; state: 'ready'; url: string; kind: 'pdf' | 'image' | 'other' } | { docId: string; state: 'none' | 'error' } | null
  >(null);

  // Only the inbox list refetches after an action (perf-states-19) — never the whole layout.
  async function refetch() {
    const rows = await utils.ingest.inbox.fetch({ filter: props.filter, limit: 50 });
    setMessages(
      rows.map(
        (m): InboxMessage => ({
          ...m,
          receivedAt: new Date(m.receivedAt).toISOString(),
          supplierName: m.supplierName ?? null,
          order: m.order ?? null,
        }),
      ),
    );
  }

  async function openPreview(docId: string) {
    if (preview?.docId === docId) return setPreview(null);
    setPreview({ docId, state: 'loading' });
    try {
      const p = await utils.ingest.documentPreview.fetch({ documentId: docId });
      setPreview(p.url ? { docId, state: 'ready', url: p.url, kind: p.kind } : { docId, state: 'none' });
    } catch {
      setPreview({ docId, state: 'error' });
    }
  }

  const readable = messages.flatMap((m) => m.documents).filter((d) => d.status === 'needs_review' && d.stored);
  const pickedIds = readable.filter((d) => picked.has(d.id)).map((d) => d.id);
  async function bulkRead() {
    try {
      const r = await bulk.mutateAsync({ documentIds: pickedIds });
      toast.success(t('inbox.bulkDone', { count: formatNumber(r.invoiceIds.length, locale) }));
      setPicked(new Set());
      await refetch();
    } catch (err) {
      toast.error(localizeServerError(err, locale, t('inbox.actionFailed', { message: '' })));
    }
  }

  const errorText = (code: string | null) =>
    code && (KNOWN_ERRORS as readonly string[]).includes(code)
      ? t(`errors.${code as (typeof KNOWN_ERRORS)[number]}`)
      : t('errors.unknown');

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await refetch();
    } catch (err) {
      toast.error(localizeServerError(err, locale, t('inbox.actionFailed', { message: '' })));
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters: real links-as-tabs (approvals-36) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          label={t('inbox.tabsLabel')}
          items={(['all', 'needs_review', 'errors'] as const).map((f) => ({
            href: f === 'all' ? '/dashboard/inbox' : `/dashboard/inbox?filter=${f}`,
            label: t(`inbox.filters.${f}`),
            current: props.filter === f,
            ...(f === 'needs_review' && props.needsReview > 0 ? { count: props.needsReview } : {}),
          }))}
        />
        <Link
          href="/dashboard/inbox?view=settings"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
          data-testid="intake-settings-link"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          {t('inbox.settingsLink')}
        </Link>
      </div>

      {/* Messages */}
      {messages.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title={t('inbox.emptyTitle')}
          description={t('inbox.emptyDescription')}
        />
      ) : (
        <ul className="space-y-3" data-testid="ingest-messages">
          {messages.map((m) => (
            <li key={m.id}>
              <Card padding="md" elevated data-testid="ingest-message">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/12 text-primary">
                      <KindIcon kind={m.kind} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        {t('inbox.from', { sender: '' })}
                        <span dir="ltr" className="font-mono text-sm">
                          {m.sender}
                        </span>
                      </p>
                      <p className="truncate text-sm text-muted">
                        {m.subject ? (
                          <span {...originalProps(m.subject)}>{m.subject}</span>
                        ) : (
                          t('inbox.noSubject')
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-subtle">
                        <span>{t(`kind.${m.kind}`)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('inbox.receivedAt', { when: formatDateTime(m.receivedAt, locale) })}
                        </span>
                        {m.supplierName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span {...originalProps(m.supplierName)}>{m.supplierName}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.senderAllowed ? 'accent' : 'neutral'}>
                      {m.senderAllowed ? t('inbox.knownSender') : t('inbox.unknownSender')}
                    </Badge>
                    <Badge tone={MESSAGE_TONE[m.status]}>{t(`messageStatus.${m.status}`)}</Badge>
                  </div>
                </div>

                {m.order ? (
                  <div
                    className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3"
                    data-testid="ingest-order"
                  >
                    <Badge tone="info">{t('orderCapture.inboxOrder')}</Badge>
                    {props.canManage ? (
                      m.order.poId ? (
                        <Link
                          href={`/dashboard/orders/${m.order.poId}`}
                          className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          {t('orderCapture.inboxOpenDraft')}
                        </Link>
                      ) : (
                        <Link
                          href={`/dashboard/orders/capture?text=${encodeURIComponent(m.subject ?? '')}`}
                          className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          {t('orderCapture.inboxNeedsSupplier')}
                        </Link>
                      )
                    ) : null}
                  </div>
                ) : null}

                {m.documents.length > 0 ? (
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {m.documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                        data-testid="ingest-document"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                          {props.canManage && d.status === 'needs_review' && d.stored ? (
                            <input
                              type="checkbox"
                              className="h-5 w-5 shrink-0 accent-[rgb(var(--c-primary))]"
                              aria-label={t('inbox.selectDoc', { name: d.filename ?? d.mimeType ?? '' })}
                              checked={picked.has(d.id)}
                              onChange={(e) =>
                                setPicked((p) => {
                                  const n = new Set(p);
                                  if (e.target.checked) n.add(d.id);
                                  else n.delete(d.id);
                                  return n;
                                })
                              }
                              data-testid="ingest-pick"
                            />
                          ) : null}
                          <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                          <span className="truncate font-mono text-xs" dir="ltr">
                            {d.filename ?? d.mimeType ?? '—'}
                          </span>
                          {d.sizeBytes ? (
                            <span className="text-xs text-subtle">
                              {t('inbox.size', {
                                kb: formatNumber(
                                  Math.max(1, Math.round(d.sizeBytes / 1024)),
                                  locale,
                                ),
                              })}
                            </span>
                          ) : null}
                          <Badge tone={DOC_TONE[d.status]}>{t(`documentStatus.${d.status}`)}</Badge>
                          {d.error ? (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-xs',
                                d.status === 'failed' ? 'text-danger' : 'text-muted',
                              )}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                              {errorText(d.error)}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {d.stored ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11"
                              aria-expanded={preview?.docId === d.id}
                              aria-controls={`preview-${d.id}`}
                              onClick={() => openPreview(d.id)}
                              data-testid="ingest-preview-toggle"
                            >
                              {preview?.docId === d.id ? <X className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                              {preview?.docId === d.id ? t('inbox.previewClose') : t('inbox.preview')}
                            </Button>
                          ) : null}
                          {d.invoiceId ? (
                            <Link
                              href={`/dashboard/invoices/${d.invoiceId}`}
                              className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                            >
                              {t('inbox.openInvoice')}
                            </Link>
                          ) : null}
                          {props.canManage && d.status === 'needs_review' ? (
                            <>
                              {d.stored ? (
                                <>
                                  <Select
                                    aria-label={t('inbox.supplierLabel')}
                                    className="min-h-11 w-44"
                                    value={supplierFor[d.id] ?? ''}
                                    onChange={(e) =>
                                      setSupplierFor((s) => ({ ...s, [d.id]: e.target.value }))
                                    }
                                  >
                                    <option value="">{t('inbox.supplierNone')}</option>
                                    {props.suppliers.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {locale === 'en' && s.nameEn ? s.nameEn : s.name}
                                      </option>
                                    ))}
                                  </Select>
                                  <Button
                                    size="sm"
                                    className="min-h-11"
                                    disabled={approve.isPending}
                                    onClick={() =>
                                      act(
                                        () =>
                                          approve.mutateAsync({
                                            documentId: d.id,
                                            ...(supplierFor[d.id]
                                              ? { supplierId: supplierFor[d.id] }
                                              : {}),
                                          }),
                                        t('inbox.approved'),
                                      )
                                    }
                                  >
                                    {t('inbox.approve')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="min-h-11"
                                    disabled={approve.isPending}
                                    onClick={() =>
                                      act(
                                        () =>
                                          approve.mutateAsync({
                                            documentId: d.id,
                                            allowSender: true,
                                            ...(supplierFor[d.id]
                                              ? { supplierId: supplierFor[d.id] }
                                              : {}),
                                          }),
                                        t('inbox.approved'),
                                      )
                                    }
                                  >
                                    {t('inbox.approveAndAllow')}
                                  </Button>
                                </>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="min-h-11"
                                disabled={reject.isPending}
                                onClick={() =>
                                  act(
                                    () => reject.mutateAsync({ documentId: d.id }),
                                    t('inbox.rejected'),
                                  )
                                }
                              >
                                {t('inbox.reject')}
                              </Button>
                            </>
                          ) : null}
                        </div>
                        {d.ocr ? (
                          <p className="w-full text-xs text-muted" data-testid="ingest-ocr-outcome">
                            {d.ocr.state === 'reading'
                              ? t('inbox.ocrReading')
                              : d.ocr.state === 'failed'
                                ? t('inbox.ocrFailed', { reason: errorText(d.ocr.failureReason) })
                                : d.ocr.supplierName
                                  ? t('inbox.ocrRead', {
                                      supplier: d.ocr.supplierName,
                                      amount: d.ocr.totalInclVatAgorot != null ? formatIls(d.ocr.totalInclVatAgorot / 100, { maximumFractionDigits: 2, locale }) : '',
                                      lines: formatNumber(d.ocr.lineCount, locale),
                                    })
                                  : t('inbox.ocrReadNoSupplier', {
                                      amount: d.ocr.totalInclVatAgorot != null ? formatIls(d.ocr.totalInclVatAgorot / 100, { maximumFractionDigits: 2, locale }) : '',
                                      lines: formatNumber(d.ocr.lineCount, locale),
                                    })}
                          </p>
                        ) : null}
                        {preview?.docId === d.id ? (
                          <div id={`preview-${d.id}`} className="w-full overflow-hidden rounded-xl border border-line bg-surface-2" data-testid="ingest-preview">
                            {preview.state === 'loading' ? (
                              <p className="p-3 text-sm text-muted">…</p>
                            ) : preview.state === 'ready' && preview.kind === 'pdf' ? (
                              <iframe src={preview.url} title={d.filename ?? t('inbox.preview')} sandbox="allow-same-origin" className="h-[60dvh] w-full border-0" />
                            ) : preview.state === 'ready' && preview.kind === 'image' ? (
                              // eslint-disable-next-line @next/next/no-img-element -- a ≤60 s signed URL of a private document
                              <img src={preview.url} alt={d.filename ?? t('inbox.preview')} className="max-h-[60dvh] w-full object-contain" />
                            ) : (
                              <p role="status" className="p-3 text-sm text-muted">
                                {preview.state === 'error' ? t('inbox.previewFailed') : t('inbox.previewUnavailable')}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Bulk "פענחו N": sending to OCR is not a payment approval — no ₪ cap applies. */}
      {pickedIds.length > 0 ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card" role="region" aria-label={t('inbox.selected', { count: formatNumber(pickedIds.length, locale) })} data-testid="ingest-batch-bar">
          <span className="text-sm text-ink">{t('inbox.selected', { count: formatNumber(pickedIds.length, locale) })}</span>
          <Button className="min-h-11" disabled={bulk.isPending} onClick={bulkRead} data-testid="ingest-bulk-read">
            {t('inbox.bulkRead', { count: formatNumber(pickedIds.length, locale) })}
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setPicked(new Set())}>
            {t('inbox.clearSelection')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
