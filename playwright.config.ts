import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

// Load environment variables from .env files
// Priority order: .env.test (highest) > .env.local > .env
// Later files override earlier ones, but system env vars take precedence

// First, load base .env file if it exists (lowest priority)
if (existsSync(resolve(process.cwd(), ".env"))) {
  config({ path: resolve(process.cwd(), ".env"), override: false });
}

// Then load .env.local if it exists (medium priority)
if (existsSync(resolve(process.cwd(), ".env.local"))) {
  config({ path: resolve(process.cwd(), ".env.local"), override: true });
}

// Finally, load .env.test if it exists (highest priority for tests)
if (existsSync(resolve(process.cwd(), ".env.test"))) {
  config({ path: resolve(process.cwd(), ".env.test"), override: true });
}

/**
 * Base URL for E2E tests. Defaults to http://localhost:3000
 * Can be overridden with E2E_BASE_URL environment variable.
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

/**
 * Environment variables required for E2E tests:
 * - E2E_OPENAI_API_KEY or OPENAI_API_KEY: OpenAI API key for testing
 *   (used to mock API key setup in full-upload-flow.spec.ts)
 * - E2E_DATABASE_URL or DATABASE_URL: Database connection string for user setup/cleanup
 * - E2E_BASE_URL: Base URL for the application (defaults to http://localhost:3000)
 */

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: 0,
  timeout: 90_000,
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

