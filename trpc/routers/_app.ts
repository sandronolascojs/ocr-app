import { createTRPCRouter } from '../init';
import { ocrRouter } from './ocr';

export const appRouter = createTRPCRouter({
  ocr: ocrRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;