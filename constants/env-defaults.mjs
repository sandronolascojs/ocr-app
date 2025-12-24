/**
 * Centralized defaults for server environment values.
 *
 * Keep this file ESM + plain JS so it can be imported from `env.mjs` (Node runtime)
 * and also from TypeScript files (tsconfig has allowJs enabled).
 */
export const ENV_DEFAULTS = /** @type {const} */ ({
  /**
   * Signed upload URL TTL (seconds).
   * 12 hours = 43,200 seconds.
   */
  R2_SIGNED_UPLOAD_TTL_SECONDS: 60 * 60 * 12,

  /**
   * Signed download URL TTL (seconds).
   * 2 hours = 7,200 seconds.
   */
  R2_SIGNED_DOWNLOAD_TTL_SECONDS: 60 * 60 * 2,
});


