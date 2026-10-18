'use client';

import { useTransition } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { chain } from '@/lib/i18n/messages/chain';
import { switchBranchAction } from '../branch-actions';

/** "Go to this branch": switches the active restaurant (server-validated) and opens its overview. */
export function SwitchBranchButton({
  restaurantId,
  label,
  variant = 'secondary',
  testId,
}: {
  restaurantId: string;
  label: string;
  variant?: 'secondary' | 'danger' | 'primary' | 'ghost';
  testId?: string;
}) {
  const t = useT(chain);
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      loading={pending}
      data-testid={testId}
      onClick={() =>
        start(async () => {
          const res = await switchBranchAction(restaurantId).catch(() => ({ ok: false as const }));
          if (res.ok) window.location.assign('/dashboard');
          else toast.error(t('switcher.failed'));
        })
      }
    >
      {label}
      <ArrowLeft className="h-3.5 w-3.5 ltr:-scale-x-100" aria-hidden="true" />
    </Button>
  );
}
