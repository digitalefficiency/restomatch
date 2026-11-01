'use client';

import { useTransition } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { chain } from '@/lib/i18n/messages/chain';
import { common } from '@/lib/i18n/messages/common';
import { switchBranchAction } from '../branch-actions';

/**
 * "עבדו כסניף הזה": switches the active restaurant (server-validated) and opens
 * `then` in it (its home by default).
 *
 * One action, one verb (chain-31): the session switch always reads
 * "עבדו כסניף הזה", whatever label a call site still passes, and never renders
 * danger-solid — it is navigation, not a destructive act. Drill-down links
 * ("open this branch's queue") are plain links, not this button.
 */
export function SwitchBranchButton({
  restaurantId,
  branchName,
  then = '/dashboard',
  variant = 'secondary',
  testId,
}: {
  restaurantId: string;
  /** Deprecated (chain-31): ignored, the verb is fixed. Kept so call sites compile. */
  label?: string;
  /** Names the branch in the accessible name when several buttons share a screen. */
  branchName?: string;
  /** Where to land in the target branch (a same-origin /dashboard path). */
  then?: string;
  variant?: 'secondary' | 'danger' | 'primary' | 'ghost';
  testId?: string;
}) {
  const t = useT(chain);
  const tc = useT(common);
  const toast = useToast();
  const [pending, start] = useTransition();
  const visible = tc('shell.branch.workAs');
  return (
    <Button
      type="button"
      size="sm"
      variant={variant === 'danger' ? 'secondary' : variant}
      loading={pending}
      data-testid={testId}
      onClick={() =>
        start(async () => {
          const res = await switchBranchAction(restaurantId).catch(() => ({ ok: false as const }));
          if (res.ok) window.location.assign(then.startsWith('/dashboard') ? then : '/dashboard');
          else toast.error(t('switcher.failed'));
        })
      }
    >
      {visible}
      {/* Visible text first, then the branch (axe label-content-name-mismatch). */}
      {branchName ? <span className="sr-only"> — {branchName}</span> : null}
      <ArrowLeft className="h-3.5 w-3.5 ltr:-scale-x-100" aria-hidden="true" />
    </Button>
  );
}
