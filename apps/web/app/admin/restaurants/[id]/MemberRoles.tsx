'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { ALL_ROLES, roleLabels } from '@/lib/roles';
import { localizeServerError } from '@/lib/serverErrors';
import { StagedChange } from '../../_components/StagedChange';

type Role = (typeof ALL_ROLES)[number];

interface Member {
  userId: string;
  role: string;
  email: string;
  name?: string | null;
  preferredLocale?: string | null;
}

/**
 * Admin per-member role editor (setMemberRole). W3-07a: picking a role only
 * stages it; the write happens on confirm, with a reason. One staged change at
 * a time. Demoting the last owner is refused server-side and shown here.
 */
export function MemberRoles({ restaurantId, members }: { restaurantId: string; members: Member[] }) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const labels = roleLabels(locale);
  const [staged, setStaged] = useState<{ userId: string; email: string; from: string; to: Role } | null>(null);

  const setRole = trpc.admin.setMemberRole.useMutation({
    onSuccess: () => {
      setStaged(null);
      router.refresh();
    },
  });

  const label = (r: string) => labels[r as Role] ?? r;
  const error = setRole.error
    ? setRole.error.data?.code === 'CONFLICT'
      ? t('roles.lastOwner')
      : localizeServerError(setRole.error, locale, t('generic'))
    : null;

  return (
    <div>
      <ul className="space-y-3 text-sm">
        {members.map((m) => {
          const shown = staged?.userId === m.userId ? staged.to : m.role;
          return (
            <li key={m.userId} className="flex items-center justify-between gap-4">
              <span className="min-w-0">
                {m.name ? <span className="block truncate font-medium text-ink">{m.name}</span> : null}
                <span className="block truncate text-xs text-muted" dir="ltr">
                  {m.email}
                  {m.preferredLocale === 'en' ? ' · EN' : ''}
                </span>
              </span>
              <select
                value={shown}
                aria-label={t('roles.roleFor', { email: m.email })}
                disabled={staged !== null && staged.userId !== m.userId}
                onChange={(e) => {
                  const to = e.target.value as Role;
                  setRole.reset();
                  setStaged(to === m.role ? null : { userId: m.userId, email: m.email, from: m.role, to });
                }}
                className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {staged ? (
        <StagedChange
          fields={[
            {
              key: `role.${staged.userId}`,
              label: t('staged.fieldRole', { email: staged.email }),
              before: label(staged.from),
              after: label(staged.to),
            },
          ]}
          pending={setRole.isPending}
          error={error}
          onConfirm={(reason) =>
            setRole.mutate({ restaurantId, userId: staged.userId, role: staged.to, reason })
          }
          onCancel={() => {
            setStaged(null);
            setRole.reset();
          }}
        />
      ) : null}
    </div>
  );
}
