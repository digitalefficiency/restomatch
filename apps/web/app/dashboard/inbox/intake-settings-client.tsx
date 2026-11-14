'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Copy, Mail, MessageCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, Select, useToast } from '@/lib/components';
import { ConfirmDialog } from '@/lib/components/ConfirmDialog';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { ingest } from '@/lib/i18n/messages/ingest';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';

type Kind = 'whatsapp' | 'email';

export interface IntakeSettingsProps {
  canManage: boolean;
  kinds: Kind[];
  channels: Array<{ kind: Kind; tokenHint: string; phoneNumberId: string | null }>;
  senders: Array<{ id: string; kind: Kind; sender: string; label: string | null; supplierName: string | null }>;
  suppliers: Array<{ id: string; name: string; nameEn: string | null }>;
}
type Props = IntakeSettingsProps;

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  return kind === 'whatsapp' ? <MessageCircle className={className} aria-hidden="true" /> : <Mail className={className} aria-hidden="true" />;
}

/**
 * W2-02 (approvals-33/34/35): intake addresses and the sender allow-list, moved
 * off the inbox queue. Revoke and remove ask first (naming the channel / sender),
 * report a real failure, and "copied" shows only when the clipboard resolved.
 * Only the touched list refetches — no router.refresh().
 */
export function IntakeSettings(props: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChannelsCard {...props} />
      <SendersCard {...props} />
    </div>
  );
}

function ChannelsCard({ canManage, channels, kinds }: Props) {
  const t = useT(ingest);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const toast = useToast();
  const rotate = trpc.ingest.rotateChannel.useMutation();
  const revoke = trpc.ingest.revokeChannel.useMutation();
  const [live, setLive] = useState(channels);
  const [fresh, setFresh] = useState<{ kind: Kind; value: string } | null>(null);
  const [phoneId, setPhoneId] = useState('');
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [confirmKind, setConfirmKind] = useState<Kind | null>(null);
  const secretRef = useRef<HTMLElement | null>(null);
  const refetch = async () => {
    const r = await utils.ingest.overview.fetch();
    setLive(r.channels.map((c) => ({ kind: c.kind as Kind, tokenHint: c.tokenHint, phoneNumberId: c.phoneNumberId })));
  };
  const channelName = (k: Kind) => (k === 'whatsapp' ? t('channels.whatsappTitle') : t('channels.emailTitle'));

  return (
    <Card padding="md" elevated data-testid="ingest-channels">
      <h2 className="text-base font-bold text-ink">{t('channels.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('channels.subtitle')}</p>
      <ul className="mt-4 space-y-4">
        {kinds.map((kind) => {
          const current = live.find((c) => c.kind === kind);
          return (
            <li key={kind} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KindIcon kind={kind} className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-ink">
                    {kind === 'whatsapp' ? t('channels.whatsappTitle') : t('channels.emailTitle')}
                  </span>
                </div>
                <Badge tone={current ? 'accent' : 'neutral'}>
                  {current ? t('channels.active', { hint: current.tokenHint }) : t('channels.notSet')}
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
                        setCopy('idle');
                        await refetch();
                      } catch (err) {
                        toast.error(
                          t('inbox.actionFailed', {
                            message: err instanceof Error ? err.message : '',
                          }),
                        );
                      }
                    }}
                  >
                    {current ? t('channels.rotate') : t('channels.generate')}
                  </Button>
                  {current ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      disabled={revoke.isPending}
                      onClick={async () => {
                        setConfirmKind(kind);
                      }}
                    >
                      {t('channels.revoke')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {current && canManage ? (
                <p className="mt-2 text-xs text-warn">{t('channels.rotateWarning')}</p>
              ) : null}
              {fresh?.kind === kind ? (
                <div
                  className="mt-3 rounded-lg border border-primary/30 bg-primary/8 p-3"
                  data-testid="ingest-fresh-secret"
                >
                  <p className="text-xs font-semibold text-ink">{t('channels.newSecret')}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code ref={secretRef} dir="ltr" data-testid="ingest-secret" className="min-w-0 flex-1 break-all font-mono text-xs text-ink">
                      {fresh.value}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      onClick={async () => {
                        // "copied" only when the promise resolves; otherwise select the secret for a manual copy.
                        try {
                          if (!navigator.clipboard) throw new Error('no clipboard');
                          await navigator.clipboard.writeText(fresh.value);
                          setCopy('copied');
                        } catch {
                          setCopy('manual');
                          const el = secretRef.current;
                          const sel = window.getSelection();
                          if (el && sel) {
                            const range = document.createRange();
                            range.selectNodeContents(el);
                            sel.removeAllRanges();
                            sel.addRange(range);
                          }
                        }
                      }}
                    >
                      {copy === 'copied' ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      {copy === 'copied' ? t('channels.copied') : t('channels.copy')}
                    </Button>
                  </div>
                  {copy === 'manual' ? (
                    <p role="status" className="mt-2 text-xs font-semibold text-warn" data-testid="ingest-copy-manual">
                      {t('channels.copyFailed')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirmKind !== null}
        danger
        title={confirmKind ? t('channels.revokeConfirmTitle', { channel: channelName(confirmKind) }) : ''}
        body={t('channels.revokeConfirmBody')}
        confirmLabel={t('channels.revokeConfirm')}
        cancelLabel={t('channels.cancel')}
        loading={revoke.isPending}
        onClose={() => setConfirmKind(null)}
        onConfirm={async () => {
          const kind = confirmKind;
          if (!kind) return;
          try {
            await revoke.mutateAsync({ kind });
            toast.success(t('channels.revoked'));
            setConfirmKind(null);
            await refetch();
          } catch (err) {
            toast.error(localizeServerError(err, locale, t('channels.revokeFailed')));
          }
        }}
      />
    </Card>
  );
}

function SendersCard({ canManage, senders, suppliers, kinds }: Props) {
  const t = useT(ingest);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const toast = useToast();
  const add = trpc.ingest.addSender.useMutation();
  const remove = trpc.ingest.removeSender.useMutation();
  const [list, setList] = useState(senders);
  const [confirm, setConfirm] = useState<{ id: string; sender: string } | null>(null);
  const refetch = async () => {
    const r = await utils.ingest.senders.fetch();
    setList(r.map((s) => ({ id: s.id, kind: s.kind as Kind, sender: s.sender, label: s.label, supplierName: s.supplierName ?? null })));
  };
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
      {list.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">{t('senders.empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {list.map((s) => (
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
                  onClick={() => setConfirm({ id: s.id, sender: s.sender })}
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
              await refetch();
            } catch {
              toast.error(t('senders.invalid'));
            }
          }}
        >
          <Select
            aria-label={t('senders.kindLabel')}
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
      <ConfirmDialog
        open={confirm !== null}
        danger
        title={confirm ? t('senders.removeConfirmTitle', { sender: confirm.sender }) : ''}
        body={t('senders.removeConfirmBody')}
        confirmLabel={t('senders.removeConfirm')}
        cancelLabel={t('channels.cancel')}
        loading={remove.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await remove.mutateAsync({ id: confirm.id });
            toast.success(t('senders.removed'));
            setConfirm(null);
            await refetch();
          } catch (err) {
            toast.error(localizeServerError(err, locale, t('senders.removeFailed')));
          }
        }}
      />
    </Card>
  );
}
