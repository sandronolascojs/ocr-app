'use client';
// ^-- ensures the provider mounts from a server component boundary

import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from './query-client';
import type { appRouter } from './routers/_app';
import superjson from 'superjson';

export const trpc = createTRPCReact<typeof appRouter>();

export const useTRPC = () => trpc;

let clientQueryClientSingleton: QueryClient;

const getQueryClient = () => {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  return (clientQueryClientSingleton ??= makeQueryClient());
};

const getUrl = () => {
  const base = (() => {
    if (typeof window !== 'undefined') return '';
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return 'http://localhost:3000';
  })();
  return `${base}/api/trpc`;
};

interface TRPCProviderProps {
  children: ReactNode;
}

export const TRPCProvider = ({ children }: TRPCProviderProps) => {
  // Avoid useState when creating the query client because React can discard it
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: getUrl(),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};