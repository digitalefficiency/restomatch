'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * After a density or text-size change: re-render the server components, so the
 * attributes the shell sets on the server from the cookies (DS3-02,
 * app/dashboard/layout.tsx → ShellFrame `data-density` / `data-text`) follow
 * at once, as the provider's own attributes already have. A layout is not
 * re-rendered by a navigation, so without this the shell would keep the old
 * value until a reload. Harmless where the shell sets nothing.
 */
export function useShellRefresh(): () => void {
  const router = useRouter();
  const [, start] = useTransition();
  return useCallback(() => start(() => router.refresh()), [router]);
}
