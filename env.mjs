import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    OPENAI_API_KEY: z.string(),
  },
  runtimeEnv: process.env,
});