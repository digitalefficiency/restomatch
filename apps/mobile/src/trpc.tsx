import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import Constants from 'expo-constants';
import React, { useState } from 'react';
import superjson from 'superjson';
import type { AppRouter } from '@restomatch/api';

export const trpc = createTRPCReact<AppRouter>();

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  // When running on a physical device, expo hostUri carries the LAN IP
  const debugHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (debugHost) return `http://${debugHost}:3000`;
  return 'http://localhost:3000';
}

interface TrpcProviderProps {
  children: React.ReactNode;
}

export function TrpcProvider(props: TrpcProviderProps) {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${resolveBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    }),
  );

  // React 18/19 @types mismatch across the workspace. Runtime is unaffected.
  const TrpcReactProvider = trpc.Provider as unknown as React.ComponentType<{
    client: typeof client;
    queryClient: typeof queryClient;
    children: React.ReactNode;
  }>;
  const ReactQueryProvider = QueryClientProvider as unknown as React.ComponentType<{
    client: typeof queryClient;
    children: React.ReactNode;
  }>;

  return (
    <TrpcReactProvider client={client} queryClient={queryClient}>
      <ReactQueryProvider client={queryClient}>{props.children}</ReactQueryProvider>
    </TrpcReactProvider>
  );
}
