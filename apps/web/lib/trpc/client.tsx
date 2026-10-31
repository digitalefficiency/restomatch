'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import superjson from 'superjson';
import type { AppRouter } from '@restomatch/api';
import { ShellResilience } from '@/lib/net/ShellResilience';
import { createAppQueryClient } from './queryClient';

export const trpc = createTRPCReact<AppRouter>();

/** The connectivity + session layer belongs to signed-in surfaces, not the public lead form. */
function wantsShellLayer(pathname: string | null): boolean {
  return !!pathname && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/onboarding'));
}

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [queryClient] = useState(createAppQueryClient);
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
        {wantsShellLayer(pathname) ? <ShellResilience /> : null}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
