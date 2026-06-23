'use client';

import { useState, useTransition } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { CheckCircle2, Copy, RefreshCw, Trash2, UserPlus, XCircle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input } from '@/lib/components';
import { ROLE_LABELS } from '@/lib/roles';
import {
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
  updateMemberRole,
} from './actions';

type TeamData = inferRouterOutputs<AppRouter>['team']['list'];
type ActionResult = { ok: boolean; message: string; devLink?: string };

const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as [UserRole, string][];

const selectClass =
  'rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50';

const dateFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function TeamClient({
  initial,
  currentUserId,
}: {
  initial: TeamData;
  currentUserId: string;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<ActionResult | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('receiver');

  function run(action: () => Promise<ActionResult>) {
    setStatus(null);
    start(async () => {
      setStatus(await action());
    });
  }

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    run(async () => {
      const res = await inviteMember({ email: value, role });
      if (res.ok) setEmail('');
      return res;
    });
  }

  return (
    <div className="space-y-6">
      {status ? (
        <Card
          padding="md"
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
              onClick={() => navigator.clipboard?.writeText(status.devLink!)}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
              title="העתק קישור הזמנה (אין ספק מייל מוגדר)"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              העתק קישור
            </button>
          ) : null}
        </Card>
      ) : null}

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">הזמנת עובד</h3>
        <p className="mb-5 text-sm text-muted">
          מנהל משמרת שמקבל סחורה — בחרו "מקבל סחורה". נשלח קישור הצטרפות לכתובת המייל.
        </p>
        <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
          <Field label="כתובת מייל" htmlFor="invite-email" className="min-w-[16rem] flex-1">
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="worker@restaurant.co.il"
              autoComplete="off"
            />
          </Field>
          <Field label="תפקיד" htmlFor="invite-role">
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={selectClass}
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" loading={pending}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            שלח הזמנה
          </Button>
        </form>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-4 text-lg font-bold text-ink">חברי צוות</h3>
        <ul className="divide-y divide-line">
          {initial.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {m.name || m.email}
                  {m.userId === currentUserId ? (
                    <span className="mr-1 text-xs text-subtle"> (אתה)</span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-xs text-subtle">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`תפקיד עבור ${m.email}`}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) =>
                    run(() =>
                      updateMemberRole({ userId: m.userId, role: e.target.value as UserRole }),
                    )
                  }
                  className={selectClass}
                >
                  {ROLE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => removeMember({ userId: m.userId }))}
                  className="text-danger"
                  aria-label={`הסר את ${m.email}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {initial.invites.length ? (
        <Card flow elevated padding="lg">
          <h3 className="mb-4 text-lg font-bold text-ink">הזמנות ממתינות</h3>
          <ul className="divide-y divide-line">
            {initial.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {inv.email} <Badge tone="neutral">{ROLE_LABELS[inv.role]}</Badge>
                  </p>
                  <p className="text-xs text-subtle">בתוקף עד {dateFmt.format(inv.expiresAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => resendInvite({ id: inv.id }))}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    שלח שוב
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => revokeInvite({ id: inv.id }))}
                    className="text-danger"
                  >
                    בטל
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : initial.members.length === 0 ? (
        <EmptyState title="עדיין אין חברי צוות" description="הזמינו את העובד הראשון למעלה." />
      ) : null}
    </div>
  );
}
