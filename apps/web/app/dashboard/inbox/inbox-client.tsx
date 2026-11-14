'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, FileText, Mail, MessageCircle, Settings, X } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, LinkButton, Money, Select, cn, useToast, type BadgeTone } from '@/lib/components';
import { Tabs } from '@/lib/components/form';
import { formatIls } from '@/lib/money';
import { localizeServerError } from '@/lib/serverErrors';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { ingest } from '@/lib/i18n/messages/ingest';
import { trpc } from '@/lib/trpc/client';
import { REFUSALS } from './refusals';

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
    /** G-09: the invoice a page_duplicate repeats (when known). */
    repeatsInvoiceId?: string | null;
    /** G-09: what is at stake on a page question — the page invoice's ₪ (shekels, string) and supplier. */
    invoiceTotal?: string | null;
    invoiceSupplier?: string | null;
    /** G-09: the invoice right before this page from the same sender (for "בדקו את שתיהן יחד"). */
    relatedInvoiceId?: string | null;
    /** G-09 (round 7): the page still asks something (an unreadable page whose invoice got lines does not). */
    questionOpen?: boolean;
    /** W2-02: the OCR outcome of the registered invoice (null before registration). */
    ocr?: {
      state: 'reading' | 'read' | 'failed';
      supplierName: string | null;
      totalInclVatAgorot: number | null;
      lineCount: number;
      failureReason: string | null;
    } | null;
    /** W3-11: suggested type (chip); confirming it is persisted once ingest_documents.doc_type exists. */
    docTypeSuggestion: {
      type: 'credit_note' | 'statement' | 'consolidated' | 'delivery_note' | 'invoice' | null;
      confidence: 'high' | 'low';
    };
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
  // G-09: a page of a multi-page document that was not merged — the one question.
  'page_other_supplier',
  'page_other_invoice',
  'page_duplicate',
  'page_unreadable',
  'page_not_merged',
  'page_merge_blocked',
  'page_too_large',
  'page_separate',
  'page_unreadable_closed',
  'page_checked_together',
] as const;
/** Flags that still ask a person something (page_separate is already answered). */
const PAGE_QUESTIONS: readonly string[] = [
  'page_other_supplier',
  'page_other_invoice',
  'page_duplicate',
  'page_unreadable',
  'page_not_merged',
  'page_merge_blocked',
  'page_too_large',
];
/** Page questions whose honest next step is to look at both invoices together. */
const COMPARE: readonly string[] = ['page_not_merged', 'page_merge_blocked', 'page_too_large'];
/** Page questions a person already answered (round 9: calm, never "an error"). */
const ANSWERED: readonly string[] = ['page_separate', 'page_unreadable_closed', 'page_checked_together'];
const shekels = (v: string | null | undefined) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

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
  const resolvePage = trpc.ingest.resolvePageFlag.useMutation();
  /** The possible duplicate a person is about to mark as a separate invoice (confirm first). */
  const [confirmSep, setConfirmSep] = useState<InboxMessage['documents'][number] | null>(null);
  const [supplierFor, setSupplierFor] = useState<Record<string, string>>({});
  /** The document whose duplicate invoice is about to be deleted (confirm first). */
  const [confirmDup, setConfirmDup] = useState<InboxMessage['documents'][number] | null>(null);
  const bulk = trpc.ingest.bulkApprove.useMutation();
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
      const code = err instanceof Error ? err.message : '';
      // G-09: a named page-question refusal reads as a sentence; anything else is localised.
      if ((REFUSALS as readonly string[]).includes(code)) {
        toast.error(t('inbox.actionFailed', { message: t(`refusals.${code as (typeof REFUSALS)[number]}`) }));
      } else {
        toast.error(localizeServerError(err, locale, t('inbox.actionFailed', { message: '' })));
      }
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
                          {d.error && PAGE_QUESTIONS.includes(d.error) && d.questionOpen !== false ? (
                            // T2: an open page question is an act-now item — solid badge + ₪.
                            <>
                              <Badge tone={d.error === 'page_duplicate' ? 'danger-solid' : 'warning-solid'}>
                                {d.error === 'page_duplicate' ? t('inbox.possibleDuplicate') : t('inbox.pageQuestion')}
                              </Badge>
                              {shekels(d.invoiceTotal) !== undefined ? (
                                <span className="text-sm font-semibold text-ink">
                                  <Money value={shekels(d.invoiceTotal)!} context="line" />
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <Badge tone={DOC_TONE[d.status]}>{t(`documentStatus.${d.status}`)}</Badge>
                          )}
                          {d.docTypeSuggestion.type && d.docTypeSuggestion.type !== 'invoice' ? (
                            <span className="inline-flex items-center gap-1.5" data-testid="doc-type-chip">
                              <Badge tone="info">
                                {d.docTypeSuggestion.confidence === 'low' ? `${t('docType.guess')} ` : ''}
                                {t(`docType.${d.docTypeSuggestion.type}`)}
                              </Badge>
                              {d.docTypeSuggestion.type === 'credit_note' ? (
                                <Link href="/dashboard/recovery" className="text-xs font-semibold text-primary hover:underline">
                                  {t('docType.toRecovery')}
                                </Link>
                              ) : d.docTypeSuggestion.type === 'statement' ? (
                                <Link
                                  href="/dashboard/suppliers/ledger#statement"
                                  className="text-xs font-semibold text-primary hover:underline"
                                >
                                  {t('docType.toStatement')}
                                </Link>
                              ) : null}
                            </span>
                          ) : null}
                          {d.error ? (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-xs',
                                d.status === 'failed' || d.error === 'page_duplicate' ? 'text-danger' : 'text-muted',
                              )}
                            >
                              {/* An answered page question reads calmly (no warning glyph). */}
                              {ANSWERED.includes(d.error) ? null : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
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
                          {props.canManage && d.invoiceId && d.error && PAGE_QUESTIONS.includes(d.error) && d.questionOpen !== false ? (
                            <>
                              {/* ONE primary action per question (T2). */}
                              {d.error === 'page_duplicate' ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  className="min-h-11"
                                  disabled={resolvePage.isPending}
                                  onClick={() => setConfirmDup(d)}
                                >
                                  {t('inbox.pageDeleteDuplicate')}
                                </Button>
                              ) : COMPARE.includes(d.error) ? (
                                <LinkButton
                                  href={`/dashboard/inbox/compare?invoice=${d.invoiceId}`}
                                  size="sm"
                                  variant="primary"
                                  className="min-h-11"
                                >
                                  {t('inbox.pageCompare')}
                                </LinkButton>
                              ) : null}
                              {d.error === 'page_unreadable' ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  className="min-h-11"
                                  disabled={resolvePage.isPending}
                                  onClick={() =>
                                    act(
                                      () => resolvePage.mutateAsync({ documentId: d.id, action: 'close_unreadable' }),
                                      t('inbox.pageClosedUnreadable'),
                                    )
                                  }
                                >
                                  {t('inbox.pageCloseUnreadable')}
                                </Button>
                              ) : null}
                              {/* Round 9 (L12): a "same invoice?" question is answered on the compare page
                                  only, where "separate" asks first with both ₪ — never one tap here. */}
                              {d.error !== 'page_unreadable' && !COMPARE.includes(d.error) ? (
                                <Button
                                  size="sm"
                                  variant={d.error === 'page_duplicate' ? 'secondary' : 'primary'}
                                  className="min-h-11"
                                  disabled={resolvePage.isPending}
                                  onClick={() =>
                                    // A possible double payment is released only after a confirm (reversible).
                                    d.error === 'page_duplicate'
                                      ? setConfirmSep(d)
                                      : act(
                                          () => resolvePage.mutateAsync({ documentId: d.id, action: 'separate' }),
                                          t('inbox.pageSeparated'),
                                        )
                                  }
                                >
                                  {t('inbox.pageSeparate')}
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          {/* Round 10 (P6/P7): "one invoice" is undoable — the page asks again. */}
                          {props.canManage && d.invoiceId && d.error === 'page_checked_together' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="min-h-11"
                              disabled={resolvePage.isPending}
                              onClick={() =>
                                act(() => resolvePage.mutateAsync({ documentId: d.id, action: 'undo_checked_together' }), t('inbox.pageUndoneTogether'))
                              }
                            >
                              {t('inbox.pageUndoTogether')}
                            </Button>
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

      <ConfirmDialog
        open={confirmDup !== null}
        title={t('inbox.pageDeleteConfirmTitle')}
        body={
          <>
            <span>{t('inbox.pageDeleteConfirmBody')}</span>
            {confirmDup?.repeatsInvoiceId ? (
              <Link
                href={`/dashboard/invoices/${confirmDup.repeatsInvoiceId}`}
                className="mt-2 block font-semibold text-primary hover:underline"
              >
                {t('inbox.pageDeleteConfirmRepeats')}
              </Link>
            ) : null}
          </>
        }
        amount={shekels(confirmDup?.invoiceTotal)}
        party={confirmDup?.invoiceSupplier ?? undefined}
        confirmLabel={t('inbox.pageDeleteDuplicate')}
        cancelLabel={t('inbox.keep')}
        danger
        loading={resolvePage.isPending}
        onClose={() => setConfirmDup(null)}
        onConfirm={() => {
          const d = confirmDup;
          setConfirmDup(null);
          if (d) void act(() => resolvePage.mutateAsync({ documentId: d.id, action: 'delete_duplicate' }), t('inbox.pageDuplicateDeleted'));
        }}
      />

      <ConfirmDialog
        open={confirmSep !== null}
        title={t('inbox.pageSeparateConfirmTitle')}
        body={
          <>
            <span>{t('inbox.pageSeparateConfirmBody')}</span>
            {confirmSep?.repeatsInvoiceId ? (
              <Link
                href={`/dashboard/invoices/${confirmSep.repeatsInvoiceId}`}
                className="mt-2 block font-semibold text-primary hover:underline"
              >
                {t('inbox.pageDeleteConfirmRepeats')}
              </Link>
            ) : null}
          </>
        }
        amount={shekels(confirmSep?.invoiceTotal)}
        party={confirmSep?.invoiceSupplier ?? undefined}
        confirmLabel={t('inbox.pageSeparate')}
        cancelLabel={t('inbox.keep')}
        danger
        loading={resolvePage.isPending}
        onClose={() => setConfirmSep(null)}
        onConfirm={() => {
          const d = confirmSep;
          setConfirmSep(null);
          if (d) void act(() => resolvePage.mutateAsync({ documentId: d.id, action: 'separate' }), t('inbox.pageSeparated'));
        }}
      />

      {/* Bulk "פענחו N": sending to OCR is not a payment approval — no ₪ cap applies. */}
      {pickedIds.length > 0 ? (
        <div className="sticky bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px)+env(safe-area-inset-bottom)+0.75rem)] z-10 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card" role="region" aria-label={t('inbox.selected', { count: formatNumber(pickedIds.length, locale) })} data-testid="ingest-batch-bar">
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
