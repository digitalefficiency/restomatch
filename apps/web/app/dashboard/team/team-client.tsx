'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { originalProps } from '@/lib/i18n/original';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { CheckCircle2, Copy, Info, MessageCircle, RefreshCw, Trash2, UserPlus, XCircle } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, useToast } from '@/lib/components';
import type { Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { team } from '@/lib/i18n/messages/team';
import { ALL_ROLES, roleLabels } from '@/lib/roles';
import {
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
  setMemberLocale,
  transferOwnership,
  updateMemberRole,
} from './actions';
import { needsRoleConfirm } from './role-change';

type TeamData = inferRouterOutputs<AppRouter>['team']['list'];
type ActionResult = { ok: boolean; message: string; shareLink?: string; shareText?: string; shareQr?: string };
/** '' = no preference (follow the device / Hebrew default). */
type LocaleChoice = '' | Locale;

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}

/** How long a revoke waits for Undo before it is committed (≥ the toast's 10 s). */
const REVOKE_UNDO_MS = 10_000;

/**
 * Commit a deferred revoke even as the page goes away (pagehide): a keepalive
 * POST straight to the tRPC procedure (superjson body), so a revoke never
 * silently fails to happen because the tab closed inside the Undo window.
 */
function flushRevoke(id: string) {
  try {
    void fetch('/api/trpc/team.revokeInvite', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { id } }),
    });
  } catch {
    /* best effort on unload */
  }
}

const selectClass =
  'rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50';

