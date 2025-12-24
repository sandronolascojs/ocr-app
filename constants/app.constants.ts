
import { ENV_DEFAULTS } from "./env-defaults.mjs";

export const APP = {
  id: "ocr-app",
  name: "OCR App",
  description: "OCR App",
  defaults: {
    /**
     * Default TTL for signed upload URLs (seconds).
     *
     * This is the repo-level default used when `R2_SIGNED_UPLOAD_TTL_SECONDS`
     * is not set in the environment.
     */
    signedUploadUrlTtlSeconds: ENV_DEFAULTS.R2_SIGNED_UPLOAD_TTL_SECONDS,

    /**
     * Default TTL for signed download URLs (seconds).
     *
     * This is the repo-level default used when `R2_SIGNED_DOWNLOAD_TTL_SECONDS`
     * is not set in the environment.
     */
    signedDownloadUrlTtlSeconds: ENV_DEFAULTS.R2_SIGNED_DOWNLOAD_TTL_SECONDS,
  },
} as const;