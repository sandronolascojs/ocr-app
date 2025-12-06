import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    OPENAI_API_KEY: z.string(),
    CLOUDFLARE_R2_ACCOUNT_ID: z.string(),
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string(),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string(),
    CLOUDFLARE_R2_BUCKET_NAME: z.string(),
    CLOUDFLARE_R2_S3_ENDPOINT: z.url().optional(),
    R2_SIGNED_UPLOAD_TTL_SECONDS: z
      .coerce.number()
      .int()
      .positive()
      .default(900),
    R2_SIGNED_DOWNLOAD_TTL_SECONDS: z
      .coerce.number()
      .int()
      .positive()
      .default(900),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});