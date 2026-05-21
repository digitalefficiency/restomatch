import { createTRPCClient, httpBatchLink, type CreateTRPCClient } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from './index.js';

export function createApiClient(baseUrl: string, getHeaders?: () => Record<string, string>) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: getHeaders,
      }),
    ],
  });
}

export type ApiClient = CreateTRPCClient<AppRouter>;
