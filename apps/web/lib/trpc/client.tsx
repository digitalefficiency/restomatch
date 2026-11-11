'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import superjson from 'superjson';
import type { AppRouter } from '@restomatch/api';
import { ShellResilience, type Identity } from '@/lib/net/ShellResilience';
import { createAppQueryClient, onRouteChange } from './queryClient';

export const trpc = createTRPCReact<AppRouter>();

/** The connectivity + session layer belongs to signed-in surfaces, not the public lead form. */
function wantsShellLayer(pathname: string | null): boolean {
  return !!pathname && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/onboarding'));
}

export function TrpcProvider({
  children,
  identity,
}: {
  children: React.ReactNode;
  /** Whose page this is (the dashboard layout's session), for the re-auth sheet. */
  identity?: Identity;
}) {
  const pathname = usePathname();
  const [queryClient] = useState(createAppQueryClient);
  // Each landed client navigation: a revisited list uses its fresh server rows.
  useEffect(() => onRouteChange(queryClient), [pathname, queryClient]);
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        {wantsShellLayer(pathname) ? <ShellResilience identity={identity} /> : null}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
