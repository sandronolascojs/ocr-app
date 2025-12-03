import 'server-only';

import { createHydrationHelpers } from '@trpc/react-query/rsc';
import { cache } from 'react';
import { createCallerFactory, createTRPCContext } from './init';
import { makeQueryClient } from './query-client';
import { appRouter } from './routers/_app';

// Create a stable getter for the query client so every prefetch call in the same
// request shares the identical instance that will later be dehydrated.
export const getQueryClient = cache(makeQueryClient);

const createCaller = createCallerFactory(appRouter);
export const caller = createCaller(createTRPCContext);

export const { trpc, HydrateClient } = createHydrationHelpers<typeof appRouter>(
  caller,
  getQueryClient,
);