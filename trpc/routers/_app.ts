import { createTRPCRouter } from '../init';
import { ocrRouter } from './ocr';
import { jobsRouter } from './jobs';
import { subtitlesRouter } from './subtitles';
import { apiKeysRouter } from './apiKeys';
import { teamsRouter } from './teams';

export const appRouter = createTRPCRouter({
  ocr: ocrRouter,
  jobs: jobsRouter,
  subtitles: subtitlesRouter,
  apiKeys: apiKeysRouter,
  teams: teamsRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;