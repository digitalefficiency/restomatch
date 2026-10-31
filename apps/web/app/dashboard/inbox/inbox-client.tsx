'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  Mail,
  MessageCircle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  cn,
  useToast,
  type BadgeTone,
} from '@/lib/components';
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
  }>;
  /** orderCapture: a forwarded WhatsApp order (text) and the draft PO captured from it. */
  order?: { poId: string | null; poStatus: string | null } | null;
}

interface Props {
  filter: 'all' | 'needs_review' | 'errors';
  canManage: boolean;
  features: Record<Kind, boolean>;
  needsReview: number;
  channels: Array<{ kind: Kind; tokenHint: string; phoneNumberId: string | null }>;
  senders: Array<{
    id: string;
    kind: Kind;
    sender: string;
    label: string | null;
    supplierName: string | null;
  }>;
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
  'page_separate',
] as const;
/** Flags that still ask a person something (page_separate is already answered). */
const PAGE_QUESTIONS: readonly string[] = [
  'page_other_supplier',
  'page_other_invoice',
  'page_duplicate',
  'page_unreadable',
  'page_not_merged',
];

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
  const router = useRouter();
  const toast = useToast();
  const kinds = (['whatsapp', 'email'] as const).filter((k) => props.features[k]);

  const approve = trpc.ingest.approveDocument.useMutation();
  const reject = trpc.ingest.rejectDocument.useMutation();
  const resolvePage = trpc.ingest.resolvePageFlag.useMutation();
  const [supplierFor, setSupplierFor] = useState<Record<string, string>>({});

  const errorText = (code: string | null) =>
    code && (KNOWN_ERRORS as readonly string[]).includes(code)
      ? t(`errors.${code as (typeof KNOWN_ERRORS)[number]}`)
      : t('errors.unknown');

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (err) {
      toast.error(t('inbox.actionFailed', { message: err instanceof Error ? err.message : '' }));
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={t('inbox.title')}
      >
        {(['all', 'needs_review', 'errors'] as const).map((f) => (
          <Link
            key={f}
            role="tab"
            aria-selected={props.filter === f}
            href={f === 'all' ? '/dashboard/inbox' : `/dashboard/inbox?filter=${f}`}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors',
              props.filter === f
                ? 'border-primary/50 bg-primary/12 text-primary'
                : 'border-line text-muted hover:border-primary/30 hover:text-ink',
            )}
          >
            {t(`inbox.filters.${f}`)}
          </Link>
        ))}
        {props.needsReview > 0 ? (
          <Badge tone="warning-solid">
            {t('inbox.needsReviewCount', { count: formatNumber(props.needsReview, locale) })}
          </Badge>
        ) : null}
      </div>

      {/* Messages */}
      {props.messages.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title={t('inbox.emptyTitle')}
          description={t('inbox.emptyDescription')}
        />
      ) : (
        <ul className="space-y-3" data-testid="ingest-messages">
          {props.messages.map((m) => (
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
                        <div className="flex min-w-0 items-center gap-2 text-sm">
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
                          {props.canManage && d.invoiceId && d.error && PAGE_QUESTIONS.includes(d.error) ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="min-h-11"
                                disabled={resolvePage.isPending}
                                onClick={() =>
                                  act(
                                    () => resolvePage.mutateAsync({ documentId: d.id, action: 'separate' }),
                                    t('inbox.pageSeparated'),
                                  )
                                }
                              >
                                {t('inbox.pageSeparate')}
                              </Button>
                              {d.error === 'page_duplicate' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="min-h-11"
                                  disabled={resolvePage.isPending}
                                  onClick={() =>
                                    act(
                                      () => resolvePage.mutateAsync({ documentId: d.id, action: 'delete_duplicate' }),
                                      t('inbox.pageDuplicateDeleted'),
                                    )
                                  }
                                >
                                  {t('inbox.pageDeleteDuplicate')}
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Channels + allow-list */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChannelsCard {...props} kinds={kinds} />
        <SendersCard {...props} kinds={kinds} />
      </div>
    </div>
  );
}

function ChannelsCard({ canManage, channels, kinds }: Props & { kinds: Kind[] }) {
  const t = useT(ingest);
  const router = useRouter();
  const toast = useToast();
  const rotate = trpc.ingest.rotateChannel.useMutation();
  const revoke = trpc.ingest.revokeChannel.useMutation();
  const [fresh, setFresh] = useState<{ kind: Kind; value: string } | null>(null);
  const [phoneId, setPhoneId] = useState('');
  const [copied, setCopied] = useState(false);

  return (
    <Card padding="md" elevated data-testid="ingest-channels">
      <h2 className="text-base font-bold text-ink">{t('channels.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('channels.subtitle')}</p>
      <ul className="mt-4 space-y-4">
        {kinds.map((kind) => {
          const live = channels.find((c) => c.kind === kind);
          return (
            <li key={kind} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KindIcon kind={kind} className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-ink">
                    {kind === 'whatsapp' ? t('channels.whatsappTitle') : t('channels.emailTitle')}
                  </span>
                </div>
                <Badge tone={live ? 'accent' : 'neutral'}>
                  {live ? t('channels.active', { hint: live.tokenHint }) : t('channels.notSet')}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-subtle">
                {kind === 'whatsapp' ? t('channels.whatsappHint') : t('channels.emailHint')}
              </p>
              {canManage ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {kind === 'whatsapp' ? (
                    <Input
                      aria-label={t('channels.phoneNumberId')}
                      placeholder={t('channels.phoneNumberId')}
                      inputMode="numeric"
                      dir="ltr"
                      className="min-h-11 w-56"
                      value={phoneId}
                      onChange={(e) => setPhoneId(e.target.value.replace(/\D/g, ''))}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={rotate.isPending}
                    onClick={async () => {
                      try {
                        const r = await rotate.mutateAsync({
                          kind,
                          ...(kind === 'whatsapp' && phoneId.length >= 5
                            ? { phoneNumberId: phoneId }
                            : {}),
                        });
                        setFresh({ kind, value: (r.address ?? r.webhookUrl)! });
                        setCopied(false);
                        router.refresh();
                      } catch (err) {
                        toast.error(
                          t('inbox.actionFailed', {
                            message: err instanceof Error ? err.message : '',
                          }),
                        );
                      }
                    }}
                  >
                    {live ? t('channels.rotate') : t('channels.generate')}
                  </Button>
                  {live ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      disabled={revoke.isPending}
                      onClick={async () => {
                        await revoke.mutateAsync({ kind }).catch(() => null);
                        toast.success(t('channels.revoked'));
                        router.refresh();
                      }}
                    >
                      {t('channels.revoke')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {live && canManage ? (
                <p className="mt-2 text-xs text-warn">{t('channels.rotateWarning')}</p>
              ) : null}
              {fresh?.kind === kind ? (
                <div
                  className="mt-3 rounded-lg border border-primary/30 bg-primary/8 p-3"
                  data-testid="ingest-fresh-secret"
                >
                  <p className="text-xs font-semibold text-ink">{t('channels.newSecret')}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code dir="ltr" className="min-w-0 flex-1 break-all font-mono text-xs text-ink">
                      {fresh.value}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(fresh.value).catch(() => null);
                        setCopied(true);
                      }}
                    >
                      {copied ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      {copied ? t('channels.copied') : t('channels.copy')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SendersCard({ canManage, senders, suppliers, kinds }: Props & { kinds: Kind[] }) {
  const t = useT(ingest);
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const add = trpc.ingest.addSender.useMutation();
  const remove = trpc.ingest.removeSender.useMutation();
  const [kind, setKind] = useState<Kind>(kinds[0] ?? 'email');
  const [sender, setSender] = useState('');
  const [label, setLabel] = useState('');
  const [supplierId, setSupplierId] = useState('');

  return (
    <Card padding="md" elevated data-testid="ingest-senders">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('senders.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('senders.subtitle')}</p>
      {senders.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">{t('senders.empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {senders.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <KindIcon kind={s.kind} className="h-4 w-4 shrink-0 text-muted" />
                <span dir="ltr" className="truncate font-mono text-xs">
                  {s.sender}
                </span>
                {s.label ? <span className="truncate text-xs text-subtle">{s.label}</span> : null}
                {s.supplierName ? (
                  <Badge tone="info">
                    <span {...originalProps(s.supplierName)}>{s.supplierName}</span>
                  </Badge>
                ) : null}
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`${t('senders.remove')} ${s.sender}`}
                  onClick={async () => {
                    await remove.mutateAsync({ id: s.id }).catch(() => null);
                    toast.success(t('senders.removed'));
                    router.refresh();
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && kinds.length > 0 ? (
        <form
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await add.mutateAsync({
                kind,
                sender,
                ...(label ? { label } : {}),
                ...(supplierId ? { supplierId } : {}),
              });
              setSender('');
              setLabel('');
              toast.success(t('senders.added'));
              router.refresh();
            } catch {
              toast.error(t('senders.invalid'));
            }
          }}
        >
          <Select
            aria-label={t('inbox.title')}
            className="min-h-11"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            required
            dir="ltr"
            className="min-h-11"
            aria-label={t('senders.senderPlaceholder')}
            placeholder={t('senders.senderPlaceholder')}
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
          <Input
            className="min-h-11"
            aria-label={t('senders.labelPlaceholder')}
            placeholder={t('senders.labelPlaceholder')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select
            aria-label={t('inbox.supplierLabel')}
            className="min-h-11"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t('inbox.supplierNone')}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {locale === 'en' && s.nameEn ? s.nameEn : s.name}
              </option>
            ))}
          </Select>
          <Button type="submit" className="min-h-11 sm:col-span-2" disabled={add.isPending}>
            {t('senders.add')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
