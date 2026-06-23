'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

const ROLES = [
  { key: 'owner', label: 'בעלים' },
  { key: 'manager', label: 'מנהל' },
  { key: 'receiver', label: 'קבלן' },
  { key: 'bookkeeper', label: 'הנה"ח' },
  { key: 'chef', label: 'שף' },
] as const;

type Role = (typeof ROLES)[number]['key'];

interface Member {
  userId: string;
  role: string;
  email: string;
}

/** Admin per-member role editor (setMemberRole). Blocks demoting the last owner
 *  server-side — surfaced here as the mutation error. */
export function MemberRoles({ restaurantId, members }: { restaurantId: string; members: Member[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRole = trpc.admin.setMemberRole.useMutation({
    onSuccess: () => {
      setPendingId(null);
      setError(null);
      router.refresh();
    },
    onError: (e) => {
      setError(e.message);
      setPendingId(null);
    },
  });

  return (
    <div>
      <ul className="space-y-2 text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-4">
            <span className="truncate text-ink">{m.email}</span>
            <select
              value={m.role}
              disabled={setRole.isPending && pendingId === m.userId}
              onChange={(e) => {
                setPendingId(m.userId);
                setError(null);
                setRole.mutate({ restaurantId, userId: m.userId, role: e.target.value as Role });
              }}
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
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
