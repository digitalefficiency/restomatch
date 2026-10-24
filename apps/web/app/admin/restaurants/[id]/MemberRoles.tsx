'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { ALL_ROLES, roleLabels } from '@/lib/roles';
import { localizeServerError } from '@/lib/serverErrors';

type Role = (typeof ALL_ROLES)[number];

interface Member {
  userId: string;
  role: string;
  email: string;
  name?: string | null;
  preferredLocale?: string | null;
}

/** Admin per-member role editor (setMemberRole). Blocks demoting the last owner
 *  server-side — surfaced here as the mutation error. */
export function MemberRoles({ restaurantId, members }: { restaurantId: string; members: Member[] }) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const labels = roleLabels(locale);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRole = trpc.admin.setMemberRole.useMutation({
    onSuccess: () => {
      setPendingId(null);
      setError(null);
      router.refresh();
    },
    onError: (e) => {
      setError(
        e.data?.code === 'CONFLICT' ? t('roles.lastOwner') : localizeServerError(e, locale, t('generic')),
      );
      setPendingId(null);
    },
  });

  return (
    <div>
      <ul className="space-y-3 text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-4">
            <span className="min-w-0">
              {m.name ? <span className="block truncate font-medium text-ink">{m.name}</span> : null}
              <span className="block truncate font-mono text-xs text-muted" dir="ltr">
                {m.email}
                {m.preferredLocale === 'en' ? ' · EN' : ''}
              </span>
            </span>
            <select
              value={m.role}
              aria-label={t('roles.roleFor', { email: m.email })}
              disabled={setRole.isPending && pendingId === m.userId}
              onChange={(e) => {
                setPendingId(m.userId);
                setError(null);
                setRole.mutate({ restaurantId, userId: m.userId, role: e.target.value as Role });
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
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
