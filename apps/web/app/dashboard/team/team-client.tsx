'use client';

import { useState, useTransition } from 'react';
import { originalProps } from '@/lib/i18n/original';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { CheckCircle2, Copy, Info, RefreshCw, Trash2, UserPlus, XCircle } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input } from '@/lib/components';
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
  updateMemberRole,
} from './actions';
import { needsRoleConfirm } from './role-change';

type TeamData = inferRouterOutputs<AppRouter>['team']['list'];
type ActionResult = { ok: boolean; message: string; devLink?: string };
/** '' = no preference (follow the device / Hebrew default). */
type LocaleChoice = '' | Locale;

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}

const selectClass =
  'rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50';

export function TeamClient({
  initial,
  currentUserId,
  canManage,
}: {
  initial: TeamData;
  currentUserId: string;
  /** Owner: invites + roles + removal. Manager: read-only roster + language. */
  canManage: boolean;
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
          {status.devLink ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(status.devLink!);
                setCopied(true);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
              title={t('invite.copyLinkTitle')}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {copied ? t('invite.copied') : t('invite.copyLink')}
            </button>
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
        </Card>
      ) : (
        <Card padding="md" className="flex items-center gap-3 border-line text-sm text-muted">
          <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {t('managerNote')}
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
                    <bdi {...originalProps(m.name)}>{m.name || m.email}</bdi>
                    {m.userId === currentUserId ? (
                      <span className="ms-1 text-xs text-subtle">{t('members.you')}</span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-xs text-subtle" dir="ltr">
                    {m.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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

      {initial.invites.length ? (
        <Card flow elevated padding="lg">
          <h3 className="mb-4 text-lg font-bold text-ink">{t('pending.title')}</h3>
          <ul className="divide-y divide-line">
            {initial.invites.map((inv) => (
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
                      disabled={pending}
                      onClick={() => run(() => resendInvite({ id: inv.id }))}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      {t('pending.resend')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => revokeInvite({ id: inv.id }))}
                      className="text-danger"
                    >
                      {t('pending.revoke')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
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