export function TeamClient({
  initial,
  currentUserId,
  canManage,
  readOnly = false,
}: {
  initial: TeamData;
  currentUserId: string;
  /** Owner: invites + roles + removal. Manager: read-only roster + language. */
  canManage: boolean;
  /** Bookkeeper: names and roles only, no controls at all. */
  readOnly?: boolean;
}) {
  const t = useT(team);
  const locale = useLocale();
  const labels = roleLabels(locale);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<ActionResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('receiver');
  const [inviteLocale, setInviteLocale] = useState<LocaleChoice>('');
  // W2-14 staged role change: the select only STAGES; Save commits (with a
  // confirm for guarded transitions). Pending and the result are per row.
  const [staged, setStaged] = useState<Record<string, UserRole>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, ActionResult>>({});
  const [confirmRole, setConfirmRole] = useState<{ userId: string; name: string; from: UserRole; to: UserRole } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const toast = useToast();
  // Deferred revoke (W2-14, admin-26): hidden at once, committed after the Undo window.
  const pendingRevokes = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [hiddenInvites, setHiddenInvites] = useState<Set<string>>(new Set());
  useEffect(() => {
    const flushAll = () => {
      for (const [id, timer] of pendingRevokes.current) {
        clearTimeout(timer);
        flushRevoke(id);
      }
      pendingRevokes.current.clear();
    };
    window.addEventListener('pagehide', flushAll);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      flushAll(); // client-side navigation away also commits
    };
  }, []);

  function revokeWithUndo(id: string, email: string) {
    setHiddenInvites((s) => new Set(s).add(id));
    const timer = setTimeout(() => {
      pendingRevokes.current.delete(id);
      void revokeInvite({ id }).then((res) => {
        if (!res.ok) {
          setHiddenInvites((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
          setStatus(res);
        }
      });
    }, REVOKE_UNDO_MS);
    pendingRevokes.current.set(id, timer);
    toast.info(t('pending.revokedUndo', { email }), {
      duration: REVOKE_UNDO_MS,
      action: {
        label: t('pending.undo'),
        onClick: () => {
          clearTimeout(pendingRevokes.current.get(id));
          pendingRevokes.current.delete(id);
          setHiddenInvites((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        },
      },
    });
  }

  // Ownership transfer (W2-14): owner only, to an active member, confirmed.
  const others = initial.members.filter((m) => m.userId !== currentUserId);
  const [transferTo, setTransferTo] = useState('');
  const [myNewRole, setMyNewRole] = useState<'owner' | 'manager' | 'bookkeeper'>('manager');
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  function runRow(userId: string, action: () => Promise<ActionResult>, after?: (r: ActionResult) => void) {
    setRowBusy(userId);
    setRowStatus((s) => omit(s, userId));
    start(async () => {
      const res = await action();
      setRowStatus((s) => ({ ...s, [userId]: res }));
      after?.(res);
      setRowBusy(null);
    });
  }

  function clearStaged(userId: string) {
    setStaged((s) => omit(s, userId));
  }

  function commitRole(userId: string, from: UserRole, to: UserRole) {
    runRow(
      userId,
      () => updateMemberRole({ userId, role: to, expectedRole: from }),
      (res) => {
        if (res.ok) clearStaged(userId);
      },
    );
  }

  const languageOptions: Array<[LocaleChoice, string]> = [
    ['', t('language.device')],
    ['he', t('language.he')],
    ['en', t('language.en')],
  ];

  function run(action: () => Promise<ActionResult>) {
    setStatus(null);
    setCopied(false);
    start(async () => {
      setStatus(await action());
    });
  }

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    run(async () => {
      const res = await inviteMember({ email: value, role, locale: inviteLocale || null });
      if (res.ok) setEmail('');
      return res;
    });
  }

  return (
    <div className="space-y-6">
      {status ? (
        <Card
          padding="md"
          role="status"
          className={
            status.ok
              ? 'flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 text-primary'
              : 'flex flex-wrap items-center gap-2 border-danger/30 bg-danger/5 text-danger'
          }
        >
          {status.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm font-medium">{status.message}</span>
          {status.shareLink ? (
            <span className="inline-flex flex-wrap items-center gap-2" data-testid="invite-share">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(status.shareLink!);
                  setCopied(true);
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink hover:bg-surface-2"
                title={t('invite.copyLinkTitle')}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? t('invite.copied') : t('invite.copyLink')}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(status.shareText ?? status.shareLink)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink hover:bg-surface-2"
                data-testid="invite-whatsapp"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                {t('invite.whatsapp')}
              </a>
              {status.shareQr ? (
                // The worker scans the join link straight off the owner's screen.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.shareQr}
                  alt={t('invite.qrAlt')}
                  width={160}
                  height={160}
                  className="rounded-lg border border-line bg-white p-1"
                  data-testid="invite-qr"
                />
              ) : null}
            </span>
          ) : null}
        </Card>
      ) : null}

      {canManage ? (
        <Card flow elevated padding="lg">
          <h3 className="mb-1 text-lg font-bold text-ink">{t('invite.title')}</h3>
          <p className="mb-5 text-sm text-muted">{t('invite.subtitle')}</p>
          <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
            <Field label={t('invite.email')} htmlFor="invite-email" className="min-w-[16rem] flex-1">
              <Input
                id="invite-email"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="worker@restaurant.co.il"
                autoComplete="off"
              />
            </Field>
            <Field label={t('invite.role')} htmlFor="invite-role">
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className={selectClass}
              >
                {ALL_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {labels[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('invite.language')} htmlFor="invite-locale">
              <select
                id="invite-locale"
                value={inviteLocale}
                onChange={(e) => setInviteLocale(e.target.value as LocaleChoice)}
                className={selectClass}
              >
                {languageOptions.map(([value, label]) => (
                  <option key={value || 'device'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" loading={pending}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t('invite.submit')}
            </Button>
          </form>
          {/* W3-07b placeholder: "מה התפקיד רואה" — swaps to IA's roleLens (apps/web/lib/roleLens) once it lands. */}
          <p className="mt-4 text-sm text-muted" data-testid="role-sees">
            <span className="font-medium text-ink">{t('invite.roleSeesTitle')}</span> {t(`invite.roleSees.${role}`)}
          </p>
        </Card>
      ) : (
        <Card padding="md" className="flex items-center gap-3 border-line text-sm text-muted">
          <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {readOnly ? t('readOnlyNote') : t('managerNote')}
        </Card>
      )}

      <Card flow elevated padding="lg">
        <h3 className="mb-4 text-lg font-bold text-ink">{t('members.title')}</h3>
        {initial.members.length === 0 ? (
          <EmptyState title={t('empty.title')} description={t('empty.description')} />
        ) : (
          <ul className="divide-y divide-line">
            {initial.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    <bdi {...originalProps(m.name)}>{m.name || m.email || '—'}</bdi>
                    {m.userId === currentUserId ? (
                      <span className="ms-1 text-xs text-subtle">{t('members.you')}</span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-xs text-subtle" dir="ltr">
                    {m.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {readOnly ? null : (
                  <select
                    aria-label={t('members.languageFor', { email: m.email })}
                    value={m.preferredLocale ?? ''}
                    disabled={pending}
                    onChange={(e) =>
                      run(() =>
                        setMemberLocale({
                          userId: m.userId,
                          email: m.email,
                          locale: (e.target.value || null) as Locale | null,
                        }),
                      )
                    }
                    className={selectClass}
                  >
                    {languageOptions.map(([value, label]) => (
                      <option key={value || 'device'} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  )}
                  {canManage ? (
                    <>
                      <select
                        aria-label={t('members.roleFor', { email: m.email })}
                        value={staged[m.userId] ?? m.role}
                        disabled={rowBusy === m.userId || m.userId === currentUserId}
                        title={m.userId === currentUserId ? t('members.ownRoleLocked') : undefined}
                        onChange={(e) => {
                          const next = e.target.value as UserRole;
                          if (next === m.role) clearStaged(m.userId);
                          else setStaged((s) => ({ ...s, [m.userId]: next }));
                        }}
                        className={selectClass}
                      >
                        {ALL_ROLES.map((value) => (
                          <option key={value} value={value}>
                            {labels[value]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={rowBusy === m.userId || m.userId === currentUserId}
                        onClick={() => setConfirmRemove({ userId: m.userId, name: m.name || m.email })}
                        className="text-danger"
                        aria-label={t('members.remove', { email: m.email })}
                        title={t('members.remove', { email: m.email })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Badge tone="neutral">{labels[m.role]}</Badge>
                  )}
                </div>
                {staged[m.userId] ? (
                  <div
                    className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink"
                    role="group"
                    aria-label={t('members.stagedFor', { email: m.email })}
                  >
                    <span>
                      {t('members.staged', { from: labels[m.role], to: labels[staged[m.userId]!] })}
                    </span>
                    <Button
                      size="sm"
                      disabled={rowBusy === m.userId}
                      onClick={() => {
                        const to = staged[m.userId]!;
                        if (needsRoleConfirm(m.role, to)) {
                          setConfirmRole({ userId: m.userId, name: m.name || m.email, from: m.role, to });
                        } else {
                          commitRole(m.userId, m.role, to);
                        }
                      }}
                    >
                      {t('members.save')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={rowBusy === m.userId} onClick={() => clearStaged(m.userId)}>
                      {t('members.cancel')}
                    </Button>
                  </div>
                ) : null}
                {rowStatus[m.userId] ? (
                  <p
                    role="status"
                    className={`w-full text-sm ${rowStatus[m.userId]!.ok ? 'text-primary' : 'text-danger'}`}
                  >
                    {rowStatus[m.userId]!.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {initial.invites.some((i) => !hiddenInvites.has(i.id)) ? (
        <Card flow elevated padding="lg">
          <h3 className="mb-4 text-lg font-bold text-ink">{t('pending.title')}</h3>
          <ul className="divide-y divide-line">
            {initial.invites.filter((inv) => !hiddenInvites.has(inv.id)).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 truncate font-medium text-ink">
                    <span dir="ltr">{inv.email}</span> <Badge tone="neutral">{labels[inv.role]}</Badge>
                    {inv.preferredLocale === 'en' ? <Badge tone="neutral">EN</Badge> : null}
                  </p>
                  <p className="text-xs text-subtle">
                    {t('pending.validUntil', { date: formatDate(inv.expiresAt, locale) })}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={rowBusy === inv.id}
                      onClick={() => runRow(inv.id, () => resendInvite({ id: inv.id }))}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      {t('pending.resend')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeWithUndo(inv.id, inv.email)}
                      className="text-danger"
                    >
                      {t('pending.revoke')}
                    </Button>
                  </div>
                ) : null}
                {rowStatus[inv.id] ? (
                  <p role="status" className={`w-full text-sm ${rowStatus[inv.id]!.ok ? 'text-primary' : 'text-danger'}`}>
                    {rowStatus[inv.id]!.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {canManage && others.length > 0 ? (
        <Card flow elevated padding="lg" className="border-danger/40" data-testid="transfer-ownership">
          <h3 className="mb-1 text-lg font-bold text-ink">{t('transfer.title')}</h3>
          <p className="mb-4 text-sm text-muted">{t('transfer.body')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('transfer.to')} htmlFor="transfer-to" className="min-w-[14rem] flex-1">
              <select
                id="transfer-to"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                className={`${selectClass} w-full`}
              >
                <option value="">{t('transfer.choose')}</option>
                {others.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('transfer.myRole')} htmlFor="transfer-my-role">
              <select
                id="transfer-my-role"
                value={myNewRole}
                onChange={(e) => setMyNewRole(e.target.value as typeof myNewRole)}
                className={selectClass}
              >
                {(['manager', 'bookkeeper', 'owner'] as const).map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="secondary"
              className="border-danger/60 text-danger"
              disabled={!transferTo || pending}
              onClick={() => setConfirmTransfer(true)}
            >
              {t('transfer.cta')}
            </Button>
          </div>
        </Card>
      ) : null}
      <ConfirmDialog
        open={confirmTransfer}
        title={t('transfer.confirmTitle', {
          name: others.find((m) => m.userId === transferTo)?.name || others.find((m) => m.userId === transferTo)?.email || '',
        })}
        body={
          <div className="space-y-2">
            <p>{t('roleSummary.owner')}</p>
            <p>{t('transfer.confirmMine', { role: labels[myNewRole] })}</p>
          </div>
        }
        confirmLabel={t('transfer.cta')}
        cancelLabel={t('members.cancel')}
        danger
        loading={pending}
        onConfirm={() => {
          const to = transferTo;
          setConfirmTransfer(false);
          run(() => transferOwnership({ toUserId: to, myNewRole }));
        }}
        onClose={() => setConfirmTransfer(false)}
      />
      <ConfirmDialog
        open={confirmRole !== null}
        title={
          confirmRole
            ? t('members.confirmRoleTitle', {
                name: confirmRole.name,
                from: labels[confirmRole.from],
                to: labels[confirmRole.to],
              })
            : ''
        }
        body={
          confirmRole ? (
            <div className="space-y-2">
              <p>{t(`roleSummary.${confirmRole.from}`)}</p>
              <p className="font-medium">{t(`roleSummary.${confirmRole.to}`)}</p>
              {confirmRole.to === 'owner' ? <p>{t('members.ownerWarning')}</p> : null}
            </div>
          ) : null
        }
        confirmLabel={t('members.confirmRoleCta')}
        cancelLabel={t('members.cancel')}
        danger={confirmRole?.to === 'owner'}
        loading={confirmRole !== null && rowBusy === confirmRole.userId}
        onConfirm={() => {
          if (!confirmRole) return;
          commitRole(confirmRole.userId, confirmRole.from, confirmRole.to);
          setConfirmRole(null);
        }}
        onClose={() => setConfirmRole(null)}
      />
      <ConfirmDialog
        open={confirmRemove !== null}
        title={confirmRemove ? t('members.confirmRemoveTitle', { name: confirmRemove.name }) : ''}
        body={t('members.confirmRemoveBody')}
        confirmLabel={t('members.removeCta')}
        cancelLabel={t('members.cancel')}
        danger
        onConfirm={() => {
          if (!confirmRemove) return;
          const { userId } = confirmRemove;
          runRow(userId, () => removeMember({ userId }));
          setConfirmRemove(null);
        }}
        onClose={() => setConfirmRemove(null)}
      />
    </div>
  );
}
