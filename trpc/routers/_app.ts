import { createTRPCRouter } from '../init';
import { ocrRouter } from './ocr';
import { apiKeysRouter } from './apiKeys';
import { teamsRouter } from './teams';

export const appRouter = createTRPCRouter({
  ocr: ocrRouter,
  apiKeys: apiKeysRouter,
  teams: teamsRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;