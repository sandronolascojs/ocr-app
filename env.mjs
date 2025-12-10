import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.url().optional(),
    API_KEY_ENCRYPTION_SECRET: z.string(),
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
    OCR_BASE_DIR: z.string().optional(),
    ALLOWED_ORIGINS: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});